"""Golden vector generator: independent checks of the reference, no SPICE needed."""

import hashlib
import itertools
import json

import numpy as np
import pytest

from lunarnav import golden, io

H_MS = 3_600_000
BORDERLINE_ID = "connecting-ridge-2029-04-borderline"


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


def test_opts_match_visibility_opts_and_height_lives_on_each_scenario(built):
    # VisibilityOpts has no observerHeightM (#82); the height is per case / scenario (#94).
    assert set(built["opts"]) == {
        "sunThreshold",
        "hysteresis",
        "earthMarginDeg",
        "earthHysteresisDeg",
    }
    assert built["scenarios"]
    for sc in built["scenarios"]:
        assert sc["observerHeightM"] == golden.SCENARIO_HEIGHT_M


def test_case_count_schema_and_ranges(built):
    cases = built["cases"]
    assert len(cases) >= 200
    assert len({(c["siteId"], c["tUtcMs"]) for c in cases}) == len(cases)
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


def _independent(case, eph, site):
    """Re-derive a case without lunarnav.geometry: own ENU math and numeric disk area."""
    t = case["tUtcMs"]
    x = (t - eph.start_ms) / H_MS
    i = min(int(np.floor(x)), eph.count - 2)
    vec = eph.positions_km[i] + (x - i) * (
        eph.positions_km[i + 1] - eph.positions_km[i]
    )
    lat = np.radians(max(-89.999, min(89.999, site["latDeg"])))
    lon = np.radians(site["lonDeg"])
    up = np.array([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)])
    east = np.array([-np.sin(lon), np.cos(lon), 0.0])
    north = np.cross(up, east)
    pos = (1737.4 + (site["surfaceHeightM"] + case["observerHeightM"]) / 1000) * up
    mask = site["horizonElevDeg"][str(case["observerHeightM"])]
    out = {}
    for name, body, radius_km in (
        ("sun", vec[0], 695_700.0),
        ("earth", vec[1], 6_371.0),
    ):
        d = body - pos
        e, n, u = d @ east, d @ north, d @ up
        az = np.degrees(np.arctan2(e, n)) % 360
        el = np.degrees(np.arctan2(u, np.hypot(e, n)))
        pos_bin = (az / 0.5) % 720
        i0 = int(pos_bin)
        h = mask[i0] + (mask[(i0 + 1) % 720] - mask[i0]) * (pos_bin - i0)
        out[name] = (
            az,
            el,
            float(np.linalg.norm(d)),
            h,
            np.degrees(np.arcsin(radius_km / np.linalg.norm(d))),
        )
    return out


def _disk_fraction_numeric(center_above_deg, radius_deg):
    """Visible share of a disk above a straight horizon, by integrating columns."""
    xs = np.linspace(-radius_deg, radius_deg, 40001)
    half = np.sqrt(np.maximum(radius_deg**2 - xs**2, 0.0))
    visible = np.clip(np.minimum(2 * half, center_above_deg + half), 0, None)
    return float(np.trapezoid(visible, xs) / (np.pi * radius_deg**2))


def test_all_cases_match_an_independent_derivation(built, data):
    eph = data.ephemeris
    sites = {s["id"]: s for s in data.sites["sites"]}
    margin = built["opts"]["earthMarginDeg"]
    for c in built["cases"]:
        ind = _independent(c, eph, sites[c["siteId"]])
        sun_az, sun_el, sun_d, sun_h, sun_r = ind["sun"]
        earth_az, earth_el, earth_d, earth_h, _ = ind["earth"]
        label = (c["siteId"], c["tUtcMs"])
        for got, want in (
            (c["sunAzDeg"], sun_az),
            (c["earthAzDeg"], earth_az),
        ):
            assert abs((got - want + 180) % 360 - 180) < 1e-7, label
        assert c["sunElevDeg"] == pytest.approx(sun_el, abs=1e-7), label
        assert c["earthElevDeg"] == pytest.approx(earth_el, abs=1e-7), label
        assert c["sunDistKm"] == pytest.approx(sun_d, abs=1e-4), label
        assert c["earthDistKm"] == pytest.approx(earth_d, abs=1e-4), label
        assert c["sunHorizonDeg"] == pytest.approx(sun_h, abs=1e-7), label
        assert c["earthHorizonDeg"] == pytest.approx(earth_h, abs=1e-7), label
        # Straight-horizon disk area, integrated numerically (engine/formula parity).
        want_fraction = _disk_fraction_numeric(sun_el - sun_h, sun_r)
        assert c["sunFraction"] == pytest.approx(want_fraction, abs=1e-3), label
        clearance = earth_el - earth_h
        if abs(clearance - margin) > 1e-6:
            assert c["earthVisible"] == (clearance >= margin), label


