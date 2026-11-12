from contextlib import asynccontextmanager
from datetime import UTC, date, datetime, timedelta
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from openai import AsyncOpenAI
from pydantic import BaseModel, Field

from app import analysis, orbits, stac, tiles
from app.catalog import APPS_BY_ID, CATALOG, App
from app.config import get_settings
from app.demos import DEMOS, Demo
from app.geo import BBox
from app.interpret import InterpretError, interpret
from app.llm import get_llm_client
from app.orders import ACCOUNTS, Account, OrderError, OrderStore
from app.pricing import Priority, pricing_terms, quote
from app.ratelimit import RateLimiter

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with httpx.AsyncClient(timeout=20, headers={"User-Agent": settings.user_agent}) as client:
        app.state.http = client
        app.state.orders = OrderStore(settings.data_dir / "orbit.db")
        yield


app = FastAPI(title="Orbit Finder API", version="0.1.0", lifespan=lifespan)
api = APIRouter(prefix="/api")


def http_client(request: Request) -> httpx.AsyncClient:
    return request.app.state.http


def bbox_param(
    bbox: Annotated[
        str,
        Query(
            description="west,south,east,north in WGS84 degrees", examples=["1.30,43.52,1.56,43.68"]
        ),
    ],
) -> BBox:
    try:
        return BBox.parse(bbox)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


Http = Annotated[httpx.AsyncClient, Depends(http_client)]
Box = Annotated[BBox, Depends(bbox_param)]


@api.get("/health")
def health() -> dict:
    return {"status": "ok", "llm_configured": bool(settings.openrouter_api_key)}


class InterpretRequest(BaseModel):
    text: str = Field(min_length=3, max_length=500)


def llm_client() -> AsyncOpenAI:
    if not settings.openrouter_api_key:
        raise HTTPException(503, "LLM is not configured (OPENROUTER_API_KEY missing)")
    return get_llm_client()


@api.post(
    "/interpret",
    summary="Turn a natural-language request into a structured search",
    dependencies=[Depends(RateLimiter(max_calls=10, per_seconds=60))],
)
async def interpret_endpoint(
    body: InterpretRequest,
    http: Http,
    llm: Annotated[AsyncOpenAI, Depends(llm_client)],
) -> dict:
    try:
        return await interpret(llm, settings.llm_model, http, body.text, datetime.now(UTC).date())
    except InterpretError as exc:
        raise HTTPException(422, str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"Geocoding unavailable: {exc}") from exc


@api.get("/apps", summary="Catalog of AI apps that run onboard satellites")
def apps() -> list[App]:
    return CATALOG


@api.get("/demos", summary="End-to-end demo missions modelled on Loft Orbital use cases")
def demos() -> list[Demo]:
    return DEMOS


@api.get(
    "/scenes/{scene_id}/tiles/{z}/{x}/{y}.webp",
    summary="True-colour map tiles of one Sentinel-2 scene, rendered from its COG",
    response_class=Response,
)
async def scene_tile(scene_id: str, z: int, x: int, y: int, http: Http) -> Response:
    if not tiles.MIN_ZOOM <= z <= tiles.MAX_ZOOM:
        raise HTTPException(404, "Zoom level not served")
    try:
        url = await tiles.visual_url(http, scene_id)
    except tiles.SceneNotFound as exc:
        raise HTTPException(404, str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"STAC catalog unavailable: {exc}") from exc
    try:
        data = await run_in_threadpool(tiles.render_tile, url, z, x, y)
    except Exception as exc:  # GDAL/network errors while reading the COG
        raise HTTPException(502, f"Could not read the scene image: {exc}") from exc
    headers = {"Cache-Control": "public, max-age=604800, immutable"}  # scenes never change
    if data is None:
        return Response(status_code=204, headers=headers)
    return Response(data, media_type="image/webp", headers=headers)


PREVIEW_LOOKBACK_DAYS = 90
PREVIEW_MAX_CLOUD = 15


@api.get(
    "/preview/{app_id}",
    summary="Run a ground-side preview of an onboard app on a real Sentinel-2 image",
    dependencies=[Depends(RateLimiter(max_calls=12, per_seconds=60))],
)
async def app_preview(
    app_id: str,
    http: Http,
    box: Box,
    scene_id: Annotated[str | None, Query(description="Image to use; default: best recent")] = None,
    reference_id: Annotated[str | None, Query(description="Image of another date")] = None,
) -> dict:
    assets = analysis.PREVIEWS.get(app_id)
    if not assets:
        raise HTTPException(404, "No preview available for this app yet")
    ref_assets = analysis.REFERENCE_BANDS.get(app_id)
    window = analysis.analysis_window(tuple(box.as_list()))
    props: dict = {}
    if not scene_id:
        scene_id, reference_id, props = await _pick_scenes(http, window, app_id)

    async def urls(sid: str, names: tuple[str, ...]) -> tuple[str, ...]:
        try:
            return tuple([await tiles.asset_url(http, sid, a) for a in names])
        except tiles.SceneNotFound as exc:
            raise HTTPException(404, str(exc)) from exc
        except httpx.HTTPError as exc:
            raise HTTPException(502, f"STAC catalog unavailable: {exc}") from exc

    scene_urls = await urls(scene_id, assets)
    ref_urls = await urls(reference_id, ref_assets) if reference_id and ref_assets else None
    try:
        result = await run_in_threadpool(analysis.run_preview, app_id, scene_urls, window, ref_urls)
    except analysis.AnalysisError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {
        "scene_id": scene_id,
        "datetime": props.get("datetime") or tiles.scene_datetime(scene_id),
        "cloud_cover": props.get("cloud_cover"),
        "reference_id": reference_id if ref_urls else None,
        "reference_datetime": tiles.scene_datetime(reference_id) if ref_urls else None,
        **result,
    }


