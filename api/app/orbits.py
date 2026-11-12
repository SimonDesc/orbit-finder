"""Next satellite passes over an area, from public TLEs (CelesTrak) propagated with SGP4 (skyfield).

A "pass" here is geometric: the moment the ground track comes closest to the area center, kept
when the instrument swath can reach the area. It is an estimate of imaging opportunities, not the
operator's real acquisition plan.
"""

import asyncio
import logging
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import numpy as np
from skyfield.api import EarthSatellite, load, wgs84

from app.config import get_settings
from app.geo import BBox, haversine_km, solar_elevation_deg

SENTINEL2_HALF_SWATH_KM = 145  # MSI swath is ~290 km
# Loft's YAM satellites point their payloads: a target is reachable when it lies within ~25° off
# nadir, i.e. ~250 km either side of the ground track at 500-600 km altitude.
LOFT_REACH_KM = 250
# Ground speed is ~6.8 km/s: a 60 s step puts a sample within ~205 km (along-track) of the true
# closest approach, which is then refined at 1 s resolution.
COARSE_STEP_S = 60
TRACK_HALF_SPAN_S = 120
TLE_TTL_S = 6 * 3600  # CelesTrak updates a few times a day and asks clients to cache

log = logging.getLogger(__name__)
_ts = load.timescale()  # uses skyfield's built-in time data, no download

HERE = Path(__file__).parent


@dataclass(frozen=True)
class Fleet:
    """A set of satellites fetched from CelesTrak with one query."""

    id: str
    label: str
    query: dict[str, str]
    cache_name: str
    snapshot: Path  # last-resort fallback, in git


def fleets() -> dict[str, Fleet]:
    return {
        f.id: f
        for f in (
            # Loft Orbital's own YAM satellites: the apps of the marketplace run onboard them.
            Fleet(
                "loft",
                "Loft Orbital YAM",
                {"NAME": "YAM-"},
                "tle_loft.txt",
                HERE / "tle_snapshot_loft.txt",
            ),
            # Public reference imagery (previews, archive search).
            Fleet(
                "sentinel-2",
                "Sentinel-2",
                {"NAME": get_settings().celestrak_name},
                "tle_sentinel2.txt",
                HERE / "tle_snapshot.txt",
            ),
            # Context: the rest of the Earth-observation fleet in orbit (CelesTrak "resource").
            Fleet(
                "eo",
                "Other Earth observation",
                {"GROUP": "resource"},
                "tle_eo.txt",
                HERE / "tle_snapshot_eo.txt",
            ),
        )
    }


SNAPSHOT_FILE = HERE / "tle_snapshot.txt"


@dataclass
class _TleCache:
    satellites: list[EarthSatellite]
    fetched_at: float


_cache: dict[str, _TleCache] = {}
_lock = asyncio.Lock()


def parse_tle(text: str) -> list[EarthSatellite]:
    lines = [ln.rstrip() for ln in text.strip().splitlines() if ln.strip()]
    sats = []
    for i in range(0, len(lines) - 2, 3):
        name, l1, l2 = lines[i : i + 3]
        if l1.startswith("1 ") and l2.startswith("2 "):
            sat = EarthSatellite(l1, l2, name.strip(), _ts)
            sat.tle_lines = (l1, l2)  # kept for clients that propagate themselves
            sats.append(sat)
    return sats


def _cache_file(fleet: Fleet) -> Path:
    return get_settings().data_dir / fleet.cache_name


def _load_file(path: Path) -> _TleCache | None:
    try:
        sats = parse_tle(path.read_text())
    except OSError:
        return None
    return _TleCache(sats, path.stat().st_mtime) if sats else None


async def _download(http: httpx.AsyncClient, fleet: Fleet) -> str:
    r = await http.get(
        get_settings().celestrak_url,
        params={**fleet.query, "FORMAT": "TLE"},
        # CelesTrak answers 500 when "deflate" is offered (httpx's default).
        headers={"Accept-Encoding": "gzip"},
    )
    r.raise_for_status()
    if not parse_tle(r.text):
        raise RuntimeError("CelesTrak returned no TLE")
    return r.text


