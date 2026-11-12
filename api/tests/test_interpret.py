import json
from datetime import date
from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import interpret as interp
from app.interpret import InterpretError, bbox_around, extract, interpret
from app.ratelimit import RateLimiter

TODAY = date(2026, 11, 12)


class FakeLLM:
    """Mimics AsyncOpenAI.chat.completions.create, replaying canned outputs."""

    def __init__(self, *outputs: str):
        self.outputs = list(outputs)
        self.calls: list[dict] = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    async def _create(self, **kwargs):
        self.calls.append(kwargs)
        content = self.outputs.pop(0)
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])


def llm_json(**overrides) -> str:
    base = {
        "place": "Toulouse, France",
        "nearby_town": "Toulouse, France",
        "radius_km": None,
        "date_from": "2026-11-05",
        "date_to": "2026-11-12",
        "app_id": "flood-mapping",
        "app_reason": "Flood extent mapping answers a question about flooded fields.",
        "max_cloud": None,
        "intent": "Flooded fields around Toulouse last week.",
    }
    return json.dumps(base | overrides)


TOULOUSE_HIT = {
    "display_name": "Toulouse, Haute-Garonne, Occitanie, France",
    "lat": "43.6044622",
    "lon": "1.4442469",
    "boundingbox": ["43.5327", "43.6687", "1.3503", "1.5153"],
}
FRANCE_HIT = {
    "display_name": "France",
    "lat": "46.6",
    "lon": "1.88",
    "boundingbox": ["41.3", "51.1", "-5.2", "9.6"],
}


def nominatim(hits_by_query: dict[str, list]):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=hits_by_query.get(request.url.params["q"], []))

    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


@pytest.fixture(autouse=True)
def clear_geocode_cache():
    interp._geocode_cache.clear()


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_extract_puts_today_in_prompt_and_parses():
    llm = FakeLLM(llm_json())
    q = await extract(llm, "some/model", "champs inondés autour de Toulouse", TODAY)
    assert q.place == "Toulouse, France"
    assert q.date_from == date(2026, 11, 5)
    assert "2026-11-12" in llm.calls[0]["messages"][0]["content"]
    assert llm.calls[0]["response_format"]["type"] == "json_schema"


@pytest.mark.anyio
async def test_extract_retries_once_on_invalid_output():
    llm = FakeLLM("not json at all", "```json\n" + llm_json() + "\n```")
    q = await extract(llm, "m", "Toulouse", TODAY)
    assert q.app_id == "flood-mapping"
    assert len(llm.calls) == 2
    assert "Invalid JSON" in llm.calls[1]["messages"][-1]["content"]


@pytest.mark.anyio
async def test_extract_gives_up_after_two_invalid_outputs():
    with pytest.raises(InterpretError):
        await extract(FakeLLM("{}", "{}"), "m", "Toulouse", TODAY)


@pytest.mark.anyio
async def test_interpret_uses_geocoded_bbox_and_defaults():
    async with nominatim({"Toulouse, France": [TOULOUSE_HIT]}) as http:
        out = await interpret(FakeLLM(llm_json()), "m", http, "x", TODAY)
    q = out["query"]
    assert q["bbox"] == [1.3503, 43.5327, 1.5153, 43.6687]
    assert (q["date_from"], q["date_to"]) == ("2026-11-05", "2026-11-12")
    assert q["max_cloud"] == 30
    assert out["warnings"] == []
    assert out["app_id"] == "flood-mapping"


@pytest.mark.anyio
async def test_interpret_radius_future_dates_and_no_matching_app():
    llm = FakeLLM(llm_json(radius_km=20, date_from=None, date_to="2027-01-01", app_id=None))
    async with nominatim({"Toulouse, France": [TOULOUSE_HIT]}) as http:
        out = await interpret(llm, "m", http, "x", TODAY)
    q = out["query"]
    assert q["date_to"] == "2026-11-12"  # clamped to today
    assert q["date_from"] == "2026-10-13"  # default 30-day window
    assert q["bbox"][3] - q["bbox"][1] == pytest.approx(40 / 111.32, abs=1e-3)
    assert out["app_id"] is None
    assert any("No app in the catalog" in w for w in out["warnings"])


@pytest.mark.anyio
async def test_interpret_narrows_very_large_areas():
    async with nominatim({"France": [FRANCE_HIT]}) as http:
        out = await interpret(FakeLLM(llm_json(place="France")), "m", http, "x", TODAY)
    w, s, e, n = out["query"]["bbox"]
    assert e - w < 2 and n - s < 2
    assert out["warnings"]


@pytest.mark.anyio
@pytest.mark.parametrize("place", [None, "Atlantis"])
async def test_interpret_errors_without_a_locatable_place(place):
    async with nominatim({}) as http:
        with pytest.raises(InterpretError):
            await interpret(FakeLLM(llm_json(place=place)), "m", http, "x", TODAY)


def test_bbox_around_is_square_in_km():
    w, s, e, n = bbox_around(43.6, 1.44, 10)
    assert n - s == pytest.approx(20 / 111.32, abs=1e-4)
    assert e - w > n - s  # longitude degrees are shorter away from the equator


def test_rate_limiter_blocks_after_quota():
    limiter = RateLimiter(max_calls=2, per_seconds=60)
    req = SimpleNamespace(client=SimpleNamespace(host="1.2.3.4"))
    limiter(req)
    limiter(req)
    with pytest.raises(HTTPException) as exc:
        limiter(req)
    assert exc.value.status_code == 429


def test_endpoint_returns_503_without_key(monkeypatch):
    from app import main

    monkeypatch.setattr(main.settings, "openrouter_api_key", "")
    with TestClient(main.app) as client:
        r = client.post("/api/interpret", json={"text": "Toulouse last week"})
    assert r.status_code == 503


@pytest.mark.anyio
async def test_extract_rejects_app_ids_outside_the_catalog():
    llm = FakeLLM(llm_json(app_id="made-up-app"), llm_json())
    q = await extract(llm, "m", "Toulouse", TODAY)
    assert q.app_id == "flood-mapping"
    assert len(llm.calls) == 2
    assert "flood-mapping" in llm.calls[0]["messages"][0]["content"]  # catalog is in the prompt


@pytest.mark.anyio
async def test_interpret_falls_back_to_nearby_town():
    llm = FakeLLM(llm_json(place="Massif des Maures, France", nearby_town="Toulouse, France"))
    async with nominatim({"Toulouse, France": [TOULOUSE_HIT]}) as http:
        out = await interpret(llm, "m", http, "x", TODAY)
    _, s, _, n = out["query"]["bbox"]
    assert n - s == pytest.approx(50 / 111.32, abs=1e-3)  # 25 km radius
    assert any("isn't in the geocoder" in w for w in out["warnings"])
