"""Analytic checks for the Python reference math, independent of SPICE."""

import numpy as np
import pytest

from lunarnav.constants import MOON_RADIUS_KM
from lunarnav.geometry import (
    angular_radius_deg,
    az_el,
    enu_basis,
    site_vector_km,
    visible_disk_fraction,
)


def test_site_position_axes_height_and_broadcasting():
    positions_km = site_vector_km([0, 0, 0], [0, 90, 180], 1000)
    radius_km = MOON_RADIUS_KM + 1
    np.testing.assert_allclose(
        positions_km,
        [[radius_km, 0, 0], [0, radius_km, 0], [-radius_km, 0, 0]],
        atol=1e-12,
    )
    np.testing.assert_allclose(
        np.linalg.norm(site_vector_km(-85, 30, [-100, 0, 100]), axis=-1),
        MOON_RADIUS_KM + np.array([-0.1, 0, 0.1]),
    )


@pytest.mark.parametrize("lat_deg", [-90, -89.45, -84, 0, 90])
@pytest.mark.parametrize("lon_deg", [-180, -137.3, 0, 90, 180])
def test_enu_is_right_handed_orthonormal_and_radial(lat_deg, lon_deg):
    east, north, up = enu_basis(lat_deg, lon_deg)
    basis = np.stack((east, north, up))
    np.testing.assert_allclose(basis @ basis.T, np.eye(3), atol=1e-15)
    np.testing.assert_allclose(np.cross(east, north), up, atol=1e-15)
    np.testing.assert_allclose(site_vector_km(lat_deg, lon_deg, 0), MOON_RADIUS_KM * up)


def test_south_pole_clamp_and_north_direction():
    np.testing.assert_array_equal(
        site_vector_km(-90, 25, 0), site_vector_km(-89.999, 25, 0)
    )
    for a, b in zip(enu_basis(-90, 25), enu_basis(-89.999, 25), strict=True):
        np.testing.assert_array_equal(a, b)
    # On the zero-longitude meridian near the south pole, north points toward +X.
    east, north, up = enu_basis(-90, 0)
    assert east[1] == 1 and north[0] > 0.999 and up[2] < -0.999


@pytest.mark.parametrize("lat_deg,lon_deg", [(0, 0), (-84.79, 29.2), (-90, -137.3)])
def test_az_el_cardinals_zenith_nadir_and_distance(lat_deg, lon_deg):
    east, north, up = enu_basis(lat_deg, lon_deg)
    site_km = site_vector_km(lat_deg, lon_deg, 2002)
    directions = np.stack((north, east, -north, -east, up, -up))
    az_deg, elev_deg, dist_km = az_el(
        site_km + 100 * directions, lat_deg, lon_deg, 2002
    )
    np.testing.assert_allclose(az_deg[:4], [0, 90, 180, 270], atol=1e-10)
    assert np.all((az_deg >= 0) & (az_deg < 360))
    np.testing.assert_allclose(elev_deg, [0, 0, 0, 0, 90, -90], atol=1e-10)
    np.testing.assert_allclose(dist_km, 100, atol=1e-10)


def test_az_el_subtracts_site_for_earth_parallax():
    # Earth on the +X axis, site on +Y: Earth lies below that site's horizontal.
    az_deg, elev_deg, dist_km = az_el([384400, 0, 0], 0, 90)
    assert az_deg == pytest.approx(270)
    assert elev_deg == pytest.approx(np.rad2deg(np.arctan2(-MOON_RADIUS_KM, 384400)))
    assert elev_deg < -0.25
    assert dist_km == pytest.approx(np.hypot(384400, MOON_RADIUS_KM))