async def get_satellites(
    http: httpx.AsyncClient, fleet_id: str = "sentinel-2"
) -> list[EarthSatellite]:
    """TLEs from memory, then disk, then CelesTrak; on failure, the freshest copy we have.

    CelesTrak blocks clients that download the same data too often (HTTP 403), so the cache is
    kept on disk to survive restarts and the fetch happens at most every TLE_TTL_S.
    """
    fleet = fleets()[fleet_id]
    async with _lock:
        cached = _cache.get(fleet.id) or _load_file(_cache_file(fleet))
        if cached and time.time() - cached.fetched_at < TLE_TTL_S:
            _cache[fleet.id] = cached
            return cached.satellites
        try:
            text = await _download(http, fleet)
        except (httpx.HTTPError, RuntimeError) as exc:
            # TLEs stay usable for days: a stale set beats an error page.
            fallback = cached or _load_file(fleet.snapshot)
            if not fallback:
                raise
            log.warning("TLE refresh of %s failed (%s), serving a cached set", fleet.id, exc)
            # Don't retry on every request: back off for an hour.
            fallback.fetched_at = time.time() - TLE_TTL_S + 3600
            _cache[fleet.id] = fallback
            return fallback.satellites
        try:
            _cache_file(fleet).parent.mkdir(parents=True, exist_ok=True)
            _cache_file(fleet).write_text(text)
        except OSError as exc:
            log.warning("Could not persist TLE cache: %s", exc)
        _cache[fleet.id] = _TleCache(parse_tle(text), time.time())
        return _cache[fleet.id].satellites


def tle_age_hours(satellites: list[EarthSatellite], now: datetime) -> float:
    """Age of the oldest orbit element set: the main driver of prediction error."""
    oldest = min(sat.epoch.utc_datetime() for sat in satellites)
    return round((now - oldest).total_seconds() / 3600, 1)


def _times(start: datetime, seconds: np.ndarray):
    return _ts.utc(
        start.year, start.month, start.day, start.hour, start.minute, start.second + seconds
    )


def _subpoints(sat: EarthSatellite, start: datetime, seconds: np.ndarray):
    lat, lon = wgs84.latlon_of(sat.at(_times(start, seconds)))
    return lat.degrees, lon.degrees


def find_passes(
    satellites: list[EarthSatellite],
    bbox: BBox,
    start: datetime,
    days: float,
    half_swath_km: float = SENTINEL2_HALF_SWATH_KM,
) -> list[dict]:
    """Return passes sorted by time. Pure function (no I/O) so it is easy to test."""
    start = start.astimezone(UTC).replace(microsecond=0)
    clat, clon = bbox.center
    reach_km = half_swath_km + bbox.radius_km
    coarse = np.arange(0, days * 86400, COARSE_STEP_S, dtype=float)
    passes = []

    for sat in satellites:
        lat, lon = _subpoints(sat, start, coarse)
        d = haversine_km(clat, clon, lat, lon)
        # Local minima of the distance to the center = closest approaches.
        idx = np.where((d[1:-1] <= d[:-2]) & (d[1:-1] <= d[2:]))[0] + 1
        for i in idx:
            if d[i] > reach_km + 300:  # coarse sample can be ~205 km from the minimum
                continue
            fine = coarse[i] + np.arange(-COARSE_STEP_S * 2, COARSE_STEP_S * 2 + 1, 1.0)
            flat, flon = _subpoints(sat, start, fine)
            fd = haversine_km(clat, clon, flat, flon)
            j = int(np.argmin(fd))
            offset = float(fd[j])
            if offset > reach_km:
                continue

            t0 = fine[j]
            when = start + timedelta(seconds=float(t0))
            track_s = t0 + np.arange(-TRACK_HALF_SPAN_S, TRACK_HALF_SPAN_S + 1, 10.0)
            tlat, tlon = _subpoints(sat, start, track_s)
            sun = solar_elevation_deg(clat, clon, when)
            passes.append(
                {
                    "satellite": sat.name,
                    "norad_id": sat.model.satnum,
                    "time": when.isoformat().replace("+00:00", "Z"),
                    "offset_km": round(offset, 1),
                    "direction": "ascending"
                    if flat[min(j + 1, len(flat) - 1)] > flat[max(j - 1, 0)]
                    else "descending",
                    "sun_elevation": round(sun, 1),
                    "daylight": sun > 0,
                    "ground_track": {
                        "type": "LineString",
                        "coordinates": [
                            [round(float(x), 4), round(float(y), 4)] for x, y in zip(tlon, tlat)
                        ],
                    },
                }
            )

    passes.sort(key=lambda p: p["time"])
    return passes
