"""Demo catalog of AI apps that run onboard satellites.

Partners and prices are fictional. The point is the marketplace mechanics: each app declares the
sensor it needs, which decides which satellite passes can run it (optical needs daylight, thermal
infrared does not), what it delivers and how fast.
"""

from typing import Literal

from pydantic import BaseModel

Sensor = Literal["optical", "thermal"]


class App(BaseModel):
    id: str
    name: str
    partner: str
    category: str
    summary: str
    sensor: Sensor
    needs_daylight: bool
    output: str
    latency_min: int  # from satellite pass to insight delivered on the ground
    price_eur_per_pass: int
    when_to_use: str  # guidance for the LLM


CATALOG: list[App] = [
    App(
        id="flood-mapping",
        name="FloodWatch",
        partner="Hydra Analytics",
        category="Disaster response",
        summary="Segments open water and flooded land, compared with a dry reference image.",
        sensor="optical",
        needs_daylight=True,
        output="Flood extent polygons (GeoJSON) with flooded area in hectares",
        latency_min=15,
        price_eur_per_pass=180,
        when_to_use="floods, flooded fields or roads, river overflow, water extent",
    ),
    App(
        id="wildfire-detection",
        name="FireSentry",
        partner="Ember Labs",
        category="Environment",
        summary="Detects active fire hotspots and small smoke plumes from thermal infrared.",
        sensor="thermal",
        needs_daylight=False,
        output="Hotspot points with fire radiative power, smoke plume outlines",
        latency_min=5,
        price_eur_per_pass=120,
        when_to_use="wildfires, forest fires, hotspots, smoke, burned areas",
    ),
    App(
        id="vessel-detection",
        name="HarborEye",
        partner="Bluewake AI",
        category="Maritime",
        summary="Finds ships and estimates their length and heading in ports and coastal waters.",
        sensor="optical",
        needs_daylight=True,
        output="Vessel points with length, heading and confidence",
        latency_min=10,
        price_eur_per_pass=90,
        when_to_use="ships, boats, vessels, ports, maritime traffic, coastline",
    ),
    App(
        id="change-detection",
        name="DeltaScan",
        partner="Terrachange",
        category="Monitoring",
        summary="Flags what changed since a reference date: construction, clearing, new roads.",
        sensor="optical",
        needs_daylight=True,
        output="Changed-area polygons with change type and confidence",
        latency_min=20,
        price_eur_per_pass=150,
        when_to_use="changes, construction, deforestation, urban growth, damage assessment",
    ),
    App(
        id="crop-health",
        name="AgriPulse",
        partner="Fieldsense",
        category="Agriculture",
        summary="Scores vegetation vigour per field from multispectral bands (NDVI) and flags stress.",
        sensor="optical",
        needs_daylight=True,
        output="Per-field vigour index and stress alerts",
        latency_min=30,
        price_eur_per_pass=60,
        when_to_use="crops, fields, vineyards, vegetation health, drought stress, agriculture",
    ),
]

APPS_BY_ID = {a.id: a for a in CATALOG}
AppId = Literal[tuple(APPS_BY_ID)]  # type: ignore[valid-type]


def catalog_for_prompt() -> str:
    return "\n".join(
        f"- {a.id}: {a.name} ({a.category}). {a.summary} Use for: {a.when_to_use}." for a in CATALOG
    )
