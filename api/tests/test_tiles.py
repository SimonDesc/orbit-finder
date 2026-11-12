import httpx
import pytest
from fastapi.testclient import TestClient

from app import tiles
from app.main import app

ID = "S2B_31TCJ_20261031_0_L2A"


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture(autouse=True)
def clear_cache():
    tiles._visual_urls.clear()


def stac_returning(href: str):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"assets": {"visual": {"href": href}}})

    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


@pytest.mark.anyio
async def test_visual_url_from_public_bucket():
    href = f"https://{tiles.ALLOWED_HOST}/sentinel-s2-l2a-cogs/31/T/CJ/2026/10/{ID}/TCI.tif"
    async with stac_returning(href) as http:
        assert await tiles.visual_url(http, ID) == href


@pytest.mark.anyio
@pytest.mark.parametrize(
    "scene_id, href",
    [
        ("../../etc/passwd", "https://sentinel-cogs.s3.us-west-2.amazonaws.com/x.tif"),
        (ID, "http://169.254.169.254/latest/meta-data"),  # never fetch another host
    ],
)
async def test_visual_url_rejects_bad_ids_and_hosts(scene_id, href):
    async with stac_returning(href) as http:
        with pytest.raises(tiles.SceneNotFound):
            await tiles.visual_url(http, scene_id)


def test_tile_endpoint_validates_zoom_and_id():
    with TestClient(app) as client:
        assert client.get(f"/api/scenes/{ID}/tiles/3/4/2.webp").status_code == 404
        assert client.get("/api/scenes/not-a-scene/tiles/10/500/400.webp").status_code == 404


def test_apps_catalog():
    with TestClient(app) as client:
        apps = client.get("/api/apps").json()
    assert {a["id"] for a in apps} >= {"flood-mapping", "wildfire-detection"}
    fire = next(a for a in apps if a["id"] == "wildfire-detection")
    assert fire["needs_daylight"] is False
