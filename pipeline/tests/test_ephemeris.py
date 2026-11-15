"""Contract/UTC tests run offline; kernel checks run when inputs are cached."""

import json
import sys
from contextlib import contextmanager
from datetime import datetime, timedelta
from itertools import pairwise
from types import SimpleNamespace
from unittest.mock import Mock

import numpy as np
import pytest

from lunarnav import cli, ephemeris, io
from lunarnav.constants import EPHEMERIS_COUNT


def test_utc_samples_cover_full_interval_including_leap_days():
    samples = ephemeris.utc_samples()
    assert len(samples) == 61368
    assert samples[0] == "2026-01-01T00:00:00Z"
    assert samples[-1] == "2032-12-31T23:00:00Z"
    times = [datetime.fromisoformat(utc) for utc in samples]
    assert all(b - a == timedelta(hours=1) for a, b in pairwise(times))
    assert "2028-02-29T00:00:00Z" in samples
    assert "2032-02-29T23:00:00Z" in samples


@pytest.fixture
def fake_spice(tmp_path, monkeypatch):
    """An isolated fake backend verifies calls without any kernel downloads."""
    raw_dir = tmp_path / "raw"
    kernel_dir = raw_dir / "kernels"
    kernel_dir.mkdir(parents=True)
    for name in ephemeris.KERNEL_NAMES:
        (kernel_dir / name).touch()
    state = {"active": False}

    @contextmanager
    def kernel_pool(paths):
        assert paths == [str(kernel_dir / name) for name in ephemeris.KERNEL_NAMES]
        state["active"] = True
        try:
            yield
        finally:
            state["active"] = False

    # Deliberately nonuniform ET values expose attempts to increment ET hourly.
    et_s = np.arange(EPHEMERIS_COUNT) * 3600.0
    et_s += np.sin(np.arange(EPHEMERIS_COUNT) / 1000)

    def str2et(samples):
        assert state["active"]
        assert samples == ephemeris.utc_samples()
        return et_s

    def spkpos(body, epochs_s, frame, abcorr, observer):
        assert state["active"]
        assert epochs_s is et_s
        assert (frame, abcorr, observer) == ("MOON_ME", "LT+S", "MOON")
        # Distinct components and time/body values catch transposition on disk.
        base_km = 149_000_000 if body == "SUN" else 380_000
        vectors_km = np.column_stack(
            (
                np.full(EPHEMERIS_COUNT, base_km),
                np.arange(EPHEMERIS_COUNT),
                -epochs_s / 1e5,
            )
        )
        return vectors_km, np.zeros(EPHEMERIS_COUNT)

    spice = SimpleNamespace(
        KernelPool=Mock(side_effect=kernel_pool),
        str2et=Mock(side_effect=str2et),
        spkpos=Mock(side_effect=spkpos),
    )
    monkeypatch.setitem(sys.modules, "spiceypy", spice)
    return raw_dir, spice, state


def test_writer_preserves_time_body_xyz_order_and_manifest(tmp_path, fake_spice):
    raw_dir, spice, state = fake_spice
    data_dir = tmp_path / "out"
    ephemeris.build_ephemeris(raw_dir, data_dir)
    assert not state["active"]
    assert [call.args[0] for call in spice.spkpos.call_args_list] == ["SUN", "EARTH"]
    binary = (data_dir / "ephemeris.bin").read_bytes()
    assert len(binary) == 61368 * 2 * 3 * 4
    positions_km = np.frombuffer(binary, dtype="<f4").reshape(61368, 2, 3)
    for i in (0, 1, 10000, 61367):
        et_s = i * 3600 + np.sin(i / 1000)
        np.testing.assert_array_equal(
            positions_km[i],
            np.array(
                [[149_000_000, i, -et_s / 1e5], [380_000, i, -et_s / 1e5]], dtype="<f4"
            ),
        )
    manifest = json.loads((data_dir / "ephemeris.json").read_text())
    assert manifest == {
        "schemaVersion": 1,
        "frame": "MOON_ME",
        "abcorr": "LT+S",
        "observer": "MOON",
        "startUtc": "2026-01-01T00:00:00Z",
        "stepS": 3600,
        "count": 61368,
        "bodies": ["sun", "earth"],
        "units": "km",
        "dtype": "float32-le",
        "layout": "[t][body][xyz]",
        "kernels": [
            "naif0012.tls",
            "de440s.bsp",
            "moon_pa_de440_200625.bpc",
            "moon_de440_250416.tf",
            "pck00011.tpc",
        ],
    }


def test_missing_kernel_fails_before_spice_or_writes(tmp_path, fake_spice):
    raw_dir, spice, _ = fake_spice
    (raw_dir / "kernels" / "de440s.bsp").unlink()
    with pytest.raises(FileNotFoundError, match="lunarnav fetch"):
        ephemeris.build_ephemeris(raw_dir, tmp_path / "out")
    spice.KernelPool.assert_not_called()
    assert not (tmp_path / "out").exists()


