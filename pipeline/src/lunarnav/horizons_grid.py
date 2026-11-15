"""`lunarnav horizons --grid`: terrain horizons over the south-polar grid.

Writes grid.json, grid-horizons.bin (ny x nx x 360 uint8) and grid-heights.bin
(ny x nx int16-le) per SPEC.md. Rows run from the lowest y (iy = 0) upward and
x varies fastest; cells are evaluated at their centers. A cell whose 250 km
scan leaves DEM coverage (only the grid corners, north of ~83.2 S) is written
as 255 (no data) in every bin rather than given a partial horizon.
"""

import sys
import time
from pathlib import Path

import numpy as np
from numpy.typing import ArrayLike, NDArray

from lunarnav.constants import (
    GRID_AZ_BINS,
    GRID_CELL_KM,
    GRID_HEIGHT_M,
    GRID_NO_DATA,
    GRID_NX,
    GRID_NY,
    GRID_ORIGIN_KM,
    MOON_RADIUS_KM,
    SCHEMA_VERSION,
)
from lunarnav.dem import DemStack, xy_km_to_lat_lon
from lunarnav.horizon import compute_horizon_deg
from lunarnav.io import (
    GRID_HEIGHTS_BIN,
    GRID_HORIZONS_BIN,
    GRID_JSON,
    write_i16,
    write_json,
    write_u8,
)

ELEV_OFFSET_DEG = -5.0
ELEV_STEP_DEG = 0.1
_MAX_CODE = GRID_NO_DATA - 1


def encode_elev_u8(elev_deg: ArrayLike) -> NDArray[np.uint8]:
    """elevDeg -> round((elevDeg + 5) / 0.1), clamped to 0..254; NaN -> 255."""
    elev_deg = np.asarray(elev_deg, dtype=np.float64)
    codes = np.rint((elev_deg - ELEV_OFFSET_DEG) / ELEV_STEP_DEG)
    codes = np.clip(np.nan_to_num(codes, nan=GRID_NO_DATA), 0, _MAX_CODE)
    return np.where(np.isnan(elev_deg), GRID_NO_DATA, codes).astype(np.uint8)


def decode_elev_deg(codes: ArrayLike) -> NDArray[np.float64]:
    """v * 0.1 - 5.0; 255 -> NaN. Mirrors the engine decoder."""
    codes = np.asarray(codes)
    elev_deg = codes * ELEV_STEP_DEG + ELEV_OFFSET_DEG
    return np.where(codes == GRID_NO_DATA, np.nan, elev_deg)


def cell_centers_km(
    origin_km: tuple[float, float], cell_km: float, nx: int, ny: int
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """(ny, nx) map x/y of cell centers: originKm + (i + 0.5) * cellKm."""
    x_km = origin_km[0] + (np.arange(nx) + 0.5) * cell_km
    y_km = origin_km[1] + (np.arange(ny) + 0.5) * cell_km
    return np.meshgrid(x_km, y_km)


def grid_manifest(
    cell_km: float, nx: int, ny: int, origin_km: tuple[float, float]
) -> dict[str, object]:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "projection": "polar-stereographic-south",
        "sphereRadiusKm": MOON_RADIUS_KM,
        "originKm": list(origin_km),
        "cellKm": cell_km,
        "nx": nx,
        "ny": ny,
        "azBins": GRID_AZ_BINS,
        "heightM": GRID_HEIGHT_M,
        "dtype": "uint8",
        "encoding": "elevDeg = v * 0.1 - 5.0; 255 = no data",
        "cellSurfaceHeightM": "grid-heights.bin (int16-le, row-major)",
    }


def build_grid(
    terrain: DemStack,
    origin_km: tuple[float, float],
    cell_km: float,
    nx: int,
    ny: int,
    progress: bool = False,
) -> tuple[NDArray[np.uint8], NDArray[np.int16]]:
    """Return (ny, nx, 360) uint8 horizons and (ny, nx) int16 surface heights."""
    x_km, y_km = cell_centers_km(origin_km, cell_km, nx, ny)
    lat_deg, lon_deg = xy_km_to_lat_lon(x_km, y_km)
    surface_m = np.asarray(terrain.height_m(x_km, y_km), dtype=np.float64)
    if not np.all(np.isfinite(surface_m)):
        raise ValueError("Missing terrain at a grid cell center")
    if np.any(np.abs(surface_m) > np.iinfo(np.int16).max):
        raise ValueError("Cell surface height does not fit int16 meters")
    horizons_u8 = np.full((ny, nx, GRID_AZ_BINS), GRID_NO_DATA, dtype=np.uint8)
    start_s = time.perf_counter()
    for iy in range(ny):
        for ix in range(nx):
            try:
                horizon_deg = compute_horizon_deg(
                    terrain,
                    float(lat_deg[iy, ix]),
                    float(lon_deg[iy, ix]),
                    GRID_HEIGHT_M,
                    GRID_AZ_BINS,
                )
            except ValueError as error:
                if "Missing terrain within" not in str(error):
                    raise
                continue  # Scan leaves DEM coverage: keep 255.
            horizons_u8[iy, ix] = encode_elev_u8(horizon_deg)
        if progress:
            elapsed_s = time.perf_counter() - start_s
            eta_s = elapsed_s / (iy + 1) * (ny - iy - 1)
            print(
                f"grid row {iy + 1}/{ny}  {elapsed_s / 60:.1f} min, "
                f"ETA {eta_s / 60:.1f} min",
                file=sys.stderr,
                flush=True,
            )
    return horizons_u8, np.rint(surface_m).astype(np.int16)


def write_grid(
    terrain: DemStack,
    origin_km: tuple[float, float],
    cell_km: float,
    nx: int,
    ny: int,
    paths: dict[str, Path],
    progress: bool = False,
) -> None:
    horizons_u8, heights_m = build_grid(terrain, origin_km, cell_km, nx, ny, progress)
    write_u8(paths["horizons"], horizons_u8)
    write_i16(paths["heights"], heights_m)
    write_json(paths["manifest"], grid_manifest(cell_km, nx, ny, origin_km))


def main() -> None:
    paths = {
        "manifest": GRID_JSON,
        "horizons": GRID_HORIZONS_BIN,
        "heights": GRID_HEIGHTS_BIN,
    }
    write_grid(
        DemStack(),
        GRID_ORIGIN_KM,
        GRID_CELL_KM,
        GRID_NX,
        GRID_NY,
        paths,
        progress=True,
    )
