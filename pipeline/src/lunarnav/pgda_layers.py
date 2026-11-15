"""PGDA product 69 average Sun/Earth visibility as 2 km map layers.

Each 120 m PGDA raster is area-averaged onto the grid cells (not point-sampled),
so a layer value is the mean over its 2 km cell, NOT the value at a site.
Layout matches grid-*.bin: row 0 is the lowest y, column 0 the lowest x.
"""

import struct
import zlib
from pathlib import Path
from typing import Protocol

import numpy as np
from numpy.typing import ArrayLike, NDArray

from lunarnav.constants import (
    GRID_CELL_KM,
    GRID_NO_DATA,
    GRID_NX,
    GRID_NY,
    GRID_ORIGIN_KM,
    MOON_RADIUS_KM,
    SCHEMA_VERSION,
)
from lunarnav.dem import PdsRaster
from lunarnav.fetch import RAW_DIR
from lunarnav.io import PGDA_EARTH_PNG, PGDA_LAYERS_JSON, PGDA_SUN_PNG, write_json

SUBSAMPLES_PER_AXIS = 16  # 125 m spacing in a 2 km cell, about the 120 m source.
_PCT_MAX = 100
PGDA_SUN_LBL = RAW_DIR / "pgda/AVGVISIB_75S_120M_201608.LBL"
PGDA_EARTH_LBL = RAW_DIR / "pgda/AVGVISIB_75S_120M_201608_EARTH.LBL"


class Sampler(Protocol):
    def sample(self, x_km: ArrayLike, y_km: ArrayLike) -> NDArray: ...


def area_mean_fraction(
    raster: Sampler,
    origin_km: tuple[float, float],
    cell_km: float,
    nx: int,
    ny: int,
    subsamples: int = SUBSAMPLES_PER_AXIS,
) -> NDArray[np.float64]:
    """(ny, nx) mean of `raster` over each cell; NaN where no sub-sample is valid.

    Cell (iy, ix) spans origin + [i, i + 1) * cell_km, like cell_centers_km.
    """
    offset_km = (np.arange(subsamples) + 0.5) / subsamples * cell_km
    mean = np.full((ny, nx), np.nan)
    for iy in range(ny):
        y_km = origin_km[1] + iy * cell_km + offset_km
        x_km = (origin_km[0] + np.arange(nx)[:, None] * cell_km + offset_km).ravel()
        grid_x, grid_y = np.meshgrid(x_km, y_km)
        values = np.asarray(raster.sample(grid_x, grid_y))
        values = values.reshape(subsamples, nx, subsamples)
        valid = np.isfinite(values)
        count = valid.sum(axis=(0, 2))
        total = np.where(valid, values, 0.0).sum(axis=(0, 2))
        mean[iy] = np.where(count > 0, total / np.maximum(count, 1), np.nan)
    return mean


def encode_pct_u8(fraction: ArrayLike) -> NDArray[np.uint8]:
    """Fraction of time (0-1) to whole percent 0-100; NaN becomes 255 (no data)."""
    fraction = np.asarray(fraction, dtype=np.float64)
    pct = np.clip(np.rint(fraction * 100), 0, _PCT_MAX)
    return np.where(np.isnan(fraction), GRID_NO_DATA, pct).astype(np.uint8)


def _chunk(kind: bytes, body: bytes) -> bytes:
    crc = zlib.crc32(kind + body)
    return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", crc)


def write_gray_png(path: Path, pixels: NDArray[np.uint8]) -> None:
    """8-bit grayscale PNG, row 0 first. Standard library only (no Pillow)."""
    pixels = np.ascontiguousarray(pixels, dtype=np.uint8)
    height, width = pixels.shape
    scanlines = np.zeros((height, width + 1), dtype=np.uint8)  # filter 0 = None
    scanlines[:, 1:] = pixels
    header = struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", header)
        + _chunk(b"IDAT", zlib.compress(scanlines.tobytes(), 9))
        + _chunk(b"IEND", b"")
    )


def layers_manifest(
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
        "layers": {"sun": "pgda-sun.png", "earth": "pgda-earth.png"},
        "encoding": "8-bit grayscale; value = whole percent of time 0-100; 255 = no data",
        "rowOrder": "row 0 = lowest y, column 0 = lowest x (same as grid-*.bin); "
        "flip vertically to draw north-up style maps",
        "resampling": f"mean of {SUBSAMPLES_PER_AXIS}x{SUBSAMPLES_PER_AXIS} bilinear "
        "samples per cell (area average, not a site value)",
        "source": {
            "product": "NASA PGDA product 69, average visibility, 75S, 120 m, 2016-08",
            "url": "https://pgda.gsfc.nasa.gov/products/69",
            "files": [PGDA_SUN_LBL.stem, PGDA_EARTH_LBL.stem],
            "resolutionM": 120,
        },
        "definition": "Fraction of time any part of the Sun/Earth disk is visible "
        "(PGDA label wording); differs from our mean Sun fraction / Earth-center "
        "validation definitions.",
        "observerHeightM": None,
        "observerHeightNote": "Not stated in the PGDA product page, labels or "
        "README; tracked in #57. Do not assume a height.",
    }


def build_layers(
    sun: Sampler,
    earth: Sampler,
    cell_km: float = GRID_CELL_KM,
    nx: int = GRID_NX,
    ny: int = GRID_NY,
    origin_km: tuple[float, float] = GRID_ORIGIN_KM,
) -> tuple[NDArray[np.uint8], NDArray[np.uint8]]:
    sun_u8 = encode_pct_u8(area_mean_fraction(sun, origin_km, cell_km, nx, ny))
    earth_u8 = encode_pct_u8(area_mean_fraction(earth, origin_km, cell_km, nx, ny))
    return sun_u8, earth_u8


def main() -> None:
    sun_u8, earth_u8 = build_layers(PdsRaster(PGDA_SUN_LBL), PdsRaster(PGDA_EARTH_LBL))
    write_gray_png(PGDA_SUN_PNG, sun_u8)
    write_gray_png(PGDA_EARTH_PNG, earth_u8)
    write_json(
        PGDA_LAYERS_JSON,
        layers_manifest(GRID_CELL_KM, GRID_NX, GRID_NY, GRID_ORIGIN_KM),
    )
    print(f"Wrote {PGDA_SUN_PNG.name}, {PGDA_EARTH_PNG.name}, {PGDA_LAYERS_JSON.name}")
