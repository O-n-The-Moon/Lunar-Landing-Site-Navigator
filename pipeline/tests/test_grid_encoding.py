"""Grid horizons: uint8 contract encoding, cell layout, and build behavior."""

import json

import numpy as np
import pytest
import yaml

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
from lunarnav.horizons_sites import SITES_YAML
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
    dems = [{"file": "LDEM_80S_80M", "role": "near field", "resolutionM": 80}]
    manifest = grid_manifest(2, 182, 182, (-182, -182), dems)
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
        "dems": dems,
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
    assert [d["file"] for d in manifest["dems"]] == ["LDEM_80S_80M", "LDEM_75S_240M"]
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


def _containing_cell(lat_deg, lon_deg):
    """Single-cell origin of the 2 km contract cell containing a site, and its center."""
    x_km, y_km = lat_lon_to_xy_km(lat_deg, lon_deg)
    ix, iy = int(np.floor((x_km + 182) / 2)), int(np.floor((y_km + 182) / 2))
    origin_km = (-182.0 + 2 * ix, -182.0 + 2 * iy)
    center_km = (origin_km[0] + 1, origin_km[1] + 1)
    assert abs(center_km[0] - x_km) <= 1 and abs(center_km[1] - y_km) <= 1
    return origin_km, center_km


def _catalog():
    sites = yaml.safe_load(SITES_YAML.read_text(encoding="utf-8"))["sites"]
    return {s["id"]: (s["latDeg"], s["lonDeg"]) for s in sites}


CATALOG = _catalog()
IM2 = CATALOG["mons-mouton-im2"]
RIDGE = CATALOG["connecting-ridge"]

# Measured median |grid cell - site mask| (deg, 2 m, 360 bins) on the shipped
# 2 km grid, curated catalog from #5. Sites at or above 0.5 deg fail the #24
# verification. This is the resolution limit of a 2 km cell-center grid on
# rim/peak terrain, not a bug (#76, option (a)): curated sites must use their
# own sites.json masks, and grid-derived answers carry a "grid-approximate
# (2 km)" caveat. The medians below were measured when the 2 km grid was built
# (2026-11) and are informational: they may drift if the DEMs or grid change.
# strict xfail: if a future grid fixes a site, this test
# fails and the entry must move to the passing set.
GRID_OK_SITES = ["nobile-rim-2", "de-gerlache-rim-2", "shackleton-floor"]
GRID_LIMIT_SITES = {
    "mons-mouton-im2": 0.94,
    "connecting-ridge": 0.95,
    "peak-near-cabeus-b": 1.17,
    "slater-plain": 1.74,
    "haworth": 1.88,
    "malapert-massif": 2.19,
    "mons-mouton": 3.74,
    "mons-mouton-plateau": 3.87,
    "nobile-rim-1": 6.21,
}


def test_grid_site_partition_covers_whole_catalog():
    assert sorted(GRID_OK_SITES + list(GRID_LIMIT_SITES)) == sorted(CATALOG)


def _median_cell_vs_mask_deg(lat_deg, lon_deg):
    terrain = DemStack()
    origin_km, _ = _containing_cell(lat_deg, lon_deg)
    horizons_u8, _ = build_grid(terrain, origin_km, 2.0, nx=1, ny=1)
    cell_deg = decode_elev_deg(horizons_u8[0, 0])
    # Compare in the contract's representable range (-5..20.4 deg): the grid clamps.
    # Clipping only shrinks differences at the saturated end, so it cannot turn a
    # failing site into a passing one.
    site_deg = np.clip(
        compute_horizon_deg(terrain, lat_deg, lon_deg, 2, 720)[::2], -5, 20.4
    )
    return float(np.median(np.abs(cell_deg - site_deg)))


@pytest.mark.skipif(not DEMS_PRESENT, reason="LOLA DEMs not fetched")
@pytest.mark.parametrize(
    "site_id",
    [
        *GRID_OK_SITES,
        *[
            pytest.param(
                site_id,
                marks=pytest.mark.xfail(
                    strict=True,
                    reason=(
                        f"Known limitation (#24, #76): median {median_deg} deg "
                        "from the site mask. A 2 km cell-center sample cannot "
                        "represent rim/peak terrain; use the site's sites.json "
                        "mask, not the grid."
                    ),
                ),
            )
            for site_id, median_deg in GRID_LIMIT_SITES.items()
        ],
    ],
)
def test_grid_cell_matches_site_mask(site_id):
    assert _median_cell_vs_mask_deg(*CATALOG[site_id]) < 0.5


