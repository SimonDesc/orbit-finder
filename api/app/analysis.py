"""Ground-side previews of what an onboard app delivers, computed on a real Sentinel-2 image.

Onboard, the partner's model runs on the raw frame right after acquisition and only its small
result is downlinked. Here we run simple, transparent equivalents on the latest public L2A image
of the area, so a buyer sees the kind of output they would receive:

- vessel-detection: bright objects on open water in the NIR band (B08, 10 m) -> points.
- flood-mapping: open water from NDWI (green B03 vs NIR B08) -> a raster mask.
- crop-health: vegetation vigour from NDVI (red B04 vs NIR B08) -> a raster map.

These are classical remote-sensing baselines, not the partners' models.
"""

import base64
import logging
import math
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache

import numpy as np
from rio_tiler.io import Reader
from rio_tiler.utils import render
from scipy import ndimage

# Earth Search already removes the L2A BOA offset (earthsearch:boa_offset_applied), so
# reflectance is DN * 1e-4 for every processing baseline.
SCALE = 0.0001
WATER_NIR = 0.10  # open water reflects almost no near-infrared
VESSEL_NIR = 0.14  # a hull or deck on water does
PIXEL_M = 10.0
MAX_SPAN_KM = 30.0  # analysed window, around the area centre: keeps a request under ~10 s
MAX_PX = 3000  # vessels need full 10 m resolution
MAX_RASTER_PX = 1024  # masks and maps are displayed, not measured: ~30 m is plenty

log = logging.getLogger(__name__)

PREVIEWS = {
    "vessel-detection": ("nir",),
    "flood-mapping": ("green", "nir"),
    "crop-health": ("red", "nir"),
}


class AnalysisError(Exception):
    pass


def analysis_window(bbox: tuple[float, float, float, float]) -> tuple[float, ...]:
    """The bbox, shrunk around its centre to at most MAX_SPAN_KM per side."""
    w, s, e, n = bbox
    lat = (s + n) / 2
    km_per_deg_lon = 111.32 * math.cos(math.radians(lat))
    half_lon = min((e - w) / 2, MAX_SPAN_KM / 2 / km_per_deg_lon)
    half_lat = min((n - s) / 2, MAX_SPAN_KM / 2 / 111.32)
    cx, cy = (w + e) / 2, lat
    return (cx - half_lon, cy - half_lat, cx + half_lon, cy + half_lat)


def _grid(window: tuple[float, ...], max_px: int = MAX_PX) -> tuple[int, int]:
    """(width, height) in pixels for ~10 m resolution over the window."""
    w, s, e, n = window
    lat = (s + n) / 2
    width = (e - w) * 111_320 * math.cos(math.radians(lat)) / PIXEL_M
    height = (n - s) * 111_320 / PIXEL_M
    k = min(1.0, max_px / max(width, height))
    return max(int(width * k), 1), max(int(height * k), 1)


def _read(url: str, window: tuple[float, ...], size: tuple[int, int]):
    """Reflectance and validity mask of one band, resampled on the shared WGS84 grid."""
    with Reader(url) as src:
        img = src.part(window, width=size[0], height=size[1])
    dn = img.data[0]
    valid = (dn > 0) & (img.mask > 0)  # 0 is nodata: outside the swath or the tile
    return dn.astype("float32") * SCALE, valid


def detect_vessels(nir: np.ndarray, valid: np.ndarray) -> list[dict]:
    """Bright compact objects fully surrounded by open sea. Returns pixel-space detections."""
    water = (nir < WATER_NIR) & valid
    sea = ndimage.binary_opening(water, iterations=2)
    labels, n = ndimage.label(sea)
    if not n:
        return []
    sizes = ndimage.sum(sea, labels, range(1, n + 1))
    open_sea = np.isin(labels, 1 + np.flatnonzero(sizes > 20_000))  # > 2 km², not ponds
    sea_area = ndimage.binary_fill_holes(open_sea)  # put ships back inside the sea
    candidates = sea_area & ~water & valid & (nir > VESSEL_NIR)
    cl, _ = ndimage.label(candidates)
    out = []
    for i, sl in enumerate(ndimage.find_objects(cl), 1):
        if sl is None:
            continue
        pad = tuple(slice(max(s.start - 3, 0), s.stop + 3) for s in sl)
        blob = cl[pad] == i
        area = int(blob.sum())
        if not 3 <= area <= 800:  # 300 m² .. 8 ha: from a fishing boat to a large tanker
            continue
        ring = ndimage.binary_dilation(blob, iterations=3) & ~blob
        if water[pad][ring].mean() < 0.85:  # quays, breakwaters and coast are not ships
            continue
        ys, xs = np.nonzero(blob)
        ys, xs = ys + pad[0].start, xs + pad[1].start
        extent = int(max(np.ptp(ys), np.ptp(xs))) + 1
        if extent > 40:  # > 400 m: a jetty or a breakwater, not a ship
            continue
        brightness = float(nir[ys, xs].mean())
        out.append(
            {
                "y": float(ys.mean()),
                "x": float(xs.mean()),
                "px": area,
                "extent": extent,
                "brightness": brightness,
            }
        )
    return out


