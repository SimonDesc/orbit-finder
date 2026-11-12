"""Ground-side previews of what an onboard app delivers, computed on a real Sentinel-2 image.

Onboard, the partner's model runs on the raw frame right after acquisition and only its small
result is downlinked. Here we run simple, transparent equivalents on public L2A images of the
area, so a buyer sees the kind of output they would receive:

- vessel-detection: bright objects on open water in the NIR band (B08, 10 m) -> points; objects
  still there on another date (rocks, platforms) are dropped.
- wildfire-detection: active flames from the SWIR bands (B12 vs B11 and B8A, Murphy et al. 2016,
  "HOTMAP") -> hotspot points; with an image from before the fire, the burned area (dNBR) -> mask.
- flood-mapping: open water from MNDWI (green B03 vs SWIR B11), clouds masked with the scene
  classification; with a dry reference image, only water that wasn't there before is flood.
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

FIRE_RATIO = 1.4  # B12/B11 and B12/B8A: flames emit far more at 2.2 um than at 1.6 or 0.86 um
FIRE_B12 = 0.15
BURNED_DNBR = 0.27  # USGS burn severity: "moderate-low" and above
WATER_MNDWI = 0.05
SCL_CLOUD = (3, 8, 9, 10)  # Sentinel-2 scene classification: cloud shadow, clouds, cirrus

log = logging.getLogger(__name__)

# Bands read for each app (Earth Search asset names), in order.
PREVIEWS = {
    "vessel-detection": ("nir",),
    "wildfire-detection": ("nir08", "swir16", "swir22", "scl"),
    "flood-mapping": ("green", "swir16", "scl"),
    "crop-health": ("red", "nir"),
}
# Bands read on the reference image (another date), for the apps that use one.
REFERENCE_BANDS = {
    "vessel-detection": ("nir",),
    "wildfire-detection": ("nir08", "swir22", "scl"),
    "flood-mapping": ("green", "swir16", "scl"),
}
# Ships only need another date; fire scars and flood need an image from before.
REFERENCE_BEFORE = {"wildfire-detection", "flood-mapping"}


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


def _clear_sky(scl: tuple[np.ndarray, np.ndarray]) -> np.ndarray:
    """Validity of the scene-classification band, minus clouds and their shadows."""
    classes = np.rint(scl[0] / SCALE).astype("int16")  # _read scales every band: undo it
    return scl[1] & ~np.isin(classes, SCL_CLOUD)


# --- Vessels -----------------------------------------------------------------------------------


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


# --- Wildfire ----------------------------------------------------------------------------------


def detect_fire(b8a: np.ndarray, b11: np.ndarray, b12: np.ndarray, valid: np.ndarray):
    """Active-fire mask: SWIR-2 much brighter than SWIR-1 and NIR, and bright in absolute terms.

    Murphy et al. (2016), "HOTMAP: Global hot target detection at moderate spatial resolution",
    Remote Sensing of Environment 177. The hottest pixels saturate B12 while B11 rises too: the
    second test keeps those.
    """
    eps = 1e-4
    core = (b12 / (b11 + eps) >= FIRE_RATIO) & (b12 / (b8a + eps) >= FIRE_RATIO)
    core &= b12 >= FIRE_B12
    saturated = (b11 >= 0.5) & (b12 >= 0.9) & (b12 / (b8a + eps) >= FIRE_RATIO)
    return (core | saturated) & valid


def fire_clusters(fire: np.ndarray) -> list[dict]:
    """One hotspot per group of touching fire pixels (8-connected), biggest first."""
    labels, n = ndimage.label(fire, structure=np.ones((3, 3)))
    if not n:
        return []
    idx = range(1, n + 1)
    sizes = ndimage.sum(fire, labels, idx)
    centres = ndimage.center_of_mass(fire, labels, idx)
    out = [{"y": float(y), "x": float(x), "px": int(px)} for (y, x), px in zip(centres, sizes)]
    return sorted(out, key=lambda d: -d["px"])


def nbr(nir: np.ndarray, swir2: np.ndarray) -> np.ndarray:
    """Normalized Burn Ratio: high on live vegetation, negative on fresh burn scars."""
    total = nir + swir2
    return (nir - swir2) / np.where(total > 0, total, 1)


# --- Flood -------------------------------------------------------------------------------------


def water_mask(green: np.ndarray, swir1: np.ndarray, valid: np.ndarray) -> np.ndarray:
    """Open water from MNDWI, which separates turbid flood water from wet soil better than NDWI."""
    total = green + swir1
    mndwi = (green - swir1) / np.where(total > 0, total, 1)
    return ndimage.binary_opening((mndwi > WATER_MNDWI) & valid)


def new_water(now: np.ndarray, before: np.ndarray, before_valid: np.ndarray) -> np.ndarray:
    """Water now that was dry land on the reference date: rivers and lakes are not flood.

    The reference water is dilated by one pixel so a river bank moving by a pixel isn't counted,
    and places the reference didn't see (cloud, nodata) are never called flooded.
    """
    return now & ~ndimage.binary_dilation(before) & before_valid


# --- Rendering ---------------------------------------------------------------------------------


def _png(rgb: np.ndarray, alpha: np.ndarray) -> str:
    data = render(rgb, mask=alpha, img_format="WEBP", quality=80)
    return "data:image/webp;base64," + base64.b64encode(data).decode()


def _ramp(values: np.ndarray, stops: list[tuple[float, tuple[int, int, int]]]) -> np.ndarray:
    xs = [s for s, _ in stops]
    return np.stack(
        [np.interp(values, xs, [c[k] for _, c in stops]).astype("uint8") for k in range(3)]
    )


def _paint(rgb: np.ndarray, alpha: np.ndarray, mask: np.ndarray, color, opacity: int) -> None:
    for k in range(3):
        rgb[k][mask] = color[k]
    alpha[mask] = opacity


@lru_cache(maxsize=64)
def run_preview(
    app_id: str,
    urls: tuple[str, ...],
    bbox: tuple[float, ...],
    reference: tuple[str, ...] | None = None,
) -> dict:
    """Run the preview of `app_id` on bands `urls` (PREVIEWS order) over `bbox`.

    `reference`: the bands of another date (REFERENCE_BANDS order). Vessels: static objects are
    dropped. Wildfire: the burned area since then. Flood: only new water is flood.
    """
    window = analysis_window(bbox)
    size = _grid(window, MAX_PX if app_id == "vessel-detection" else MAX_RASTER_PX)
    # Reads are network-bound and GDAL releases the GIL: fetch every band, of both dates, at once.
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(_read, u, window, size) for u in urls]
        ref_futures = [pool.submit(_read, u, window, size) for u in reference or ()]
        try:
            bands = [f.result() for f in futures]
        except Exception as exc:  # GDAL / network
            raise AnalysisError(f"Could not read the image: {exc}") from exc
        ref = None
        if ref_futures:
            try:
                ref = [f.result() for f in ref_futures]
            except Exception as exc:  # noqa: BLE001 - a bonus: the single image still gives a result
                log.warning("Reference image skipped: %s", exc)
    sky = ref_sky = None
    if app_id == "flood-mapping":
        bands[2] = (bands[2][0], _clear_sky(bands[2]))
        if ref:
            ref[2] = (ref[2][0], _clear_sky(ref[2]))
    elif app_id == "wildfire-detection":
        # Flames show through smoke and are often classified as cloud: hotspots ignore the
        # cloud mask, but cloud and smoke must not pass for burn scars.
        sky = _clear_sky(bands.pop())
        if ref:
            ref_sky = _clear_sky(ref.pop())
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
    rgb = np.zeros((3, height, width), "uint8")
    alpha = np.zeros((height, width), "uint8")

    if app_id == "vessel-detection":
        nir, _ = bands[0]
        ships = detect_vessels(nir, valid)
        candidates = len(ships)
        if ref:
            ships = drop_static(ships, *ref[0])
        ships.sort(key=lambda d: -d["px"])
        result["features"] = [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": lonlat(d["x"], d["y"])},
                "properties": {
                    "kind": "vessel",
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

    if app_id == "wildfire-detection":
        (b8a, _), (b11, _), (b12, _) = bands
        fire = detect_fire(b8a, b11, b12, valid)
        spots = fire_clusters(fire)
        px_ha = px_m * px_m / 1e4
        result["features"] = [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": lonlat(d["x"], d["y"])},
                "properties": {
                    "kind": "fire",
                    "pixels": d["px"],
                    "area_ha": round(d["px"] * px_ha, 1),
                },
            }
            for d in spots
        ]
        summary: dict = {
            "hotspots": len(spots),
            "fire_front_ha": round(float(fire.sum()) * px_ha),
            "burned_ha": None,
        }
        if ref:
            (r8a, rv1), (r12, rv2) = ref
            dnbr = nbr(r8a, r12) - nbr(b8a, b12)
            seen = valid & sky & rv1 & rv2 & ref_sky
            burned = ndimage.binary_opening((dnbr > BURNED_DNBR) & seen) | fire
            summary["cloud_share"] = round(1 - float(seen.sum()) / max(int(valid.sum()), 1), 2)
            summary["burned_ha"] = round(float(burned.sum()) * px_ha)
            _paint(rgb, alpha, burned, (127, 29, 29), 150)  # red-900: scorched
        _paint(rgb, alpha, fire, (251, 146, 60), 235)  # orange-400: flames
        result["image"] = _png(rgb, alpha)
        result["summary"] = summary
        return result

    if app_id == "flood-mapping":
        (green, _), (swir1, _), _ = bands
        water = water_mask(green, swir1, valid)
        px_km2 = px_m * px_m / 1e6
        summary = {"water_km2": round(float(water.sum()) * px_km2, 2), "flooded_km2": None}
        flood = water
        if ref:
            (rg, rv1), (rs, rv2), (_, rv3) = ref
            seen = rv1 & rv2 & rv3
            flood = ndimage.binary_opening(new_water(water, water_mask(rg, rs, seen), seen))
            usual = water & ~flood
            _paint(rgb, alpha, usual, (30, 64, 175), 130)  # blue-800: rivers, lakes, sea
            summary["flooded_km2"] = round(float(flood.sum()) * px_km2, 2)
            summary["usual_water_km2"] = round(float(usual.sum()) * px_km2, 2)
        _paint(rgb, alpha, flood, (56, 189, 248), 200)  # sky-400: flood
        summary["water_share"] = round(float(water.sum()) / max(int(valid.sum()), 1), 3)
        result["image"] = _png(rgb, alpha)
        result["summary"] = summary
        return result

    (red, _), (nir, _) = bands
    total = red + nir
    valid = valid & (total > 0.02)  # too dark to tell (deep shadow)
    ndvi = (nir - red) / np.where(total > 0, total, 1)
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
