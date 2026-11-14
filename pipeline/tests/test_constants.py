from datetime import UTC, datetime

from lunarnav import constants


def test_ephemeris_count_matches_date_range():
    fmt = "%Y-%m-%dT%H:%M:%SZ"
    start = datetime.strptime(constants.EPHEMERIS_START_UTC, fmt).replace(tzinfo=UTC)
    end = datetime.strptime(constants.EPHEMERIS_END_UTC, fmt).replace(tzinfo=UTC)
    hours = (end - start).total_seconds() / constants.EPHEMERIS_STEP_S
    assert hours == constants.EPHEMERIS_COUNT


def test_site_bins_cover_full_circle():
    assert constants.SITE_AZ_BINS * constants.SITE_AZ_STEP_DEG == 360
