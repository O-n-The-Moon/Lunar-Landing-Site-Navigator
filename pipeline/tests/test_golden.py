"""Golden vector generator: independent checks of the reference, no SPICE needed."""

import json

import numpy as np
import pytest

from lunarnav import golden, io
from lunarnav.geometry import az_el

pytestmark = pytest.mark.skipif(
    not (io.EPHEMERIS_BIN.is_file() and io.SITES_JSON.is_file()),
    reason="needs web/public/data ephemeris.bin and sites.json",
)

H_MS = 3_600_000


@pytest.fixture(scope="module")
def data():
    return golden.load_inputs()


@pytest.fixture(scope="module")
def built(data):
    return golden.build_golden(data)


def test_horizon_lookup_is_linear_and_wraps():
    mask = np.arange(720, dtype=float) * 0.01
    assert golden.horizon_elev_at(mask, 0.5, 0.0) == pytest.approx(0.0)
    assert golden.horizon_elev_at(mask, 0.5, 0.25) == pytest.approx(0.005)
    # between bin 719 (7.19) and bin 0 (0.0)
    assert golden.horizon_elev_at(mask, 0.5, 359.75) == pytest.approx(7.19 / 2)
    assert golden.horizon_elev_at(mask, 0.5, -0.5) == pytest.approx(7.19)
    assert golden.horizon_elev_at(mask, 0.5, 720.5) == pytest.approx(0.01)


