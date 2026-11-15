"""sites.json builder: synthetic terrain, plus real-data checks after fetch."""

import json

import numpy as np
import pytest
import yaml

from lunarnav import cli, horizons_sites
from lunarnav.constants import MOON_RADIUS_KM, SITE_AZ_BINS
from lunarnav.dem import DemStack, lat_lon_to_xy_km, xy_km_to_lat_lon
from lunarnav.fetch import RAW_DIR
from lunarnav.horizons_sites import SLOPE_BASELINE_M, build_site, build_sites_file
from test_horizon import SyntheticTerrain


class Ramp(SyntheticTerrain):
    """Height rises `rise_m_per_km` along map +y (local north at lon 0)."""

    def __init__(self, rise_m_per_km, surface_m=0.0):
        super().__init__(surface_m)
        self.rise_m_per_km = rise_m_per_km

    def height_m(self, x_km, y_km):
        x_km, y_km = np.broadcast_arrays(x_km, y_km)
        return self.surface_m + self.rise_m_per_km * y_km


class ConstantFraction:
    """Stand-in for a PGDA raster: bilinear average visibility as a fraction."""

    def __init__(self, fraction):
        self.fraction = fraction

    def sample(self, x_km, y_km):
        return np.full(np.broadcast(x_km, y_km).shape, self.fraction)


SITE = {
    "id": "test-site",
    "name": "Test site",
    "category": "reference",
    "latDeg": -85.0,
    "lonDeg": 0.0,
    "coordSource": "https://example.org",
}


class TiltedPlane(SyntheticTerrain):
    """height = east_gradient * east_m + north_gradient * north_m about a site."""

    def __init__(self, lat_deg, lon_deg, east_gradient, north_gradient):
        super().__init__()
        self.lat_deg, self.lon_deg = lat_deg, lon_deg
        self.east_gradient, self.north_gradient = east_gradient, north_gradient

    def height_m(self, x_km, y_km):
        lat_deg, lon_deg = xy_km_to_lat_lon(x_km, y_km)
        m_per_deg = np.deg2rad(1) * MOON_RADIUS_KM * 1000
        north_m = (lat_deg - self.lat_deg) * m_per_deg
        east_m = (lon_deg - self.lon_deg) * np.cos(np.deg2rad(self.lat_deg)) * m_per_deg
        return self.east_gradient * east_m + self.north_gradient * north_m


@pytest.mark.parametrize(
    "east,north", [(0.1, 0.0), (-0.1, 0.0), (0.0, 0.1), (0.1, 0.1), (0.05, -0.1)]
)
def test_slope_of_a_tilted_plane_away_from_lon_zero(east, north):
    site = {**SITE, "latDeg": -87.0, "lonDeg": 30.0}
    terrain = TiltedPlane(-87.0, 30.0, east, north)
    entry = build_site(terrain, ConstantFraction(0), ConstantFraction(0), site)
    expected_deg = np.rad2deg(np.arctan(np.hypot(east, north)))
    assert entry["slopeDeg"] == pytest.approx(expected_deg, abs=0.02)


def test_slope_near_the_pole_stays_inside_the_projection_domain():
    site = {**SITE, "latDeg": -89.9995, "lonDeg": 10.0}
    entry = build_site(
        SyntheticTerrain(), ConstantFraction(0), ConstantFraction(0), site
    )
    assert entry["slopeDeg"] == pytest.approx(0, abs=1e-6)


def test_slope_baseline_is_80_m():
    assert SLOPE_BASELINE_M == 80


def test_site_entry_has_contract_fields_and_720_bin_masks():
    entry = build_site(
        SyntheticTerrain(150.0), ConstantFraction(0.25), ConstantFraction(0.5), SITE
    )
    assert set(entry) == {
        "id", "name", "category", "latDeg", "lonDeg", "surfaceHeightM",
        "slopeDeg", "coordSource", "pgdaAvgSunPct", "pgdaAvgEarthPct",
        "horizonElevDeg",
    }  # fmt: skip
    assert entry["id"] == "test-site" and entry["latDeg"] == -85.0
    assert entry["surfaceHeightM"] == pytest.approx(150.0)
    assert entry["pgdaAvgSunPct"] == pytest.approx(25.0)
    assert entry["pgdaAvgEarthPct"] == pytest.approx(50.0)
    assert set(entry["horizonElevDeg"]) == {"2", "10"}
    for mask in entry["horizonElevDeg"].values():
        assert len(mask) == SITE_AZ_BINS and all(np.isfinite(mask))


