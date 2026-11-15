"""Vectorized reference geometry in MOON_ME; public angles are in degrees.

Vectors use a trailing xyz axis. Site coordinates and scalar quantities broadcast
with NumPy. Heights include terrain plus observer height above the 1737.4 km
sphere. Latitude is clamped consistently for both the position and ENU frame.
"""

from typing import Literal

import numpy as np
from numpy.typing import ArrayLike, NDArray

from lunarnav.constants import MAX_ABS_LAT_DEG, MOON_RADIUS_KM

SUN_RADIUS_KM = 695_700.0
EARTH_RADIUS_KM = 6_371.0


def _lat_lon_rad(
    lat_deg: ArrayLike, lon_deg: ArrayLike
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    lat_deg, lon_deg = np.broadcast_arrays(
        np.asarray(lat_deg, dtype=float), np.asarray(lon_deg, dtype=float)
    )
    if not np.all(np.isfinite(lat_deg) & np.isfinite(lon_deg)):
        raise ValueError("Coordinates must be finite")
    if np.any(np.abs(lat_deg) > 90):
        raise ValueError("Latitude must be between -90 and 90 degrees")
    return (
        np.deg2rad(np.clip(lat_deg, -MAX_ABS_LAT_DEG, MAX_ABS_LAT_DEG)),
        np.deg2rad(lon_deg),
    )


def enu_basis(
    lat_deg: ArrayLike, lon_deg: ArrayLike
) -> tuple[NDArray[np.float64], NDArray[np.float64], NDArray[np.float64]]:
    """Return east, north, up unit vectors, each shaped (..., 3).

    North points toward increasing planetocentric latitude. Longitude fixes the
    meridian at a pole; latitude is clamped to +/-89.999 degrees.
    """
    lat_rad, lon_rad = _lat_lon_rad(lat_deg, lon_deg)
    sin_lat, cos_lat = np.sin(lat_rad), np.cos(lat_rad)
    sin_lon, cos_lon = np.sin(lon_rad), np.cos(lon_rad)
    east = np.stack((-sin_lon, cos_lon, np.zeros_like(lat_rad)), axis=-1)
    north = np.stack((-sin_lat * cos_lon, -sin_lat * sin_lon, cos_lat), axis=-1)
    up = np.stack((cos_lat * cos_lon, cos_lat * sin_lon, sin_lat), axis=-1)
    return east, north, up


def site_vector_km(
    lat_deg: ArrayLike, lon_deg: ArrayLike, height_m: ArrayLike
) -> NDArray[np.float64]:
    """Position (..., 3) on the reference sphere plus total height in meters."""
    height_m = np.asarray(height_m, dtype=float)
    radius_km = MOON_RADIUS_KM + height_m / 1000.0
    if not np.all(np.isfinite(radius_km) & (radius_km > 0)):
        raise ValueError("Height must give a finite, positive site radius")
    _, _, up = enu_basis(lat_deg, lon_deg)
    return radius_km[..., np.newaxis] * up


def az_el(
    body_vec_km: ArrayLike,
    lat_deg: ArrayLike,
    lon_deg: ArrayLike,
    height_m: ArrayLike = 0.0,
) -> tuple[NDArray[np.float64], NDArray[np.float64], NDArray[np.float64]]:
    """Return (az_deg, elev_deg, dist_km) using body minus site position.

    body_vec_km is Moon-centered, shaped (..., 3). Azimuth is clockwise from
    north in [0, 360); elevation is above the local spherical horizontal.
    Azimuth at exact zenith/nadir is undefined and must not be interpreted.
    """
    body_vec_km = np.asarray(body_vec_km, dtype=float)
    if body_vec_km.ndim == 0 or body_vec_km.shape[-1] != 3:
        raise ValueError("Body vectors must have a trailing xyz axis")
    if not np.all(np.isfinite(body_vec_km)):
        raise ValueError("Body vectors must be finite")
    east, north, up = enu_basis(lat_deg, lon_deg)
    direction_km = body_vec_km - site_vector_km(lat_deg, lon_deg, height_m)
    dist_km = np.linalg.norm(direction_km, axis=-1)
    if np.any(dist_km == 0):
        raise ValueError("Body and observer positions must differ")
    east_km = np.sum(direction_km * east, axis=-1)
    north_km = np.sum(direction_km * north, axis=-1)
    up_km = np.sum(direction_km * up, axis=-1)
    az_deg = np.rad2deg(np.arctan2(east_km, north_km)) % 360.0
    # A negative angle within half an ulp of zero can round to 360 after modulo.
    az_deg = np.where(az_deg >= 360.0, 0.0, az_deg)
    elev_deg = np.rad2deg(np.arctan2(up_km, np.hypot(east_km, north_km)))
    return az_deg, elev_deg, dist_km


def angular_radius_deg(
    body: Literal["sun", "earth"], dist_km: ArrayLike
) -> NDArray[np.float64]:
    """Apparent angular radius of a spherical body at topocentric distance."""
    radii_km = {"sun": SUN_RADIUS_KM, "earth": EARTH_RADIUS_KM}
    if body not in radii_km:
        raise ValueError(f"Unknown body: {body}")
    radius_km = radii_km[body]
    dist_km = np.asarray(dist_km, dtype=float)
    if not np.all(np.isfinite(dist_km) & (dist_km >= radius_km)):
        raise ValueError("Distance must be finite and at least the body radius")
    return np.rad2deg(np.arcsin(radius_km / dist_km))


def visible_disk_fraction(
    center_elev_deg: ArrayLike, horizon_elev_deg: ArrayLike, radius_deg: ArrayLike
) -> NDArray[np.float64]:
    """Circular disk area above a locally straight horizon, as a fraction.

    Positive d=(center-horizon)/radius means more of the disk is visible:
    d=-1, 0, +1 gives 0, 0.5, 1. This models disk area, not limb darkening.
    """
    center_elev_deg, horizon_elev_deg, radius_deg = np.broadcast_arrays(
        np.asarray(center_elev_deg, dtype=float),
        np.asarray(horizon_elev_deg, dtype=float),
        np.asarray(radius_deg, dtype=float),
    )
    if not np.all(
        np.isfinite(center_elev_deg)
        & np.isfinite(horizon_elev_deg)
        & np.isfinite(radius_deg)
        & (radius_deg > 0)
    ):
        raise ValueError("Angles must be finite and disk radius must be positive")
    d = np.clip((center_elev_deg - horizon_elev_deg) / radius_deg, -1, 1)
    hidden_area = np.arccos(d) - d * np.sqrt(np.maximum(0, 1 - d * d))
    return np.clip(1 - hidden_area / np.pi, 0, 1)
