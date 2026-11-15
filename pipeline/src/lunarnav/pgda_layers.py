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

from lunarnav.constants import GRID_NO_DATA

SUBSAMPLES_PER_AXIS = 16  # 125 m spacing in a 2 km cell, about the 120 m source.
_PCT_MAX = 100


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


def main() -> None:
    raise NotImplementedError
