"""PGDA product 69 comparison (#20) under the #57 disposition.

Synthetic tests place the Sun/Earth at exact topocentric az/el around a flat or
stepped horizon mask, so expected percentages follow from counting samples.
"""

import json

import numpy as np
import pytest

from lunarnav import fetch, io, validate_pgda
from lunarnav.geometry import enu_basis, site_vector_km

LAT_DEG, LON_DEG = -85.0, 30.0
SUN_DIST_KM = 1.5e8
EARTH_DIST_KM = 384_400.0  # Earth angular radius ~0.950 deg
AZ_BINS = 720


def _body_vecs_km(az_deg, elev_deg, dist_km, height_m=0.0):
    """Moon-centered vectors seen from the site at exactly (az, elev)."""
    east, north, up = enu_basis(LAT_DEG, LON_DEG)
    az, el = np.deg2rad(az_deg), np.deg2rad(elev_deg)
    direction = (
        np.cos(el)[:, None] * (np.sin(az)[:, None] * east + np.cos(az)[:, None] * north)
        + np.sin(el)[:, None] * up
    )
    return site_vector_km(LAT_DEG, LON_DEG, height_m) + dist_km * direction


def _sun_earth(
    sun_elev_deg, earth_elev_deg, az_deg=None, height_m=0.0, earth_dist_km=None
):
    n = len(sun_elev_deg)
    earth_dist_km = EARTH_DIST_KM if earth_dist_km is None else earth_dist_km
    az_deg = np.zeros(n) if az_deg is None else np.asarray(az_deg, dtype=float)
    sun = _body_vecs_km(az_deg, np.asarray(sun_elev_deg, float), SUN_DIST_KM, height_m)
    earth = _body_vecs_km(
        az_deg, np.asarray(earth_elev_deg, float), earth_dist_km, height_m
    )
    return np.stack([sun, earth], axis=1)


# --- any-disc visibility ----------------------------------------------------


def test_sun_counts_when_any_part_of_nominal_disc_clears_horizon():
    # Horizon 0 deg; Sun radius is the nominal 0.265 deg.
    vecs = _sun_earth([-0.26, -0.27, 1.0, -5.0], [10, 10, 10, 10])
    sun_pct, _ = validate_pgda.visibility_pct(np.zeros(AZ_BINS), vecs, LAT_DEG, LON_DEG)
    assert sun_pct == pytest.approx(50.0)


def test_earth_uses_its_actual_angular_radius():
    # ~0.950 deg at 384,400 km: -0.94 is still visible, -0.96 is not.
    vecs = _sun_earth([10, 10, 10, 10], [-0.94, -0.96, 0.5, -3.0])
    _, earth_pct = validate_pgda.visibility_pct(
        np.zeros(AZ_BINS), vecs, LAT_DEG, LON_DEG
    )
    assert earth_pct == pytest.approx(50.0)


def test_earth_radius_follows_distance():
    # Near perigee (360,000 km) the radius is ~1.014 deg, so -0.98 is visible;
    # a constant ~0.95 deg would hide it.
    vecs = _sun_earth([10, 10], [-0.98, -1.03], earth_dist_km=360_000.0)
    _, earth_pct = validate_pgda.visibility_pct(
        np.zeros(AZ_BINS), vecs, LAT_DEG, LON_DEG
    )
    assert earth_pct == pytest.approx(50.0)


def test_horizon_is_looked_up_at_the_body_azimuth():
    # A 5 deg wall from az 80 to 100 deg blocks the Sun at az 90 but not at 270.
    mask = np.zeros(AZ_BINS)
    mask[160:201] = 5.0
    vecs = _sun_earth([3.0, 3.0], [3.0, 3.0], az_deg=[90.0, 270.0])
    sun_pct, earth_pct = validate_pgda.visibility_pct(mask, vecs, LAT_DEG, LON_DEG)
    assert (sun_pct, earth_pct) == (pytest.approx(50.0), pytest.approx(50.0))


def test_visibility_rejects_a_mask_that_is_not_720_bins():
    vecs = _sun_earth([1.0], [1.0])
    with pytest.raises(ValueError, match="360"):
        validate_pgda.visibility_pct(np.zeros(100), vecs, LAT_DEG, LON_DEG)


# --- time span --------------------------------------------------------------


def test_span_is_hourly_over_about_18_6_years():
    samples = validate_pgda.utc_samples()
    assert len(samples) == validate_pgda.SPAN_HOURS
    assert validate_pgda.SPAN_HOURS / (365.25 * 24) == pytest.approx(18.6, abs=0.01)
    assert samples[0] == validate_pgda.SPAN_START_UTC
    assert samples[1] == "2026-01-01T01:00:00Z"


# --- PGDA pixel -------------------------------------------------------------


