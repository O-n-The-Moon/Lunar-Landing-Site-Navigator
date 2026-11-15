"""Terrain horizons in MOON_ME, sampled out to 250 km on the LOLA map.

The Python boundary reuses DemStack's near-first bilinear sampling. Only the
3D ray reduction is compiled; each parallel ray owns its bins to avoid races.
"""

import numpy as np
from numba import njit, prange
from numpy.typing import NDArray

from lunarnav.constants import MAX_ABS_LAT_DEG, MOON_RADIUS_KM
from lunarnav.dem import DemStack, lat_lon_to_xy_km
from lunarnav.geometry import enu_basis, site_vector_km

MAX_DISTANCE_KM = 250.0


def _distances_km(cell_km: float) -> NDArray[np.float64]:
    distances_km = []
    distance_km = cell_km
    while distance_km < MAX_DISTANCE_KM:
        distances_km.append(distance_km)
        distance_km += max(cell_km, 0.005 * distance_km)
    distances_km.append(MAX_DISTANCE_KM)
    return np.asarray(distances_km)


@njit(parallel=True, cache=True)
def _reduce_rays_deg(
    x_km: NDArray[np.float64],
    y_km: NDArray[np.float64],
    heights_m: NDArray[np.float64],
    observer_km: NDArray[np.float64],
    basis: NDArray[np.float64],
    az_bins: int,
) -> NDArray[np.float64]:
    ray_bins_deg = np.full((x_km.shape[0], az_bins), -np.inf)
    for ray in prange(x_km.shape[0]):
        for sample in range(x_km.shape[1]):
            x, y = x_km[ray, sample], y_km[ray, sample]
            # Inverse stereographic directly to XYZ. Map Y faces Moon +X,
            # map X faces Moon +Y; the pole is Moon -Z. No flat-plane shortcut.
            rho_sq = (x * x + y * y) / (4 * MOON_RADIUS_KM**2)
            scale = (1 + heights_m[ray, sample] / (1000 * MOON_RADIUS_KM)) / (
                1 + rho_sq
            )
            dx = y * scale - observer_km[0]
            dy = x * scale - observer_km[1]
            dz = -MOON_RADIUS_KM * (1 - rho_sq) * scale - observer_km[2]
            east_km = dx * basis[0, 0] + dy * basis[0, 1] + dz * basis[0, 2]
            north_km = dx * basis[1, 0] + dy * basis[1, 1] + dz * basis[1, 2]
            up_km = dx * basis[2, 0] + dy * basis[2, 1] + dz * basis[2, 2]
            az_rad = np.arctan2(east_km, north_km) % (2 * np.pi)
            # Bins are centered at i * 360/N degrees, including north at i=0.
            az_bin = int(np.floor(az_rad * az_bins / (2 * np.pi) + 0.5)) % az_bins
            elev_deg = np.arctan2(up_km, np.hypot(east_km, north_km)) * 180 / np.pi
            ray_bins_deg[ray, az_bin] = max(ray_bins_deg[ray, az_bin], elev_deg)
    return ray_bins_deg


def _fill_bins_deg(horizon_deg: NDArray[np.float64]) -> NDArray[np.float64]:
    known = np.flatnonzero(np.isfinite(horizon_deg))
    if not known.size:
        raise ValueError("No terrain samples available for horizon")
    return np.interp(
        np.arange(horizon_deg.size), known, horizon_deg[known], period=horizon_deg.size
    )


def compute_horizon_deg(
    terrain: DemStack,
    lat_deg: float,
    lon_deg: float,
    observer_height_m: float,
    az_bins: int = 720,
) -> NDArray[np.float64]:
    """Return N terrain elevations at azimuths i * 360/N degrees.

    The observer is above the locally sampled surface, in meters. Sites use
    720 bins with 0.25-degree rays; grid callers use 360 with 0.5-degree rays.
    March steps are max(near-field cell size, 0.005 * projected distance).
    Empty azimuth bins are interpolated periodically. Missing DEM coverage
    anywhere in the scan raises ValueError rather than inventing a horizon.
    The first call includes numba compilation; later calls reuse compiled code.
    """
    if not np.isfinite(lat_deg) or not -90 <= lat_deg <= 0:
        raise ValueError("Latitude must be finite and between -90 and 0 degrees")
    if not np.isfinite(lon_deg) or not -180 <= lon_deg <= 180:
        raise ValueError("Longitude must be finite and between -180 and 180 degrees")
    if not np.isfinite(observer_height_m) or observer_height_m < 0:
        raise ValueError("Observer height must be finite and nonnegative")
    if isinstance(az_bins, bool) or not isinstance(az_bins, int) or az_bins < 1:
        raise ValueError("Azimuth bin count must be a positive integer")
    cell_km = terrain.near.cell_km
    if not np.isfinite(cell_km) or not 0 < cell_km <= MAX_DISTANCE_KM:
        raise ValueError("DEM cell size must be finite and in (0, 250] km")

    # Match geometry.py's pole convention for both the DEM origin and the ENU.
    lat_deg = max(lat_deg, -MAX_ABS_LAT_DEG)
    origin_x_km, origin_y_km = lat_lon_to_xy_km(lat_deg, lon_deg)
    surface_height_m = float(terrain.height_m(origin_x_km, origin_y_km))
    if not np.isfinite(surface_height_m):
        raise ValueError("Missing terrain at observer")
    observer_km = site_vector_km(lat_deg, lon_deg, surface_height_m + observer_height_m)
    basis = np.stack(enu_basis(lat_deg, lon_deg))
    distances_km = _distances_km(cell_km)
    # Stereographic is conformal: this rotation starts each straight map ray
    # in the specified local direction. True azimuth still varies along it.
    ray_rad = np.arange(2 * az_bins) * np.pi / az_bins + np.deg2rad(lon_deg)
    x_km = origin_x_km + np.sin(ray_rad[:, None]) * distances_km
    y_km = origin_y_km + np.cos(ray_rad[:, None]) * distances_km
    heights_m = np.asarray(terrain.height_m(x_km, y_km), dtype=np.float64)
    if not np.all(np.isfinite(heights_m)):
        raise ValueError("Missing terrain within 250 km horizon scan")
    ray_bins_deg = _reduce_rays_deg(x_km, y_km, heights_m, observer_km, basis, az_bins)
    return _fill_bins_deg(np.max(ray_bins_deg, axis=0))
