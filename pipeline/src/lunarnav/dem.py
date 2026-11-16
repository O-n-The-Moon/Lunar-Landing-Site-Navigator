"""Memory-mapped PDS LOLA rasters and spherical south-polar projection.

X points toward 90 E, Y toward 0 E. Heights are relative to R=1737.4 km.
"""

import re
from pathlib import Path

import numpy as np
from numpy.typing import ArrayLike, NDArray

from lunarnav.constants import MOON_RADIUS_KM
from lunarnav.fetch import RAW_DIR


def lat_lon_to_xy_km(lat_deg: ArrayLike, lon_deg: ArrayLike) -> tuple[NDArray, NDArray]:
    """True-scale-at-pole stereographic; scalars or broadcastable arrays."""
    lat_deg, lon_deg = np.broadcast_arrays(lat_deg, lon_deg)
    if not np.all(np.isfinite(lat_deg) & np.isfinite(lon_deg)):
        raise ValueError("Coordinates must be finite")
    if np.any((lat_deg < -90) | (lat_deg > 0)):
        raise ValueError("South-polar projection requires -90 <= latitude <= 0")
    rho_km = 2 * MOON_RADIUS_KM * np.tan(np.deg2rad(90 + lat_deg) / 2)
    lon_rad = np.deg2rad(lon_deg)
    return rho_km * np.sin(lon_rad), rho_km * np.cos(lon_rad)


def xy_km_to_lat_lon(x_km: ArrayLike, y_km: ArrayLike) -> tuple[NDArray, NDArray]:
    """Inverse projection; longitude at the pole is defined as zero."""
    x_km, y_km = np.broadcast_arrays(x_km, y_km)
    if not np.all(np.isfinite(x_km) & np.isfinite(y_km)):
        raise ValueError("Coordinates must be finite")
    rho_km = np.hypot(x_km, y_km)
    lat_deg = -90 + np.rad2deg(2 * np.arctan(rho_km / (2 * MOON_RADIUS_KM)))
    lon_deg = (np.rad2deg(np.arctan2(x_km, y_km)) + 180) % 360 - 180
    return lat_deg, np.where(rho_km == 0, 0, lon_deg)


