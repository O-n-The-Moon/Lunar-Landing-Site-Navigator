"""Horizons validation: request, cache, parse and compare, all offline."""

import dataclasses
import io as std_io
import json
import urllib.error
from collections import Counter
from datetime import UTC, datetime
from urllib.parse import parse_qs, urlsplit

import pytest

from lunarnav import golden, io, validate_horizons
from lunarnav.geometry import az_el

# SPEC.md success criterion 1.
MAX_ERR_DEG = 0.02

MAR_1_06H_MS = round(datetime(2026, 3, 1, 6, tzinfo=UTC).timestamp() * 1000)
MAR_2_06H_MS = MAR_1_06H_MS + 24 * 3_600_000

# Trimmed from a real response (API 1.2, Sun from IM-2, 2026-11-15).
CANNED_RESULT = """\
Center radii    : 1737.4, 1737.4, 1737.4 km       {Equator_a, b, pole_c}
*******************************************************************************
 Date__(UT)__HR:MN:SC.fff, , ,Azimuth_(a-app), Elevation_(a-app),
*****************************************************************
$$SOE
 2026-Mar-01 06:00:00.000,*,i,    2.704278146,       5.144295172,
 2026-Mar-02 06:00:00.000, , ,  350.512239396,      -5.042916104,
$$EOE
*******************************************************************************
"""


def _response(result: str) -> dict:
    return {
        "signature": {"source": "NASA/JPL Horizons API", "version": "1.2"},
        "result": result,
    }


def test_parse_reads_time_azimuth_and_elevation_rows():
    rows = validate_horizons.parse_az_el(CANNED_RESULT)
    assert rows == [
        (MAR_1_06H_MS, 2.704278146, 5.144295172),
        (MAR_2_06H_MS, 350.512239396, -5.042916104),
    ]


def test_parse_rejects_output_without_ephemeris_block():
    with pytest.raises(ValueError, match=r"\$\$SOE"):
        validate_horizons.parse_az_el("Cannot interpret date. Type `?!` for help.")


def test_request_uses_moon_surface_site_in_utc():
    params = validate_horizons.request_params(
        lat_deg=-84.79059,
        lon_deg=29.19567,
        body="earth",
        t_utc_ms=[MAR_1_06H_MS, MAR_2_06H_MS],
    )
    assert params["COMMAND"] == "'399'"
    assert params["CENTER"] == "'coord@301'"
    assert params["COORD_TYPE"] == "'GEODETIC'"
    # E-lon, lat, altitude in km on the reference sphere.
    assert params["SITE_COORD"] == "'29.19567,-84.79059,0'"
    assert params["QUANTITIES"] == "'4'"
    assert params["TIME_TYPE"] == "'UT'"
    assert params["TLIST"] == "'2026-03-01 06:00:00','2026-03-02 06:00:00'"


def test_sun_request_targets_body_10():
    params = validate_horizons.request_params(-85.0, 0.0, "sun", [MAR_1_06H_MS])
    assert params["COMMAND"] == "'10'"


def test_second_query_reads_cache_without_network(tmp_path):
    params = validate_horizons.request_params(-85.0, 0.0, "sun", [MAR_1_06H_MS])
    calls = []

    def fetch(url: str) -> dict:
        calls.append(url)
        return _response(CANNED_RESULT)

    first = validate_horizons.query(params, tmp_path, fetch, throttle=lambda: None)

    def offline(url: str) -> dict:
        raise AssertionError("network used despite cache")

    second = validate_horizons.query(params, tmp_path, offline, throttle=lambda: None)
    assert first == second == CANNED_RESULT
    assert len(calls) == 1
    assert len(list(tmp_path.glob("*.json"))) == 1


def test_different_requests_get_different_cache_files(tmp_path):
    def fetch(url: str) -> dict:
        return _response(CANNED_RESULT)

    for body in ("sun", "earth"):
        params = validate_horizons.request_params(-85.0, 0.0, body, [MAR_1_06H_MS])
        validate_horizons.query(params, tmp_path, fetch, throttle=lambda: None)
    assert len(list(tmp_path.glob("*.json"))) == 2


def test_api_error_raises_and_is_not_cached(tmp_path):
    params = validate_horizons.request_params(-85.0, 0.0, "sun", [MAR_1_06H_MS])

    def fetch(url: str) -> dict:
        return {**_response("..."), "error": "No site matches"}

    with pytest.raises(RuntimeError, match="No site matches"):
        validate_horizons.query(params, tmp_path, fetch, throttle=lambda: None)
    assert list(tmp_path.iterdir()) == []


def test_unknown_api_major_version_raises(tmp_path):
    params = validate_horizons.request_params(-85.0, 0.0, "sun", [MAR_1_06H_MS])

    def fetch(url: str) -> dict:
        return {"signature": {"version": "2.0"}, "result": CANNED_RESULT}

    with pytest.raises(RuntimeError, match="version"):
        validate_horizons.query(params, tmp_path, fetch, throttle=lambda: None)


