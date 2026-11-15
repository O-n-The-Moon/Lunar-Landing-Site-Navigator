"""Analytic terrain tests; no raw DEMs or network needed for the core checks."""

from types import SimpleNamespace

import numpy as np
import pytest

from lunarnav.constants import MOON_RADIUS_KM
from lunarnav.dem import DemStack, lat_lon_to_xy_km, xy_km_to_lat_lon
from lunarnav.fetch import RAW_DIR
from lunarnav.geometry import az_el, enu_basis, site_vector_km
from lunarnav.horizon import (
    _distances_km,
    _fill_bins_deg,
    _reduce_rays_deg,
    compute_horizon_deg,
)
from test_dem import write_raster


class SyntheticTerrain(DemStack):
    """Continuous analytic DEM with the same sampling boundary as DemStack."""

    def __init__(self, surface_m=0.0, cone_xy_km=None):
        self.near = SimpleNamespace(cell_km=0.08)
        self.surface_m = surface_m
        self.cone_xy_km = cone_xy_km

    def height_m(self, x_km, y_km):
        x_km, y_km = np.broadcast_arrays(x_km, y_km)
        heights_m = np.full(x_km.shape, self.surface_m)
        if self.cone_xy_km is not None:
            dx = x_km - self.cone_xy_km[0]
            dy = y_km - self.cone_xy_km[1]
            heights_m += np.maximum(0, 1000 * (1 - np.hypot(dx, dy) / 5))
        return heights_m


@pytest.mark.parametrize(
    "lat_deg,lon_deg,observer_height_m,surface_m,az_bins",
    [
        (-89.45, -137.3, 2, 0, 720),
        (-84.79, 29.2, 10, 2000, 360),
        (-90, 80, 2, -4000, 360),
        (-86, -180, 0, 0, 360),
    ],
)
def test_flat_sphere_geometric_dip(
    lat_deg, lon_deg, observer_height_m, surface_m, az_bins
):
    horizon_deg = compute_horizon_deg(
        SyntheticTerrain(surface_m), lat_deg, lon_deg, observer_height_m, az_bins
    )
    surface_radius_km = MOON_RADIUS_KM + surface_m / 1000
    dip_deg = -np.rad2deg(
        np.arccos(surface_radius_km / (surface_radius_km + observer_height_m / 1000))
    )
    assert horizon_deg.shape == (az_bins,)
    np.testing.assert_allclose(horizon_deg, dip_deg, atol=0.01)
    assert np.all(horizon_deg < 0)


@pytest.mark.parametrize("cone_az_deg", [0, 90, 217, 359.75])
def test_isolated_cone_height_direction_and_wrap(cone_az_deg):
    lat_deg, lon_deg = -87.0, 42.0
    origin_x_km, origin_y_km = lat_lon_to_xy_km(lat_deg, lon_deg)
    map_angle_rad = np.deg2rad(cone_az_deg + lon_deg)
    cone_xy_km = (
        origin_x_km + 20 * np.sin(map_angle_rad),
        origin_y_km + 20 * np.cos(map_angle_rad),
    )
    cone_lat_deg, cone_lon_deg = xy_km_to_lat_lon(*cone_xy_km)
    peak_km = site_vector_km(cone_lat_deg, cone_lon_deg, 1000)
    expected_az_deg, expected_elev_deg, _ = az_el(peak_km, lat_deg, lon_deg, 2)
    horizon_deg = compute_horizon_deg(
        SyntheticTerrain(cone_xy_km=cone_xy_km), lat_deg, lon_deg, 2
    )
    peak_bin = int(np.round(float(expected_az_deg) * 2)) % 720
    assert horizon_deg[peak_bin] == pytest.approx(float(expected_elev_deg), abs=0.05)
    assert np.max(horizon_deg) == pytest.approx(float(expected_elev_deg), abs=0.05)
    assert horizon_deg[(peak_bin + 360) % 720] < 0
    if cone_az_deg == 359.75:
        assert horizon_deg[0] > 2 and horizon_deg[-1] > 2