def test_body_vectors_interpolate_linearly_between_hours(data):
    eph = data.ephemeris
    t0 = eph.start_ms + 5 * H_MS
    at_sample = golden.body_vectors_km(eph, np.array([t0]))[0]
    np.testing.assert_allclose(at_sample, eph.positions_km[5])
    mid = golden.body_vectors_km(eph, np.array([t0 + H_MS // 2]))[0]
    np.testing.assert_allclose(
        mid, 0.5 * (eph.positions_km[5] + eph.positions_km[6]), rtol=1e-12
    )
    last = golden.body_vectors_km(
        eph, np.array([eph.start_ms + (eph.count - 1) * H_MS])
    )
    np.testing.assert_allclose(last[0], eph.positions_km[-1])


def test_body_vectors_reject_times_outside_coverage(data):
    eph = data.ephemeris
    with pytest.raises(ValueError):
        golden.body_vectors_km(eph, np.array([eph.start_ms - 1]))
    with pytest.raises(ValueError):
        golden.body_vectors_km(eph, np.array([eph.start_ms + eph.count * H_MS]))


def test_hysteresis_matches_engine_rules():
    # Turns on at >= on_at, off at <= off_at, holds in between.
    v = np.array([0.0, 0.5, 0.56, 0.5, 0.44, 0.5, 0.2])
    on = golden.hysteresis_states(v, on_at=0.55, off_at=0.45)
    assert on.tolist() == [False, False, True, True, False, False, False]
    # First sample is on iff it is at or above the band midpoint.
    assert golden.hysteresis_states(np.array([0.5]), 0.55, 0.45)[0]
    assert not golden.hysteresis_states(np.array([0.49]), 0.55, 0.45)[0]
    # Zero-width band: a value exactly at the level does not toggle off.
    z = golden.hysteresis_states(np.array([1.0, 0.5, 0.5]), 0.5, 0.5)
    assert z.tolist() == [True, True, True]


def test_run_stats_on_a_known_pattern():
    on = np.array([0, 0, 1, 1, 1, 0, 0, 0, 1, 1], dtype=bool)  # minutes 0..9
    stats = golden.run_stats(on, step_min=60)
    assert stats["onH"] == pytest.approx(5.0)
    assert stats["longestGapH"] == pytest.approx(3.0)
    assert stats["firstOffH"] == pytest.approx(5.0)
    assert golden.run_stats(np.ones(4, dtype=bool), 60)["firstOffH"] is None
    assert golden.run_stats(np.zeros(4, dtype=bool), 60)["longestGapH"] == 4.0


def test_case_count_schema_and_ranges(built):
    cases = built["cases"]
    assert len(cases) >= 200
    keys = {
        "siteId",
        "observerHeightM",
        "tUtcMs",
        "sunAzDeg",
        "sunElevDeg",
        "sunDistKm",
        "sunHorizonDeg",
        "sunFraction",
        "earthAzDeg",
        "earthElevDeg",
        "earthDistKm",
        "earthHorizonDeg",
        "earthVisible",
    }
    for c in cases:
        assert set(c) == keys
        assert 0 <= c["sunAzDeg"] < 360 and 0 <= c["earthAzDeg"] < 360
        assert 0.0 <= c["sunFraction"] <= 1.0
        assert isinstance(c["earthVisible"], bool)
        assert c["observerHeightM"] in (2, 10)


def test_cases_cover_sites_heights_and_both_visibility_outcomes(built, data):
    cases = built["cases"]
    assert {c["siteId"] for c in cases} == {s["id"] for s in data.sites["sites"]}
    assert {c["observerHeightM"] for c in cases} == {2, 10}
    assert any(c["earthVisible"] for c in cases)
    assert any(not c["earthVisible"] for c in cases)
    fractions = [c["sunFraction"] for c in cases]
    assert any(f == 0.0 for f in fractions) and any(f == 1.0 for f in fractions)
    assert any(0.0 < f < 1.0 for f in fractions)
    # Times are not all on the hourly grid, so interpolation is exercised.
    assert any(c["tUtcMs"] % H_MS for c in cases)


def test_cases_recompute_from_first_principles(built, data):
    eph = data.ephemeris
    sites = {s["id"]: s for s in data.sites["sites"]}
    for c in built["cases"][:25]:
        s = sites[c["siteId"]]
        t = np.array([c["tUtcMs"]])
        x = (c["tUtcMs"] - eph.start_ms) / H_MS
        i = min(int(np.floor(x)), eph.count - 2)
        sun = eph.positions_km[i, 0] + (x - i) * (
            eph.positions_km[i + 1, 0] - eph.positions_km[i, 0]
        )
        az, el, dist = az_el(
            sun, s["latDeg"], s["lonDeg"], s["surfaceHeightM"] + c["observerHeightM"]
        )
        assert c["sunAzDeg"] == pytest.approx(float(az), abs=1e-8)
        assert c["sunElevDeg"] == pytest.approx(float(el), abs=1e-8)
        assert c["sunDistKm"] == pytest.approx(float(dist), abs=1e-5)
        assert golden.body_vectors_km(eph, t).shape == (1, 2, 3)


def test_earth_visible_uses_the_margin(built):
    margin = built["opts"]["earthMarginDeg"]
    for c in built["cases"]:
        clearance = c["earthElevDeg"] - c["earthHorizonDeg"]
        if abs(clearance - margin) > 1e-6:
            assert c["earthVisible"] == (clearance >= margin)


def test_scenarios_are_three_14_day_hourly(built):
    scenarios = built["scenarios"]
    assert len(scenarios) == 3
    for sc in scenarios:
        assert sc["durationH"] == 14 * 24
        n = 14 * 24 + 1
        for key in ("sunFraction", "sunlit", "earthLink", "both"):
            assert len(sc["hourly"][key]) == n
        assert sc["stepMin"] == 1
        t = sc["totals"]
        assert 0 <= t["sunlitPct"] <= 100 and 0 <= t["earthPct"] <= 100
        assert t["bothPct"] <= min(t["sunlitPct"], t["earthPct"]) + 1e-9
        assert t["sunlitH"] == pytest.approx(t["sunlitPct"] / 100 * sc["durationH"])
        assert 0.0 <= t["meanSunFraction"] <= 1.0


def test_scenarios_have_real_dynamics(built):
    # Each scenario must exercise transitions, otherwise it cannot catch regressions.
    for sc in built["scenarios"]:
        t = sc["totals"]
        assert 0 < t["sunlitPct"] < 100, sc["id"]
        assert t["firstSunsetH"] is not None, sc["id"]
    assert any(0 < sc["totals"]["earthPct"] < 100 for sc in built["scenarios"])


def test_scenario_totals_agree_with_hourly_series(built):
    for sc in built["scenarios"]:
        hourly_sun_h = sum(sc["hourly"]["sunlit"][:-1])
        assert sc["totals"]["sunlitH"] == pytest.approx(
            hourly_sun_h, abs=sc["durationH"] * 0.02
        )


def test_generation_is_deterministic(data, built):
    again = golden.build_golden(data)
    assert json.dumps(again, sort_keys=True) == json.dumps(built, sort_keys=True)


def test_main_writes_byte_identical_file(tmp_path, monkeypatch):
    target = tmp_path / "golden.json"
    monkeypatch.setattr(io, "GOLDEN_JSON", target)
    monkeypatch.setattr(golden.io, "GOLDEN_JSON", target)
    golden.main()
    first = target.read_bytes()
    golden.main()
    assert target.read_bytes() == first
    assert json.loads(first)["schemaVersion"] == 1
