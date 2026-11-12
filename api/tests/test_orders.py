import json
import sqlite3
from contextlib import closing
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app import main, orbits
from app.orders import ACCOUNTS, OrderError, OrderStore, _with_usage

CIVIL = ACCOUNTS["civil-protection-sud"]
PORT = ACCOUNTS["port-authority-marseille"]
NOW = datetime(2026, 11, 12, 12, tzinfo=UTC)


def iso(dt: datetime) -> str:
    return dt.isoformat().replace("+00:00", "Z")


def passes(*hours: int) -> list[dict]:
    return [
        {"satellite": "SENTINEL-2C", "norad_id": 60989, "time": iso(NOW + timedelta(hours=h))}
        for h in hours
    ]


@pytest.fixture
def store(tmp_path):
    return OrderStore(tmp_path / "test.db")


def test_entitlement_is_required(store):
    with pytest.raises(OrderError) as exc:
        store.create(PORT, "wildfire-detection", "Maures", [6, 43, 6.5, 43.4], passes(5))
    assert exc.value.status == 403


def test_orders_are_isolated_between_accounts(store):
    order = store.create(CIVIL, "wildfire-detection", "Maures", [6, 43, 6.5, 43.4], passes(5))
    assert [o["id"] for o in store.list(CIVIL)] == [order["id"]]
    assert store.list(PORT) == []
    for action in (store.get, store.cancel):
        with pytest.raises(OrderError) as exc:
            action(PORT, order["id"])
        assert exc.value.status == 404


def test_no_usable_pass_is_refused(store):
    with pytest.raises(OrderError) as exc:
        store.create(CIVIL, "flood-mapping", "Toulouse", [1, 43, 2, 44], [])
    assert exc.value.status == 409


def test_metering_bills_only_passes_flown_before_cancellation(store):
    order = store.create(CIVIL, "wildfire-detection", "Maures", [6, 43, 6.5, 43.4], passes(5))
    with closing(sqlite3.connect(store.path)) as db, db:
        db.execute(
            "UPDATE orders SET passes = ?, cancelled_at = ? WHERE id = ?",
            (json.dumps(passes(-30, -2, 10)), iso(NOW - timedelta(hours=1)), order["id"]),
        )
        db.row_factory = sqlite3.Row
        row = db.execute("SELECT * FROM orders WHERE id = ?", (order["id"],)).fetchone()

    out = _with_usage(row, now=NOW)
    assert out["status"] == "cancelled"
    assert [p["state"] for p in out["passes"]] == ["consumed", "consumed", "cancelled"]
    assert out["usage"] == {
        "passes_booked": 3,
        "passes_consumed": 2,
        "passes_remaining": 0,
        "price_eur_per_pass": 120,
        "billed_eur": 240,
        "committed_eur": 240,
    }


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main.settings, "data_dir", tmp_path)

    async def fake_sats(http):
        return []

    def fake_passes(sats, box, start, days):
        night = {"daylight": False, "time": iso(NOW + timedelta(days=1)), "norad_id": 1}
        day = {"daylight": True, "time": iso(NOW + timedelta(days=2)), "norad_id": 2}
        return [{**night, "satellite": "N"}, {**day, "satellite": "D"}]

    monkeypatch.setattr(orbits, "get_satellites", fake_sats)
    monkeypatch.setattr(orbits, "find_passes", fake_passes)
    with TestClient(main.app) as c:
        yield c


def test_order_api_flow(client):
    body = {"app_id": "flood-mapping", "place": "Toulouse", "bbox": [1.35, 43.53, 1.52, 43.67]}
    assert client.post("/api/orders", json=body).status_code == 401  # no account

    h = {"X-Demo-Account": CIVIL.id}
    r = client.post("/api/orders", json=body, headers=h)
    assert r.status_code == 201
    order = r.json()
    # Optical app: only the daylight pass is booked, priced server-side.
    assert [p["satellite"] for p in order["passes"]] == ["D"]
    assert order["usage"]["committed_eur"] == 180

    other = {"X-Demo-Account": PORT.id}
    assert client.get("/api/orders", headers=other).json() == []
    assert client.post(f"/api/orders/{order['id']}/cancel", headers=other).status_code == 404
    assert client.post("/api/orders", json=body, headers=other).status_code == 403

    cancelled = client.post(f"/api/orders/{order['id']}/cancel", headers=h).json()
    assert cancelled["status"] == "cancelled"
    assert cancelled["usage"]["billed_eur"] == 0
