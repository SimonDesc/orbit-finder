"""Map tiles rendered on the fly from a Sentinel-2 scene's true-colour COG (10 m).

Only scene ids are accepted, never URLs: the COG location is looked up in the STAC catalog and
must live in the public Sentinel-2 bucket, so the endpoint can't be used to fetch arbitrary hosts.
"""

import re
from functools import lru_cache
from urllib.parse import urlparse

import httpx
from rio_tiler.errors import TileOutsideBounds
from rio_tiler.io import Reader

from app.config import get_settings

SCENE_ID = re.compile(r"^S2[A-D]_\d{2}[A-Z]{3}_\d{8}_\d+_L2A$")
ALLOWED_HOST = "sentinel-cogs.s3.us-west-2.amazonaws.com"
MIN_ZOOM, MAX_ZOOM = 8, 16  # below 8 a tile spans many scenes; above 16 is beyond 10 m pixels

_assets: dict[str, dict[str, str]] = {}


class SceneNotFound(Exception):
    pass


async def asset_url(http: httpx.AsyncClient, scene_id: str, asset: str = "visual") -> str:
    """URL of one band/asset of a scene, looked up in STAC and checked against the bucket."""
    if not SCENE_ID.match(scene_id):
        raise SceneNotFound("Invalid scene id")
    if scene_id not in _assets:
        s = get_settings()
        r = await http.get(f"{s.stac_url}/collections/{s.stac_collection}/items/{scene_id}")
        if r.status_code == 404:
            raise SceneNotFound("Unknown scene")
        r.raise_for_status()
        _assets[scene_id] = {k: v.get("href", "") for k, v in r.json().get("assets", {}).items()}
    href = _assets[scene_id].get(asset, "")
    if urlparse(href).hostname != ALLOWED_HOST:
        raise SceneNotFound(f"Scene has no '{asset}' image in the public bucket")
    return href


async def visual_url(http: httpx.AsyncClient, scene_id: str) -> str:
    return await asset_url(http, scene_id, "visual")


@lru_cache(maxsize=512)
def render_tile(url: str, z: int, x: int, y: int) -> bytes | None:
    """WebP tile with transparency outside the scene footprint; None if the tile is off-scene."""
    try:
        with Reader(url) as src:
            img = src.tile(x, y, z)
    except TileOutsideBounds:
        return None
    return img.render(img_format="WEBP")
