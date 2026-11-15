# Spec: `data-pipeline` — V1

> Module of `SPEC.md`. Inherits stack, conventions, data contract and boundaries from there; only additions are listed here.

## Objective

Produce every data file in the SPEC.md data contract, offline, with Python. These are the only source of physics truth for the app. Also produce the validation evidence (Horizons + PGDA) and golden test vectors so the TS engine can prove parity.

**Owner focus:** this module is the critical path. Horizon masks are the #1 project risk and are tackled first.

## Components

| CLI command | Module | Output |
|---|---|---|
| `lunarnav fetch` | `kernels.py`, `dem.py`, `pgda.py` | `pipeline/data/raw/…` (kernels, DEM GeoTIFFs, PGDA rasters) |
| `lunarnav ephemeris` | `ephemeris.py` | `ephemeris.json`, `ephemeris.bin` |
| `lunarnav horizons --sites` | `horizon.py`, `sites.py` | `sites.json` |
| `lunarnav horizons --grid` | `horizon.py`, `grid.py` | `grid.json`, `grid-horizons.bin`, `grid-heights.bin` |
| `lunarnav pgda` | `pgda.py` | `pgda-sun.png`, `pgda-earth.png`, `pgda-layers.json` |
| `lunarnav validate` | `validate.py` | `validation.json` |
| `lunarnav golden` | `export.py` | `shared/fixtures/golden.json` |
| `lunarnav build-all` | `cli.py` | runs ephemeris → sites → grid → pgda |

## Requirements

### 1. Ephemeris
- Kernels: `naif0012.tls`, `de440s.bsp` (or `de440.bsp`), `moon_pa_de440_*.bpc`, `moon_de440_*.tf`, `pck00011.tpc`. Confirm exact current filenames on NAIF in hour 0.
- `spkpos(body, et, "MOON_ME", "LT+S", "MOON")` for `SUN` and `EARTH`, hourly from 2026-01-01T00:00Z to 2033-01-01T00:00Z (exclusive).
- Times are UTC instants; convert with `str2et`/`utc2et`.
- **Accept:** file is 61,368 × 2 × 3 float32; spot check: Sun distance ≈ 1.47–1.52e8 km, Earth ≈ 356–407e3 km.

### 2. Horizon masks (critical)
- **DEMs:** LOLA polar stereographic. Near field from the ~80 m/px product covering 80–90°S, far field from the ~240 m/px product to 75°S. Heights are relative to the 1737.4 km sphere. Do **not** use the 5 m 87°S mosaic (3.3 GB, too small an area).
- **Algorithm (3D, handles curvature exactly):**
  1. Observer `P` = site vector at `R + surfaceHeight + observerHeight`; local ENU basis from the spherical normal.
  2. For each ray azimuth (0.25° spacing for sites, 0.5° for the grid), march outward on the projected plane with step `max(cellSize, 0.005 × distance)` out to **250 km**.
  3. At each sample `Q` (DEM height → 3D point): `elev = asin(dot(Q − P, up) / |Q − P|)`; `az` from the east/north components.
  4. Bin by the **computed true az** (not the nominal ray az), keeping the max elevation → 720 bins (sites) / 360 bins (grid). Fill empty bins by interpolating neighbors.
  5. If no terrain rises above the ellipsoid horizon, the result is the geometric dip angle (negative). That is correct and not clamped to 0.
- Hot loop in `numba` (`prange` over cells/rays).
- **Sites:** heights 2 m and 10 m. **Grid:** 2 m only, 182 × 182 cells at 2 km, cell centers, encoded per contract (uint8, 0.1°, offset −5°; values clamped; 255 = no data).
- **Budget:** grid build ≤ 60 min on a laptop. If it is slower, fall back to a 4 km grid (91 × 91) and update `grid.json`. The contract allows this because `cellKm`, `nx` and `ny` are read from the manifest.
- **Accept:** synthetic tests pass (flat sphere → dip angle within 0.01°; isolated cone of known height/distance → expected elevation within 0.05°); horizons for the curated sites look plausible on a quick matplotlib plot.