def test_throttle_spaces_requests_at_least_one_second_apart():
    now = [100.0]
    slept = []

    def sleep(s: float) -> None:
        slept.append(s)
        now[0] += s

    throttle = validate_horizons.make_throttle(1.0, clock=lambda: now[0], sleep=sleep)
    throttle()  # first request goes at once
    now[0] += 0.25
    throttle()  # 0.25 s later: waits the remaining 0.75 s
    now[0] += 3.0
    throttle()  # long gap: no wait
    assert slept == [pytest.approx(0.75)]


def test_azimuth_error_wraps_through_north():
    assert validate_horizons.az_err_deg(359.99, 0.01) == pytest.approx(0.02)
    assert validate_horizons.az_err_deg(0.01, 359.99) == pytest.approx(0.02)
    assert validate_horizons.az_err_deg(10.0, 10.5) == pytest.approx(0.5)


def test_summary_reports_count_max_and_mean():
    rows = [
        {"azErrDeg": 0.01, "elevErrDeg": 0.004},
        {"azErrDeg": 0.03, "elevErrDeg": 0.002},
    ]
    assert validate_horizons.summarize(rows) == {
        "n": 2,
        "maxAzErrDeg": pytest.approx(0.03),
        "maxElevErrDeg": pytest.approx(0.004),
        "meanAzErrDeg": pytest.approx(0.02),
        "meanElevErrDeg": pytest.approx(0.003),
    }


def test_epochs_cover_2026_to_2032_on_the_hourly_ephemeris_grid():
    epochs = validate_horizons.epochs_utc_ms()
    eph = golden.load_inputs().ephemeris
    assert len(epochs) >= 20
    assert len(set(epochs)) == len(epochs)
    assert all((t - eph.start_ms) % eph.step_ms == 0 for t in epochs)
    assert all(
        eph.start_ms <= t < eph.start_ms + eph.count * eph.step_ms for t in epochs
    )
    years = {datetime.fromtimestamp(t / 1000, UTC).year for t in epochs}
    assert years == set(range(2026, 2033))


def test_at_least_five_curated_sites_are_validated():
    site_ids = {s["id"] for s in golden.load_inputs().sites["sites"]}
    assert len(validate_horizons.SITE_IDS) >= 5
    assert set(validate_horizons.SITE_IDS) <= site_ids


AZ_OFFSET_DEG = 0.004
ELEV_OFFSET_DEG = -0.003


def _fake_horizons(inputs: golden.Inputs):
    """Answers from the request alone: ours plus a fixed offset at the requested times."""
    eph = inputs.ephemeris
    body_index = {"'10'": 0, "'399'": 1}

    def fetch(url: str) -> dict:
        q = {k: v[0] for k, v in parse_qs(urlsplit(url).query).items()}
        lon_deg, lat_deg, _ = (float(x) for x in q["SITE_COORD"].strip("'").split(","))
        lines = []
        for stamp in q["TLIST"].split(","):
            t = datetime.strptime(stamp.strip("'"), "%Y-%m-%d %H:%M:%S").replace(
                tzinfo=UTC
            )
            i = (round(t.timestamp() * 1000) - eph.start_ms) // eph.step_ms
            az, el, _ = az_el(
                eph.positions_km[i, body_index[q["COMMAND"]]], lat_deg, lon_deg
            )
            lines.append(
                f" {t:%Y-%b-%d %H:%M:%S}.000, , ,"
                f"{(float(az) + AZ_OFFSET_DEG) % 360:.9f},{float(el) + ELEV_OFFSET_DEG:.9f},"
            )
        return _response("$$SOE\n" + "\n".join(lines) + "\n$$EOE\n")

    return fetch


def test_run_compares_every_site_epoch_and_body(tmp_path):
    inputs = golden.load_inputs()
    section = validate_horizons.run(
        inputs=inputs,
        cache_dir=tmp_path,
        fetch=_fake_horizons(inputs),
        throttle=lambda: None,
    )
    n = len(validate_horizons.SITE_IDS) * len(validate_horizons.epochs_utc_ms()) * 2
    assert section["summary"]["n"] == len(section["rows"]) == n
    assert {r["body"] for r in section["rows"]} == {"sun", "earth"}
    assert {r["siteId"] for r in section["rows"]} == set(validate_horizons.SITE_IDS)
    for row in section["rows"]:
        assert row["azErrDeg"] == pytest.approx(AZ_OFFSET_DEG, abs=1e-8)
        assert row["elevErrDeg"] == pytest.approx(abs(ELEV_OFFSET_DEG), abs=1e-8)
    assert section["summary"]["maxAzErrDeg"] == pytest.approx(AZ_OFFSET_DEG, abs=1e-8)


def test_run_output_matches_the_contract_row_shape(tmp_path):
    inputs = golden.load_inputs()
    section = validate_horizons.run(
        inputs=inputs,
        cache_dir=tmp_path,
        fetch=_fake_horizons(inputs),
        throttle=lambda: None,
    )
    assert set(section) == {"rows", "summary"}
    assert set(section["rows"][0]) == {
        "siteId",
        "tUtcMs",
        "body",
        "oursAzDeg",
        "oursElevDeg",
        "horizonsAzDeg",
        "horizonsElevDeg",
        "azErrDeg",
        "elevErrDeg",
    }
    json.dumps(section, allow_nan=False)


