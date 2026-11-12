"""Natural-language need -> recommended onboard AI app + area + time window.

The LLM only extracts *intent* (place name, time window, which catalog app fits, cloud
tolerance). It never produces coordinates: the place is geocoded by Nominatim, so the area on the
map is real data, and it can only pick an app id that exists in the catalog.
"""

import json
import logging
import math
from datetime import date, timedelta
from typing import Literal

import httpx
from openai import AsyncOpenAI, OpenAIError
from pydantic import BaseModel, Field, ValidationError

from app.catalog import APPS_BY_ID, AppId, catalog_for_prompt
from app.config import get_settings

log = logging.getLogger(__name__)


class ExtractedQuery(BaseModel):
    """What the LLM must return. Every field is required (nullable) to keep outputs predictable."""

    place: str | None = Field(
        description="Geocodable place name with country, e.g. 'Toulouse, France'. "
        "Null if the request names no place."
    )
    nearby_town: str | None = Field(
        description="A town or city inside or next to the place, with country, e.g. "
        "'Collobrieres, France' for a mountain range. Used if the place itself can't be geocoded."
    )
    radius_km: float | None = Field(
        description="Only if the user asks for an area around a point ('within 20 km of', "
        "'around'); otherwise null to use the place's own boundaries."
    )
    date_from: date | None = Field(
        description="Start of the period of interest (e.g. when the event happened), YYYY-MM-DD."
    )
    date_to: date | None = Field(description="End of the period of interest, YYYY-MM-DD.")
    timeframe: Literal["past", "future", "both"] = Field(
        description="'past' if the user only asks about something that already happened "
        "('fires this year', 'last week's flood'), 'future' to monitor or detect from now on, "
        "'both' if both or unclear."
    )
    app_id: AppId | None = Field(
        description="Id of the catalog app that best answers the need; null if none fits."
    )
    app_reason: str = Field(
        description="One short English sentence: why this app fits, or why none does."
    )
    max_cloud: int | None = Field(
        description="Maximum cloud cover in percent if the user expresses one (e.g. 'clear', "
        "'cloud-free' = 10), else null."
    )
    intent: str = Field(description="One short English sentence restating the need.")


SYSTEM_PROMPT = """You are the assistant of a marketplace of AI apps that run onboard satellites.
Turn the user's need into a structured mission request and recommend the catalog app that answers
it. Catalog:
{catalog}

Today is {today}. Resolve relative dates ("last week", "this summer") against today.
"Last week" means the 7 days ending today. Never return dates after today.
The user may write in any language; `intent` is always in English.
Reply with a single JSON object matching this JSON schema, and nothing else:
{schema}"""


class InterpretError(Exception):
    pass


async def extract(llm: AsyncOpenAI, model: str, text: str, today: date) -> ExtractedQuery:
    schema = ExtractedQuery.model_json_schema()
    messages = [
        {
            "role": "system",
            "content": SYSTEM_PROMPT.format(
                catalog=catalog_for_prompt(), today=today.isoformat(), schema=json.dumps(schema)
            ),
        },
        {"role": "user", "content": text},
    ]
    # One retry with the validation error fed back: cheap, and fixes most malformed outputs.
    for attempt in range(2):
        try:
            resp = await llm.chat.completions.create(
                model=model,
                messages=messages,
                temperature=0,
                max_tokens=400,
                response_format={
                    "type": "json_schema",
                    "json_schema": {"name": "imagery_query", "schema": schema},
                },
            )
        except OpenAIError as exc:
            raise InterpretError(f"LLM provider error: {exc}") from exc

        raw = (resp.choices[0].message.content or "").strip()
        try:
            return ExtractedQuery.model_validate_json(_strip_fences(raw))
        except ValidationError as exc:
            log.warning("LLM output failed validation (attempt %d): %s", attempt + 1, raw)
            messages += [
                {"role": "assistant", "content": raw},
                {"role": "user", "content": f"Invalid JSON for the schema: {exc}. Reply again."},
            ]
    raise InterpretError("The model did not return a valid query")


def _strip_fences(raw: str) -> str:
    if raw.startswith("```"):
        raw = raw.strip("`").removeprefix("json").strip()
    return raw


# --- Geocoding ---------------------------------------------------------------------------------

