"""Offline regression tests; real-data checks run after `lunarnav fetch`."""

import io
import json
from unittest.mock import patch

import numpy as np
import pytest

from lunarnav import fetch
from lunarnav.dem import DemStack, PdsRaster, lat_lon_to_xy_km, xy_km_to_lat_lon


def write_raster(tmp_path, stem, data, cell_m=80, max_lat_deg=-80):
    directory = tmp_path / "dem"
    directory.mkdir(exist_ok=True)
    np.asarray(data, dtype="<i2").tofile(directory / f"{stem}.IMG")
    rows, cols = np.shape(data)
    label = directory / f"{stem}.LBL"
    label.write_text(f'''^IMAGE = "{stem}.IMG"
NAME = HEIGHT
LINES = {rows}
LINE_SAMPLES = {cols}
SAMPLE_TYPE = LSB_INTEGER
SAMPLE_BITS = 16
SCALING_FACTOR = 0.5
OFFSET = 1737400.
MAP_PROJECTION_TYPE = "POLAR STEREOGRAPHIC"
KEYWORD_LATITUDE_TYPE = "PLANETOCENTRIC"
POSITIVE_LONGITUDE_DIRECTION = "EAST"
CENTER_LATITUDE = -90 <deg>
CENTER_LONGITUDE = 0 <deg>
MAP_PROJECTION_ROTATION = 0
A_AXIS_RADIUS = 1737.4 <km>
B_AXIS_RADIUS = 1737.4 <km>
C_AXIS_RADIUS = 1737.4 <km>
MAP_SCALE = {cell_m} <m/pix>
LINE_PROJECTION_OFFSET = {(rows - 1) / 2} <pix>
SAMPLE_PROJECTION_OFFSET = {(cols - 1) / 2} <pix>
MAXIMUM_LATITUDE = {max_lat_deg} <deg>
''')
    return label


def test_projection_cardinal_directions_and_round_trip():
    lat_deg = np.array([-84, -84, -84, -84, -89.45])
    lon_deg = np.array([0, 90, -180, -90, -137.3])
    x_km, y_km = lat_lon_to_xy_km(lat_deg, lon_deg)
    assert x_km[0] == 0
    assert y_km[0] > 0 and x_km[1] > 0 and y_km[2] < 0 and x_km[3] < 0
    got_lat, got_lon = xy_km_to_lat_lon(x_km, y_km)
    np.testing.assert_allclose(got_lat, lat_deg, atol=1e-12)
    np.testing.assert_allclose(got_lon, lon_deg, atol=1e-12)
    assert lat_lon_to_xy_km(-90, 80) == (0, 0)
    assert xy_km_to_lat_lon(0, 0) == (-90, 0)


@pytest.mark.parametrize("lat,lon", [(-91, 0), (1, 0), (np.nan, 0), (-85, np.inf)])
def test_projection_rejects_invalid_inputs(lat, lon):
    with pytest.raises(ValueError):
        lat_lon_to_xy_km(lat, lon)


def test_pixel_registration_scale_and_bilinear_interpolation(tmp_path):
    raster = PdsRaster(write_raster(tmp_path, "plane", [[0, 20], [40, 60]]))
    # Pole falls halfway between all four centers; OFFSET must not be added.
    assert raster.sample(0, 0) == 15
    np.testing.assert_allclose(raster.sample([-0.04, 0.04], [0.04, -0.04]), [0, 30])
    assert np.isnan(raster.sample(0.041, 0))
    assert not raster.data.flags.writeable


def test_stack_near_first_far_fallback_and_nodata(tmp_path):
    write_raster(tmp_path, "LDEM_80S_80M", [[200, 200], [200, -32768]])
    write_raster(tmp_path, "LDEM_75S_240M", np.full((4, 4), 400), cell_m=240)
    stack = DemStack(tmp_path)
    assert stack.height_m(-0.04, 0.04) == 100  # valid exact center next to nodata
    assert stack.height_m(0, 0) == 200  # near interpolation hits nodata
    assert stack.height_m(0.2, 0) == 200  # outside near, inside far
    assert np.isnan(stack.height_m(1, 0))
    result = stack.height_m([-0.04, 0, 0.2, 1], [0.04, 0, 0, 0])
    np.testing.assert_allclose(result, [100, 200, 200, np.nan])