def test_ray_reduction_matches_reference_geometry_and_uses_true_azimuth():
    lat_deg, lon_deg = -84.0, 73.0
    observer_km = site_vector_km(lat_deg, lon_deg, 2002)
    basis = np.stack(enu_basis(lat_deg, lon_deg))
    x0_km, y0_km = lat_lon_to_xy_km(lat_deg, lon_deg)
    # A distant oblique sample has appreciable map-ray/true-azimuth divergence.
    map_angle_rad = np.deg2rad(np.array([[90], [12], [230]]) + lon_deg)
    distances_km = np.array([[0.08, 20, 250]])
    x_km = x0_km + np.sin(map_angle_rad) * distances_km
    y_km = y0_km + np.cos(map_angle_rad) * distances_km
    heights_m = np.array([[2000.0, 1000.0, 5000.0]] * 3)
    sample_lat_deg, sample_lon_deg = xy_km_to_lat_lon(x_km, y_km)
    terrain_km = site_vector_km(sample_lat_deg, sample_lon_deg, heights_m)
    az_deg, elev_deg, _ = az_el(terrain_km, lat_deg, lon_deg, 2002)
    assert abs(az_deg[0, -1] - 90) > 0.1
    bins = 3600
    result = _reduce_rays_deg(x_km, y_km, heights_m, observer_km, basis, bins)
    expected_bins = np.floor(az_deg * bins / 360 + 0.5).astype(int) % bins
    for ray in range(3):
        assert np.flatnonzero(np.isfinite(result[ray])).tolist() == sorted(
            set(expected_bins[ray])
        )
        for az_bin in set(expected_bins[ray]):
            assert result[ray, az_bin] == pytest.approx(
                float(np.max(elev_deg[ray, expected_bins[ray] == az_bin])), abs=1e-9
            )
    # Repeat parallel reduction to catch accidentally shared mutable bins.
    np.testing.assert_array_equal(
        _reduce_rays_deg(x_km, y_km, heights_m, observer_km, basis, bins), result
    )


def test_march_spacing_and_250_km_endpoint():
    distances_km = _distances_km(0.08)
    assert distances_km[0] == 0.08
    assert distances_km[-1] == 250
    np.testing.assert_allclose(
        np.diff(distances_km)[:-1], np.maximum(0.08, 0.005 * distances_km[:-2])
    )
    assert distances_km[-1] - distances_km[-2] <= 0.005 * distances_km[-2]


def test_horizon_with_real_raster_sampling_and_far_field_fallback(tmp_path):
    # Small near raster contains the 2 m observer's tangent distance (~2.6 km).
    # The remaining 250 km scan must use the coarser far raster.
    write_raster(tmp_path, "LDEM_80S_80M", np.zeros((101, 101)))
    write_raster(tmp_path, "LDEM_75S_240M", np.zeros((601, 601)), cell_m=1000)
    horizon_deg = compute_horizon_deg(DemStack(tmp_path), -90, 0, 2, 360)
    dip_deg = -np.rad2deg(np.arccos(MOON_RADIUS_KM / (MOON_RADIUS_KM + 0.002)))
    np.testing.assert_allclose(horizon_deg, dip_deg, atol=0.01)


def test_empty_bins_interpolate_periodically_without_clamping_negative_values():
    np.testing.assert_allclose(
        _fill_bins_deg(np.array([np.nan, -1, np.nan, -3, np.nan])),
        [-5 / 3, -1, -2, -3, -7 / 3],
    )
    np.testing.assert_array_equal(_fill_bins_deg(np.array([np.nan, -2, np.nan])), -2)
    with pytest.raises(ValueError, match="No terrain"):
        _fill_bins_deg(np.full(4, -np.inf))


@pytest.mark.parametrize("missing_observer", [True, False])
def test_missing_terrain_rejected(missing_observer):
    class MissingTerrain(SyntheticTerrain):
        def height_m(self, x_km, y_km):
            heights_m = super().height_m(x_km, y_km)
            if missing_observer or heights_m.ndim > 0:
                heights_m.flat[0] = np.nan
            return heights_m

    with pytest.raises(ValueError, match="Missing terrain"):
        compute_horizon_deg(MissingTerrain(), -87, 0, 2, 8)


@pytest.mark.parametrize(
    "kwargs",
    [
        {"lat_deg": -91},
        {"lat_deg": 1},
        {"lat_deg": np.nan},
        {"lon_deg": 181},
        {"lon_deg": np.inf},
        {"observer_height_m": -1},
        {"observer_height_m": np.nan},
        {"az_bins": 0},
        {"az_bins": 1.5},
        {"az_bins": True},
    ],
)
def test_invalid_inputs(kwargs):
    inputs = {"lat_deg": -87, "lon_deg": 0, "observer_height_m": 2, "az_bins": 8}
    inputs.update(kwargs)
    with pytest.raises(ValueError):
        compute_horizon_deg(SyntheticTerrain(), **inputs)


@pytest.mark.skipif(
    not (RAW_DIR / "dem/LDEM_80S_80M.IMG").exists(), reason="Run lunarnav fetch first"
)
def test_real_dem_horizon_is_finite_and_responds_to_observer_height():
    terrain = DemStack()
    low_deg = compute_horizon_deg(terrain, -89.45, -137.3, 2)
    high_deg = compute_horizon_deg(terrain, -89.45, -137.3, 10)
    assert low_deg.shape == high_deg.shape == (720,)
    assert np.all(np.isfinite(low_deg)) and np.all(np.isfinite(high_deg))
    assert np.all(high_deg < low_deg)
    assert np.ptp(low_deg) > 1
