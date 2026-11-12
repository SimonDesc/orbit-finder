"""Price of a mission: the app's list price per pass, a volume discount, a priority option.

Computed here and only here: the client shows the same quote from GET /api/pricing, but an order
is always priced server-side from the passes the server itself validated.
"""

from typing import Literal

from app.catalog import App

Priority = Literal["standard", "priority"]

# (minimum passes in the order, discount on the list price)
VOLUME_TIERS: list[tuple[int, float]] = [(1, 0.0), (5, 0.10), (10, 0.20)]
# Priority tasking: the pass is reserved ahead of other customers' requests on that satellite.
PRIORITY_SURCHARGE: dict[str, float] = {"standard": 0.0, "priority": 0.25}


def volume_discount(n: int) -> float:
    return max((d for m, d in VOLUME_TIERS if n >= m), default=0.0)


def quote(app: App, n: int, priority: Priority = "standard") -> dict:
    discount = volume_discount(n)
    surcharge = PRIORITY_SURCHARGE[priority]
    unit = round(app.price_eur_per_pass * (1 - discount) * (1 + surcharge))
    return {
        "passes": n,
        "list_price_eur": app.price_eur_per_pass,
        "discount": discount,
        "surcharge": surcharge,
        "unit_price_eur": unit,
        "total_eur": unit * n,
    }


def pricing_terms() -> dict:
    return {
        "volume_tiers": [{"min_passes": m, "discount": d} for m, d in VOLUME_TIERS],
        "priority": PRIORITY_SURCHARGE,
    }