class LinearRaster:
    """Fraction rising 0.01 per 120 m pixel in x; NaN beyond x_nan_km."""

    cell_km = 0.12

    def __init__(self, x_nan_km=np.inf):
        self.x_nan_km = x_nan_km

    def sample(self, x_km, y_km):
        x_km, _ = np.broadcast_arrays(np.asarray(x_km, float), y_km)
        values = 0.5 + 0.01 * x_km / self.cell_km
        return np.where(x_km > self.x_nan_km, np.nan, values)


def test_pgda_pixel_is_bilinear_value_plus_range_over_two_pixels():
    pct, lo, hi = validate_pgda.pgda_pixel_pct(LinearRaster(), 0.0, 0.0)
    assert (pct, lo, hi) == (
        pytest.approx(50.0),
        pytest.approx(48.0),
        pytest.approx(52.0),
    )


def test_pgda_pixel_range_ignores_missing_neighbours():
    _, lo, hi = validate_pgda.pgda_pixel_pct(LinearRaster(x_nan_km=0.13), 0.0, 0.0)
    assert (lo, hi) == (pytest.approx(48.0), pytest.approx(51.0))


def test_pgda_pixel_without_coverage_at_site_raises():
    with pytest.raises(ValueError, match="PGDA"):
        validate_pgda.pgda_pixel_pct(LinearRaster(x_nan_km=-1.0), 0.0, 0.0)


class ConstantRaster:
    cell_km = 0.12

    def sample(self, x_km, y_km):
        return np.full(np.broadcast(x_km, y_km).shape, 0.5)


# --- rows and summary (validation.json contract) ------------------------------


def _site_result(site_id, sun_diff, earth_diff):
    """Ours at 0/2/10 m; PGDA 50 % with a ±2 px range of 45-55 %."""
    ours = {
        0: (50.0 + sun_diff, 50.0 + earth_diff),
        2: (51.0, 52.0),
        10: (53.0, 54.0),
    }
    return validate_pgda.SiteResult(
        site_id=site_id,
        ours_pct_by_height=ours,
        pgda_sun=(50.0, 45.0, 55.0),
        pgda_earth=(50.0, 45.0, 55.0),
    )


def test_row_within_threshold_has_no_explanation():
    row = validate_pgda.to_row(_site_result("a", 5.0, -4.99), explanations={})
    assert row == {
        "siteId": "a",
        "oursSunPct": 55.0,
        "pgdaSunPct": 50.0,
        "sunDiffPp": 5.0,
        "oursEarthPct": 45.01,
        "pgdaEarthPct": 50.0,
        "earthDiffPp": -4.99,
        "explanation": None,
    }


def test_outlier_without_written_explanation_raises():
    with pytest.raises(ValueError, match="outlier-site"):
        validate_pgda.to_row(_site_result("outlier-site", 6.0, 0.0), explanations={})


def test_outlier_explanation_carries_range_and_sensitivity_evidence():
    row = validate_pgda.to_row(
        _site_result("b", 0.0, -7.0), explanations={"b": "Rim site."}
    )
    assert row["earthDiffPp"] == -7.0
    assert row["explanation"].startswith("Rim site.")
    assert "45.0–55.0 %" in row["explanation"]  # PGDA ±2 px range
    assert "2 m: 52.0 %" in row["explanation"]
    assert "10 m: 54.0 %" in row["explanation"]


def test_summary_counts_sites_with_both_bodies_within_threshold():
    rows = [
        validate_pgda.to_row(_site_result("a", 1.0, -2.0), {}),
        validate_pgda.to_row(_site_result("b", -6.5, 0.0), {"b": "x"}),
        validate_pgda.to_row(_site_result("c", 0.0, 5.5), {"c": "y"}),
    ]
    assert validate_pgda.summarize(rows) == {
        "thresholdPp": 5.0,
        "sitesWithinThreshold": 1,
        "sitesTotal": 3,
        "maxAbsSunDiffPp": 6.5,
        "maxAbsEarthDiffPp": 5.5,
        "targetFractionWithin": 0.8,
    }


def test_criterion_2_needs_80_percent_of_sites_within():
    def rows_with(n_within, n_out):
        within = [
            validate_pgda.to_row(_site_result(f"w{i}", 0, 0), {})
            for i in range(n_within)
        ]
        out = [
            validate_pgda.to_row(_site_result(f"o{i}", 9, 0), {f"o{i}": "z"})
            for i in range(n_out)
        ]
        return validate_pgda.summarize(within + out)

    assert validate_pgda.criterion_2_passes(rows_with(8, 2))
    assert not validate_pgda.criterion_2_passes(rows_with(7, 2))


def test_report_counts_per_height_on_rounded_diffs_and_both_bodies():
    result = validate_pgda.SiteResult(
        site_id="s",
        # 0 m: Sun +5.004 rounds to 5.0 (within, like the JSON/panel).
        # 2 m: Sun within, Earth +6 (out). 10 m: both out.
        ours_pct_by_height={0: (55.004, 50.0), 2: (50.0, 56.0), 10: (60.0, 60.0)},
        pgda_sun=(50.0, 45.0, 55.0),
        pgda_earth=(50.0, 45.0, 55.0),
    )
    text = validate_pgda.report([result])
    assert "  0 m: 1/1 sites within" in text
    assert "  2 m: 0/1 sites within" in text
    assert " 10 m: 0/1 sites within" in text


