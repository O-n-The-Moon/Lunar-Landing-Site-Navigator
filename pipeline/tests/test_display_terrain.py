import json

import numpy as np
import pytest

from lunarnav import display_terrain, fetch
from lunarnav.constants import GRID_CELL_KM, GRID_NX, GRID_ORIGIN_KM
from lunarnav.horizons_grid import cell_centers_km
from lunarnav.io import (
    GRID_HEIGHTS_BIN,
    GRID_JSON,
    TERRAIN_DISPLAY_BIN,
    TERRAIN_DISPLAY_JSON,
)

ORIGIN = (-8.0, -8.0)
CELL_KM = 1.0
N = 16
DEMS = [{"file": "NEAR", "role": "near field", "resolutionM": 80}]


class Flat:
    """Base for the fake terrains: they all report the same DEM list."""

    def dems(self):
        return DEMS


class Cone(Flat):
    """Height 1000 m at the apex, falling 100 m/km, floored at 0."""

    def __init__(self, apex_km):
        self.apex = apex_km

    def height_m(self, x_km, y_km):
        d = np.hypot(np.asarray(x_km) - self.apex[0], np.asarray(y_km) - self.apex[1])
        return np.maximum(0.0, 1000 - 100 * d)


class Ramp(Flat):
    """Height increases with map y only."""

    def height_m(self, x_km, y_km):
        return 10.0 * np.asarray(y_km) + 0 * np.asarray(x_km)


def test_shape_dtype_and_row_order_iy0_is_lowest_y():
    heights = display_terrain.build_display_terrain(Ramp(), ORIGIN, CELL_KM, N, N)
    assert heights.shape == (N, N)
    assert heights.dtype == np.int16
    assert np.all(np.diff(heights[:, 0].astype(int)) > 0)  # up with iy
    assert np.all(heights[0] == heights[0, 0])  # constant along x


def test_cone_apex_lands_in_the_right_cell():
    # Cell (ix, iy) is centered at origin + (i + 0.5) * cell.
    ix, iy = 11, 4
    apex = (ORIGIN[0] + (ix + 0.5) * CELL_KM, ORIGIN[1] + (iy + 0.5) * CELL_KM)
    heights = display_terrain.build_display_terrain(Cone(apex), ORIGIN, CELL_KM, N, N)
    assert np.unravel_index(np.argmax(heights), heights.shape) == (iy, ix)


def test_sub_samples_average_a_cell_instead_of_taking_the_center():
    # A linear ramp is unchanged by averaging symmetric sub-samples...
    ramp = display_terrain.build_display_terrain(Ramp(), ORIGIN, CELL_KM, N, N)
    _, yc = cell_centers_km(ORIGIN, CELL_KM, N, N)
    np.testing.assert_allclose(ramp, np.rint(10 * yc), atol=1)
    # ...but the cone apex is lowered below its center value (a peak averages down).
    apex = (ORIGIN[0] + 5.5, ORIGIN[1] + 5.5)
    cone = display_terrain.build_display_terrain(Cone(apex), ORIGIN, CELL_KM, N, N)
    assert cone[5, 5] < 1000


def test_missing_terrain_is_an_error_not_zero():
    class Hole(Ramp):
        def height_m(self, x_km, y_km):
            out = super().height_m(x_km, y_km)
            return np.where(np.asarray(x_km) > 5, np.nan, out)

    with pytest.raises(ValueError, match="Missing terrain"):
        display_terrain.build_display_terrain(Hole(), ORIGIN, CELL_KM, N, N)


def test_height_outside_int16_is_an_error():
    class Tall(Ramp):
        def height_m(self, x_km, y_km):
            return np.full(np.shape(x_km), 40_000.0)

    with pytest.raises(ValueError, match="int16"):
        display_terrain.build_display_terrain(Tall(), ORIGIN, CELL_KM, N, N)


def test_manifest_documents_the_display_only_contract():
    manifest = display_terrain.display_manifest(CELL_KM, N, N, ORIGIN, DEMS)
    assert manifest["nx"] == N and manifest["ny"] == N
    assert manifest["originKm"] == [-8.0, -8.0]
    assert manifest["cellKm"] == CELL_KM
    assert manifest["dtype"] == "int16-le"
    assert manifest["rowOrder"].startswith("row-major iy * nx + ix")
    assert manifest["dems"] == DEMS
    assert "never used for visibility" in manifest["note"]
    json.dumps(manifest)


def test_write_display_terrain_round_trips(tmp_path):
    paths = {"bin": tmp_path / "t.bin", "manifest": tmp_path / "t.json"}
    display_terrain.write_display_terrain(Ramp(), ORIGIN, CELL_KM, N, N, paths)
    raw = np.fromfile(paths["bin"], dtype="<i2").reshape(N, N)
    assert raw.shape == (N, N)
    manifest = json.loads(paths["manifest"].read_text())
    assert manifest["nx"] == N
    assert manifest["dems"] == DEMS


@pytest.mark.skipif(
    not (fetch.RAW_DIR / "sources.json").exists(), reason="Run lunarnav fetch first"
)
def test_real_display_terrain_matches_the_2km_grid_heights():
    from lunarnav.dem import DemStack

    if not GRID_HEIGHTS_BIN.exists():
        pytest.skip("grid-heights.bin not built")
    # A 256x256 render of the same square keeps the test fast; the acceptance
    # numbers are the same ones the full 1024x1024 run is held to.
    n = 256
    cell_km = GRID_NX * GRID_CELL_KM / n
    dt = display_terrain.build_display_terrain(
        DemStack(), GRID_ORIGIN_KM, cell_km, n, n
    )
    grid = np.fromfile(GRID_HEIGHTS_BIN, dtype="<i2").reshape(GRID_NX, GRID_NX)
    delta = display_terrain.compare_to_grid(dt, grid)
    assert np.median(delta) <= 50
    assert np.percentile(delta, 95) <= 250


def test_display_square_is_the_grid_square():
    assert display_terrain.DISPLAY_ORIGIN_KM == GRID_ORIGIN_KM
    assert display_terrain.DISPLAY_EXTENT_KM == GRID_NX * GRID_CELL_KM
    assert display_terrain.DISPLAY_CELL_KM * display_terrain.DISPLAY_N == (
        GRID_NX * GRID_CELL_KM
    )


def test_committed_display_terrain_matches_grid_heights():
    """Always on (no raw DEMs needed): the committed 1024^2 file vs the 2 km grid heights."""
    n = display_terrain.DISPLAY_N
    display = np.fromfile(TERRAIN_DISPLAY_BIN, dtype="<i2").reshape(n, n)
    grid = np.fromfile(GRID_HEIGHTS_BIN, dtype="<i2").reshape(GRID_NX, GRID_NX)
    delta = display_terrain.compare_to_grid(display, grid)
    assert np.median(delta) <= 50
    assert np.percentile(delta, 95) <= 250

    manifest = json.loads(TERRAIN_DISPLAY_JSON.read_text())
    grid_manifest = json.loads(GRID_JSON.read_text())
    assert manifest["nx"] == manifest["ny"] == n
    assert manifest["originKm"] == grid_manifest["originKm"]
    assert manifest["cellKm"] * n == grid_manifest["cellKm"] * grid_manifest["nx"]
    assert manifest["dems"] == grid_manifest["dems"]