def test_higher_observer_sees_a_lower_horizon_by_the_geometric_dip():
    entry = build_site(
        SyntheticTerrain(0.0), ConstantFraction(0), ConstantFraction(0), SITE
    )
    for height_m, mask in ((2, entry["horizonElevDeg"]["2"]),
                           (10, entry["horizonElevDeg"]["10"])):  # fmt: skip
        dip_deg = -np.rad2deg(
            np.arccos(MOON_RADIUS_KM / (MOON_RADIUS_KM + height_m / 1000))
        )
        np.testing.assert_allclose(mask, dip_deg, atol=0.01)


def test_flat_terrain_has_zero_slope():
    entry = build_site(
        SyntheticTerrain(500.0), ConstantFraction(0), ConstantFraction(0), SITE
    )
    assert entry["slopeDeg"] == pytest.approx(0, abs=1e-6)


@pytest.mark.parametrize("rise_m_per_km", [0.0, 50.0, 100.0, -100.0])
def test_ramp_slope_uses_the_80_m_baseline(rise_m_per_km):
    entry = build_site(
        Ramp(rise_m_per_km), ConstantFraction(0), ConstantFraction(0), SITE
    )
    expected_deg = np.rad2deg(np.arctan(abs(rise_m_per_km) / 1000))
    assert entry["slopeDeg"] == pytest.approx(expected_deg, abs=0.05)


def test_missing_pgda_coverage_is_an_error_not_zero():
    with pytest.raises(ValueError, match="PGDA"):
        build_site(
            SyntheticTerrain(), ConstantFraction(np.nan), ConstantFraction(0.5), SITE
        )


def test_sites_file_header_and_order(tmp_path):
    catalog = {"sites": [SITE, {**SITE, "id": "second"}]}
    doc = build_sites_file(
        catalog["sites"], SyntheticTerrain(), ConstantFraction(0), ConstantFraction(0)
    )
    assert doc["schemaVersion"] == 1
    assert doc["azStepDeg"] == 0.5
    assert doc["heightsM"] == [2, 10]
    assert [s["id"] for s in doc["sites"]] == ["test-site", "second"]


def test_build_all_runs_sites_second():
    assert cli.BUILD_STEPS[1] is horizons_sites.main


def test_horizons_sites_command_is_dispatched(monkeypatch):
    calls = []
    monkeypatch.setattr(cli.horizons_sites, "main", lambda: calls.append("sites"))
    cli.main(["horizons", "--sites"])
    assert calls == ["sites"]


REAL = pytest.mark.skipif(
    not (RAW_DIR / "dem/LDEM_80S_80M.IMG").exists()
    or not (RAW_DIR / "pgda/AVGVISIB_75S_120M_201608.IMG").exists(),
    reason="Run lunarnav fetch first",
)


@REAL
def test_real_catalog_builds_valid_entries():
    terrain = DemStack()
    sun = horizons_sites.PdsRaster(RAW_DIR / "pgda/AVGVISIB_75S_120M_201608.LBL")
    earth = horizons_sites.PdsRaster(
        RAW_DIR / "pgda/AVGVISIB_75S_120M_201608_EARTH.LBL"
    )
    catalog = yaml.safe_load(horizons_sites.SITES_YAML.read_text(encoding="utf-8"))
    doc = build_sites_file(catalog["sites"][:2], terrain, sun, earth)
    json.dumps(doc)  # serializable (no numpy scalars, no NaN)
    for site in doc["sites"]:
        assert 0 <= site["pgdaAvgSunPct"] <= 100
        assert 0 <= site["pgdaAvgEarthPct"] <= 100
        assert 0 <= site["slopeDeg"] < 60
        assert np.all(
            np.array(site["horizonElevDeg"]["10"])
            < np.array(site["horizonElevDeg"]["2"])
        )
    x_km, y_km = lat_lon_to_xy_km(-85.0, 0.0)
    assert np.isfinite(sun.sample(x_km, y_km))


@pytest.mark.skipif(
    not horizons_sites.SITES_JSON.exists(), reason="sites.json not generated"
)
def test_committed_sites_json_matches_the_catalog():
    catalog = yaml.safe_load(horizons_sites.SITES_YAML.read_text(encoding="utf-8"))
    doc = json.loads(horizons_sites.SITES_JSON.read_text(encoding="utf-8"))
    assert [s["id"] for s in doc["sites"]] == [s["id"] for s in catalog["sites"]]
    for built, source in zip(doc["sites"], catalog["sites"], strict=True):
        for key in ("name", "category", "latDeg", "lonDeg", "coordSource"):
            assert built[key] == source[key], (source["id"], key)