def test_missing_terrain_at_site_raises():
    site = {"id": "hole", "latDeg": LAT_DEG, "lonDeg": LON_DEG}
    with pytest.raises(ValueError, match="hole"):
        validate_pgda.compare_site(
            site,
            horizon_deg=lambda lat, lon, h: np.zeros(AZ_BINS),
            surface_height_m=lambda lat, lon: float("nan"),
            pgda_sun=ConstantRaster(),
            pgda_earth=ConstantRaster(),
            body_vecs_km=_sun_earth([1.0], [1.0]),
        )


def test_method_states_the_agreed_any_disc_comparison_at_surface_level():
    method = validate_pgda.METHOD
    assert set(method) == {
        "observerHeightM",
        "sensitivityHeightsM",
        "sunDefinition",
        "earthDefinition",
        "pgdaDefinition",
        "sampling",
        "claimLabel",
        "notes",
    }
    assert method["observerHeightM"] == validate_pgda.PRIMARY_HEIGHT_M == 0
    assert method["sensitivityHeightsM"] == [2, 10]
    assert method["claimLabel"] == validate_pgda.CLAIM_LABEL
    assert "any part" in method["sunDefinition"]
    assert "any part" in method["earthDefinition"]
    # Height is a working assumption (#57): the file must say so, not imply a match.
    assert "assum" in method["notes"] and "not confirmed" in method["notes"]
    assert str(validate_pgda.SPAN_HOURS) in method["sampling"]


# --- run() with injected inputs ------------------------------------------------


def test_run_compares_surface_level_and_reports_sensitivity(capsys, monkeypatch):
    sites = [{"id": "flat", "latDeg": LAT_DEG, "lonDeg": LON_DEG}]
    # Sun/Earth at elevation +1 deg half the time, -3 deg otherwise.
    vecs = _sun_earth([1.0, -3.0, 1.0, -3.0], [1.0, -3.0, 1.0, -3.0])
    heights_seen = []

    def horizon(lat_deg, lon_deg, height_m):
        heights_seen.append(height_m)
        return np.zeros(AZ_BINS)

    # Masks take height above the surface; az/el takes height above the sphere.
    total_heights_seen = []
    real_visibility_pct = validate_pgda.visibility_pct

    def spy(mask, vecs, lat, lon, height_m=0.0):
        total_heights_seen.append(height_m)
        return real_visibility_pct(mask, vecs, lat, lon, height_m)

    monkeypatch.setattr(validate_pgda, "visibility_pct", spy)
    result = validate_pgda.run(
        sites=sites,
        horizon_deg=horizon,
        surface_height_m=lambda lat, lon: 3000.0,
        pgda_sun=ConstantRaster(),
        pgda_earth=ConstantRaster(),
        body_vecs_km=vecs,
    )
    assert sorted(heights_seen) == [0, 2, 10]
    assert sorted(total_heights_seen) == [3000, 3002, 3010]
    assert result["rows"] == [
        {
            "siteId": "flat",
            "oursSunPct": 50.0,
            "pgdaSunPct": 50.0,
            "sunDiffPp": 0.0,
            "oursEarthPct": 50.0,
            "pgdaEarthPct": 50.0,
            "earthDiffPp": 0.0,
            "explanation": None,
        }
    ]
    assert result["summary"]["sitesWithinThreshold"] == 1
    assert result["method"] == validate_pgda.METHOD
    out = capsys.readouterr().out
    assert validate_pgda.CLAIM_LABEL in out
    assert "10 m" in out


# --- real data -------------------------------------------------------------


@pytest.mark.skipif(
    not (fetch.RAW_DIR / "sources.json").exists(), reason="Run lunarnav fetch first"
)
def test_spice_vectors_for_a_short_span_have_plausible_distances():
    vecs = validate_pgda.body_vectors_km(validate_pgda.utc_samples()[:48])
    assert vecs.shape == (48, 2, 3)
    dist_km = np.linalg.norm(vecs, axis=-1)
    assert np.all((dist_km[:, 0] > 1.46e8) & (dist_km[:, 0] < 1.53e8))
    assert np.all((dist_km[:, 1] > 3.5e5) & (dist_km[:, 1] < 4.1e5))


def test_shipped_validation_carries_the_pgda_target_and_method():
    shipped = json.loads(io.VALIDATION_JSON.read_text(encoding="utf-8"))["pgda"]
    assert shipped["summary"] == validate_pgda.summarize(shipped["rows"])
    assert shipped["summary"]["targetFractionWithin"] == 0.8
    assert shipped["method"] == validate_pgda.METHOD
