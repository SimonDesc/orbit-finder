from datetime import UTC, datetime

import pytest

from app.geo import BBox, haversine_km, solar_elevation_deg


def test_bbox_parse_and_center():
    b = BBox.parse("1.30,43.52,1.56,43.68")
    assert b.center == pytest.approx((43.60, 1.43))
    assert 10 < b.radius_km < 15


@pytest.mark.parametrize("raw", ["1,2,3", "a,b,c,d", "2,43,1,44", "0,95,1,96"])
def test_bbox_rejects_invalid(raw):
    with pytest.raises(ValueError):
        BBox.parse(raw)


def test_haversine_toulouse_paris():
    assert haversine_km(43.6047, 1.4442, 48.8566, 2.3522) == pytest.approx(588, abs=5)


def test_solar_elevation_toulouse():
    summer_noon = datetime(2026, 6, 21, 12, 0, tzinfo=UTC)
    midnight = datetime(2026, 6, 21, 0, 0, tzinfo=UTC)
    assert solar_elevation_deg(43.6, 1.44, summer_noon) == pytest.approx(69.5, abs=1.5)
    assert solar_elevation_deg(43.6, 1.44, midnight) < 0
