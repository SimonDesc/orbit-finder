from datetime import date

import httpx

from app.config import get_settings
from app.geo import BBox


async def search_scenes(
    http: httpx.AsyncClient,
    bbox: BBox,
    date_from: date,
    date_to: date,
    max_cloud: float,
    limit: int,
) -> dict:
    """Search Sentinel-2 L2A scenes on Earth Search and return a slim GeoJSON FeatureCollection."""
    s = get_settings()
    body = {
        "collections": [s.stac_collection],
        "bbox": bbox.as_list(),
        "datetime": f"{date_from.isoformat()}T00:00:00Z/{date_to.isoformat()}T23:59:59Z",
        "query": {"eo:cloud_cover": {"lte": max_cloud}},
        "sortby": [{"field": "properties.datetime", "direction": "desc"}],
        "limit": limit,
    }
    r = await http.post(f"{s.stac_url}/search", json=body)
    r.raise_for_status()
    data = r.json()

    features = [_slim(f) for f in data.get("features", [])]
    return {
        "type": "FeatureCollection",
        "features": features,
        "matched": data.get("context", {}).get("matched", data.get("numberMatched")),
    }


def _slim(feature: dict) -> dict:
    """Keep only what the UI needs; the full item stays reachable through `stac_url`."""
    p = feature.get("properties", {})
    assets = feature.get("assets", {})
    self_link = next(
        (ln["href"] for ln in feature.get("links", []) if ln.get("rel") == "self"), None
    )
    return {
        "type": "Feature",
        "id": feature["id"],
        "geometry": feature.get("geometry"),
        "properties": {
            "datetime": p.get("datetime"),
            "platform": p.get("platform"),
            "cloud_cover": p.get("eo:cloud_cover"),
            "tile": p.get("grid:code"),
            "thumbnail": assets.get("thumbnail", {}).get("href"),
            "visual": assets.get("visual", {}).get("href"),
            "stac_url": self_link,
        },
    }
