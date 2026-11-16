# Spec: Lunar Landing Site Navigator — V1 (Hackathon MVP)

> This is the top-level spec: objective, module map, **data contract**, shared conventions, and project-wide success criteria.
> Module details live in `SPEC-data-pipeline.md`, `SPEC-engine.md`, `SPEC-app.md`.
> Why we chose this direction (ideas considered, what we dropped): [`docs/ideas/lunar-landing-site-navigator.md`](docs/ideas/lunar-landing-site-navigator.md).

## Objective

**How might we** let a mission planner go from *"the launch slipped 3 weeks"* to *"here is the best site/date now, and why"* in under a minute?

**User:** lunar mission planners (CLPS / Artemis / international) evaluating south-pole landing sites (84–90°S; curated Artemis III regions may sit to 83.5°S, while the grid and map stay 84–90°S). Not targeting educators or the public in V1.

**Core job:** compare 2–3 candidate sites across a mission window, see how a date slip changes **power (Sun)** and **direct-to-Earth comms (Earth)**, and understand *why* (terrain horizon), using numbers checked against NASA/JPL references.

**What makes it different from Quickmap / Moon Trek / Horizons:** these give one query or one long-term average at a time. We give date-specific, terrain-aware Sun and Earth answers for many sites at once. Everything is precomputed, so the slip slider updates live, and every number is checked against JPL Horizons and NASA PGDA products.

### User stories
1. As a planner, I pick up to 3 sites (from the curated list, a map click, or lat/lon) and a landing date and mission duration, and I see sunlit %, Earth-link %, longest blackouts, slope, and time to the next sunset or Earthset.
2. As a planner, I drag a **slip slider** (−30…+90 days) and every metric, timeline and view updates live, with the change from the original date shown.
3. As a planner, I see a **horizon panorama** for a site: the terrain silhouette with Sun and Earth tracks, so I can see which ridge causes a blackout and when. A **3D Terrain** tab shows the south pole with live terrain-aware shadows, and a first-person **Surface** tab shows the Sun and Earth sinking behind the real ridge.
4. As a planner, I pick a date window and see an **opportunity map** of the south pole colored by how viable a mission would be, then click a hot spot to evaluate it.
5. As a planner, I can open a **validation panel** showing how our numbers compare with JPL Horizons and PGDA, so I can trust them.

## Module Map (approved)

| Module id | Responsibility | Depends on |
|---|---|---|
| `data-pipeline` | Offline Python. SPICE ephemeris; LOLA → horizon masks (curated sites + 2 km grid); PGDA averages + slope; site catalog; validation reports; golden test vectors | — |
| `engine` | Pure TypeScript. Az/el, disk visibility, windows/events, mission metrics, grid scoring | data contract (below) |
| `app` | React UI. Site picker, scenario controls, metrics/compare, timeline, panorama, opportunity map, validation panel | `engine` |

**Build order:** data contract frozen at hour 0 → all three modules build **in parallel** against small fixture files → real data swapped in when the pipeline lands.

## Tech Stack

| Area | Choice |
|---|---|
| Pipeline | Python 3.12, `uv`, `spiceypy`, `numpy`, `numba`, `rasterio`, `pyproj`, `pytest`, `ruff` |
| Web | Vite, React 18, TypeScript (strict), D3 (SVG timeline/panorama), Canvas 2D (map), Web Workers, Vitest, ESLint |
| 3D views | `three`, `@react-three/fiber`, `@react-three/drei` (exact pins, lazy-loaded chunk; no postprocessing). Drawing only: the engine never depends on them. |
| Hosting | Vercel (static). **No backend.** |
| Data | Generated files committed under `web/public/data/` (~15 MB). Raw DEMs and kernels are gitignored. |

## Data Contract (shared by all modules: change only with team agreement)

All files live in `web/public/data/`. Version field `schemaVersion: 1` in every manifest.

### Conventions
- **Frame:** `MOON_ME` (Mean Earth/polar axis), the frame used by LOLA and Horizons. Planetocentric lat/lon; longitude east-positive, −180…180.
- **Reference sphere:** R = 1737.4 km. LOLA heights are relative to this sphere.
- **Time:** UTC, stored and passed as Unix ms (`tUtcMs`). The pipeline does the UTC↔ET conversion with the leapseconds kernel.
- **Azimuth:** degrees clockwise from local north (toward increasing latitude), 0–360, same convention as Horizons. **Elevation:** degrees above the local spherical horizontal plane.
- **Units in names**: `elevDeg`, `distKm`, `durationH`, `tUtcMs`, `heightM`.