_geocode_cache: dict[str, dict | None] = {}


async def geocode(http: httpx.AsyncClient, place: str) -> dict | None:
    """Nominatim lookup -> {display_name, lat, lon, bbox}. Cached: Nominatim allows 1 req/s."""
    key = place.strip().lower()
    if key in _geocode_cache:
        return _geocode_cache[key]
    r = await http.get(
        get_settings().nominatim_url, params={"q": place, "format": "jsonv2", "limit": 1}
    )
    r.raise_for_status()
    hits = r.json()
    result = None
    if hits:
        h = hits[0]
        south, north, west, east = (float(v) for v in h["boundingbox"])
        result = {
            "display_name": h["display_name"],
            "lat": float(h["lat"]),
            "lon": float(h["lon"]),
            "bbox": [west, south, east, north],
        }
    _geocode_cache[key] = result
    return result


def bbox_around(lat: float, lon: float, radius_km: float) -> list[float]:
    dlat = radius_km / 111.32
    dlon = radius_km / (111.32 * max(math.cos(math.radians(lat)), 0.01))
    return [
        round(max(lon - dlon, -180), 5),
        round(max(lat - dlat, -90), 5),
        round(min(lon + dlon, 180), 5),
        round(min(lat + dlat, 90), 5),
    ]


# --- Orchestration -----------------------------------------------------------------------------

DEFAULT_WINDOW_DAYS = 30
DEFAULT_MAX_CLOUD = 30
FALLBACK_RADIUS_KM = 25
MAX_SPAN_DEG = 5  # keep searches regional; a whole country returns thousands of tiles


async def interpret(
    llm: AsyncOpenAI, model: str, http: httpx.AsyncClient, text: str, today: date
) -> dict:
    q = await extract(llm, model, text, today)
    warnings: list[str] = []

    if not q.place:
        raise InterpretError(
            "I couldn't find a place in your request. Try naming a city or region."
        )
    geo = await geocode(http, q.place)
    radius_km = q.radius_km
    if not geo and q.nearby_town:
        # Natural areas (ranges, deltas, forests) are often missing from the geocoder.
        geo = await geocode(http, q.nearby_town)
        if geo:
            radius_km = radius_km or FALLBACK_RADIUS_KM
            warnings.append(
                f"'{q.place}' isn't in the geocoder: the area is approximated as "
                f"{radius_km:g} km around {q.nearby_town}. Adjust it on the map if needed."
            )
    if not geo:
        raise InterpretError(f"I couldn't locate '{q.place}' on the map.")

    if radius_km:
        bbox = bbox_around(geo["lat"], geo["lon"], min(radius_km, 250))
    else:
        bbox = geo["bbox"]
        if bbox[2] - bbox[0] > MAX_SPAN_DEG or bbox[3] - bbox[1] > MAX_SPAN_DEG:
            bbox = bbox_around(geo["lat"], geo["lon"], 50)
            warnings.append(
                "That area is very large; the search was narrowed to 50 km around its center."
            )

    date_to = min(q.date_to or today, today)
    date_from = q.date_from or date_to - timedelta(days=DEFAULT_WINDOW_DAYS)
    if date_from > date_to:
        date_from, date_to = date_to, date_from

    if q.timeframe == "past":
        # Onboard apps process new acquisitions: be explicit rather than sell the wrong thing.
        warnings.append(
            "Onboard apps analyse new acquisitions, so they can't look back in time. For what "
            "already happened, archive products fit better (e.g. Copernicus EFFIS burnt areas for "
            "wildfires, Copernicus EMS maps for floods). Below: how to monitor it from now on."
        )
    if q.app_id is None:
        warnings.append(
            "No app in the catalog answers this need yet: pick one manually, or this would be a "
            "lead for a new partner app."
        )

    return {
        "intent": q.intent,
        "app_id": q.app_id if q.app_id in APPS_BY_ID else None,
        "app_reason": q.app_reason,
        "timeframe": q.timeframe,
        "query": {
            "place": geo["display_name"],
            "bbox": bbox,
            "date_from": date_from.isoformat(),
            "date_to": date_to.isoformat(),
            "max_cloud": q.max_cloud if q.max_cloud is not None else DEFAULT_MAX_CLOUD,
        },
        "warnings": warnings,
    }
