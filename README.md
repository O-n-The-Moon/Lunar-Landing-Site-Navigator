# Lunar-Landing-Site-Navigator
Lunar Landing Site Navigator - NASA Hackathon

## Project docs

| Read this | For |
|---|---|
| [`docs/ideas/lunar-landing-site-navigator.md`](docs/ideas/lunar-landing-site-navigator.md) | **Why**: ideas considered, must-haves, not doing, nice-to-haves |
| [`SPEC.md`](SPEC.md) | **What**: objective, data contract, success criteria, boundaries (source of truth) |
| [`SPEC-data-pipeline.md`](SPEC-data-pipeline.md) · [`SPEC-engine.md`](SPEC-engine.md) · [`SPEC-app.md`](SPEC-app.md) | Per-module specs |
| [`tasks/plan.md`](tasks/plan.md) | **How/when**: timeline, roles, issue index (tasks live in GitHub Issues) |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Branch/PR workflow (never push to `main`, squash merge only) |
| [`AGENTS.md`](AGENTS.md) / [`CLAUDE.md`](CLAUDE.md) | Short context + conventions for AI coding agents |
| `docs/demo.md` | Demo script (written during the build) |

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
uv run lunarnav validate     # → web/public/data/validation.json
uv run lunarnav golden       # → shared/fixtures/golden.json
```

## Deploy

Static site on Vercel (no backend). Vercel project root is `web/` (Vite preset, Node 22); `main` deploys to production and every PR gets a preview URL.

- **Production:** https://lunar-landing-site-navigator-sooty.vercel.app
- Data files are served from `web/public/data/` (e.g. `/data/ephemeris.json`).
