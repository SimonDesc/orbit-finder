"""Mission orders: the marketplace backbone, kept minimal.

- Tenancy: every order belongs to an account; every query is scoped by account id, and another
  account's order is indistinguishable from a missing one (404).
- Entitlements: an account can only order apps it holds a licence for.
- Metering: an order books the next passes able to run the app; a pass counts as consumed (and
  billable) once its time is past, unless the order was cancelled before it.

Accounts are hard-coded demo tenants selected with a header. In production they would come from
an OAuth/OIDC token (tenant claim) and live in the database with their licences.
"""

import json
import sqlite3
import uuid
from contextlib import closing
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from app.catalog import APPS_BY_ID


@dataclass(frozen=True)
class Account:
    id: str
    name: str
    licensed_apps: tuple[str, ...]


ACCOUNTS = {
    a.id: a
    for a in (
        Account(
            "civil-protection-sud",
            "Civil Protection, South of France",
            ("wildfire-detection", "flood-mapping", "change-detection"),
        ),
        Account(
            "port-authority-marseille",
            "Port Authority of Marseille",
            ("vessel-detection", "change-detection"),
        ),
        Account(
            "fire-service-centro",
            "Regional Fire Service, Centro (Portugal)",
            ("wildfire-detection", "change-detection"),
        ),
        Account(
            "civil-protection-romagna",
            "Civil Protection, Emilia-Romagna",
            ("flood-mapping", "change-detection"),
        ),
        Account("agri-coop-occitanie", "Occitanie Farmers' Cooperative", ("crop-health",)),
    )
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    app_id TEXT NOT NULL,
    place TEXT NOT NULL,
    bbox TEXT NOT NULL,              -- JSON [w, s, e, n]
    passes TEXT NOT NULL,            -- JSON list of {satellite, norad_id, time}
    price_eur_per_pass INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    cancelled_at TEXT
);
CREATE INDEX IF NOT EXISTS orders_account ON orders (account_id, created_at);
"""


class OrderError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


class OrderStore:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        with closing(self._connect()) as db, db:
            db.executescript(SCHEMA)

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.path)
        db.row_factory = sqlite3.Row
        return db

    def create(
        self,
        account: Account,
        app_id: str,
        place: str,
        bbox: list[float],
        passes: list[dict],
        unit_price_eur: int | None = None,  # after discount and options; list price if None
    ) -> dict:
        app = APPS_BY_ID.get(app_id)
        if not app:
            raise OrderError(404, "Unknown app")
        if app_id not in account.licensed_apps:
            raise OrderError(
                403, f"{account.name} has no licence for {app.name}. Request access first."
            )
        if not passes:
            raise OrderError(409, f"No pass in the coming days can run {app.name} over this area.")
        order_id = uuid.uuid4().hex[:12]
        now = _now()
        with closing(self._connect()) as db, db:
            db.execute(
                "INSERT INTO orders VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)",
                (
                    order_id,
                    account.id,
                    app_id,
                    place,
                    json.dumps(bbox),
                    json.dumps(passes),
                    app.price_eur_per_pass if unit_price_eur is None else unit_price_eur,
                    now.isoformat(),
                ),
            )
        return self.get(account, order_id)

    def list(self, account: Account) -> list[dict]:
        with closing(self._connect()) as db:
            rows = db.execute(
                "SELECT * FROM orders WHERE account_id = ? ORDER BY created_at DESC", (account.id,)
            ).fetchall()
        return [_with_usage(r) for r in rows]

    def get(self, account: Account, order_id: str) -> dict:
        with closing(self._connect()) as db:
            row = db.execute(
                "SELECT * FROM orders WHERE id = ? AND account_id = ?", (order_id, account.id)
            ).fetchone()
        if not row:
            raise OrderError(404, "Order not found")
        return _with_usage(row)

    def cancel(self, account: Account, order_id: str) -> dict:
        order = self.get(account, order_id)  # scopes to the account, 404 otherwise
        if order["status"] == "cancelled":
            return order
        with closing(self._connect()) as db, db:
            db.execute(
                "UPDATE orders SET cancelled_at = ? WHERE id = ? AND account_id = ?",
                (_now().isoformat(), order_id, account.id),
            )
        return self.get(account, order_id)


def _now() -> datetime:
    return datetime.now(UTC)


def _with_usage(row: sqlite3.Row, now: datetime | None = None) -> dict:
    """Metering is derived from pass times, so it is always up to date without a job."""
    now = now or _now()
    cancelled_at = datetime.fromisoformat(row["cancelled_at"]) if row["cancelled_at"] else None
    cutoff = min(now, cancelled_at) if cancelled_at else now
    passes = json.loads(row["passes"])
    for p in passes:
        t = datetime.fromisoformat(p["time"])  # py3.11+ parses "Z"
        p["state"] = "consumed" if t <= cutoff else ("cancelled" if cancelled_at else "scheduled")
    consumed = sum(p["state"] == "consumed" for p in passes)
    scheduled = sum(p["state"] == "scheduled" for p in passes)
    price = row["price_eur_per_pass"]
    if cancelled_at:
        status = "cancelled"
    elif scheduled:
        status = "active"
    else:
        status = "completed"
    return {
        "id": row["id"],
        "app_id": row["app_id"],
        "place": row["place"],
        "bbox": json.loads(row["bbox"]),
        "created_at": row["created_at"],
        "cancelled_at": row["cancelled_at"],
        "status": status,
        "passes": passes,
        "usage": {
            "passes_booked": len(passes),
            "passes_consumed": consumed,
            "passes_remaining": scheduled,
            "price_eur_per_pass": price,
            "billed_eur": consumed * price,
            "committed_eur": (consumed + scheduled) * price,
        },
    }
