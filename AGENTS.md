# AGENTS.md

Context for AI coding agents (Claude Code, Cursor, Codex, Copilot…) and humans. Keep this file short; details live in the linked docs.

## Project
Lunar Landing Site Navigator: NASA hackathon web app for **mission planners**. It compares lunar south-pole (84–90°S) landing sites and dates by **Sun visibility (power)** and **Earth visibility (direct-to-Earth comms)**, using terrain-aware horizons. Core interaction: a **slip slider** (change the landing date → see what you lose and why).

**Source of truth:** `SPEC.md` (data contract, success criteria, boundaries) → `SPEC-data-pipeline.md`, `SPEC-engine.md`, `SPEC-app.md`. Read only the section your task needs. Why we chose this direction: `docs/ideas/`. Plan + issue index: `tasks/plan.md`.

## Architecture
```
pipeline/ (Python, offline)  ──writes──▶  web/public/data/ (data contract)  ──▶  web/src/engine (pure TS)  ──▶  web/src/app (React UI)
 SPICE ephemeris, LOLA DEM horizons,        ephemeris.bin, sites.json,             az/el, visibility,           compare, slip slider,
 PGDA layers, validation, golden vectors    grid*.bin, pgda-*.png, validation.json  windows, metrics, grid        timeline, panorama, map
```
Static site on Vercel. **No backend, no runtime API calls.**

## Layout
- `pipeline/src/lunarnav/`: one module per CLI command; `geometry.py` is the Python reference math. `pipeline/sites.yaml`: curated sites (cited).
- `web/src/engine/`: pure functions, **no React/DOM/fetch imports**. `__fixtures__/` holds sample data and outputs for building without real data.
- `web/src/app/<view>/`: one folder per view (compare, timeline, panorama, map, validation, controls). `web/src/workers/`: grid scoring.
- `shared/fixtures/golden.json`: Python→TS parity vectors.

## Commands
```bash
cd pipeline && uv sync && uv run pytest && uv run ruff check . && uv run ruff format --check .
uv run lunarnav build-all | validate | golden      # regenerate data (needs `lunarnav fetch` first)
cd web && npm ci && npm run dev | npm test | npm run lint | npm run build
```

## Conventions
- **Units in every name:** `elevDeg`, `distKm`, `durationH`, `tUtcMs`, `heightM` (Python: `elev_deg`, `dist_km`).
- **Frame `MOON_ME`**, planetocentric lat/lon, lon east-positive (−180…180), sphere R = 1737.4 km. **Time = UTC Unix ms.** **Azimuth** clockwise from local north (0–360, Horizons convention); **elevation** above the local spherical horizontal.
- Degrees at public APIs, radians internally. Never hardcode physics in UI components; call the engine.
- TS: strict, functions over classes, kebab-case filenames (`timeline-strip.tsx`), no `any`, no `@ts-ignore`. Python: typed, numpy-vectorized, `numba` only for hot loops, ruff defaults.
- Visual components are **prop-driven** and testable with fixtures.

## Workflow (enforced)
- Every change: **GitHub issue → branch `<issue#>-<short-desc>` → PR with `Closes #N` → 1 approval → squash merge.** `main` is protected; never push to it directly.
- **Stay inside the issue's "Files owned by this issue" list.** Touching others' files → say so in the PR.
- **Data contract** (`SPEC.md` → Data Contract) changes need team agreement first. Don't change it inside a feature PR.
- New ideas → `SPEC.md` "Out of Scope (Deferred)". Don't build features that aren't in the spec or an issue.
- See `CONTRIBUTING.md`.

## Testing
- Every exported engine function has a Vitest test. TS must match `golden.json` (az/el ≤ 1e-3°).
- Pipeline: pytest with synthetic DEMs (flat sphere → dip angle, cone → known elevation).
- Never delete, skip or weaken a failing test to get green. Fix the code or flag it.

## Never
- Commit raw DEMs, SPICE kernels, `pipeline/data/raw/`, files over 25 MB, or secrets.
- Call JPL Horizons (or any API) from the web app. It has no CORS, and data is precomputed.
- Present smooth-sphere (no-terrain) results as terrain-aware, or show an accuracy number that isn't in `validation.json`.
- Add a dependency without asking the team.

## Gotchas
- At the south pole the Sun and Earth sit within ~±5° of the horizon: small terrain or angle errors flip results. Treat the Sun as a 0.53° disk (visible fraction), not a point.
- Earth parallax across the Moon is ~0.26°: compute topocentric vectors (`body − site`); never reuse one direction for all sites.
- Azimuth "north" is undefined at exactly −90°: clamp latitude to −89.999°.
- Unrolled panorama, not fisheye. A fisheye collapses everything into a thin ring at the pole.
