"""Hourly Sun/Earth positions from the cached SPICE kernels, with no network.

Run ``lunarnav fetch`` first. All UTC samples are converted separately to ET:
uniform UTC hours are not uniform TDB seconds. SPICE evaluates the MOON_ME frame
at the Moon observer epoch with reception light-time and stellar aberration.
"""

from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

from lunarnav import io
from lunarnav.constants import (
    EPHEMERIS_COUNT,
    EPHEMERIS_END_UTC,
    EPHEMERIS_START_UTC,
    EPHEMERIS_STEP_S,
    FRAME,
    SCHEMA_VERSION,
)
from lunarnav.fetch import SOURCES

KERNEL_NAMES = tuple(
    Path(source.path).name for source in SOURCES if source.path.startswith("kernels/")
)
BODIES = ("sun", "earth")
ABCORR = "LT+S"
OBSERVER = "MOON"


def utc_samples() -> list[str]:
    """Contract UTC instants, hourly through 2032-12-31T23:00:00Z inclusive."""
    start = datetime.fromisoformat(EPHEMERIS_START_UTC)
    end = datetime.fromisoformat(EPHEMERIS_END_UTC)
    step = timedelta(seconds=EPHEMERIS_STEP_S)
    if end - start != EPHEMERIS_COUNT * step:
        raise ValueError("Ephemeris sample count does not match the UTC interval")
    return [
        (start + i * step).strftime("%Y-%m-%dT%H:%M:%SZ")
        for i in range(EPHEMERIS_COUNT)
    ]


def compute_positions_km(raw_dir: Path = io.RAW_DIR) -> NDArray[np.float64]:
    """Compute [t][sun, earth][xyz] in km, using only the pinned local kernels.

    Missing kernels and SPICE coverage/frame errors propagate before any output
    is written. KernelPool isolates this calculation from previously loaded
    kernels, restoring those files afterwards (but not user-assigned variables).
    """
    # Keep unrelated CLI commands usable without loading the SPICE library.
    import spiceypy as spice

    paths = [raw_dir / "kernels" / name for name in KERNEL_NAMES]
    for path in paths:
        if not path.is_file():
            raise FileNotFoundError(f"Missing SPICE kernel {path}; run lunarnav fetch")
    with spice.KernelPool([str(path.resolve()) for path in paths]):
        et_s = spice.str2et(utc_samples())
        positions_km = np.stack(
            [
                spice.spkpos(body.upper(), et_s, FRAME, ABCORR, OBSERVER)[0]
                for body in BODIES
            ],
            axis=1,
        )
    if positions_km.shape != (EPHEMERIS_COUNT, len(BODIES), 3):
        raise ValueError("SPICE returned an unexpected ephemeris shape")
    if not np.all(np.isfinite(positions_km)):
        raise ValueError("SPICE returned nonfinite body positions")
    return positions_km


def build_ephemeris(raw_dir: Path = io.RAW_DIR, data_dir: Path = io.DATA_DIR) -> None:
    """Write contract metadata and little-endian float32 body positions."""
    positions_km = compute_positions_km(raw_dir)
    manifest = {
        "schemaVersion": SCHEMA_VERSION,
        "frame": FRAME,
        "abcorr": ABCORR,
        "observer": OBSERVER,
        "startUtc": EPHEMERIS_START_UTC,
        "stepS": EPHEMERIS_STEP_S,
        "count": EPHEMERIS_COUNT,
        "bodies": list(BODIES),
        "units": "km",
        "dtype": "float32-le",
        "layout": "[t][body][xyz]",
        "kernels": list(KERNEL_NAMES),
    }
    io.write_f32(data_dir / "ephemeris.bin", positions_km)
    io.write_json(data_dir / "ephemeris.json", manifest)


def main() -> None:
    build_ephemeris()
