"""Map tiles rendered on the fly from a Sentinel-2 scene's true-colour COG (10 m).

Only scene ids are accepted, never URLs: the COG location is looked up in the STAC catalog and
must live in the public Sentinel-2 bucket, so the endpoint can't be used to fetch arbitrary hosts.
"""

import os
import re
from functools import lru_cache
from urllib.parse import urlparse

# rasterio wheels ship their own PROJ database; a system-wide PROJ_LIB (e.g. set by a PostGIS
# install) points them at an incompatible one.
os.environ.pop("PROJ_LIB", None)
os.environ.pop("PROJ_DATA", None)
# Read public COGs over HTTP efficiently: no S3 credentials, no directory listing, merged ranges.
for k, v in {
    "AWS_NO_SIGN_REQUEST": "YES",
    "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
    "GDAL_HTTP_MERGE_CONSECUTIVE_RANGES": "YES",
    "GDAL_HTTP_MULTIPLEX": "YES",
    "VSI_CACHE": "TRUE",
    "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".tif",
}.items():
    os.environ.setdefault(k, v)

import httpx
from rio_tiler.errors import TileOutsideBounds
from rio_tiler.io import Reader

from app.config import get_settings

SCENE_ID = re.compile(r"^S2[A-D]_\d{2}[A-Z]{3}_\d{8}_\d+_L2A$")
ALLOWED_HOST = "sentinel-cogs.s3.us-west-2.amazonaws.com"
MIN_ZOOM, MAX_ZOOM = 8, 16  # below 8 a tile spans many scenes; above 16 is beyond 10 m pixels

_visual_urls: dict[str, str] = {}


class SceneNotFound(Exception):
    pass


async def visual_url(http: httpx.AsyncClient, scene_id: str) -> str:
    if not SCENE_ID.match(scene_id):
        raise SceneNotFound("Invalid scene id")
    if scene_id in _visual_urls:
        return _visual_urls[scene_id]
    s = get_settings()
    r = await http.get(f"{s.stac_url}/collections/{s.stac_collection}/items/{scene_id}")
    if r.status_code == 404:
        raise SceneNotFound("Unknown scene")
    r.raise_for_status()
    href = r.json().get("assets", {}).get("visual", {}).get("href", "")
    if urlparse(href).hostname != ALLOWED_HOST:
        raise SceneNotFound("Scene has no true-colour image in the public bucket")
    _visual_urls[scene_id] = href
    return href


@lru_cache(maxsize=512)
def render_tile(url: str, z: int, x: int, y: int) -> bytes | None:
    """WebP tile with transparency outside the scene footprint; None if the tile is off-scene."""
    try:
        with Reader(url) as src:
            img = src.tile(x, y, z)
    except TileOutsideBounds:
        return None
    return img.render(img_format="WEBP")
