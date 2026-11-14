"""Shared constants. Values mirror the data contract in SPEC.md."""

MOON_RADIUS_KM = 1737.4
FRAME = "MOON_ME"
SCHEMA_VERSION = 1

# Ephemeris: hourly, 2026-01-01 to 2033-01-01 (exclusive).
EPHEMERIS_START_UTC = "2026-01-01T00:00:00Z"
EPHEMERIS_END_UTC = "2033-01-01T00:00:00Z"
EPHEMERIS_STEP_S = 3600
EPHEMERIS_COUNT = 61368

# Site horizons: 720 bins at 0.5 degrees, observer heights 2 m and 10 m.
SITE_AZ_STEP_DEG = 0.5
SITE_AZ_BINS = 720
SITE_HEIGHTS_M = (2, 10)

# Grid horizons: polar stereographic (south), 2 m observer.
GRID_CELL_KM = 2
GRID_NX = 182
GRID_NY = 182
GRID_ORIGIN_KM = (-182, -182)
GRID_AZ_BINS = 360
GRID_HEIGHT_M = 2
GRID_NO_DATA = 255

# Azimuth "north" is undefined at exactly -90 degrees.
MAX_ABS_LAT_DEG = 89.999
