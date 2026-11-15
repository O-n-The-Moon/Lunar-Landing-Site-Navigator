"""Grid horizons: uint8 contract encoding, cell layout, and build behavior."""

import json

import numpy as np
import pytest

from lunarnav import horizons_grid
from lunarnav.constants import GRID_AZ_BINS, GRID_NO_DATA, MOON_RADIUS_KM
from lunarnav.dem import DemStack, lat_lon_to_xy_km, xy_km_to_lat_lon
from lunarnav.fetch import RAW_DIR
from lunarnav.horizon import compute_horizon_deg
from lunarnav.horizons_grid import (
    build_grid,
    cell_centers_km,
    decode_elev_deg,
    encode_elev_u8,
    grid_manifest,
    write_grid,
)
from test_horizon import SyntheticTerrain

DEMS_PRESENT = (RAW_DIR / "dem/LDEM_80S_80M.LBL").exists() and (
    RAW_DIR / "dem/LDEM_75S_240M.LBL"
).exists()


def test_encode_decode_round_trip_on_contract_steps():
    codes = np.arange(256).astype(np.uint8)  # 0..254 are data, 255 is no data
    elev_deg = decode_elev_deg(codes)
    np.testing.assert_allclose(elev_deg[:-1], codes[:-1] * 0.1 - 5.0, atol=1e-12)
    assert np.isnan(elev_deg[-1])
    np.testing.assert_array_equal(encode_elev_u8(elev_deg), codes)


def test_encode_rounds_to_nearest_tenth_and_clamps():
    rng = np.random.default_rng(7)
    elev_deg = rng.uniform(-5, 20.4, 10_000)
    decoded = decode_elev_deg(encode_elev_u8(elev_deg))
    assert np.max(np.abs(decoded - elev_deg)) <= 0.05 + 1e-9
    codes = encode_elev_u8(np.array([-90.0, -5.04, 20.44, 45.0, np.nan]))
    np.testing.assert_array_equal(codes, [0, 0, 254, 254, GRID_NO_DATA])
    assert codes.dtype == np.uint8


def test_cell_centers_are_row_major_y_outer_from_lower_left():
    x_km, y_km = cell_centers_km((-6.0, -4.0), 2.0, nx=3, ny=2)
    assert x_km.shape == y_km.shape == (2, 3)
    np.testing.assert_allclose(x_km[0], [-5, -3, -1])
    np.testing.assert_allclose(y_km[:, 0], [-3, -1])
    # Flattened index iy * nx + ix walks x fastest.
    np.testing.assert_allclose(x_km.ravel()[:3], [-5, -3, -1])
    np.testing.assert_allclose(y_km.ravel()[:3], -3)


def test_manifest_matches_contract():
    manifest = grid_manifest(2, 182, 182, (-182, -182))
    assert manifest == {
        "schemaVersion": 1,
        "projection": "polar-stereographic-south",
        "sphereRadiusKm": 1737.4,
        "originKm": [-182, -182],
        "cellKm": 2,
        "nx": 182,
        "ny": 182,
        "azBins": 360,
        "heightM": 2,
        "dtype": "uint8",
        "encoding": "elevDeg = v * 0.1 - 5.0; 255 = no data",
        "cellSurfaceHeightM": "grid-heights.bin (int16-le, row-major)",
    }


class EastEdgeTerrain(SyntheticTerrain):
    """Flat sphere 100 m up; no DEM coverage east of x = 60 km."""

    def height_m(self, x_km, y_km):
        x_km, y_km = np.broadcast_arrays(x_km, y_km)
        return np.where(x_km > 60, np.nan, np.full(x_km.shape, 100.0))


def test_build_grid_flat_sphere_and_no_data_cells():
    # 10 km cells centered at x = -195 (scan reaches x = 55: covered) and
    # x = -185 (scan reaches x = 65: crosses the coverage edge -> no data).
    horizons_u8, heights_m = build_grid(
        EastEdgeTerrain(), (-200.0, -5.0), 10.0, nx=2, ny=1
    )
    assert horizons_u8.shape == (1, 2, GRID_AZ_BINS)
    assert horizons_u8.dtype == np.uint8
    assert heights_m.shape == (1, 2) and heights_m.dtype == np.int16
    np.testing.assert_array_equal(heights_m, 100)

    surface_radius_km = MOON_RADIUS_KM + 0.1
    dip_deg = -np.rad2deg(np.arccos(surface_radius_km / (surface_radius_km + 0.002)))
    np.testing.assert_allclose(decode_elev_deg(horizons_u8[0, 0]), dip_deg, atol=0.05)
    np.testing.assert_array_equal(horizons_u8[0, 1], GRID_NO_DATA)