def test_spice_failure_releases_kernels_and_preserves_outputs(tmp_path, fake_spice):
    raw_dir, spice, state = fake_spice
    data_dir = tmp_path / "out"
    data_dir.mkdir()
    (data_dir / "ephemeris.bin").write_bytes(b"previous data")
    (data_dir / "ephemeris.json").write_text("previous manifest")
    spice.spkpos.side_effect = RuntimeError("Insufficient ephemeris coverage")
    with pytest.raises(RuntimeError, match="coverage"):
        ephemeris.build_ephemeris(raw_dir, data_dir)
    assert not state["active"]
    assert (data_dir / "ephemeris.bin").read_bytes() == b"previous data"
    assert (data_dir / "ephemeris.json").read_text() == "previous manifest"


@pytest.mark.parametrize("bad_value", [np.nan, np.inf])
def test_nonfinite_spice_output_is_rejected(tmp_path, fake_spice, bad_value):
    raw_dir, spice, state = fake_spice
    spice.spkpos.side_effect = None
    spice.spkpos.return_value = (np.full((EPHEMERIS_COUNT, 3), bad_value), 0)
    with pytest.raises(ValueError, match="nonfinite"):
        ephemeris.build_ephemeris(raw_dir, tmp_path / "out")
    assert not state["active"]
    assert not (tmp_path / "out").exists()


def test_ephemeris_cli_dispatch_and_main(monkeypatch):
    build = Mock()
    monkeypatch.setattr(ephemeris, "build_ephemeris", build)
    cli.main(["ephemeris"])
    build.assert_called_once_with()


def test_build_all_runs_ephemeris_before_other_steps(monkeypatch):
    build = Mock()
    monkeypatch.setattr(ephemeris, "build_ephemeris", build)
    with pytest.raises(NotImplementedError):
        cli.main(["build-all"])
    build.assert_called_once_with()


def test_committed_ephemeris_shape_ranges_and_manifest():
    manifest = json.loads(io.EPHEMERIS_JSON.read_text())
    assert manifest["count"] == 61368
    assert manifest["bodies"] == ["sun", "earth"]
    assert manifest["frame"] == "MOON_ME"
    assert manifest["abcorr"] == "LT+S"
    assert manifest["kernels"] == list(ephemeris.KERNEL_NAMES)
    assert io.EPHEMERIS_BIN.stat().st_size == 61368 * 2 * 3 * 4
    positions_km = np.fromfile(io.EPHEMERIS_BIN, dtype="<f4").reshape(61368, 2, 3)
    assert np.all(np.isfinite(positions_km))
    dist_km = np.linalg.norm(positions_km.astype(float), axis=-1)
    # SPEC-data-pipeline §1 gives an approximate SPOT check, rounded to 1e6 km.
    # The Moon's orbital displacement makes strict all-sample bounds incorrect.
    assert 1.47e8 <= dist_km[0, 0] <= 1.52e8
    # Full extrema independently checked with LT+S in inertial J2000, at
    # 2027-01-07T16:00Z and 2028-07-06T21:00Z. Float32 xyz quantization can
    # change a solar range by up to ~14 km; keep a tight 16 km regression bound.
    np.testing.assert_allclose(
        [dist_km[:, 0].min(), dist_km[:, 0].max()],
        [146_705_234.05007005, 152_485_059.02563408],
        rtol=0,
        atol=16,
    )
    assert np.all((dist_km[:, 1] >= 356e3) & (dist_km[:, 1] <= 407e3))


@pytest.mark.skipif(
    not all(
        (io.RAW_DIR / "kernels" / name).exists() for name in ephemeris.KERNEL_NAMES
    ),
    reason="Run lunarnav fetch first",
)
def test_real_kernel_spot_checks_and_float32_precision():
    import spiceypy as spice

    positions_km = np.fromfile(io.EPHEMERIS_BIN, dtype="<f4").reshape(61368, 2, 3)
    samples = ephemeris.utc_samples()
    paths = [str(io.RAW_DIR / "kernels" / name) for name in ephemeris.KERNEL_NAMES]
    with spice.KernelPool(paths):
        for index in (0, 8920, 22029, 24 * 789, 24 * 1520, 61367):
            et_s = spice.str2et(samples[index])
            for body_index, body in enumerate(("SUN", "EARTH")):
                expected_km, _ = spice.spkpos(body, et_s, "MOON_ME", "LT+S", "MOON")
                # Independently evaluate the inertial vector and rotate it at
                # the observer epoch; its range must be frame invariant.
                inertial_km, _ = spice.spkpos(body, et_s, "J2000", "LT+S", "MOON")
                rotation = spice.pxform("J2000", "MOON_ME", et_s)
                np.testing.assert_allclose(
                    expected_km, rotation @ inertial_km, rtol=0, atol=1e-6
                )
                np.testing.assert_array_equal(
                    positions_km[index, body_index], expected_km.astype("<f4")
                )
                # At float32 precision, direction error must stay far below 1e-3 deg.
                actual_km = positions_km[index, body_index].astype(float)
                angle_deg = np.rad2deg(
                    np.arctan2(
                        np.linalg.norm(np.cross(actual_km, expected_km)),
                        np.dot(actual_km, expected_km),
                    )
                )
                assert angle_deg < 1e-5
