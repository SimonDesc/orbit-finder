import json
from datetime import date

import httpx
import pytest

from app.geo import BBox
from app.stac import search_scenes

ITEM = {
    "type": "Feature",
    "id": "S2B_31TCJ_20261031_0_L2A",
    "geometry": {"type": "Polygon", "coordinates": [[[1, 43], [2, 43], [2, 44], [1, 43]]]},
    "properties": {
        "datetime": "2026-10-31T10:58:59.408000Z",
        "platform": "sentinel-2b",
        "eo:cloud_cover": 2.1,
        "grid:code": "MGRS-31TCJ",
    },
    "assets": {
        "thumbnail": {"href": "https://x/preview.jpg"},
        "visual": {"href": "https://x/TCI.tif"},
    },
    "links": [{"rel": "self", "href": "https://stac/items/S2B"}],
}


@pytest.mark.anyio
async def test_search_scenes_builds_query_and_slims_items():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"features": [ITEM], "context": {"matched": 1}})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        fc = await search_scenes(
            http, BBox.parse("1.3,43.5,1.5,43.7"), date(2026, 10, 1), date(2026, 11, 11), 20, 10
        )

    body = seen["body"]
    assert body["collections"] == ["sentinel-2-l2a"]
    assert body["bbox"] == [1.3, 43.5, 1.5, 43.7]
    assert body["datetime"] == "2026-10-01T00:00:00Z/2026-11-11T23:59:59Z"
    assert body["query"] == {"eo:cloud_cover": {"lte": 20}}

    assert fc["matched"] == 1
    props = fc["features"][0]["properties"]
    assert props["thumbnail"] == "https://x/preview.jpg"
    assert props["cloud_cover"] == 2.1
    assert props["stac_url"] == "https://stac/items/S2B"


@pytest.fixture
def anyio_backend():
    return "asyncio"