async def _pick_scenes(http: httpx.AsyncClient, window, app_id: str):
    """Best recent image of the window, and a reference of the same tile a week or more apart."""
    today = datetime.now(UTC).date()
    try:
        found = await stac.search_scenes(
            http,
            BBox(*window),
            today - timedelta(days=PREVIEW_LOOKBACK_DAYS),
            today,
            PREVIEW_MAX_CLOUD,
            100,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"STAC catalog unavailable: {exc}") from exc
    # A sample output needs the whole window: full coverage first, then the most recent.
    scenes = sorted(
        found["features"],
        key=lambda f: (round(f["properties"]["coverage"], 1), f["properties"]["datetime"]),
        reverse=True,
    )
    if not scenes or scenes[0]["properties"]["coverage"] < 0.5:
        raise HTTPException(
            404, f"No clear image of this area in the last {PREVIEW_LOOKBACK_DAYS} days"
        )
    scene = scenes[0]
    # Same tile (identical footprint), a week or more apart so ships at anchor have moved;
    # strictly before for apps that compare with "before" (fire scars, flood).
    when = datetime.fromisoformat(scene["properties"]["datetime"])

    def fits(s: dict) -> bool:
        t = datetime.fromisoformat(s["properties"]["datetime"])
        return (
            s["properties"]["tile"] == scene["properties"]["tile"]
            and abs(t - when) >= timedelta(days=7)
            and (app_id not in analysis.REFERENCE_BEFORE or t < when)
        )

    others = [s for s in scenes[1:] if fits(s)]
    reference = others[0]["id"] if others and app_id in analysis.REFERENCE_BANDS else None
    return scene["id"], reference, scene["properties"]


# --- Marketplace: accounts, entitlements, orders, metering ----------------------------------


def current_account(
    x_demo_account: Annotated[str | None, Header(description="Demo tenant id")] = None,
) -> Account:
    """Demo stand-in for authentication: production would read the tenant from an OIDC token."""
    account = ACCOUNTS.get(x_demo_account or "")
    if not account:
        raise HTTPException(401, "Unknown or missing account")
    return account


def order_store(request: Request) -> OrderStore:
    return request.app.state.orders


CurrentAccount = Annotated[Account, Depends(current_account)]
Orders = Annotated[OrderStore, Depends(order_store)]


@api.get("/accounts", summary="Demo accounts and the apps each one is licensed for")
def accounts() -> list[dict]:
    return [
        {"id": a.id, "name": a.name, "licensed_apps": list(a.licensed_apps)}
        for a in ACCOUNTS.values()
    ]


class OrderRequest(BaseModel):
    app_id: str
    place: str = Field(max_length=200)
    bbox: list[float] = Field(min_length=4, max_length=4)
    days: float = Field(default=5, gt=0, le=10)
    # Book only these passes (their times, as returned by /passes); all usable ones if omitted.
    pass_times: list[datetime] | None = Field(default=None, max_length=100)
    priority: Priority = "standard"


# Pass times are refined to the second from a different start time on each call.
PASS_MATCH_S = 90


def _selected(usable: list[dict], times: list[datetime] | None) -> list[dict]:
    if times is None:
        return usable
    return [
        p
        for p in usable
        if any(
            abs((datetime.fromisoformat(p["time"]) - t).total_seconds()) <= PASS_MATCH_S
            for t in times
        )
    ]


def _order_error(exc: OrderError) -> HTTPException:
    return HTTPException(exc.status, str(exc))


@api.get("/pricing", summary="Volume tiers and options used to price a mission")
def pricing() -> dict:
    return pricing_terms()


