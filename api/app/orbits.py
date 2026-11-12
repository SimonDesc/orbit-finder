"""Next satellite passes over an area, from public TLEs (CelesTrak) propagated with SGP4 (skyfield).

A "pass" here is geometric: the moment the ground track comes closest to the area center, kept
when the instrument swath can reach the area. It is an estimate of imaging opportunities, not the
operator's real acquisition plan.
"""

import asyncio
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import httpx
import numpy as np
from skyfield.api import EarthSatellite, load, wgs84

from app.config import get_settings
from app.geo import BBox, haversine_km, solar_elevation_deg

SENTINEL2_HALF_SWATH_KM = 145  # MSI swath is ~290 km
# Ground speed is ~6.8 km/s: a 60 s step puts a sample within ~205 km (along-track) of the true
# closest approach, which is then refined at 1 s resolution.
COARSE_STEP_S = 60
TRACK_HALF_SPAN_S = 120
TLE_TTL_S = 6 * 3600  # CelesTrak updates a few times a day and asks clients to cache

_ts = load.timescale()  # uses skyfield's built-in time data, no download


@dataclass
class _TleCache:
    satellites: list[EarthSatellite]
    fetched_at: float


_cache: _TleCache | None = None
_lock = asyncio.Lock()


def parse_tle(text: str) -> list[EarthSatellite]:
    lines = [ln.rstrip() for ln in text.strip().splitlines() if ln.strip()]
    sats = []
    for i in range(0, len(lines) - 2, 3):
        name, l1, l2 = lines[i : i + 3]
        if l1.startswith("1 ") and l2.startswith("2 "):
            sats.append(EarthSatellite(l1, l2, name.strip(), _ts))
    return sats


async def get_satellites(http: httpx.AsyncClient) -> list[EarthSatellite]:
    global _cache
    async with _lock:
        if _cache and time.time() - _cache.fetched_at < TLE_TTL_S:
            return _cache.satellites
        s = get_settings()
        r = await http.get(s.celestrak_url, params={"NAME": s.celestrak_name, "FORMAT": "TLE"})
        r.raise_for_status()
        sats = parse_tle(r.text)
        if not sats:
            raise RuntimeError("CelesTrak returned no TLE")
        _cache = _TleCache(sats, time.time())
        return sats


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