class PdsRaster:
    """Reader for pinned int16 PDS3 rasters (including PGDA fractions).

    sample() applies the label scale, but NOT the reference-radius OFFSET:
    LOLA defines HEIGHT = DN * SCALING_FACTOR. Missing neighbors produce NaN.
    """

    def __init__(self, label_path: Path) -> None:
        text = label_path.read_text()

        def value(key: str) -> str:
            match = re.search(
                rf"^\s*{re.escape(key)}\s*=\s*([^\r\n]+)", text, re.MULTILINE
            )
            if match is None:
                raise ValueError(f"Missing {key} in {label_path}")
            return match[1].split("<")[0].strip().strip('"')

        required = {
            "SAMPLE_TYPE": "LSB_INTEGER",
            "SAMPLE_BITS": "16",
            "MAP_PROJECTION_TYPE": "POLAR STEREOGRAPHIC",
            "KEYWORD_LATITUDE_TYPE": "PLANETOCENTRIC",
            "POSITIVE_LONGITUDE_DIRECTION": "EAST",
        }
        for key, expected in required.items():
            if value(key) != expected:
                raise ValueError(f"Unsupported {key} in {label_path}")
        for key, expected in (
            ("CENTER_LATITUDE", -90),
            ("CENTER_LONGITUDE", 0),
            ("MAP_PROJECTION_ROTATION", 0),
            ("A_AXIS_RADIUS", MOON_RADIUS_KM),
            ("B_AXIS_RADIUS", MOON_RADIUS_KM),
            ("C_AXIS_RADIUS", MOON_RADIUS_KM),
        ):
            if float(value(key)) != expected:
                raise ValueError(f"Unsupported {key} in {label_path}")
        self.rows = int(value("LINES"))
        self.cols = int(value("LINE_SAMPLES"))
        self.cell_km = float(value("MAP_SCALE")) / 1000
        self.line_offset = float(value("LINE_PROJECTION_OFFSET"))
        self.sample_offset = float(value("SAMPLE_PROJECTION_OFFSET"))
        self.scale = float(value("SCALING_FACTOR"))
        self.max_lat_deg = float(value("MAXIMUM_LATITUDE"))
        self.file = label_path.stem
        self.name = value("NAME")
        if self.name not in ("HEIGHT", "AVERAGE_VISIBILITY"):
            raise ValueError(f"Unsupported raster quantity: {self.name}")
        expected_offset = MOON_RADIUS_KM * 1000 if self.name == "HEIGHT" else 0
        if float(value("OFFSET")) != expected_offset:
            raise ValueError("Unexpected reference-radius/visibility offset")
        if self.rows < 2 or self.cols < 2 or self.cell_km <= 0:
            raise ValueError("Invalid raster geometry")
        filename = value("^IMAGE")
        if Path(filename).name != filename:
            raise ValueError("Expected a detached image in the label directory")
        image_path = label_path.parent / filename
        if image_path.stat().st_size != self.rows * self.cols * 2:
            raise ValueError(f"Incorrect raster byte count: {image_path}")
        self.data = np.memmap(
            image_path, dtype="<i2", mode="r", shape=(self.rows, self.cols)
        )

    def sample(self, x_km: ArrayLike, y_km: ArrayLike) -> NDArray:
        """Bilinear sample at pixel centers; NaN outside valid coverage."""
        x_km, y_km = np.broadcast_arrays(x_km, y_km)
        col = x_km / self.cell_km + self.sample_offset
        row = self.line_offset - y_km / self.cell_km
        lat_deg, _ = xy_km_to_lat_lon(x_km, y_km)
        valid = (
            (col >= 0) & (col <= self.cols - 1) & (row >= 0) & (row <= self.rows - 1)
        )
        valid &= lat_deg <= self.max_lat_deg
        c0 = np.clip(np.floor(col), 0, self.cols - 2).astype(int)
        r0 = np.clip(np.floor(row), 0, self.rows - 2).astype(int)
        dc, dr = col - c0, row - r0
        heights = np.zeros(x_km.shape)
        for rr, cc, weight in (
            (r0, c0, (1 - dc) * (1 - dr)),
            (r0, c0 + 1, dc * (1 - dr)),
            (r0 + 1, c0, (1 - dc) * dr),
            (r0 + 1, c0 + 1, dc * dr),
        ):
            dn = self.data[rr, cc]
            valid &= (dn != -32768) | (weight == 0)
            heights += dn * self.scale * weight
        return np.where(valid, heights, np.nan)


class DemStack:
    """Near-field-first terrain sampler; uncovered points return NaN, never zero."""

    def __init__(self, raw_dir: Path = RAW_DIR) -> None:
        self.near = PdsRaster(raw_dir / "dem/LDEM_80S_80M.LBL")
        self.far = PdsRaster(raw_dir / "dem/LDEM_75S_240M.LBL")

    def dems(self) -> list[dict[str, str | int]]:
        """The DEMs behind every horizon mask, for sites.json and grid.json."""
        return [
            {
                "file": raster.file,
                "role": role,
                "resolutionM": round(raster.cell_km * 1000),
            }
            for raster, role in ((self.near, "near field"), (self.far, "far field"))
        ]

    def height_m(self, x_km: ArrayLike, y_km: ArrayLike) -> float | NDArray:
        """Height above reference sphere in meters, with far-field fallback."""
        x_km, y_km = np.broadcast_arrays(x_km, y_km)
        near_m = self.near.sample(x_km, y_km)
        missing = np.isnan(near_m)
        if np.any(missing):
            near_m = np.array(near_m, copy=True)
            near_m[missing] = self.far.sample(x_km[missing], y_km[missing])
        return float(near_m) if near_m.ndim == 0 else near_m
