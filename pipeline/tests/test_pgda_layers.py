"""PGDA map layers: area-mean resampling, 8-bit encoding, PNG, and build."""

import struct
import zlib

import numpy as np
import pytest
import yaml

from lunarnav.constants import (
    GRID_CELL_KM,
    GRID_NO_DATA,
    GRID_NX,
    GRID_NY,
    GRID_ORIGIN_KM,
)
from lunarnav.dem import PdsRaster, lat_lon_to_xy_km
from lunarnav.fetch import RAW_DIR
from lunarnav.horizons_sites import SITES_YAML
from lunarnav.pgda_layers import (
    area_mean_fraction,
    build_layers,
    encode_pct_u8,
    layers_manifest,
    write_gray_png,
)


def write_visibility(tmp_path, data, cell_m=120):
    rows, cols = np.shape(data)
    np.asarray(data, dtype="<i2").tofile(tmp_path / "vis.IMG")
    label = tmp_path / "vis.LBL"
    label.write_text(f"""^IMAGE = "vis.IMG"
NAME = AVERAGE_VISIBILITY
LINES = {rows}
LINE_SAMPLES = {cols}
SAMPLE_TYPE = LSB_INTEGER
SAMPLE_BITS = 16
SCALING_FACTOR = 0.00004
OFFSET = 0.
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
MAXIMUM_LATITUDE = -75 <deg>
""")
    return PdsRaster(label)


def test_area_mean_of_constant_raster_is_that_constant(tmp_path):
    raster = write_visibility(tmp_path, np.full((100, 100), 10000))  # 0.4
    mean = area_mean_fraction(raster, (-2.0, -2.0), 2.0, nx=2, ny=2)
    assert mean.shape == (2, 2)
    np.testing.assert_allclose(mean, 0.4)


def test_area_mean_averages_inside_cell_not_at_center(tmp_path):
    # Left half of the raster (x < 0) is 0.2, right half is 0.8. A cell
    # straddling x = 0 averages both; a center sample would be one or the other.
    data = np.full((100, 100), 5000)
    data[:, 50:] = 20000
    raster = write_visibility(tmp_path, data)
    mean = area_mean_fraction(raster, (-1.0, -1.0), 2.0, nx=1, ny=1)
    assert mean[0, 0] == pytest.approx(0.5, abs=0.03)


def test_area_mean_marks_uncovered_cells_nan(tmp_path):
    raster = write_visibility(tmp_path, np.full((20, 20), 10000))  # 2.4 km square
    mean = area_mean_fraction(raster, (-6.0, -6.0), 2.0, nx=6, ny=6)
    assert np.isnan(mean[0, 0])
    assert np.isfinite(mean[3, 3])


def test_area_mean_cell_layout_matches_grid(tmp_path):
    # Row 0 is the lowest y, column 0 the lowest x, like grid-*.bin.
    data = np.zeros((100, 100), dtype=int)
    data[:50, :] = 25000  # image rows above the center are y > 0
    raster = write_visibility(tmp_path, data)
    mean = area_mean_fraction(raster, (-4.0, -4.0), 4.0, nx=2, ny=2)
    assert mean[1, 0] > 0.9 and mean[1, 1] > 0.9  # iy = 1 is y > 0
    assert mean[0, 0] < 0.1 and mean[0, 1] < 0.1


def test_encode_pct_rounds_clamps_and_flags_no_data():
    codes = encode_pct_u8(np.array([0.0, 0.2459, 0.5, 1.0, 1.004, np.nan]))
    np.testing.assert_array_equal(codes, [0, 25, 50, 100, 100, GRID_NO_DATA])
    assert codes.dtype == np.uint8


def decode_png(path):
    raw = path.read_bytes()
    assert raw[:8] == b"\x89PNG\r\n\x1a\n"
    pos, idat, header = 8, b"", None
    while pos < len(raw):
        length, kind = struct.unpack(">I4s", raw[pos : pos + 8])
        body = raw[pos + 8 : pos + 8 + length]
        crc = struct.unpack(">I", raw[pos + 8 + length : pos + 12 + length])[0]
        assert crc == zlib.crc32(kind + body)
        if kind == b"IHDR":
            header = struct.unpack(">IIBBBBB", body)
        elif kind == b"IDAT":
            idat += body
        pos += 12 + length
    width, height, depth, color, *_ = header
    assert (depth, color) == (8, 0)
    scan = np.frombuffer(zlib.decompress(idat), dtype=np.uint8)
    scan = scan.reshape(height, width + 1)
    assert np.all(scan[:, 0] == 0)  # filter type None
    return scan[:, 1:]


def test_png_round_trips_8bit_grayscale(tmp_path):
    pixels = np.arange(12, dtype=np.uint8).reshape(3, 4) * 20
    path = tmp_path / "a.png"
    write_gray_png(path, pixels)
    np.testing.assert_array_equal(decode_png(path), pixels)


def test_manifest_matches_grid_extent_and_states_limits():
    manifest = layers_manifest(2, 182, 182, (-182, -182))
    assert manifest["originKm"] == [-182, -182]
    assert (manifest["cellKm"], manifest["nx"], manifest["ny"]) == (2, 182, 182)
    assert manifest["layers"] == {"sun": "pgda-sun.png", "earth": "pgda-earth.png"}
    assert manifest["observerHeightM"] is None  # unknown until #57, never invented


def test_build_layers_encodes_both_rasters(tmp_path):
    sun = write_visibility(tmp_path, np.full((100, 100), 10000))  # 0.4
    sun_u8, earth_u8 = build_layers(sun, sun, 2.0, 2, 2, (-2.0, -2.0))
    np.testing.assert_array_equal(sun_u8, np.full((2, 2), 40))
    np.testing.assert_array_equal(earth_u8, sun_u8)


REAL = RAW_DIR / "pgda"
needs_pgda = pytest.mark.skipif(
    not (REAL / "AVGVISIB_75S_120M_201608.LBL").exists(), reason="Run lunarnav fetch"
)


@needs_pgda
@pytest.mark.parametrize(
    ("label", "key"),
    [
        ("AVGVISIB_75S_120M_201608", "sun"),
        ("AVGVISIB_75S_120M_201608_EARTH", "earth"),
    ],
)
def test_real_layer_matches_independent_cell_mean_at_curated_sites(label, key):
    raster = PdsRaster(REAL / f"{label}.LBL")
    sites = yaml.safe_load(SITES_YAML.read_text())["sites"]
    pixels = encode_pct_u8(
        area_mean_fraction(raster, GRID_ORIGIN_KM, GRID_CELL_KM, GRID_NX, GRID_NY)
    )
    assert not np.any(pixels == GRID_NO_DATA)
    for site in sites:
        x_km, y_km = (
            float(v) for v in lat_lon_to_xy_km(site["latDeg"], site["lonDeg"])
        )
        ix = int((x_km - GRID_ORIGIN_KM[0]) // GRID_CELL_KM)
        iy = int((y_km - GRID_ORIGIN_KM[1]) // GRID_CELL_KM)
        # Different lattice (40x40 = 50 m) than the build (16x16), same cell.
        fine = area_mean_fraction(
            raster,
            (
                GRID_ORIGIN_KM[0] + ix * GRID_CELL_KM,
                GRID_ORIGIN_KM[1] + iy * GRID_CELL_KM,
            ),
            GRID_CELL_KM,
            1,
            1,
            subsamples=40,
        )[0, 0]
        assert abs(int(pixels[iy, ix]) - fine * 100) <= 2, site["id"]