@api.post(
    "/orders",
    status_code=201,
    summary="Order a monitoring mission: books the next passes able to run the app",
    dependencies=[Depends(RateLimiter(max_calls=20, per_seconds=60))],
)
async def create_order(body: OrderRequest, account: CurrentAccount, orders: Orders, http: Http):
    try:
        box = BBox.parse(",".join(map(str, body.bbox)))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    app_ = APPS_BY_ID.get(body.app_id)
    if not app_:
        raise HTTPException(404, "Unknown app")
    # Passes are recomputed server-side: the client never decides what gets billed.
    try:
        sats = await orbits.get_satellites(http, "loft")  # the apps run onboard Loft's YAMs
    except (httpx.HTTPError, RuntimeError) as exc:
        raise HTTPException(502, f"TLE source unavailable: {exc}") from exc
    found = await run_in_threadpool(
        orbits.find_passes, sats, box, datetime.now(UTC), body.days, orbits.LOFT_REACH_KM
    )
    usable = [
        {"satellite": p["satellite"], "norad_id": p["norad_id"], "time": p["time"]}
        for p in found
        if p["daylight"] or not app_.needs_daylight
    ]
    chosen = _selected(usable, body.pass_times)
    if body.pass_times is not None and len(chosen) < len(body.pass_times):
        raise HTTPException(409, "Some selected passes are no longer available: refresh them.")
    price = quote(app_, len(chosen), body.priority)
    try:
        order = orders.create(
            account, body.app_id, body.place, box.as_list(), chosen, price["unit_price_eur"]
        )
    except OrderError as exc:
        raise _order_error(exc) from exc
    return {**order, "quote": price}


@api.get("/orders", summary="Orders of the current account, with usage")
def list_orders(account: CurrentAccount, orders: Orders) -> list[dict]:
    return orders.list(account)


@api.post("/orders/{order_id}/cancel", summary="Cancel an order; past passes stay billed")
def cancel_order(order_id: str, account: CurrentAccount, orders: Orders) -> dict:
    try:
        return orders.cancel(account, order_id)
    except OrderError as exc:
        raise _order_error(exc) from exc


@api.get("/scenes", summary="Sentinel-2 L2A scenes intersecting an area")
async def scenes(
    http: Http,
    box: Box,
    date_from: date | None = None,
    date_to: date | None = None,
    max_cloud: Annotated[float, Query(ge=0, le=100)] = 30,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
) -> dict:
    date_to = date_to or datetime.now(UTC).date()
    date_from = date_from or date_to - timedelta(days=30)
    if date_from > date_to:
        raise HTTPException(422, "date_from must be before date_to")
    try:
        return await stac.search_scenes(http, box, date_from, date_to, max_cloud, limit)
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"STAC catalog unavailable: {exc}") from exc


@api.get("/passes", summary="Next passes of Loft's YAM satellites able to image the area")
async def passes(
    http: Http,
    box: Box,
    days: Annotated[float, Query(gt=0, le=10)] = 2,
) -> dict:
    try:
        sats = await orbits.get_satellites(http, "loft")
    except (httpx.HTTPError, RuntimeError) as exc:
        raise HTTPException(502, f"TLE source unavailable: {exc}") from exc
    now = datetime.now(UTC)
    result = await run_in_threadpool(orbits.find_passes, sats, box, now, days, orbits.LOFT_REACH_KM)
    return {
        "from": now.isoformat(),
        "days": days,
        "fleet": "Loft Orbital YAM",
        "satellites": len(sats),
        "reach_km": orbits.LOFT_REACH_KM,
        "tle_age_hours": orbits.tle_age_hours(sats, now),
        "passes": result,
    }


@api.get("/satellites", summary="Current TLEs of the fleets shown live on the map")
async def satellites(http: Http) -> dict:
    out, seen, ages = [], set(), []
    for fleet in orbits.fleets().values():  # Loft first: a satellite is listed once
        try:
            sats = await orbits.get_satellites(http, fleet.id)
        except (httpx.HTTPError, RuntimeError):
            continue  # one fleet missing still leaves a useful map
        ages.append(orbits.tle_age_hours(sats, datetime.now(UTC)))
        for s in sats:
            if s.model.satnum in seen:
                continue
            seen.add(s.model.satnum)
            out.append(
                {
                    "name": s.name,
                    "norad_id": s.model.satnum,
                    "fleet": fleet.id,
                    "line1": s.tle_lines[0],
                    "line2": s.tle_lines[1],
                }
            )
    if not out:
        raise HTTPException(502, "TLE source unavailable")
    return {
        "tle_age_hours": max(ages),
        "fleets": {f.id: f.label for f in orbits.fleets().values()},
        "satellites": out,
    }


app.include_router(api)

# In production the Vite build is copied into ./static and served from the same origin.
if settings.static_dir.is_dir():
    app.mount("/assets", StaticFiles(directory=settings.static_dir / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        if path == "api" or path.startswith("api/"):
            raise HTTPException(404, "Not found")  # unknown API routes must not get the SPA
        root = settings.static_dir.resolve()
        file = (root / path).resolve()
        if path and file.is_relative_to(root) and file.is_file():
            return FileResponse(file)
        return FileResponse(settings.static_dir / "index.html")
