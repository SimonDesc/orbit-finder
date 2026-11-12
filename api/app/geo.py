import math
from dataclasses import dataclass

import numpy as np

EARTH_RADIUS_KM = 6371.0


@dataclass(frozen=True)
class BBox:
    west: float
    south: float
    east: float
    north: float

    @classmethod
    def parse(cls, raw: str) -> "BBox":
        """Parse 'west,south,east,north' (WGS84 degrees) and validate it."""
        try:
            w, s, e, n = (float(v) for v in raw.split(","))
        except ValueError as exc:
            raise ValueError("bbox must be 'west,south,east,north'") from exc
        if not (-180 <= w < e <= 180 and -90 <= s < n <= 90):
            raise ValueError("bbox is out of range or inverted")
        return cls(w, s, e, n)

    def as_list(self) -> list[float]:
        return [self.west, self.south, self.east, self.north]

    @property
    def center(self) -> tuple[float, float]:
        """(lat, lon) of the box center."""
        return (self.south + self.north) / 2, (self.west + self.east) / 2

    @property
    def radius_km(self) -> float:
        """Distance from the center to a corner: the box fits in a circle of this radius."""
        lat, lon = self.center
        return float(haversine_km(lat, lon, self.north, self.east))


def haversine_km(lat1, lon1, lat2, lon2):
    """Great-circle distance in km. Works on scalars and numpy arrays."""
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dp = p2 - p1
    dl = np.radians(lon2) - np.radians(lon1)
    a = np.sin(dp / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_KM * np.arcsin(np.sqrt(a))


def solar_elevation_deg(lat: float, lon: float, when) -> float:
    """Approximate sun elevation (NOAA formula, ~0.5° accuracy). `when` is an aware UTC datetime.

    Good enough to tell daytime (optical imaging possible) from night passes, without
    downloading a planetary ephemeris.
    """
    day_of_year = when.timetuple().tm_yday
    hour = when.hour + when.minute / 60 + when.second / 3600
    g = 2 * math.pi / 365 * (day_of_year - 1 + (hour - 12) / 24)
    decl = (
        0.006918
        - 0.399912 * math.cos(g)
        + 0.070257 * math.sin(g)
        - 0.006758 * math.cos(2 * g)
        + 0.000907 * math.sin(2 * g)
        - 0.002697 * math.cos(3 * g)
        + 0.00148 * math.sin(3 * g)
    )
    eqtime = 229.18 * (
        0.000075
        + 0.001868 * math.cos(g)
        - 0.032077 * math.sin(g)
        - 0.014615 * math.cos(2 * g)
        - 0.040849 * math.sin(2 * g)
    )
    solar_time_min = hour * 60 + eqtime + 4 * lon
    hour_angle = math.radians(solar_time_min / 4 - 180)
    phi = math.radians(lat)
    cos_zenith = math.sin(phi) * math.sin(decl) + math.cos(phi) * math.cos(decl) * math.cos(
        hour_angle
    )
    return 90 - math.degrees(math.acos(max(-1.0, min(1.0, cos_zenith))))
