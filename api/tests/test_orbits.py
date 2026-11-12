from datetime import UTC, datetime

from app.geo import BBox
from app.orbits import SENTINEL2_HALF_SWATH_KM, find_passes, parse_tle

# Snapshot from CelesTrak (epoch 2026-11-11/12) so the test runs offline and is deterministic.
TLE = """
SENTINEL-2A
1 40697U 15028A   26315.62715235  .00000295  00000+0  12902-3 0  9992
2 40697  98.5619  28.3134 0001181  97.1672 262.9645 14.30821442594810
SENTINEL-2B
1 42063U 17013A   26316.17953808  .00000122  00000+0  63359-4 0  9990
2 42063  98.5724  28.8417 0001107  95.9170 264.2139 14.30820535505808
SENTINEL-2C
1 60989U 24157A   26316.14454257  .00000131  00000+0  66606-4 0  9993
2 60989  98.5731  28.8016 0000829 100.8155 259.3121 14.30813012114148
"""

TOULOUSE = BBox.parse("1.30,43.52,1.56,43.68")
START = datetime(2026, 11, 12, tzinfo=UTC)


def test_parse_tle():
    sats = parse_tle(TLE)
    assert [s.name for s in sats] == ["SENTINEL-2A", "SENTINEL-2B", "SENTINEL-2C"]


def test_passes_over_toulouse():
    passes = find_passes(parse_tle(TLE), TOULOUSE, START, days=5)
    assert passes, "three Sentinel-2 satellites must overfly Toulouse within 5 days"
    assert [p["time"] for p in passes] == sorted(p["time"] for p in passes)

    reach = SENTINEL2_HALF_SWATH_KM + TOULOUSE.radius_km
    for p in passes:
        assert p["offset_km"] <= reach
        assert len(p["ground_track"]["coordinates"]) > 10

    # Sentinel-2 is sun-synchronous (10:30 descending node): daytime passes over Toulouse
    # happen late morning UTC while descending, night passes while ascending.
    day = [p for p in passes if p["daylight"]]
    assert day
    for p in day:
        assert p["direction"] == "descending"
        assert 9 <= int(p["time"][11:13]) <= 12
    assert all(p["direction"] == "ascending" for p in passes if not p["daylight"])
