import numpy as np
from fastapi.testclient import TestClient

from app import analysis
from app.geo import BBox
from app.main import app
from app.stac import coverage


def sea_scene():
    nir = np.full((300, 300), 0.03, "float32")  # open sea
    nir[:, :40] = 0.25  # coast on the left
    nir[150:153, 150:162] = 0.30  # a 120 m ship
    nir[50:52, 100:160] = 0.30  # a 600 m breakwater
    nir[250, 250] = 0.30  # a single bright pixel: noise
    return nir, np.ones_like(nir, bool)


def test_detects_ships_but_not_coast_jetties_or_noise():
    found = analysis.detect_vessels(*sea_scene())
    assert len(found) == 1
    ship = found[0]
    assert (ship["y"], ship["x"]) == (151.0, 155.5)
    assert ship["extent"] == 12


def test_nodata_is_not_water():
    nir, valid = sea_scene()
    valid[:, 200:] = False  # outside the swath: DN 0 must not look like dark sea
    nir[:, 200:] = 0.0
    assert len(analysis.detect_vessels(nir, valid)) == 1


def test_static_objects_seen_on_another_date_are_dropped():
    nir, valid = sea_scene()
    ships = analysis.detect_vessels(nir, valid)
    moved = np.full_like(nir, 0.03)
    assert analysis.drop_static(ships, moved, valid) == ships  # the ship has left: keep
    assert analysis.drop_static(ships, nir, valid) == []  # still there: a rock, drop
    assert analysis.drop_static(ships, nir, np.zeros_like(valid)) == ships  # no data: keep


def test_analysis_window_is_capped_around_the_centre():
    w, s, e, n = analysis.analysis_window((4.0, 43.0, 6.0, 44.0))
    assert abs((w + e) / 2 - 5.0) < 1e-9 and abs((s + n) / 2 - 43.5) < 1e-9
    assert (n - s) * 111.32 <= analysis.MAX_SPAN_KM + 1e-6
    small = (5.2, 43.2, 5.3, 43.3)
    assert analysis.analysis_window(small) == small


def test_scene_coverage_of_the_area():
    box = BBox(0, 0, 2, 2)
    half = {"type": "Polygon", "coordinates": [[[1, -1], [3, -1], [3, 3], [1, 3], [1, -1]]]}
    assert coverage(half, box) == 0.5
    assert coverage(None, box) == 0.0


def test_preview_endpoint_guards():
    with TestClient(app) as client:
        bbox = {"bbox": "5.2,43.2,5.4,43.4"}
        assert client.get("/api/preview/wildfire-detection", params=bbox).status_code == 404
        assert client.get("/api/preview/vessel-detection").status_code == 422  # no bbox