def test_stack_records_the_dems_it_was_built_from(tmp_path):
    write_raster(tmp_path, "LDEM_80S_80M", np.zeros((2, 2)))
    write_raster(tmp_path, "LDEM_75S_240M", np.zeros((4, 4)), cell_m=240)
    assert DemStack(tmp_path).dems() == [
        {"file": "LDEM_80S_80M", "role": "near field", "resolutionM": 80},
        {"file": "LDEM_75S_240M", "role": "far field", "resolutionM": 240},
    ]


def test_stack_near_priority_and_latitude_coverage(tmp_path):
    write_raster(tmp_path, "LDEM_80S_80M", np.full((4, 4), 200), cell_m=300000)
    write_raster(
        tmp_path, "LDEM_75S_240M", np.full((4, 4), 400), cell_m=400000, max_lat_deg=-75
    )
    stack = DemStack(tmp_path)
    assert stack.height_m(0, 0) == 100
    assert stack.height_m(*lat_lon_to_xy_km(-78, 0)) == 200
    assert np.isnan(stack.height_m(*lat_lon_to_xy_km(-74, 0)))


def test_raster_rejects_truncation_and_wrong_projection(tmp_path):
    label = write_raster(tmp_path, "bad", np.zeros((2, 2)))
    label.with_suffix(".IMG").write_bytes(b"bad")
    with pytest.raises(ValueError, match="byte count"):
        PdsRaster(label)
    label = write_raster(tmp_path, "bad", np.zeros((2, 2)))
    label.write_text(label.read_text().replace("LSB_INTEGER", "MSB_INTEGER"))
    with pytest.raises(ValueError, match="SAMPLE_TYPE"):
        PdsRaster(label)


class Response(io.BytesIO):
    status = 200

    def __init__(self, data, length=None):
        super().__init__(data)
        self.headers = {"Content-Length": str(len(data) if length is None else length)}


def test_fetch_cache_is_offline_and_repairs_corruption(tmp_path, monkeypatch):
    source = fetch.Source("https://example.org/test.IMG", "dem/test.IMG", 4)
    monkeypatch.setattr(fetch, "SOURCES", (source,))
    with patch.object(fetch, "urlopen", return_value=Response(b"data")) as request:
        paths = fetch.fetch_all(tmp_path)
        request.assert_called_once()
    with patch.object(
        fetch, "urlopen", side_effect=AssertionError("Network on cache hit")
    ):
        assert fetch.fetch_all(tmp_path) == paths
    paths[0].write_bytes(b"oops")  # same length, different checksum
    with patch.object(fetch, "urlopen", return_value=Response(b"data")) as request:
        fetch.fetch_all(tmp_path)
        request.assert_called_once()
    manifest = json.loads((tmp_path / "sources.json").read_text())
    assert manifest[0]["sizeBytes"] == 4
    assert manifest[0]["url"] == source.url
    assert len(manifest[0]["sha256"]) == 64


@pytest.mark.parametrize("data,length", [(b"", 0), (b"bad", 4), (b"<html>error", 11)])
def test_failed_download_never_becomes_cache(tmp_path, data, length):
    source = fetch.Source("https://example.org/test", "test")
    with (
        patch.object(
            fetch, "urlopen", side_effect=lambda *a, **k: Response(data, length)
        ),
        patch.object(fetch.time, "sleep"),
        pytest.raises(ValueError),
    ):
        fetch.download(source, tmp_path)
    assert not (tmp_path / "test").exists()
    assert not (tmp_path / "test.part").exists()


@pytest.mark.skipif(
    not (fetch.RAW_DIR / "sources.json").exists(), reason="Run lunarnav fetch first"
)
def test_real_dem_pole_known_site_and_pgda():
    stack = DemStack()
    # Pole: independently decoded center DNs 2598,2571,2596,2564, scaled by .5.
    # These are regressions for the pinned products, not an accuracy claim.
    pole_m = stack.height_m(0, 0)
    ridge_m = stack.height_m(*lat_lon_to_xy_km(-89.45, -137.3))
    assert pole_m == 1291.125
    assert ridge_m == pytest.approx(1954.4999724365828, abs=0.01)
    assert np.isfinite(stack.height_m(*lat_lon_to_xy_km(-76, 20)))
    assert np.isnan(stack.height_m(*lat_lon_to_xy_km(-74, 20)))
    for name in ("AVGVISIB_75S_120M_201608", "AVGVISIB_75S_120M_201608_EARTH"):
        raster = PdsRaster(fetch.RAW_DIR / "pgda" / f"{name}.LBL")
        assert 0 <= raster.sample(0, 0) <= 1