def drop_static(ships: list[dict], ref_nir: np.ndarray, ref_valid: np.ndarray) -> list[dict]:
    """Keep detections with no bright object at the same place on another date.

    A single image can't tell a ship from a rock, a moored platform or a buoy cluster; ships
    move, those don't. Where the other image has no data, the detection is kept.
    """
    kept = []
    for d in ships:
        r = d["extent"] // 2 + 2
        y, x = round(d["y"]), round(d["x"])
        sl = (slice(max(y - r, 0), y + r + 1), slice(max(x - r, 0), x + r + 1))
        seen = ref_valid[sl]
        if seen.mean() > 0.5 and (ref_nir[sl][seen] > VESSEL_NIR).sum() >= 0.5 * d["px"]:
            continue
        kept.append(d)
    return kept


def _png(rgb: np.ndarray, alpha: np.ndarray) -> str:
    data = render(rgb, mask=alpha, img_format="WEBP", quality=80)
    return "data:image/webp;base64," + base64.b64encode(data).decode()


def _ramp(values: np.ndarray, stops: list[tuple[float, tuple[int, int, int]]]) -> np.ndarray:
    xs = [s for s, _ in stops]
    return np.stack(
        [np.interp(values, xs, [c[k] for _, c in stops]).astype("uint8") for k in range(3)]
    )


@lru_cache(maxsize=64)
def run_preview(
    app_id: str, urls: tuple[str, ...], bbox: tuple[float, ...], reference_nir: str | None = None
) -> dict:
    """Run the preview of `app_id` on bands `urls` (in PREVIEWS order) over `bbox`.

    `reference_nir`: NIR band of another date, used to discard static objects (vessels only).
    """
    window = analysis_window(bbox)
    size = _grid(window, MAX_PX if app_id == "vessel-detection" else MAX_RASTER_PX)
    # Reads are network-bound and GDAL releases the GIL: fetch every band at once.
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = [pool.submit(_read, u, window, size) for u in urls]
        ref_future = pool.submit(_read, reference_nir, window, size) if reference_nir else None
        try:
            bands = [f.result() for f in futures]
        except Exception as exc:  # GDAL / network
            raise AnalysisError(f"Could not read the image: {exc}") from exc
    valid = np.logical_and.reduce([v for _, v in bands])
    coverage = float(valid.mean())
    if coverage < 0.05:
        raise AnalysisError("This image barely covers the area: pick another one.")

    w, s, e, n = window
    width, height = size
    px_m = (e - w) * 111_320 * math.cos(math.radians((s + n) / 2)) / width

    def lonlat(x: float, y: float) -> list[float]:
        return [
            round(w + (x + 0.5) / width * (e - w), 6),
            round(n - (y + 0.5) / height * (n - s), 6),
        ]

    result: dict = {
        "app_id": app_id,
        "window": [round(v, 6) for v in window],
        "coverage": round(coverage, 3),
        "pixel_m": round(px_m, 1),
    }

    if app_id == "vessel-detection":
        nir, _ = bands[0]
        ships = detect_vessels(nir, valid)
        candidates = len(ships)
        if ref_future:
            try:
                ships = drop_static(ships, *ref_future.result())
            except (OSError, RuntimeError, ValueError) as exc:  # a bonus: keep raw detections
                log.warning("Static-object filter skipped: %s", exc)
        ships.sort(key=lambda d: -d["px"])
        result["features"] = [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": lonlat(d["x"], d["y"])},
                "properties": {
                    "length_m": round(d["extent"] * px_m),
                    "area_m2": round(d["px"] * px_m * px_m),
                },
            }
            for d in ships
        ]
        lengths = [f["properties"]["length_m"] for f in result["features"]]
        result["summary"] = {
            "vessels": len(lengths),
            "large_vessels": sum(L >= 100 for L in lengths),
            "static_removed": candidates - len(lengths),
        }
        return result

    (a, _), (nir, _) = bands
    total = a + nir
    valid = valid & (total > 0.02)  # too dark to tell (deep shadow)
    index = np.clip((a - nir) / np.where(total > 0, total, 1), -1, 1)  # NDWI or -NDVI
    if app_id == "flood-mapping":
        water = (index > 0.0) & valid
        water = ndimage.binary_opening(water)
        rgb = np.zeros((3, height, width), "uint8")
        rgb[0], rgb[1], rgb[2] = 56, 189, 248  # sky-400
        result["image"] = _png(rgb, np.where(water, 170, 0).astype("uint8"))
        result["summary"] = {
            "water_km2": round(float(water.sum()) * px_m * px_m / 1e6, 2),
            "water_share": round(float(water.sum()) / max(int(valid.sum()), 1), 3),
        }
        return result

    ndvi = -index
    veg = valid & (ndvi > 0.2)  # bare soil, water, roofs stay transparent
    rgb = _ramp(ndvi, [(0.2, (220, 60, 40)), (0.45, (250, 204, 21)), (0.75, (22, 163, 74))])
    result["image"] = _png(rgb, np.where(veg, 190, 0).astype("uint8"))
    stressed = veg & (ndvi < 0.45)
    result["summary"] = {
        "vegetation_km2": round(float(veg.sum()) * px_m * px_m / 1e6, 2),
        "stressed_share": round(float(stressed.sum()) / max(int(veg.sum()), 1), 3),
        "mean_ndvi": round(float(ndvi[veg].mean()), 2) if veg.any() else None,
    }
    return result
