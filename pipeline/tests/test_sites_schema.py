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
# DEM coverage starts at 84 S; nothing north of it (SPEC-data-pipeline.md section 3).
NORTHMOST_LAT_DEG = -84.0


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
    assert isinstance(lat, float) and isinstance(lon, float)
    assert -MAX_ABS_LAT_DEG <= lat <= NORTHMOST_LAT_DEG, f"latDeg out of range: {lat}"
    assert -180.0 <= lon < 180.0, f"lonDeg must be east-positive -180..180: {lon}"

    assert isinstance(site["coordSource"], str)
    assert site["coordSource"].startswith("https://"), "coordSource must be a URL"


def test_required_non_artemis_sites_present():
    ids = {s["id"] for s in SITES}
    assert {"mons-mouton-im2", "connecting-ridge", "shackleton-floor"} <= ids


def test_artemis_regions_inside_scope_are_all_present():
    # Peak near Cabeus B and Nobile Rim 2 lie north of 84 S and are excluded by design.
    artemis = {s["id"] for s in SITES if s["category"] == "artemis3-region"}
    assert artemis == {
        "haworth",
        "malapert-massif",
        "mons-mouton",
        "mons-mouton-plateau",
        "nobile-rim-1",
        "de-gerlache-rim-2",
        "slater-plain",
    }
