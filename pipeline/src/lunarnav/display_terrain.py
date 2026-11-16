"""`lunarnav display-terrain`: a high-resolution height map used ONLY for drawing.

Writes terrain-display.bin (ny x nx int16-le metres, row-major iy * nx + ix,
iy = 0 is the lowest y, same order as grid-heights.bin) and terrain-display.json.
Every number in the app (visibility, windows, scores) still comes from the 2 km
horizon grid and the site masks; the engine never reads these files.

Each cell is the mean of a sub x sub block of samples over its footprint, so a
355.5 m cell is not a point sample of an 80 m DEM.
"""

from pathlib import Path
from typing import Protocol

import numpy as np
from numpy.typing import ArrayLike, NDArray

from lunarnav.constants import (
    GRID_CELL_KM,
    GRID_NX,
    GRID_ORIGIN_KM,
    MOON_RADIUS_KM,
    SCHEMA_VERSION,
)
from lunarnav.dem import DemStack
from lunarnav.horizons_grid import cell_centers_km
from lunarnav.io import (
    TERRAIN_DISPLAY_BIN,
    TERRAIN_DISPLAY_JSON,
    write_i16,
    write_json,
)

DISPLAY_N = 1024
# The same square as the 2 km grid (extent and origin come from its constants).
DISPLAY_EXTENT_KM = GRID_NX * GRID_CELL_KM
DISPLAY_ORIGIN_KM = (float(GRID_ORIGIN_KM[0]), float(GRID_ORIGIN_KM[1]))
DISPLAY_CELL_KM = DISPLAY_EXTENT_KM / DISPLAY_N
SUB = 4
_CHUNK_ROWS = 64


class Terrain(Protocol):
    def height_m(self, x_km: ArrayLike, y_km: ArrayLike) -> float | NDArray: ...

    def dems(self) -> list[dict[str, str | int]]: ...


def build_display_terrain(
    terrain: Terrain,
    origin_km: tuple[float, float],
    cell_km: float,
    nx: int,
    ny: int,
    sub: int = SUB,
) -> NDArray[np.int16]:
    """(ny, nx) int16 metres: mean of sub x sub samples per cell footprint."""
    x_km, y_km = cell_centers_km(origin_km, cell_km, nx, ny)
    offsets = ((np.arange(sub) + 0.5) / sub - 0.5) * cell_km
    out = np.empty((ny, nx), dtype=np.int16)
    int16 = np.iinfo(np.int16)
    for y0 in range(0, ny, _CHUNK_ROWS):
        y1 = min(y0 + _CHUNK_ROWS, ny)
        xs = x_km[y0:y1, :, None, None] + offsets[None, None, None, :]
        ys = y_km[y0:y1, :, None, None] + offsets[None, None, :, None]
        xs, ys = np.broadcast_arrays(xs, ys)
        samples = np.asarray(terrain.height_m(xs, ys), dtype=np.float64)
        if not np.all(np.isfinite(samples)):
            raise ValueError("Missing terrain inside the display grid")
        mean_m = np.rint(samples.mean(axis=(2, 3)))
        if np.any((mean_m < int16.min) | (mean_m > int16.max)):
            raise ValueError("Display height does not fit int16 meters")
        out[y0:y1] = mean_m.astype(np.int16)
    return out


def compare_to_grid(
    display_m: NDArray[np.int16], grid_m: NDArray[np.int16]
) -> NDArray[np.float64]:
    """|display - grid| at the grid cell centers (bilinear from the display array)."""
    ny, nx = display_m.shape
    gy, gx = grid_m.shape
    # Grid cell centers as fractional display-pixel coordinates (same square).
    fx = (np.arange(gx) + 0.5) * nx / gx - 0.5
    fy = (np.arange(gy) + 0.5) * ny / gy - 0.5
    x0 = np.clip(np.floor(fx).astype(int), 0, nx - 2)
    y0 = np.clip(np.floor(fy).astype(int), 0, ny - 2)
    tx = np.clip(fx - x0, 0, 1)[None, :]
    ty = np.clip(fy - y0, 0, 1)[:, None]
    d = display_m.astype(np.float64)
    top = d[np.ix_(y0, x0)] * (1 - tx) + d[np.ix_(y0, x0 + 1)] * tx
    bottom = d[np.ix_(y0 + 1, x0)] * (1 - tx) + d[np.ix_(y0 + 1, x0 + 1)] * tx
    sampled = top * (1 - ty) + bottom * ty
    return np.abs(sampled - grid_m.astype(np.float64)).ravel()


def display_manifest(
    cell_km: float,
    nx: int,
    ny: int,
    origin_km: tuple[float, float],
    dems: list[dict[str, str | int]],
) -> dict[str, object]:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "projection": "polar-stereographic-south",
        "sphereRadiusKm": MOON_RADIUS_KM,
        "originKm": list(origin_km),
        "cellKm": cell_km,
        "nx": nx,
        "ny": ny,
        "dtype": "int16-le",
        "rowOrder": "row-major iy * nx + ix, iy = 0 is the lowest y",
        "units": "metres above the reference sphere",
        "dems": dems,
        "resampling": f"mean of {SUB}x{SUB} samples",
        "note": "display only; never used for visibility",
    }


def write_display_terrain(
    terrain: Terrain,
    origin_km: tuple[float, float],
    cell_km: float,
    nx: int,
    ny: int,
    paths: dict[str, Path],
) -> NDArray[np.int16]:
    heights = build_display_terrain(terrain, origin_km, cell_km, nx, ny)
    write_i16(paths["bin"], heights)
    write_json(
        paths["manifest"],
        display_manifest(cell_km, nx, ny, origin_km, terrain.dems()),
    )
    return heights


def main() -> None:
    write_display_terrain(
        DemStack(),
        DISPLAY_ORIGIN_KM,
        DISPLAY_CELL_KM,
        DISPLAY_N,
        DISPLAY_N,
        {"bin": TERRAIN_DISPLAY_BIN, "manifest": TERRAIN_DISPLAY_JSON},
    )
