"""Schema checks for the hand-edited site catalog (SPEC-data-pipeline.md section 3)."""

import re
from pathlib import Path

import pytest
import yaml

from lunarnav.constants import MAX_ABS_LAT_DEG

SITES_YAML = Path(__file__).resolve().parents[1] / "sites.yaml"

REQUIRED_KEYS = {"id", "name", "category", "latDeg", "lonDeg", "coordSource"}
CATEGORIES = {"artemis3-region", "clps", "international", "reference"}
KEBAB_ID = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
# Project scope: the +/-182 km polar grid (182 x 182 cells, 2 km) ends at ~84 S.
NORTHMOST_LAT_DEG = -84.0
# Artemis III regions only (#5): 250 km horizon rays must stay inside the 75 S DEM.
ARTEMIS_REGION_MAX_LAT_DEG = -83.5


def _load_sites() -> list[dict]:
    doc = yaml.safe_load(SITES_YAML.read_text(encoding="utf-8"))
    assert isinstance(doc, dict) and isinstance(doc.get("sites"), list), (
        "sites.yaml must be a mapping with a 'sites' list"
    )
    return doc["sites"]


SITES = _load_sites()


def test_catalog_is_not_empty():
    assert SITES


def test_ids_are_unique():
    ids = [s["id"] for s in SITES]
    assert len(ids) == len(set(ids))


@pytest.mark.parametrize("site", SITES, ids=lambda s: str(s.get("id")))
def test_site_has_exactly_the_contract_keys(site):
    assert set(site) == REQUIRED_KEYS


@pytest.mark.parametrize("site", SITES, ids=lambda s: str(s.get("id")))
def test_site_field_values(site):
    assert KEBAB_ID.match(site["id"]), f"id must be kebab-case: {site['id']!r}"
    assert isinstance(site["name"], str) and site["name"].strip()
    assert site["category"] in CATEGORIES

    lat, lon = site["latDeg"], site["lonDeg"]
    for value in (lat, lon):
        assert isinstance(value, int | float) and not isinstance(value, bool)
    northmost = (
        ARTEMIS_REGION_MAX_LAT_DEG
        if site["category"] == "artemis3-region"
        else NORTHMOST_LAT_DEG
    )
    assert -MAX_ABS_LAT_DEG <= lat <= northmost, f"latDeg out of range: {lat}"
    assert -180.0 <= lon <= 180.0, f"lonDeg must be east-positive -180..180: {lon}"

    assert isinstance(site["coordSource"], str)
    assert site["coordSource"].startswith("https://"), "coordSource must be a URL"


def test_required_non_artemis_sites_present():
    ids = {s["id"] for s in SITES}
    assert {"mons-mouton-im2", "connecting-ridge", "shackleton-floor"} <= ids


@pytest.mark.parametrize(
    ("site_id", "lat_deg", "lon_deg"),
    [
        # Spot-checked against their sources on #5; guards against accidental edits.
        ("mons-mouton-im2", -84.79059, 29.19567),  # NAIF IM-2 frame kernel
        ("shackleton-floor", -89.67, 129.78),  # IAU Gazetteer 5450
        ("mons-mouton", -85.4218, 31.6755),  # USGS grid corner math (PR #5)
    ],
)
def test_spot_checked_coordinates(site_id, lat_deg, lon_deg):
    site = next(s for s in SITES if s["id"] == site_id)
    assert site["latDeg"] == pytest.approx(lat_deg, abs=1e-4)
    assert site["lonDeg"] == pytest.approx(lon_deg, abs=1e-4)


def test_all_nine_artemis_regions_present():
    artemis = {s["id"] for s in SITES if s["category"] == "artemis3-region"}
    assert artemis == {
        "peak-near-cabeus-b",
        "haworth",
        "malapert-massif",
        "mons-mouton-plateau",
        "mons-mouton",
        "nobile-rim-1",
        "nobile-rim-2",
        "de-gerlache-rim-2",
        "slater-plain",
    }