def test_enough_cases_have_a_partly_hidden_sun(built):
    partial = [c for c in built["cases"] if 0.02 < c["sunFraction"] < 0.98]
    assert len(partial) >= 40
    assert len({c["siteId"] for c in partial}) >= 6


def test_margin_exclusion_covers_parity_drift():
    # Parity lets elev and horizon each differ by 1e-3 deg (SPEC.md), so the TS
    # clearance can drift by 2e-3 deg; closer cases could flip earthVisible.
    assert golden.MARGIN_EXCLUSION_DEG >= 2 * 1e-3


def test_lead_in_starts_48_h_before_landing_in_whole_10_min_steps(data):
    # Mirrors missionMetrics in web/src/engine/metrics.ts.
    eph = data.ephemeris
    landing = eph.start_ms + 100 * H_MS
    assert golden.lead_in_start_ms(eph, landing) == landing - 48 * H_MS
    near = eph.start_ms + 25 * golden.MIN_MS
    assert golden.lead_in_start_ms(eph, near) == eph.start_ms + 5 * golden.MIN_MS
    assert golden.lead_in_start_ms(eph, eph.start_ms) == eph.start_ms


def test_borderline_scenario_takes_its_landing_state_from_the_lead_in(built):
    sc = next(s for s in built["scenarios"] if s["id"] == BORDERLINE_ID)
    f0 = sc["hourly"]["sunFraction"][0]
    assert 0.45 < f0 < 0.55
    # Seeding the hysteresis at landing would pick the midpoint state instead.
    assert sc["hourly"]["sunlit"][0] != int(f0 >= 0.5)


def test_scenarios_are_four_14_day_hourly(built):
    scenarios = built["scenarios"]
    assert len(scenarios) == 4
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
    # An hourly sample can misplace each window edge by < 1 h, so the hourly count
    # may differ from the exact total by at most the number of edges.
    for sc in built["scenarios"]:
        for key, total in (
            ("sunlit", "sunlitH"),
            ("earthLink", "earthH"),
            ("both", "bothH"),
        ):
            series = sc["hourly"][key]
            edges = sum(a != b for a, b in itertools.pairwise(series)) + 2
            assert abs(sum(series[:-1]) - sc["totals"][total]) <= edges, (sc["id"], key)
        t = sc["totals"]
        assert t["bothH"] <= min(t["sunlitH"], t["earthH"]) + 1e-9


def test_committed_file_matches_generator(built):
    # Both inputs and golden.json are tracked, so this must run in CI, never skip.
    assert json.loads(io.GOLDEN_JSON.read_text(encoding="utf-8")) == json.loads(
        json.dumps(built)
    )


def test_cases_avoid_the_earth_margin_boundary(built):
    margin = built["opts"]["earthMarginDeg"]
    for c in built["cases"]:
        clearance = c["earthElevDeg"] - c["earthHorizonDeg"]
        assert abs(clearance - margin) > golden.MARGIN_EXCLUSION_DEG


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


# --- input fingerprint (#89) ---------------------------------------------------


def test_text_digest_ignores_crlf_line_endings(tmp_path):
    # A Windows checkout (core.autocrlf) has CRLF JSON; git and CI have LF.
    lf, crlf = tmp_path / "lf.json", tmp_path / "crlf.json"
    lf.write_bytes(b'{\n  "a": 1\n}\n')
    crlf.write_bytes(b'{\r\n  "a": 1\r\n}\r\n')
    assert golden.text_sha256(lf) == golden.text_sha256(crlf)
    # sha256 of the LF bytes, so other languages can reproduce it.
    assert golden.text_sha256(lf) == hashlib.sha256(lf.read_bytes()).hexdigest()


def test_text_digest_changes_with_content(tmp_path):
    a, b = tmp_path / "a.json", tmp_path / "b.json"
    a.write_bytes(b'{"a": 1}\n')
    b.write_bytes(b'{"a": 2}\n')
    assert golden.text_sha256(a) != golden.text_sha256(b)


def test_binary_digest_is_raw_bytes(tmp_path):
    p = tmp_path / "x.bin"
    p.write_bytes(b"\r\n\x00\x01")  # never normalized: CR LF inside floats is data
    assert golden.binary_sha256(p) == hashlib.sha256(p.read_bytes()).hexdigest()


def test_golden_records_the_fingerprint_of_its_inputs(built):
    assert built["inputs"] == {
        "ephemerisBinSha256": golden.binary_sha256(io.EPHEMERIS_BIN),
        "ephemerisJsonSha256": golden.text_sha256(io.EPHEMERIS_JSON),
        "sitesJsonSha256": golden.text_sha256(io.SITES_JSON),
    }