### `ephemeris.json` + `ephemeris.bin`
```json
{ "schemaVersion": 1, "frame": "MOON_ME", "abcorr": "LT+S", "observer": "MOON",
  "startUtc": "2026-01-01T00:00:00Z", "stepS": 3600, "count": 61368,
  "bodies": ["sun", "earth"], "units": "km", "dtype": "float32-le",
  "layout": "[t][body][xyz]", "kernels": ["naif0012.tls", "de440.bsp", "..."] }
```
`.bin`: `count × 2 × 3` little-endian float32, the position of each body relative to the Moon's center in MOON_ME. Covers 2026-01-01 to 2033-01-01 (exclusive), ~1.5 MB.

### `sites.json`
```json
{ "schemaVersion": 1, "azStepDeg": 0.5, "heightsM": [2, 10],
  "dems": [{ "file": "LDEM_80S_80M", "role": "near field", "resolutionM": 80 },
           { "file": "LDEM_75S_240M", "role": "far field", "resolutionM": 240 }],
  "sites": [{
    "id": "mons-mouton-im2", "name": "IM-2 Athena (Mons Mouton)",
    "category": "clps",            // artemis3-region | clps | international | reference
    "latDeg": -84.79, "lonDeg": 29.20, "surfaceHeightM": 0,
    "slopeDeg": 0, "coordSource": "url or citation",
    "pgdaAvgSunPct": 0, "pgdaAvgEarthPct": 0,
    "horizonElevDeg": { "2": [720 numbers], "10": [720 numbers] }
  }]
}
```
`horizonElevDeg[h][i]` is the terrain horizon elevation at azimuth `i × 0.5°` for an observer `h` metres above the surface.

`dems` lists the LOLA DEMs the horizon masks were built from, near field first (`file` is the product name without extension). The pipeline writes it from the rasters it actually read. `grid.json` carries the same list.

### `grid.json` + `grid-horizons.bin` (lazy-loaded)
```json
{ "schemaVersion": 1, "projection": "polar-stereographic-south", "sphereRadiusKm": 1737.4,
  "originKm": [-182, -182], "cellKm": 2, "nx": 182, "ny": 182,
  "azBins": 360, "heightM": 2, "dtype": "uint8",
  "encoding": "elevDeg = v * 0.1 - 5.0; 255 = no data",
  "cellSurfaceHeightM": "grid-heights.bin (int16-le, row-major)",
  "dems": [{ "file": "LDEM_80S_80M", "role": "near field", "resolutionM": 80 },
           { "file": "LDEM_75S_240M", "role": "far field", "resolutionM": 240 }] }
```
`.bin`: `ny × nx × 360` uint8, row-major (y outer, x inner), cell centers. ~12 MB.

### `pgda-sun.png`, `pgda-earth.png` + `pgda-layers.json`
Long-term average visibility rasters from PGDA product 69, reprojected to the same grid extent (8-bit grayscale = %), used as the map's v0 layer.

### Display assets (additive; drawing only, not part of the shared contract above)
`terrain-display.bin` + `terrain-display.json`: a 1024×1024 height map of the grid's square (extent and origin taken from `grid.json`, so cell = `nx · cellKm / 1024` ≈ 355.5 m), averaged from 4×4 samples of `LDEM_80S_80M` per cell (far-field fallback as in the grid). `int16-le` metres above the reference sphere, row-major `iy · nx + ix`, `iy = 0` = lowest y, same projection and origin as `grid.json`. The manifest lists the source `dems` like `grid.json`. Written by `lunarnav display-terrain` (not part of `build-all`). The 3D views use it for the *look* of the terrain only: the engine never reads it, and every visibility number still comes from `grid-horizons.bin` and the site masks. Checked against `grid-heights.bin` at the 2 km cell centres: median |Δ| ≤ 50 m, p95 ≤ 250 m. The UI labels it "display terrain, not used for visibility".

`web/public/textures/moon-color-2k.jpg` (447 kB, NASA SVS "CGI Moon Kit" colour map, public domain; credit in `textures/CREDITS.txt`): the globe of the intro fly-in. Decorative only, fetched after first paint by the lazy intro chunk; no engine or UI number depends on it.

### `validation.json`
Ephemeris comparison with Horizons (per site/epoch/body, with error) and comparison of our long-term averages with PGDA (per site), plus summary statistics. The app renders this file and never computes accuracy claims itself.