def test_az_el_oblique_direction_and_wrap():
    # At (0, 0), east=+Y, north=+Z, up=+X. Offset (3,4,12) has range 13.
    az_deg, elev_deg, dist_km = az_el([MOON_RADIUS_KM + 3, 4, 12], 0, 0)
    assert az_deg == pytest.approx(np.rad2deg(np.arctan2(4, 12)))
    assert elev_deg == pytest.approx(np.rad2deg(np.arcsin(3 / 13)))
    assert dist_km == pytest.approx(13)
    az_deg, _, _ = az_el([MOON_RADIUS_KM, -0.001, 1], 0, 0)
    assert 359.9 < az_deg < 360


def test_az_el_broadcasts_sites_and_times():
    body_km = np.array([[[384400, 0, 0]], [[0, 384400, 0]]])
    az_deg, elev_deg, dist_km = az_el(body_km, [0, -85, -90], [90, -30, 25])
    assert az_deg.shape == elev_deg.shape == dist_km.shape == (2, 3)
    for i in range(2):
        for j, (lat_deg, lon_deg) in enumerate(zip([0, -85, -90], [90, -30, 25])):
            expected = az_el(body_km[i, 0], lat_deg, lon_deg)
            np.testing.assert_allclose(
                [az_deg[i, j], elev_deg[i, j], dist_km[i, j]], expected
            )


def test_angular_radius_uses_arcsine_and_topocentric_distance():
    assert angular_radius_deg("sun", 149597870.7) == pytest.approx(
        0.266453107, abs=1e-9
    )
    assert angular_radius_deg("earth", 6371 * 2) == pytest.approx(30)
    values = angular_radius_deg("earth", [356000, 407000])
    assert 0.8 < values[1] < values[0] < 1.1


def test_visible_disk_fraction_contacts_symmetry_and_segment_area():
    np.testing.assert_array_equal(
        visible_disk_fraction([-2, -1, 0, 1, 2], 0, 1), [0, 0, 0.5, 1, 1]
    )
    # d=1/2: the hidden segment has angle pi/3 and triangle area sqrt(3)/4.
    expected = 2 / 3 + np.sqrt(3) / (4 * np.pi)
    assert visible_disk_fraction(0.75, 0.25, 1) == pytest.approx(expected)
    d = np.linspace(-1, 1, 101)
    fraction = visible_disk_fraction(d, 0, 1)
    np.testing.assert_allclose(
        fraction + visible_disk_fraction(-d, 0, 1), 1, atol=1e-15
    )
    assert np.all(np.diff(fraction) >= 0)
    # Close to grazing, clipping must avoid invalid sqrt/acos warnings.
    with np.errstate(all="raise"):
        assert np.all(np.isfinite(visible_disk_fraction([-1 - 1e-15, 1 + 1e-15], 0, 1)))


@pytest.mark.parametrize(
    "lat_deg,lon_deg", [(-91, 0), (91, 0), (np.nan, 0), (-85, np.inf)]
)
def test_invalid_coordinates_raise(lat_deg, lon_deg):
    with pytest.raises(ValueError):
        enu_basis(lat_deg, lon_deg)
    with pytest.raises(ValueError):
        site_vector_km(lat_deg, lon_deg, 0)


@pytest.mark.parametrize("height_m", [np.nan, np.inf, -MOON_RADIUS_KM * 1000])
def test_invalid_height_raises(height_m):
    with pytest.raises(ValueError):
        site_vector_km(-85, 0, height_m)


@pytest.mark.parametrize("body_km", [[0, 1], 1, [np.nan, 0, 0], [MOON_RADIUS_KM, 0, 0]])
def test_invalid_body_vector_raises(body_km):
    with pytest.raises(ValueError):
        az_el(body_km, 0, 0)


@pytest.mark.parametrize("dist_km", [0, -1, 6000, np.nan, np.inf])
def test_invalid_distance_raises(dist_km):
    with pytest.raises(ValueError):
        angular_radius_deg("earth", dist_km)


@pytest.mark.parametrize(
    "args", [(0, 0, 0), (0, 0, -1), (np.nan, 0, 1), (0, np.inf, 1)]
)
def test_invalid_disk_angles_raise(args):
    with pytest.raises(ValueError):
        visible_disk_fraction(*args)