### 3. Sites catalog
- `pipeline/sites.yaml` is the hand-edited source: `id, name, category, latDeg, lonDeg, coordSource`. Each coordinate cites a source (NASA release, mission paper, PGDA).
- Pipeline fills in `surfaceHeightM` (DEM), `slopeDeg` (from DEM, 80 m baseline; label as such), `pgdaAvgSunPct`, `pgdaAvgEarthPct`, and horizon arrays.
- **V1 list (coordinates are placeholders until verified, see SPEC.md Open Q1/Q3):**
  - **artemis3-region:** Peak near Cabeus B, Haworth, Malapert Massif, Mons Mouton Plateau, Mons Mouton, Nobile Rim 1, Nobile Rim 2, de Gerlache Rim 2, Slater Plain
  - **clps:** IM-2 Athena landing site (≈84.79°S, 29.20°E, verify)
  - **reference:** Shackleton–de Gerlache connecting ridge (≈89.45°S, 137.3°W, verify); Shackleton crater floor (permanent-shadow contrast)
  - **international:** Chang'e-7 target, only if a citable coordinate exists
- Reject sites north of the DEM coverage (Chandrayaan-3 and Chang'e-6 excluded by design).

### 4. PGDA layers
- From PGDA product 69 (https://pgda.gsfc.nasa.gov/products/69): average Sun and Earth visibility (240 m or 120 m), reprojected/resampled onto the grid extent → 8-bit PNG (value = %), plus `pgda-layers.json` (extent, source, resolution, observer height if documented).

### 5. Validation (`validation.json`)
- **Horizons:** for ≥ 5 curated sites × ≥ 20 epochs spread over 2026–2032, query the Horizons API (pipeline-time only) with `CENTER='coord@301'`, `COORD_TYPE=GEODETIC`, `SITE_COORD='lon,lat,alt_km'`, `QUANTITIES='4'`, for Sun (`10`) and Earth (`399`). Cache responses in `pipeline/data/raw/horizons-cache/`. Compare with our az/el on the smooth sphere. Record per-row errors, max, and mean.
- **PGDA:** for each curated site, compute the long-term average Sun and Earth visibility over 18.6 years at a **1 h step** (Sun/Earth vectors computed directly from the SPICE kernels, not from the shipped 2026–2032 `ephemeris.bin`) using the PGDA definition: a body counts as visible when **any part of its disc** clears the terrain horizon mask (Sun elevation + 0.265°; Earth elevation + its actual angular radius, ≈ 0.95°). This is for validation only; app metrics (mean disk fraction, Earth center + margin) are unchanged. Compare with the PGDA pixel (bilinear at the site, plus the range over ±1–2 pixels at rim sites). Run at **0 m** (surface level) as the primary comparison, with the app's 2 m and 10 m site heights as sensitivity runs (not assumptions about PGDA). PGDA product 69's observer height is not documented; surface level is a working assumption from Mazarico et al. (2011) for the 2010 maps (see `pipeline/DATA_SOURCES.md`, SPEC.md Open Q2). Record the difference and an `explanation` field for outliers (> 5 pp). Report any ±5 pp result only as "agreement with PGDA under the any-disc definition, surface level assumed", never as accuracy against truth or as "height-matched".
- **Accept:** SPEC.md success criteria 1 and 2 (criterion 2 is read under the PGDA definition above until SPEC.md is updated).

### 6. Golden vectors (`shared/fixtures/golden.json`)
- ≥ 200 cases: random curated site × random time → `{sunAzDeg, sunElevDeg, earthAzDeg, earthElevDeg, sunHorizonDeg, sunFraction, earthVisible}`.
- 3 mission scenarios (site, start, 14 days): hourly sun/earth visibility series + totals, so the engine metrics can be checked.

## Testing
- `pytest`: geometry helpers, ENU basis, ray-march synthetic DEMs, uint8 encode/decode round trip, ephemeris file shape/ranges, sites.yaml schema.
- Validation runs as a command, not in CI (it needs the network and is slow).

## Boundaries (additions)
- **Always:** cache every downloaded file and every Horizons response; log kernel and DEM file names into manifests.
- **Never:** hit Horizons more than ~1 request/second; commit anything in `pipeline/data/raw/`.