def test_build_grid_cell_order_matches_flattened_contract():
    class RampHeights(SyntheticTerrain):
        def height_m(self, x_km, y_km):
            x_km, y_km = np.broadcast_arrays(x_km, y_km)
            return 10.0 * np.round(x_km) + 1000.0 * np.round(y_km)

    _, heights_m = build_grid(RampHeights(), (-4.0, -2.0), 2.0, nx=3, ny=2)
    # Centers x = -3, -1, 1 and y = -1, 1.
    np.testing.assert_array_equal(
        heights_m.ravel(), [-1030, -1010, -990, 970, 990, 1010]
    )


def test_write_grid_writes_contract_files(tmp_path):
    paths = {
        "manifest": tmp_path / "grid.json",
        "horizons": tmp_path / "grid-horizons.bin",
        "heights": tmp_path / "grid-heights.bin",
    }
    write_grid(SyntheticTerrain(surface_m=-1234.4), (-2.0, -2.0), 2.0, 2, 2, paths)
    manifest = json.loads(paths["manifest"].read_text())
    assert manifest["nx"] == manifest["ny"] == 2 and manifest["originKm"] == [-2, -2]
    raw = np.frombuffer(paths["horizons"].read_bytes(), dtype=np.uint8)
    assert raw.size == 2 * 2 * GRID_AZ_BINS
    assert np.all(raw < GRID_NO_DATA)
    heights = np.frombuffer(paths["heights"].read_bytes(), dtype="<i2")
    np.testing.assert_array_equal(heights, -1234)


def test_main_uses_contract_paths(monkeypatch, tmp_path):
    calls = {}

    def fake_write_grid(terrain, origin_km, cell_km, nx, ny, paths, **kwargs):
        calls.update(origin_km=origin_km, cell_km=cell_km, nx=nx, ny=ny, paths=paths)

    monkeypatch.setattr(horizons_grid, "DemStack", lambda: object())
    monkeypatch.setattr(horizons_grid, "write_grid", fake_write_grid)
    horizons_grid.main()
    assert calls["origin_km"] == (-182, -182)
    assert (calls["cell_km"], calls["nx"], calls["ny"]) == (2, 182, 182)
    assert calls["paths"]["horizons"].name == "grid-horizons.bin"


# Placeholder coordinates from SPEC-data-pipeline section 3 until sites.yaml
# (#5) lands; rerun against the curated catalog then.
SPEC_PLACEHOLDER_SITES = [(-89.45, -137.3), (-84.79, 29.2)]


@pytest.mark.skipif(not DEMS_PRESENT, reason="LOLA DEMs not fetched")
@pytest.mark.parametrize("lat_deg,lon_deg", SPEC_PLACEHOLDER_SITES)
def test_grid_cell_matches_site_mask(lat_deg, lon_deg):
    terrain = DemStack()
    x_km, y_km = lat_lon_to_xy_km(lat_deg, lon_deg)
    ix, iy = int(np.floor((x_km + 182) / 2)), int(np.floor((y_km + 182) / 2))
    origin_km = (-182 + 2 * ix, -182 + 2 * iy)
    horizons_u8, _ = build_grid(terrain, origin_km, 2.0, nx=1, ny=1)
    cell_deg = decode_elev_deg(horizons_u8[0, 0])
    site_deg = compute_horizon_deg(terrain, lat_deg, lon_deg, 2, 720)[::2]
    assert np.median(np.abs(cell_deg - site_deg)) < 0.5
    # Sanity: the cell center really is the containing cell.
    cx, cy = origin_km[0] + 1, origin_km[1] + 1
    assert abs(cx - x_km) <= 1 and abs(cy - y_km) <= 1
    assert xy_km_to_lat_lon(cx, cy)[0] < -84