def test_run_rejects_a_response_for_other_times(tmp_path):
    inputs = golden.load_inputs()

    def wrong_times(url: str) -> dict:
        return _response(CANNED_RESULT)

    with pytest.raises(ValueError, match="times"):
        validate_horizons.run(
            inputs=inputs, cache_dir=tmp_path, fetch=wrong_times, throttle=lambda: None
        )


def test_result_without_ephemeris_block_raises_and_is_not_cached(tmp_path):
    # Horizons reports some problems inside "result" with HTTP 200 and no "error".
    params = validate_horizons.request_params(-85.0, 0.0, "sun", [MAR_1_06H_MS])

    def fetch(url: str) -> dict:
        return _response("Cannot interpret date. Type `?!` for help.")

    with pytest.raises(ValueError, match=r"\$\$SOE"):
        validate_horizons.query(params, tmp_path, fetch, throttle=lambda: None)
    assert list(tmp_path.iterdir()) == []


def test_truncated_cache_file_is_fetched_again(tmp_path):
    params = validate_horizons.request_params(-85.0, 0.0, "sun", [MAR_1_06H_MS])

    def fetch(url: str) -> dict:
        return _response(CANNED_RESULT)

    validate_horizons.query(params, tmp_path, fetch, throttle=lambda: None)
    (cached,) = tmp_path.glob("*.json")
    cached.write_text(cached.read_text()[:40])  # e.g. Ctrl-C mid-write
    result = validate_horizons.query(params, tmp_path, fetch, throttle=lambda: None)
    assert result == CANNED_RESULT
    assert json.loads(cached.read_text())["response"]["result"] == CANNED_RESULT


def test_http_error_keeps_the_horizons_message(monkeypatch):
    def urlopen(request, timeout):
        body = std_io.BytesIO(b'{"message": "Cannot read TLIST"}')
        raise urllib.error.HTTPError(request.full_url, 400, "Bad Request", {}, body)

    monkeypatch.setattr(validate_horizons.urllib.request, "urlopen", urlopen)
    with pytest.raises(RuntimeError, match="400.*Cannot read TLIST"):
        validate_horizons.fetch_json("https://example.invalid/api")


def test_run_defaults_follow_module_patches(monkeypatch, tmp_path):
    inputs = golden.load_inputs()
    monkeypatch.setattr(validate_horizons, "fetch_json", _fake_horizons(inputs))
    monkeypatch.setattr(validate_horizons, "CACHE_DIR", tmp_path)
    section = validate_horizons.run(inputs=inputs, throttle=lambda: None)
    assert section["summary"]["n"] > 0
    assert len(list(tmp_path.glob("*.json"))) == len(validate_horizons.SITE_IDS) * 2


def test_epoch_outside_ephemeris_coverage_raises_before_any_request(tmp_path):
    inputs = golden.load_inputs()
    short = dataclasses.replace(
        inputs.ephemeris, count=100, positions_km=inputs.ephemeris.positions_km[:100]
    )

    def offline(url: str) -> dict:
        raise AssertionError("request sent for an epoch we cannot compute")

    with pytest.raises(ValueError, match="coverage"):
        validate_horizons.run(
            inputs=dataclasses.replace(inputs, ephemeris=short),
            cache_dir=tmp_path,
            fetch=offline,
            throttle=lambda: None,
        )


@pytest.fixture(scope="module")
def shipped():
    return json.loads(io.VALIDATION_JSON.read_text(encoding="utf-8"))["horizons"]


def test_shipped_validation_meets_success_criterion_1(shipped):
    per_site_body = Counter((r["siteId"], r["body"]) for r in shipped["rows"])
    assert len({site for site, _ in per_site_body}) >= 5
    assert {body for _, body in per_site_body} == {"sun", "earth"}
    assert min(per_site_body.values()) >= 20
    assert shipped["summary"] == validate_horizons.summarize(shipped["rows"])
    assert shipped["summary"]["maxAzErrDeg"] <= MAX_ERR_DEG
    assert shipped["summary"]["maxElevErrDeg"] <= MAX_ERR_DEG


def test_shipped_validation_matches_current_ephemeris_and_sites(shipped):
    # Stale after ephemeris.bin or sites.json changes: re-run `lunarnav validate`.
    inputs = golden.load_inputs()
    sites = {s["id"]: s for s in inputs.sites["sites"]}
    for r in shipped["rows"]:
        site = sites[r["siteId"]]
        vec = golden.body_vectors_km(inputs.ephemeris, [r["tUtcMs"]])[0]
        az, el, _ = az_el(
            vec[validate_horizons.BODY_INDEX[r["body"]]], site["latDeg"], site["lonDeg"]
        )
        assert r["oursAzDeg"] == pytest.approx(float(az), abs=1e-9)
        assert r["oursElevDeg"] == pytest.approx(float(el), abs=1e-9)
