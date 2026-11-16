"""Contract output paths and file writers."""

import json
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import ArrayLike

REPO_ROOT = Path(__file__).resolve().parents[3]
RAW_DIR = REPO_ROOT / "pipeline" / "data" / "raw"
DATA_DIR = REPO_ROOT / "web" / "public" / "data"
FIXTURES_DIR = REPO_ROOT / "shared" / "fixtures"

EPHEMERIS_JSON = DATA_DIR / "ephemeris.json"
EPHEMERIS_BIN = DATA_DIR / "ephemeris.bin"
SITES_JSON = DATA_DIR / "sites.json"
GRID_JSON = DATA_DIR / "grid.json"
GRID_HORIZONS_BIN = DATA_DIR / "grid-horizons.bin"
GRID_HEIGHTS_BIN = DATA_DIR / "grid-heights.bin"
TERRAIN_DISPLAY_BIN = DATA_DIR / "terrain-display.bin"  # display only
TERRAIN_DISPLAY_JSON = DATA_DIR / "terrain-display.json"
PGDA_SUN_PNG = DATA_DIR / "pgda-sun.png"
PGDA_EARTH_PNG = DATA_DIR / "pgda-earth.png"
PGDA_LAYERS_JSON = DATA_DIR / "pgda-layers.json"
VALIDATION_JSON = DATA_DIR / "validation.json"
GOLDEN_JSON = FIXTURES_DIR / "golden.json"


def _prepare(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def write_json(path: Path, obj: Any) -> None:
    _prepare(path).write_text(json.dumps(obj, indent=2) + "\n", encoding="utf-8")


def _write_array(path: Path, data: ArrayLike, dtype: str) -> None:
    _prepare(path).write_bytes(np.ascontiguousarray(data, dtype=dtype).tobytes())


def write_f32(path: Path, data: ArrayLike) -> None:
    """Little-endian float32."""
    _write_array(path, data, "<f4")


def write_u8(path: Path, data: ArrayLike) -> None:
    _write_array(path, data, "u1")


def write_i16(path: Path, data: ArrayLike) -> None:
    """Little-endian int16."""
    _write_array(path, data, "<i2")