@pytest.mark.skipif(not DEMS_PRESENT, reason="LOLA DEMs not fetched")
@pytest.mark.parametrize("lat_deg,lon_deg", [IM2, RIDGE])
def test_grid_cell_equals_horizon_at_its_center(lat_deg, lon_deg):
    """The grid is exact at cell centers: only the 0.1 deg encoding differs."""
    terrain = DemStack()
    origin_km, center_km = _containing_cell(lat_deg, lon_deg)
    horizons_u8, _ = build_grid(terrain, origin_km, 2.0, nx=1, ny=1)
    center_lat_deg, center_lon_deg = xy_km_to_lat_lon(*center_km)
    assert center_lat_deg < -84
    center_deg = compute_horizon_deg(
        terrain, float(center_lat_deg), float(center_lon_deg), 2, GRID_AZ_BINS
    )
    decoded = decode_elev_deg(horizons_u8[0, 0])
    assert np.max(np.abs(decoded - np.clip(center_deg, -5, 20.4))) <= 0.05 + 1e-9


def test_build_grid_reraises_unrelated_value_errors(monkeypatch):
    """Only the out-of-coverage scan becomes no data; other errors still fail."""

    def broken_horizon(*args, **kwargs):
        raise ValueError("DEM cell size must be finite and in (0, 250] km")

    monkeypatch.setattr(horizons_grid, "compute_horizon_deg", broken_horizon)
    with pytest.raises(ValueError, match="DEM cell size"):
        build_grid(SyntheticTerrain(), (-2.0, -2.0), 2.0, nx=1, ny=1)


SHIPPED_HORIZONS = horizons_grid.GRID_HORIZONS_BIN


@pytest.mark.skipif(
    not (DEMS_PRESENT and SHIPPED_HORIZONS.exists()),
    reason="LOLA DEMs or generated grid-horizons.bin not present",
)
@pytest.mark.parametrize("iy,ix", [(90, 90), (40, 120), (150, 60)])
def test_shipped_grid_matches_recomputed_cells(iy, ix):
    """Guards the committed data file, not just the code path."""
    manifest = json.loads(horizons_grid.GRID_JSON.read_text())
    nx, ny, bins = manifest["nx"], manifest["ny"], manifest["azBins"]
    shipped = np.fromfile(SHIPPED_HORIZONS, dtype=np.uint8).reshape(ny, nx, bins)
    x_km, y_km = cell_centers_km(
        tuple(manifest["originKm"]), manifest["cellKm"], nx, ny
    )
    lat_deg, lon_deg = xy_km_to_lat_lon(x_km[iy, ix], y_km[iy, ix])
    expected_deg = compute_horizon_deg(
        DemStack(), float(lat_deg), float(lon_deg), manifest["heightM"], bins
    )
    decoded = decode_elev_deg(shipped[iy, ix])
    assert np.max(np.abs(decoded - np.clip(expected_deg, -5, 20.4))) <= 0.05 + 1e-9


@pytest.mark.skipif(
    not SHIPPED_HORIZONS.exists(), reason="generated grid-horizons.bin not present"
)
def test_shipped_grid_no_data_only_beyond_dem_reach():
    """No interior holes: 255 only where a 250 km scan leaves the 75 S far DEM."""
    manifest = json.loads(horizons_grid.GRID_JSON.read_text())
    nx, ny, bins = manifest["nx"], manifest["ny"], manifest["azBins"]
    shipped = np.fromfile(SHIPPED_HORIZONS, dtype=np.uint8).reshape(ny, nx, bins)
    no_data = shipped == GRID_NO_DATA
    assert np.array_equal(no_data.all(axis=2), no_data.any(axis=2))  # whole cells
    x_km, y_km = cell_centers_km(
        tuple(manifest["originKm"]), manifest["cellKm"], nx, ny
    )
    far_reach_km = lat_lon_to_xy_km(-75.0, 0.0)[1] - 250
    np.testing.assert_array_equal(
        no_data.all(axis=2), np.hypot(x_km, y_km) > far_reach_km
    )