The file also carries what the panel needs to give a verdict and state the method, so the app hardcodes neither:
- `horizons.summary.targetMaxErrDeg` (0.02): pass when both `maxAzErrDeg` and `maxElevErrDeg` are ≤ it (criterion 1).
- `pgda.summary.targetFractionWithin` (0.8): pass when `sitesWithinThreshold / sitesTotal` ≥ it (criterion 2).
- `pgda.method`: `observerHeightM` (0, or `null` if unknown; an assumption, see `notes`), `sensitivityHeightsM` ([2, 10]), `sunDefinition`, `earthDefinition`, `pgdaDefinition`, `sampling`, `claimLabel` (the only wording under which the ±5 pp result may be stated) and `notes` (limits on claims, from #57).

These fields are optional for readers: a file without them renders its numbers with no verdict and no method.

### `fixtures/golden.json` (test-only, in `shared/fixtures/`)
Python-generated input→output vectors (az/el, visible fraction, metrics) that the TS engine must reproduce.
`inputs` fingerprints the contract files it was generated from: `{ "ephemerisBinSha256", "ephemerisJsonSha256", "sitesJsonSha256" }`, lowercase hex SHA-256. The `.bin` is hashed as raw bytes; the JSON files (UTF-8) are hashed with CRLF normalized to LF, so Windows (`core.autocrlf`) and CI checkouts agree. `golden.test.ts` checks it first: on a mismatch it fails with "golden.json is stale … `uv run lunarnav golden`" instead of reporting parity errors.

## Commands

```bash
# Pipeline
cd pipeline && uv sync
uv run lunarnav fetch            # download SPICE kernels + LOLA DEMs + PGDA rasters → pipeline/data/raw/
uv run lunarnav build-all        # ephemeris, site horizons, grid horizons, pgda layers → web/public/data/
uv run lunarnav display-terrain  # → web/public/data/terrain-display.* (3D view only)
uv run lunarnav validate         # → web/public/data/validation.json
uv run lunarnav golden           # → shared/fixtures/golden.json
uv run pytest
uv run ruff check . && uv run ruff format --check .

# Web
cd web && npm install
npm run dev                      # Vite dev server
npm run build                    # typecheck + production build
npm test                         # vitest run
npm run lint
```

## Project Structure

```
SPEC.md, SPEC-*.md          → specs (source of truth)
pipeline/                   → Python package `lunarnav` (uv project)
  src/lunarnav/             → kernels, ephemeris, dem, horizon, grid, sites, pgda, validate, export, cli
  sites.yaml                → curated site list (hand-edited source of truth, with citations)
  tests/
  data/raw/                 → downloaded DEMs/kernels (gitignored)
web/                        → Vite React app
  src/engine/               → pure TS engine (NO React/DOM imports)
  src/app/                  → components, views, state
  src/workers/              → grid scoring worker
  public/data/              → generated data (committed)
shared/fixtures/            → golden cross-language test vectors
docs/                       → demo script, methods notes
```

## Code Style

TypeScript: pure functions, explicit units in every name, no classes in the engine, degrees at public boundaries.
```ts
export interface AzEl { azDeg: number; elevDeg: number; distKm: number }

/** Fraction (0–1) of a body's disk above a locally flat terrain horizon. */
export function visibleDiskFraction(centerElevDeg: number, horizonElevDeg: number, radiusDeg: number): number {
  const d = (centerElevDeg - horizonElevDeg) / radiusDeg; // center height above horizon, in radii
  if (d >= 1) return 1;
  if (d <= -1) return 0;
  const hidden = Math.acos(d) - d * Math.sqrt(1 - d * d); // segment area / r²
  return 1 - hidden / Math.PI;
}
```
Python: typed functions, numpy vectorized, numba only for the horizon ray-march hot loop, `ruff` defaults.
```python
def site_vector_km(lat_deg: float, lon_deg: float, height_m: float) -> np.ndarray:
    """Site position in MOON_ME (km) on the 1737.4 km reference sphere."""
    r_km = MOON_RADIUS_KM + height_m / 1000.0
    lat, lon = np.radians(lat_deg), np.radians(lon_deg)
    return r_km * np.array([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)])
```
Naming: kebab-case files in web (`timeline-strip.tsx`), snake_case in Python, site ids kebab-case and stable.

## Testing Strategy

| Level | Tool | What |
|---|---|---|
| Pipeline unit | pytest | geometry helpers, ray-march on synthetic DEMs (flat plane → horizon = −dip angle; single cone → known elevation), encoding round-trip |
| Pipeline validation | `lunarnav validate` | Horizons and PGDA comparisons (see Success Criteria) |
| Engine unit | Vitest | `shared/fixtures/golden.json` parity, edge cases (grazing Sun, wrap at az 360, pole) |
| App | Vitest + Testing Library (light) | metrics rendering and slip deltas for one fixture scenario; no E2E suite in V1 |
| Manual | checklist in `docs/demo.md` | demo flow end-to-end on the deployed Vercel URL |

Coverage target: the engine has tests for every exported function. No overall % target.

## Boundaries

- **Always:** put units in identifiers; keep `src/engine` pure (no React/DOM/fetch); regenerate `golden.json` when pipeline math changes; label modelling assumptions in the UI ("geometric DTE", "terrain: LOLA 80 m", "2 m observer"); run tests before pushing to `main`; cite a source for every curated site coordinate.
- **Ask first:** changing the data contract; adding dependencies not listed above; pulling anything from Deferred into V1; changing the date range or grid extent.
- **Never:** commit raw DEMs, kernels or anything over 25 MB; call Horizons or any external API at runtime; show smooth-sphere (no-terrain) results as terrain-aware; put an accuracy number in the UI that `validation.json` doesn't contain; commit secrets.

## Success Criteria (V1 is done when…)

1. **Ephemeris validity:** max Sun and Earth az/el error vs Horizons ≤ **0.02°** across ≥ 5 sites × ≥ 20 epochs (geometry only, no terrain).
2. **Terrain validity:** our long-term average Sun and Earth visibility per curated site, under the PGDA any-disc definition (a body is visible when any part of its disc clears the terrain horizon) at surface level (0 m, an unconfirmed working assumption, #57), is within **±5 percentage points** of PGDA product 69 for ≥ 80% of sites; outliers are listed with explanations in the validation panel. Stated only as "agreement with PGDA under the any-disc definition, surface level assumed", never as accuracy against truth or "height-matched".
3. **Cross-language parity:** the TS engine matches `golden.json` to ≤ 1e-3° (az/el) and ≤ 1e-3 (fraction); metric durations match to ≤ 10 min.
4. **Speed of use:** a teammate who hasn't seen the app compares 2 sites for a given date and states sunlit %, Earth-link %, and time to sunset in **≤ 30 s**.
5. **Live slip:** dragging the slip slider updates 3 sites × 30-day mission (metrics + timelines + panorama) in **≤ 33 ms per update** on a 2020+ laptop.
6. **Opportunity map:** a 30-day window heatmap over the full grid computes in **≤ 3 s** in a Web Worker without blocking the UI.
7. **Load:** first paint ≤ 3 MB; terrain/grid files stream after first paint with a visible loading state; interactive ≤ 3 s on broadband.
8. **Demo scenario:** `docs/demo.md` documents one real slip example (sites, dates, before/after numbers) that the deployed app reproduces.
9. **Shipped:** deployed on Vercel; README has setup + run steps.

## Out of Scope (Deferred, V2 backlog)

- Power model (vertical panels, panel azimuth, battery state of charge): needs hardware assumptions; next after V1.
- Auto-suggest alternate sites/dates after a slip: needs ranking UX; builds on the grid scoring.
- AI mission copilot (natural language → ranked options): garnish; only on top of a working engine.
- PDF/decision-brief export: coordination nicety.
- In-browser DEM horizon for arbitrary points: V1 snaps to the nearest 2 km grid cell instead.
- Finer or peak-aware grid horizons (e.g. 1 km inside 88°S, or highest-point-in-cell sampling): the 2 km cell-center grid differs from site-level masks by 1–6° at rim/peak sites (median over 9 of 12 curated sites, #76). V1 labels grid-derived results "grid-approximate (2 km)" and always uses `sites.json` masks for curated sites. Any fix is a `grid.json` data-contract change.
- DSN station visibility, link budgets, multipath models: V1 uses "geometric DTE + elevation margin".
- Coverage beyond 84–90°S, far side, equatorial/Apollo sites.
- Educator/public mode, accounts, saved scenarios server-side.

## Open Questions

1. ~~**Artemis III region coordinates:** regions are areas, not points. Which representative point per region?~~ **Resolved (#69):** each point is the geometric center of the region's USGS 1 km navigation grid ([doi:10.5066/P1MEQ6UK](https://doi.org/10.5066/P1MEQ6UK)), not the best-lit point. Artemis regions may sit to 83.5°S. See `pipeline/sites.yaml`.
2. **PGDA observer height:** PGDA product 69 does not document its observer height. *Dispositioned, not confirmed (#57):* surface level (0 m) is the working assumption (from Mazarico et al. 2011, for the 2010 maps), with our 2 m and 10 m heights as sensitivity runs only. Revisit if the comparison is inconclusive. Gates Checkpoint 1 (#42) only as a labelled, conditional result.
3. ~~**Chang'e-7 target:** do we have a citable coordinate? If not, leave it out.~~ **Resolved (#69):** left out; no citable target coordinate.
4. ~~**Exact DEM products:** confirm file names/resolutions.~~ **Resolved (#58):** `LDEM_80S_80M` (80 m, 80–90°S near field) and `LDEM_75S_240M` (240 m, to 75°S far field). See `pipeline/DATA_SOURCES.md`.
5. **Hackathon deliverables:** confirm the required format (video length, demo link, slides) so `docs/demo.md` matches.
