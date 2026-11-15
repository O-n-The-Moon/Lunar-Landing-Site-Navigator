"""`lunarnav horizons --sites`: terrain horizons for the curated catalog.

Reads pipeline/sites.yaml and writes sites.json (SPEC.md, sites.json): 720-bin
masks at 2 m and 10 m, DEM surface height, slope over an 80 m baseline, and
the long-term PGDA average Sun and Earth visibility at each site.
"""

from pathlib import Path
from typing import Any, Protocol

import numpy as np
import yaml
from numpy.typing import ArrayLike, NDArray

from lunarnav.constants import (
    MAX_ABS_LAT_DEG,
    MOON_RADIUS_KM,
    SCHEMA_VERSION,
    SITE_AZ_BINS,
    SITE_AZ_STEP_DEG,
    SITE_HEIGHTS_M,
)
from lunarnav.dem import DemStack, PdsRaster, lat_lon_to_xy_km
from lunarnav.fetch import RAW_DIR
from lunarnav.horizon import compute_horizon_deg
from lunarnav.io import SITES_JSON, write_json

SITES_YAML = Path(__file__).resolve().parents[2] / "sites.yaml"
PGDA_SUN_LBL = RAW_DIR / "pgda/AVGVISIB_75S_120M_201608.LBL"
PGDA_EARTH_LBL = RAW_DIR / "pgda/AVGVISIB_75S_120M_201608_EARTH.LBL"

SLOPE_BASELINE_M = 80  # Central differences over +/-40 m; label as such in the UI.
_HORIZON_DECIMALS = 3
_PGDA_FRACTION_TO_PCT = 100.0


class Sampler(Protocol):
    def sample(self, x_km: ArrayLike, y_km: ArrayLike) -> NDArray: ...


def _slope_deg(terrain: DemStack, lat_deg: float, lon_deg: float) -> float:
    """Slope from heights 40 m east/west/north/south on the sphere."""
    half_rad = SLOPE_BASELINE_M / 2 / 1000 / MOON_RADIUS_KM
    offset_deg = np.rad2deg(half_rad)
    # Same pole clamp as the horizon code, with room for the southern offset so
    # the projection stays inside -90..0.
    lat_deg = max(lat_deg, -MAX_ABS_LAT_DEG + offset_deg)
    cos_lat = np.cos(np.deg2rad(lat_deg))
    lons_deg = lon_deg + np.array([1, -1]) * offset_deg / cos_lat
    lats_deg = lat_deg + np.array([1, -1]) * offset_deg
    east_x, east_y = lat_lon_to_xy_km(np.full(2, lat_deg), lons_deg)
    north_x, north_y = lat_lon_to_xy_km(lats_deg, np.full(2, lon_deg))
    east_m = np.asarray(terrain.height_m(east_x, east_y), dtype=np.float64)
    north_m = np.asarray(terrain.height_m(north_x, north_y), dtype=np.float64)
    if not np.all(np.isfinite([east_m, north_m])):
        raise ValueError("Missing terrain for slope baseline")
    d_east = (east_m[0] - east_m[1]) / SLOPE_BASELINE_M
    d_north = (north_m[0] - north_m[1]) / SLOPE_BASELINE_M
    return float(np.rad2deg(np.arctan(np.hypot(d_east, d_north))))


def _pgda_pct(raster: Sampler, x_km: float, y_km: float, name: str) -> float:
    fraction = float(raster.sample(x_km, y_km))
    if not np.isfinite(fraction):
        raise ValueError(f"No PGDA {name} coverage at site")
    return fraction * _PGDA_FRACTION_TO_PCT


def build_site(
    terrain: DemStack,
    pgda_sun: Sampler,
    pgda_earth: Sampler,
    site: dict[str, Any],
) -> dict[str, Any]:
    """One sites.json entry from a sites.yaml record."""
    lat_deg, lon_deg = float(site["latDeg"]), float(site["lonDeg"])
    x_km, y_km = lat_lon_to_xy_km(lat_deg, lon_deg)
    surface_m = float(terrain.height_m(x_km, y_km))
    if not np.isfinite(surface_m):
        raise ValueError(f"Missing terrain at site {site['id']}")
    masks = {
        str(height_m): np.round(
            compute_horizon_deg(terrain, lat_deg, lon_deg, height_m, SITE_AZ_BINS),
            _HORIZON_DECIMALS,
        ).tolist()
        for height_m in SITE_HEIGHTS_M
    }
    return {
        "id": site["id"],
        "name": site["name"],
        "category": site["category"],
        "latDeg": lat_deg,
        "lonDeg": lon_deg,
        "surfaceHeightM": round(surface_m, 1),
        "slopeDeg": round(_slope_deg(terrain, lat_deg, lon_deg), 2),
        "coordSource": site["coordSource"],
        "pgdaAvgSunPct": round(_pgda_pct(pgda_sun, x_km, y_km, "Sun"), 2),
        "pgdaAvgEarthPct": round(_pgda_pct(pgda_earth, x_km, y_km, "Earth"), 2),
        "horizonElevDeg": masks,
    }


def build_sites_file(
    sites: list[dict[str, Any]],
    terrain: DemStack,
    pgda_sun: Sampler,
    pgda_earth: Sampler,
) -> dict[str, Any]:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "azStepDeg": SITE_AZ_STEP_DEG,
        "heightsM": list(SITE_HEIGHTS_M),
        "sites": [build_site(terrain, pgda_sun, pgda_earth, s) for s in sites],
    }


def main() -> None:
    catalog = yaml.safe_load(SITES_YAML.read_text(encoding="utf-8"))
    doc = build_sites_file(
        catalog["sites"],
        DemStack(),
        PdsRaster(PGDA_SUN_LBL),
        PdsRaster(PGDA_EARTH_LBL),
    )
    write_json(SITES_JSON, doc)
    print(f"wrote {len(doc['sites'])} sites to {SITES_JSON}")
