# Lunar Landing Site Navigator (South Pole)

Built for the [NASA Space Apps Challenge](https://www.spaceappschallenge.org/) by team **O(n) the Moon**.

**Launch slipped? See what it costs your landing site, and why.**

A web tool for mission planners that compares lunar south pole landing sites by **Sun visibility (power)** and **Earth visibility (direct-to-Earth comms)**, using real terrain. Drag the **slip slider** to move the landing date and watch every number update live.

**Live demo:** [Lunar Landing Site Navigator](https://lunar-landing-site-nav.vercel.app/)

## Why this exists

Near the lunar south pole the Sun and Earth sit within a few degrees of the horizon. A small terrain feature, or a two-week launch delay, can flip a site from "sunlit and in contact" to "dark and silent". Existing tools answer one query or one long-term average at a time. We give **date-specific, terrain-aware answers for several sites at once**, in under a minute.

## What you can do

- **Compare up to 3 sites** (Artemis III regions, IM-2 Athena, reference sites, or your own lat/lon) for any landing date and mission length.
- **Drag the slip slider** (−30 to +90 days) and see sunlit %, Earth-link %, longest blackouts and time to sunset change, with the delta from your original date.
- **See why** in the horizon panorama: the terrain skyline with the Sun and Earth tracks, so you can spot the ridge that causes a blackout.
- **Scan the whole pole** with the opportunity map for any date window.
- **3D Terrain and Surface views:** the south pole with live terrain-aware shadows, and a first-person view of the Sun sinking behind a ridge.
- **Check our work** in the validation panel (against JPL Horizons and NASA PGDA).

### Example

IM-2 Athena landing on 2030-10-04 gets **99.9%** Sun and Earth coverage. Slip the landing by 14 days and it drops to **0.0%**. More scenarios are in [`docs/demo.md`](docs/demo.md).

## How it works

```
pipeline/ (Python, offline)  ──▶  web/public/data/  ──▶  web/src/engine (pure TS)  ──▶  web/src/app (React UI)
 SPICE ephemeris, LOLA horizons,    ephemeris, sites,       az/el, visibility,           compare, slip slider,
 PGDA layers, validation            grid, validation        windows, metrics, grid       timelines, panorama, map
```

Everything heavy is precomputed once. The browser only does fast geometry, so the app is a static site with **no backend and no runtime API calls**.

**How accurate is it?** Sun and Earth positions match JPL Horizons to within 0.00003° (336 comparisons). Long-term averages are within ±5 percentage points of PGDA at 10 of 12 curated sites (outliers are listed and explained in the app). Assumptions such as observer height and "geometric comms only" are labelled on screen.

## Tech stack

| Area | Tools |
|---|---|
| Data pipeline | Python 3.12, SpiceyPy, NumPy, Numba, uv, pytest, ruff |
| Engine | TypeScript (strict), pure functions, no React or DOM |
| App | React 18, Vite, Canvas 2D, SVG, Web Workers, three.js with React Three Fiber and drei |
| Testing | Vitest, Testing Library, shared Python-to-TypeScript golden vectors |
| Tooling and hosting | ESLint, GitHub Actions, Vercel |

## Data sources

**NASA data**

- [NASA NAIF SPICE kernels](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/): DE440s planetary ephemeris, lunar orientation and frame kernels, leapseconds, body constants
- [LRO LOLA polar DEMs](https://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/IMG/): `LDEM_80S_80M` and `LDEM_75S_240M`, used to build terrain horizons
- [NASA PGDA product 69](https://pgda.gsfc.nasa.gov/products/69): long-term Sun and Earth visibility, used for the map and validation
- [JPL Horizons API](https://ssd-api.jpl.nasa.gov/doc/horizons.html): used offline to validate our ephemeris
- [Artemis III landing regions](https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/) and the [IM-2 frame kernel](https://naif.jpl.nasa.gov/pub/naif/pds/pds4/clps/clps_spice/spice_kernels/fk/clps_prime1_im2_v01.tf): site locations

**Other sources**

- [USGS Artemis III region grids](https://doi.org/10.5066/P1MEQ6UK) and the [USGS Gazetteer of Planetary Nomenclature](https://planetarynames.wr.usgs.gov/Feature/5450): site coordinates
- [Mazarico et al. (2011)](https://doi.org/10.1016/j.icarus.2010.10.030): illumination method we compare against

Exact files, URLs and every coordinate citation are in [`pipeline/DATA_SOURCES.md`](pipeline/DATA_SOURCES.md) and `pipeline/sites.yaml`.

## Project docs

| Read this | For |
|---|---|
| [`docs/ideas/lunar-landing-site-navigator.md`](docs/ideas/lunar-landing-site-navigator.md) | **Why**: ideas considered, must-haves, not doing, nice-to-haves |
| [`SPEC.md`](SPEC.md) | **What**: objective, data contract, success criteria, boundaries (source of truth) |
| [`SPEC-data-pipeline.md`](SPEC-data-pipeline.md) · [`SPEC-engine.md`](SPEC-engine.md) · [`SPEC-app.md`](SPEC-app.md) | Per-module specs |
| [`tasks/plan.md`](tasks/plan.md) | **How/when**: timeline, roles, issue index (tasks live in GitHub Issues) |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Branch/PR workflow (never push to `main`, squash merge only) |
| [`AGENTS.md`](AGENTS.md) / [`CLAUDE.md`](CLAUDE.md) | Short context + conventions for AI coding agents |
| [`docs/demo.md`](docs/demo.md) | Demo script and real slip examples |

## Run locally

**Prerequisites:** Node 22 or newer (CI uses 24) and npm. Python 3.12+ and [uv](https://docs.astral.sh/uv/) are needed only to regenerate the data.

```bash
git clone https://github.com/O-n-The-Moon/Lunar-Landing-Site-Navigator.git
cd Lunar-Landing-Site-Navigator/web
npm ci
npm run dev        # http://localhost:5173
```

**Data:** the app reads the generated files in `web/public/data/` (see SPEC.md → Data Contract). Until the pipeline has produced all of them, `npm run dev` falls back to small **synthetic fixtures** and shows a yellow "Synthetic fixture data" banner. The numbers you see then are not real lunar data. A production build (`npm run build && npm run preview`) uses real data only and shows a load error if a file is missing.

**Checks** (same as CI):

```bash
cd web && npm test && npm run lint && npm run build
cd pipeline && uv sync && uv run pytest && uv run ruff check . && uv run ruff format --check .
```

**Regenerate the data** (offline pipeline; `fetch` downloads SPICE kernels, LOLA DEMs and PGDA rasters, several hundred MB, into the gitignored `pipeline/data/raw/`):

```bash
cd pipeline && uv sync
uv run lunarnav fetch
uv run lunarnav build-all    # ephemeris, sites, grid, PGDA layers → web/public/data/
uv run lunarnav display-terrain  # → web/public/data/terrain-display.* (3D view only)
uv run lunarnav validate     # → web/public/data/validation.json
uv run lunarnav golden       # → shared/fixtures/golden.json
```

## Deploy

Static site on Vercel (no backend). Vercel project root is `web/` (Vite preset, Node 22); `main` deploys to production and every PR gets a preview URL.

- **Production:** https://lunar-landing-site-navigator-sooty.vercel.app
- Data files are served from `web/public/data/` (e.g. `/data/ephemeris.json`).

## Contributors

Team **O(n) the Moon**:

- [Anish Pokhrel](https://github.com/apokhrel7)
- [Farabi Hasan](https://github.com/mfarabih)
- [Arsalan Khaleel](https://github.com/ak033)
- [Fardin Mahid](https://github.com/Freddydeddydoo)
