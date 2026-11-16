# Plan: bring UI v2 (3D Terrain + Surface, then a focused 3-view console) into this repo

> **Status:** plan only, nothing built (2026-11-15). Branch `ui-v2-slice1`, rebased on `main` @ `dac8482`. **Owner:** apokhrel7.
> **Design source:** [`ui-v2-mission-console-plan.md`](ui-v2-mission-console-plan.md), a verbatim copy of the demo repo plan. Its §3 (design contract) and §8a (Slice 1 build spec) still apply. Its §4–§7 layout and panel list are **trimmed** by §5 below (no GO/NO-GO, telemetry rail, ANALYSIS mode or mock panels). **This file decides how the work lands here; where they differ, this file wins.**
> **Reference code:** `O-n-The-Moon/Lunar-Landing-Site-Navigator-demo`, branch `ui-v2-mission-console` @ `121986b` (local: `../Lunar-Landing-Site-Navigator-demo`). Slice 1 = commits `81e90d0..1141489`. Handoffs: demo `handoffs/apokhrel7/2026-11-15-1822-ui-v2-slice1-reviewed.md` (newest, has the review fixes and open items) and `…-1930-ui-v2-slice1-built.md` (how it was built).

## 0. Is this a good idea? (short answer: yes for Slice 1, yes for Slice 2 with timing care)

| | Current UI plan (`SPEC-app.md`) | UI v2 |
|---|---|---|
| First 5 s | Sidebar + metric cards + bars. Correct, but the terrain is never *seen*. | A lit 3D south pole whose shadows are the real terrain-aware Sun (`grid-horizons.bin`), with site beacons. |
| The slip moment | Numbers and bands change. | Shadows sweep, beacons flip colour; the Surface view shows the Sun sinking behind the actual ridge. |
| Honesty | Strong (validation tab, labels). | Same data, same engine. Display terrain is labelled "display only", vertical exaggeration is shown, beacon state = the timeline's own windows. |
| Cost | Already built. | Slice 1 is **already built, QA'd and code-reviewed** in the demo repo. Porting it is real work (repos have drifted, see §1) but mostly new files. |

**Why it's better, not just prettier:**
- It satisfies the existing P0-5 acceptance ("Sun disk below the silhouette when the timeline says blocked") in 3D, and it was verified that way.
- It also delivers two open issues: **#29** (window-score layer, demo `use-grid-scores.ts`) and **#33** (Play, demo `use-play-cursor.ts`).

**What to watch:**
- **Slice 2 changes the whole layout** (but is now small, §5). It collides with teammates' in-flight work on the same views. Start it after **CP2 (#43)** and finish it before **feature freeze (#44)**.
- **Fewer features, done well.** Judges see three views (3D Terrain, Surface, Verify) plus one slip/time deck with the key numbers. Everything else is cut or folded away (§5).
- **Slice 1 is additive** (new tabs, new files), so it can start now.

## 1. Ground truth: how far apart the two repos are

```
upstream main:  … 19c82f9 ──► 13 team PRs (T30 T26 T22 T21 T19 T27 #116–#122) ──► dac8482  (this repo, today)
                    │
demo repo:          └─► demo redesign (758f9b8..bad5a52, 50 files) ──► Slice 1 (81e90d0..1141489, 55 files)
```

- The demo branch is Slice 1, on top of a **demo-only redesign**, on top of a **main that's 13 PRs old**.
- Main has since built its own versions of the same areas: custom sites on the grid (T26), timeline ghosts + cursor (T21), panorama tracks (T22), opportunity map v0 (T27), PGDA validation (T19) and `missionRun` (#92). **About 18 files were changed on both sides.**
- **So: no `git merge`, no cherry-pick.** We **port**: copy the Slice 1 *new* files as they are, and re-write the few integration points against main's current APIs. Main's logic wins over the demo redesign's logic wherever both exist.
- Good news: the engine-facing types match. `SiteRun`/`SiteResult` are identical, main's `isIn` (`panorama/tracks.ts:33`) has the same rule as the demo's `isUpAt`, and `MAP_LAYERS` / `cursorMs` / `setCursor` already exist in main's `state.ts`.

## 2. Decisions

| Topic | Decision | Source |
|---|---|---|
| Demo redesign (site cards, slip hero + outlook strip, presets, top-bar restyle) | **Not ported on its own.** Slice 1 takes only the small helpers it needs (§3). In **Slice 2** only the pieces that fit the bottom deck come back (slip "Try +N d" target, presets, outlook strip, compact site rows), with the v2 look, so nothing is restyled twice. The full site cards are not ported. | User, 2026-11-15 |
| Team sign-off: deps, pulling "3D panorama" out of Deferred, Display-assets contract addition, SPEC criterion 7 | **Already agreed by the team.** P0 writes it into `SPEC.md` so the repo matches. | User, 2026-11-15 |
| Slice 2 scope | **Trimmed (user, 2026-11-15, "not a million things").** Final app = 3 views (**3D Terrain**, **Surface**, **Verify**) + a collapsible left rail + **one bottom deck** (slip, Play, compact per-site numbers) + the **~4 s intro fly-in** (kept). **Cut:** GO/NO-GO board and pills, telemetry rail, ANALYSIS mode, battery/DSN mocks (stay in SPEC Deferred), presentation mode, full site cards. | User, 2026-11-15 |
| Opportunity Map | **Replaced by the 3D Terrain overlays** (same PGDA + window-score layers, draped on the terrain). The tab is removed in Slice 2. The 2D map stays as the **WebGL fallback** and as a small "2D" toggle inside 3D Terrain (exact hover values). Grid scoring still runs in the worker (criterion 6). | User, 2026-11-15 |
| Compare tab | **Replaced by the bottom deck** in Slice 2: one row per site with Sun / Earth / Both %, Δ vs baseline, next sunset, a mini band. The full metric table + timeline sit behind a "Details" drawer, so SPEC-app P0-3/P0-4 and criterion 4 (state sunlit %, Earth-link %, time to sunset in ≤ 30 s) still hold. | User, 2026-11-15 |
| Default tab during Slice 1 | **3D Terrain.** The horizon grid streams in after first paint, and criterion 7 is reworded to cover that (P0). | User, 2026-11-15 |
| Existing tabs | **Kept during Slice 1** (`3D Terrain · Surface · Compare · Opportunity Map · Validation`), so the review is safe. Slice 2 ends with 3 views; Compare and Opportunity Map are removed only after their replacements work (S2-5). No capability is lost: every number and layer is still reachable. | User + design plan §2 |
| 3D stack | Exact pins: `three@0.187.0`, `@types/three@0.187.0`, `@react-three/fiber@8.18.0`, `@react-three/drei@9.122.0`. No postprocessing in Slice 1 (bloom = S2-6, would pin three ≤ 0.187). Lazy chunk. | Demo plan §8a.1 |
| Workflow | **One branch per slice.** Slice 1 on `ui-v2-slice1` (created 2026-11-15, rebased on `main` @ `dac8482`; rebase again before the PR), one small commit per phase P0–P9, **one PR** after the user's and Claude's review. Slice 2 starts on a **new branch from `main`** only after the Slice 1 PR merges. One umbrella issue per slice for the `Closes #N` line (the Slice 1 PR also closes #97, #29, #33); the branch is renamed `<N>-ui-v2-slice1` once that issue exists. No per-phase issues. Teammates already agreed, so no coordination step. **No push / merge without an explicit OK in-session.** Before the PR: a fresh `agent-skills:code-reviewer` subagent on `git diff main...HEAD` (CLAUDE.md). | User, 2026-11-15 + AGENTS.md |
| Demo repo | Read-only reference. Never merged into main; it keeps its own preview. | Demo plan §12 |

## 3. What Slice 1 imports from demo-only code, and what it uses here

Every non-new import in the demo's `scene/`, `surface/`, `controls/time-bar.tsx`, `terrain-data.ts`, `panorama/bodies.ts`:

| Demo import | Exists on main? | Action in the port |
|---|---|---|
| `map/projection`: `MapFrame`, `rhoKm`, `latLonToKm(frame,…)`, `kmToLatLon(frame,…)`, `cellAt` | **Different API.** Main: `latLonToKm(sphereRadiusKm, lat, lon)`, `kmToLatLon(R, x, y)`, `ringRadiusKm`, `gridExtentKm`. | **Don't change main's signatures** (the map uses them). Add a small `scene/frame.ts` adapter (`frameOf(grid)`, `rhoKm`, `cellAt`) built on main's functions, with a test. Scene modules import from it. |
| `map/colormaps`: `rampRgb` (nullable for no-data), `rampCss`, `RampName` incl. `'both'` | **No.** Main has `rampRgb(layer: 'sun'\|'earth', pct)` + `rampCssGradient` in `map/pgda-raster.ts`: no `'both'`, no null case. | **One new `map/colormaps.ts`** (sun / earth / both, null → no-data), **landed in P4**. `pgda-raster.ts` re-exports or calls it so the 2D map and the 3D overlays share one ramp per layer. Never two `rampRgb`s. |
| `map/use-pgda-values` | **Different API.** Main: `usePgdaValues(url, decode?) → Uint8Array \| null`, **PNG row order** (row `ny−1−iy`, `pgda-raster.ts:2-3`), 255 = no data. Demo: takes `PgdaData`, returns `{sun, earth}` `Float32Array` in **grid order** with NaN. | New tested pure helper `pgdaToGridOrder(u8, nx, ny): Float32Array` (flip rows, 255 → NaN), checked against `rasterValueAt`. 3D calls main's hook once per layer URL, **only while a PGDA overlay is picked** (review item 11). Without this the 3D overlay is flipped north–south. |
| `map/use-grid-scores` (window scores via the worker) | **No.** This is open issue **#29** (assigned to you; owned file `map/score-layer.ts`). | Port it in P5 under #29's file name `map/score-layer.ts` (or note the rename in the PR): 2D map score layer first, then the 3D overlays reuse it. Starts one worker per hook and copies ~13 MB into it, so **only one scoring consumer may be active** (see the MapView row). |
| `panorama/horizon-panorama` → `TrackPoint {azDeg, elevDeg, on, dayTick}` (used by demo `bodies.ts`, `surface-scene.tsx`) | **Different shape.** Main's `TrackPoint` is in `panorama/tracks.ts:8`: `{tUtcMs, azDeg, elevDeg, horizonDeg, visible}`, day ticks returned separately by `missionTracks`. | P8 adds a `surfaceTrack()` adapter in `bodies.ts` built from `missionTracks` output (+ test). Surface uses it; don't port the demo `track()`. |
| `timeline/mission-timeline` → `isUpAt` | Same rule as `isIn` in `panorama/tracks.ts`. | Use `isIn`. Don't port `mission-timeline.tsx` (main's T21 timeline replaces it). |
| `panorama/bodies.ts` (`bodyAt`, `track`) | `bodyAt` is private in `panorama/panorama-panel.tsx:20`; tracks are in `panorama/tracks.ts` (`missionTracks`). | Export `bodyAt` from a new `panorama/bodies.ts` (move it, don't copy). Surface uses `missionTracks` from main where it fits, plus a thin adapter for 3D track points. Touches T22's files; say so in the PR. |
| `timeline/use-play-cursor` | **No.** Issue **#33** (assigned to **mfarabih**; owned file `timeline/playback.ts`). | Team agreed. Land the demo hook as `timeline/playback.ts` (#33's owned file; the PR closes #33). If a #33 PR already exists by then, build on it (§7 step 2). |
| `ui/names` (`siteLetter`, `splitSiteName`, `formatClock`, `formatDayShort`) and `ui/icons` (`PlayIcon`, `PauseIcon`) | **No.** | Port as two small new files with only the functions used (+ tests for `names`). |
| `controls/slip-outlook` | **No** (demo redesign). | **Drop it in Slice 1.** The time bar has no outlook strip; it comes back in S2-2. |
| `controls/slip-slider` | Yes, but main's `SlipSlider()` takes no props and lives in the sidebar. | Time bar = cursor scrubber + Play + speeds + a compact slip readout. **The sidebar slider stays the one slip control** in Slice 1 (no two sliders). S2-2 moves it into the bottom deck. |
| `use-scenario-results`: `ScenarioResultsProvider` | **No.** Main's `useScenarioResults()` runs the engine **once per caller**. That's open issue **#97**. | **Do #97 first (P1).** With 3D + Surface mounted, main would run the engine 5× per slip step otherwise, which risks SPEC criterion 5 (≤ 33 ms). |
| `data`: `useTerrainHeights`, `useDisplayTerrain`, `useGridWhen`, `useRetryTerrainHeights`, `loadGridHeights`, `loadDisplayTerrain` | Main has `useGrid(enabled)`, `usePgdaLayers`, `LazyResource`, `DataSource.loadGrid/loadPgda`. | Add `loadGridHeights` + `loadDisplayTerrain` to `DataSource` (fetch + fixture), and `useTerrainHeights` / `useDisplayTerrain` / retry on main's `LazyResource` pattern. Use main's `useGrid(enabled)` instead of `useGridWhen`. |
| `map/map-view` (2D fallback, `<MapView active={…}/>`) | Yes, but `MapView()` has **no `active` prop**. | P5 adds `active` (the file is #29's anyway): a hidden map doesn't score. P7 done-when: **one scoring job per window change** with the Map tab, 3D overlay and 2D fallback all mounted. |
| `scene/site-status.ts` `SIGNAL_META.short` = `'GO'` / `'NO-GO'` on beacons | n/a | **Rename in P4** to state words (`SUN + EARTH`, `SUN ONLY`, `EARTH ONLY`, `NO SUN, NO EARTH`). GO/NO-GO is cut, and it would state a mission decision the engine never makes. |
| `three-stdlib` types (imported in demo `ops-scene.tsx`) | Comes in through drei, not a declared dep. | Import the types through `three` / drei instead (no new dep). |
| `engine`: `gridSiteContext`, `scoreGrid`, `azEl`, `bodyVectorKm`, `horizonElevAt`, `visibleDiskFraction` | Yes. | Add only `illuminationAt` (P2). |
| Tests: `test-utils.tsx` `renderAppOnCompare()`, global `./app/scene/webgl` mock in `test-setup.ts` | No. | Needed because the default tab changes. **Eight** test files render `<App>`: `app`, `compare-view`, `custom-site`, `options`, `slip-slider`, `map-view`, `panorama-panel`, `timeline-panel`. List them all in the PR. Record the `vitest` count before and after every phase; it may only go up. |

## 4. Slice 1 port: phases → issues → PRs

Each row is one commit or a few commits on `ui-v2-slice1`, in this order; every row leaves the branch green (§8). "Port" = copy the demo file, then adapt per §3. The whole slice ships as **one PR** after review (P9). The "PR" column is the commit-message title.

| # | PR (proposed issue title) | Port from demo | Adapt / new | Tests and done-when |
|---|---|---|---|---|
| **P0** | `[Docs] UI v2: SPEC updates the team agreed` | demo `SPEC.md` "Display assets" section | `SPEC.md`: move "3D … with animated shadows" from Deferred to V1 (3D Terrain + Surface tabs); add the 4 deps to the allowed list; **criterion 7** → "first paint ≤ 3 MB; terrain/grid files stream after first paint with a visible loading state; interactive ≤ 3 s on broadband"; "Display assets" contract section (files additive, never read by the engine). `SPEC-app.md`: add the 3D Terrain / Surface sections (from demo plan §5 OPS/SURFACE, trimmed), the new tab order and Layout block, and **rewrite P0-1** (staged load: 2 km heights → display terrain → horizon grid with progress, since the grid no longer waits for the Map tab). Link both plan files from `tasks/plan.md`. | Docs only. The team sees the agreement in writing. |
| **P1** | **#97** Share scenario results (provider) | demo `use-scenario-results.ts` provider parts (`bad5a52`) | `ScenarioResultsProvider` inside `ScenarioProvider` (`app.tsx`); `useScenarioResults()` reads context (throws outside the provider, so wrap `use-scenario-results.test.tsx`); memo stages unchanged. **Keep main's T26 grid/custom-site logic** (`useGridForSetups`, `GridAvailability`), not the demo's. Kept regardless of the measured gain (#97's "keep only if it beats noise" rule): the two 3D consumers in P7/P8 make it necessary. | Existing tests green; a test that two consumers share one result object. Measure slip-step time before/after (issue's method) as the baseline for P7. |
| **P2** | `[Engine] illuminationAt: visible Sun fraction per grid cell` | `web/src/engine/grid.ts` (`illuminationAt` + WeakMap frame cache), `grid.test.ts` additions (`0d974dc`, `1141489`) | Reconcile with main's `grid.ts` (#122 moved option checks to `checkVisibilityOpts` in `windows.ts`; `illuminationAt` takes no opts, so nothing to reuse there). Add one line to the **grid API block in `SPEC-engine.md`** (now complete after #122): `illuminationAt(grid, eph, tUtcMs, out?): Float32Array // raw visible Sun fraction per cell, NaN on no-data; no hysteresis; display only`. | Both demo tests: vs `scoreGrid` (hysteresis 0, so `scoreGrid`'s 48 h hourly lead-in can't change the state; cells within 0.02 of the threshold are skipped as in the demo) and vs `gridSiteContext`+`azEl`+`horizonElevAt`+`visibleDiskFraction` for every fixture cell; RangeError outside the ephemeris. Golden parity untouched. |
| **P3** | `[Pipeline] display-terrain: LOLA 80 m display heights (1024²)` | `pipeline/src/lunarnav/display_terrain.py`, `tests/test_display_terrain.py`, `web/public/data/terrain-display.{bin,json}`, `io.py` + `cli.py` lines (`edc1357`) | Rebase on main's `dem.py` (+12), `io.py`, `cli.py`, `test_cli.py`. Fold in **review item 12**: derive the extent and origin from the grid constants (`GRID_NX * GRID_CELL_KM`, `GRID_ORIGIN_KM`), and add an always-on test comparing the committed `.bin` with `grid-heights.bin` (median ≤ 50 m, p95 ≤ 250 m). Record source DEM file names in `terrain-display.json` the same way #119 does for `grid.json`. **Not** in `BUILD_STEPS`. **Regenerate here** (the raw DEMs are already in `pipeline/data/raw/dem/`, no fetch needed) and compare bytes with the demo's file. No `golden.json` regeneration: P3 doesn't touch `ephemeris.*` or `sites.json`, which #121 fingerprints. Only the `.bin` should match the demo's byte for byte; the `.json` differs on purpose (DEM list, derived extent). | `uv run pytest && ruff check && ruff format --check`. Acceptance numbers met; files ≤ 2.5 MB. |
| **P4** | `[UI] 3D foundations: deps, display-terrain loaders, pure scene modules` | `package.json` pins (`81e90d0`); `app/terrain-data.ts`; `data.ts` loader parts (`a2ebda1`); `scene/world.ts`, `terrain-mesh.ts`, `overlay-textures.ts`, `site-status.ts`, `overlay-layers.ts`, `webgl.ts` + tests (`8714416`, `1141489`) | New `scene/frame.ts` adapter (§3). **New `map/colormaps.ts`** (one ramp set, §3) and `pgdaToGridOrder` helper (+ tests). Minimal `ui/names.ts` (+ test) and `ui/icons.tsx` (needed by P6/P7). `site-status` uses `isIn` and state words instead of GO/NO-GO. `overlay-textures` uses `colormaps`. `data.ts` additions on main's `LazyResource` (§3). No UI yet, so nothing visible changes. Deps via `npm install --save-exact three@0.187.0 @types/three@0.187.0 @react-three/fiber@8.18.0 @react-three/drei@9.122.0`, then commit `package-lock.json` (Vercel runs `npm ci`). | `npm ci` (from the committed lock) then `tsc -b`, `npm run lint`, `vitest`, `build` green. Bundle unchanged (three isn't imported by any live code yet). |
| **P5** | **#29** Opportunity map v1: window-score layer | `map/use-grid-scores.ts` + test (lands as `map/score-layer.ts`, #29's owned file) | Wire into main's `map-view.tsx` / `opportunity-map.tsx` (T27's files; listed in the PR). Add the `active` prop to `MapView` (hidden map doesn't score). Uses the existing `workers/grid-score.worker.ts` and P4's `colormaps`. 300 ms debounce per SPEC-app P0-6. | #29's own acceptance: SPEC criterion 6 (≤ 3 s, non-blocking); lazy grid load with progress; legend/tooltip says **"approximate overview from the 2 km grid; near rims/peaks off by 1–6° of horizon"**. Score layers render; the `score-*` fallback note in `map-view.tsx:20` goes away. |
| **P6** | **#33** Play / animate the cursor + time bar | `timeline/use-play-cursor.ts` + test (`c14f771`), `controls/time-bar.{tsx,css}` | Hook lands as `timeline/playback.ts`. `TimelinePanel` gets Play (24 s sweep default; 1 h/s · 6 h/s · 1 d/s in the time bar). No outlook strip; slip = readout only. Remove the duplicate `HOUR_MS` (review item). | Hook tests (one frame per `act`; see gotchas). Play keeps timeline + panorama in sync (#33 acceptance). |
| **P7** | `[UI] 3D Terrain tab (live shadows, beacons, overlays)` | `scene/terrain-view.tsx`, `ops-scene.tsx`, `terrain-material.ts`, `compass.tsx`, `scene-error-boundary.tsx`, `scene.css` (`da660ea`, `fdf1095`, `1141489`) | Move `bodyAt` out of `panorama-panel.tsx` into `panorama/bodies.ts` (T22's file; say so). `app.tsx`: tabs `3D Terrain` (default) · `Compare` · `Opportunity Map` · `Validation` (**Surface is added in P8**, so no empty tab). Mount-on-first-open; Compare is no longer always mounted. Port the `test-utils.tsx` `renderAppOnCompare()` helper and the global webgl mock; rewrite `app.test.tsx` **on purpose** (tab list, staged load order 2 km heights → display terrain → grid, WebGL fallback). **Fold in review item 14**: build the 1024² mesh/normals **in chunks on idle frames** (179 ms freeze; no second worker pattern), and **item 11**: load PGDA only when a PGDA overlay is picked (via `pgdaToGridOrder`). **Shadow update is deferred** (`useDeferredValue` or next frame) so a slip step never waits on `illuminationAt` + texture upload. Score overlays carry the same "grid-approximate (2 km)" label as the 2D map (SPEC.md Deferred note on the 2 km grid). | Demo §8a S2/S3 done-whens: ≥ 50 fps at 1440p, beacons on the right cells, overlay values = 2D map values (PGDA overlay not flipped: check a known cell), shadows refresh ≤ 100 ms. **Slip step ≤ 33 ms with 3D Terrain visible** (criterion 5, #97's method). **One scoring job per window change.** Port the matching `views-3d.test.tsx` cases. |
| **P8** | `[UI] Surface tab (first-person skyline, Sun/Earth with phase)` | `surface/*` (`10f9a7f`, `fdf1095`, `1141489`) | Adds the **Surface** tab to `app.tsx` (second, after 3D Terrain). Uses `bodies.ts` (moved in P7) plus a new `surfaceTrack()` adapter over `missionTracks` (§3, + test). Fix the review leftovers: "EARTH BLOCKED · ridge at …" wording when Earth fails only the margin/hysteresis; the unused Earth texture in the Sun `Disk`; give the 2D fallback a time control. | S4 done-when: the Sun disk drops behind the ridge in the frame `isIn` turns false (threshold rule). Remaining `views-3d.test.tsx` cases (lit/blocked agreement at 9 times, keyboard yaw, drag guard, Follow Sun). |
| **P9** | `[UI] Slice 1 QA + preview measurements` | — | Visual QA in Chrome at 1440 / 1024 / 390 (DevTools emulation for 390; the demo never tested true 390). Vercel **preview** (ask before deploying): real transfer sizes (brotli for `grid-horizons.bin`, `terrain-display.bin`), fps at the demo machine's resolution, `Loading terrain shadows…` chip on Slow 4G. Update `docs/demo.md` with the 3D beat **outside the generated block** (lines 3–67 are written by `lunarnav demo`). Small fixes only. | Screenshots + a short GIF for the team. **Checkpoint: Slice 1 done; stop for user review.** |

**Order notes:** P2 and P3 are independent of the UI rows. P1 must be in before P7 (perf). P4 carries everything shared (colormaps, names, icons, PGDA helper). P5 needs only P4's `colormaps`; P6 needs P4's `names`/`icons`; P7 needs P1, P2, P4, P5, P6; P8 needs P7.

## 5. Slice 2: focused console (after Slice 1 review, real data only)

**Goal:** few features, done well. Judges see the 3D views, the slip, and the numbers. Nothing else competes with the stage.

```
┌ top bar: brand · [ 3D Terrain | Surface | Verify ] · UTC / L+ clock · data-source chip ──┐
│ left rail      │                                                                        │
│ (collapsible;  │                 3D stage (as big as possible: the hero)                │
│ sites, date,   │      live shadows · beacons · overlays (+ "2D" toggle) / first-person  │
│ options)       │                                                                        │
├────────────────┴────────────────────────────────────────────────────────────────────────┤
│ bottom deck: SLIP −30 ──●── +90 d  Try +15 d  [outlook strip] │ ▶ Play 1h/s 6h/s 1d/s │ cursor │
│ A Athena   Sun 82 % (−31)  Earth 64 %  Both 52 %  sunset in 3 d 4 h  ████░░░   [Details]  │
│ B Shackl.  Sun 40 % (+12)  …                                          ░░███░              │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**Clutter rules** (check in every Slice 2 step):
- At most **3 floating elements** over the stage at once (e.g. overlay picker, legend, compass). Everything else lives in the rail or the deck.
- The left rail **collapses** once a scenario is set (chevron + `[`); the stage grows to fill it.
- **One** slip control and **one** time control in the whole app.
- Numbers are shown **once**: in the deck rows. The 3D beacons show state (colour + text), not numbers.
- Every element must answer "does a judge need this in the 30-second demo?" If not, it goes behind "Details" or is cut.

**Where today's views end up:**

| Today | After Slice 2 |
|---|---|
| Tab bar (5 tabs) | 3 views: **3D Terrain · Surface · Verify** (APG tabs, restyled) |
| Sidebar | Collapsible **left rail** |
| Sidebar slip slider + time bar | **Bottom deck** (one slip, one Play/cursor) |
| Compare: metric cards table | Deck rows (key numbers + Δ) + full table in the **Details** drawer |
| Compare: timeline strips | Mini band per deck row + full timeline in the **Details** drawer |
| Compare: 2D panorama | Surface's **"Engineering view (2D)"** toggle (already there in Slice 1) |
| Opportunity Map tab | **3D Terrain overlays** + a small **"2D"** toggle; 2D map is also the WebGL fallback |
| Validation | **Verify**, restyled ("checked against JPL Horizons and PGDA", every number from `validation.json`) |

| # | Step (commit) | Delivers | Done when |
|---|---|---|---|
| **S2-0** | Design lock (no code) | Update the mock-up (`https://claude.ai/artifact/HYXWoavbJ2fvc3PzQKnnce`) to the trimmed layout above, using real P9 screenshots. Fonts (Inter + JetBrains Mono, OFL, self-hosted woff2 in `public/fonts/`, ≈ 150 kB) and tokens from demo plan §3. | User OKs the look and the density. |
| **S2-1** | Design tokens + shell | `ui/tokens.css`, `hud.css` (glass panels, corner ticks), `shell/` (top bar with mission clock, collapsible left rail, deck placeholder). **All 5 tabs still present** in the new shell. | App works exactly as before inside the shell; all tests green. |
| **S2-2** | Bottom deck | Slip moves from the sidebar into the deck with the time bar (one control each). **From the demo redesign:** "Try +N d" target button, scenario presets, slip outlook strip. Presets = hand-copied TS constants from main's T30 scenarios (`docs/demo.md`, made by `pipeline/src/lunarnav/demo.py`), plus a test that checks them against `docs/demo.md` (a generated JSON would be a data-contract change). Per-site rows: Sun / Earth / Both %, Δ vs baseline, a **labelled** "sunset in …" at the cursor (`nextEvents`; the Details table keeps "first sunset after landing", so both are named), mini band. | One slip control on screen; slip ≤ 33 ms with everything mounted (criterion 5, measured); row values = `missionMetrics` (tests); rows fit at 390 px. |
| **S2-3** | Details drawer + "2D" toggles | Drawer from the deck: the full metric-cards table and the full timeline (main's T21 components, restyled). "2D" toggle in 3D Terrain → `MapView`. | Criterion 4 (fresh user, ≤ 30 s) still passes; P0-3/P0-4 acceptance tests still green. |
| **S2-4** | Intro fly-in (kept) | ≈ 4 s skippable fly-in (orbit → south pole) with a short boot log from real counts ("EPHEMERIS · N epochs · SITES 12 · GRID 182×182"). Skipped by `?nointro`, Esc, Skip, `prefers-reduced-motion`. The horizon grid starts downloading during it. Moon texture (approved; **ask before downloading**, ≈ 0.5 MB public domain). | Intro ≤ 4.5 s; never with `?nointro`; reduced motion respected; tests for the skip rules. |
| **S2-5** | Retire old views | Remove the **Compare** and **Opportunity Map** tabs (their content now lives in the deck, drawer and toggles), the old header and the old layout CSS. Update `app.test.tsx`, `test-utils.tsx` and the eight `<App>` test files on purpose (tab list = 3 views); the PR maps **every** old P0-3 / P0-4 / P0-6 assertion to its new place (deck, drawer, 2D toggle), none dropped (AGENTS: never weaken a test). Rename Validation → Verify. Update `SPEC-app.md` Layout + P0-6 (map = 3D overlays, 2D as toggle/fallback). | Nothing reachable before is unreachable now (checklist in the PR); all tests green. |
| **S2-6** | Polish (bonus) | Number ticking (150 ms), beacon pulse on state change, cinema mode (`[` `]` hide rail + deck; ignored while typing in inputs such as the lat/lon fields). Small Slice 1 gaps if time: scale bar, beacon hover readout, stars in 3D Terrain. **No bloom** (would add a dep). | Visual QA. |
| **S2-7** | Hardening | Perf (demo plan §10 budgets), a11y (contrast ≥ 4.5:1 on glass, canvas text summaries, keyboard for every control), responsive 1440 / 1024 / 390. Update `docs/demo.md` (outside the `lunarnav demo` generated block, lines 3–67) + the 30-second demo (demo plan §9, minus the battery/board beats). Code review on `git diff main...HEAD`. | All checks green; preview smoke-tested; the 30-second demo runs end to end. |

**Cut line:** S2-1 → S2-3 + S2-5 is the shippable console. S2-4 (intro) is next in value; S2-6 is bonus. Before S2-5 the app always still has the old tabs, so stopping early is safe.

**Cut entirely (not built):** GO/NO-GO board and status pills, telemetry rail, ANALYSIS mode, battery SoC and DSN mocks (stay in SPEC Deferred), presentation mode, full site cards, bloom/postprocessing.

## 6. Risks for this migration

| Risk | Mitigation |
|---|---|
| Main keeps moving (teammates merge every ~30 min) | New files first; **rebase on `main` after each phase** (one PR per slice, so conflicts must not pile up). Check `gh pr list` before P5/P6 (§7). |
| Port silently drops a demo fix | For each ported file, diff it against the demo file at `121986b` and list every intended difference in the PR description. |
| Two implementations of one thing (projection, colour ramps, tracks, Play) | §3 picks one per item. Main's wins unless the demo version is the only one. Never keep both. |
| Default-tab change breaks teammates' tests | `renderAppOnCompare()` helper + global webgl mock, in the same PR as the default change (P7). Tell the team in the PR. |
| 13 MB streamed after first paint on venue Wi-Fi | P9 measures brotli sizes on the preview. Fallback: defer the horizon grid until a shadow/overlay is needed (the demo handoff's `useGridWhen(displaySettled)` idea). |
| Slice 2 lands mid-feature-freeze | Start after #43; S2-1 keeps behaviour identical; cut line above. |
| A slip step reruns `illuminationAt` (~33k cells) + texture upload in the same commit, breaking criterion 5 | Deferred shadow update (P7) and an explicit slip ≤ 33 ms check with 3D Terrain visible. |
| Several grid-scoring workers at once (~13 MB copied into each) | `active` prop on `MapView` (P5); one scoring job per window change (P7 check). |
| `react-hooks` v7 lint vs mutating three objects | Keep the demo's pattern: module-level helpers (`applyTerrainState`, `uploadPixels`, `markUpdated`, `writeRay`). |

## 7. Before P0 (setup checklist)

1. ~~Create the branch~~ done: `ui-v2-slice1`. Create the umbrella issue "UI v2 Slice 1: 3D Terrain + Surface" (lists P0–P9, links this plan) and rename the branch to `<N>-ui-v2-slice1`.
2. Before P5/P6: check that #29 and #33 are still open and unstarted (`gh issue view`, `gh pr list`). If a teammate already opened a PR for either, build on theirs instead of porting.
3. Baseline on `main`: `vitest` count, gzip bundle (main JS), slip-step time (the #97 method).
4. `cd pipeline && uv sync`. The raw DEMs (`LDEM_80S_80M`, `LDEM_75S_240M`) are **already** in `pipeline/data/raw/dem/`, so no fetch is needed for P3.

## 8. Verification (every PR)

```bash
cd web && npm ci && npx tsc -b && npm run lint && npx vitest run && npm run build
cd pipeline && uv run pytest -q && uv run ruff check . && uv run ruff format --check .   # P3 (and any pipeline change)
```
Plus an `agent-skills:code-reviewer` subagent on `git diff main...HEAD` with `code-review-and-quality` before opening the PR; fix its findings first. 3D work also gets a Chrome visual check (claude-in-chrome) with screenshots.

## 9. Gotchas carried over from the demo (read before P4–P8)

- The fixture ephemeris covers only 48 h: tests that render Surface must set the duration to 1 day first.
- `usePlayCursor` tests must advance one frame per `act`.
- jsdom has no WebGL: mock `./scene/webgl` globally (`false`); suites that test 3D mock it themselves plus `./scene/ops-scene` / `./surface/surface-scene`.
- Error boundary is a class component (`scene-error-boundary.tsx`), the only one; keep it.
- Stages are `role="group"` + a visually hidden summary, not `role="img"` (img hides the buttons).
- Hidden tabs freeze their scene (`frameloop='never'`, `shownMs`) instead of unmounting.
- World coordinates are a real sphere: `world = (Ym, −Zm − R, −Xm)`; click-to-add inverts with `worldToLatLon`, not map km.
- Curated-site status uses the site's own 0.5° mask; the shadow texture uses the 2 km cell's 1° mask. The beacon tooltip says so; check "blocked = in shadow" only on custom sites.
- `npx eslint src` can fail to find eslint; use `npm run lint`. macOS `sed -i` needs `''`.

## 10. Data: what the new UI uses (checked 2026-11-15)

- **All views read this repo's live data, nothing from the demo.** The heavy data files are byte-identical in both repos (`ephemeris.bin`, `grid-heights.bin`, `grid-horizons.bin`; same SHA), so the 3D shadows are exactly what the demo showed.
- **This repo is newer** for `sites.json` (DEM file names, #119), `grid.json` (#119) and `validation.json` (pass/fail targets + PGDA comparison, #116). The 3D views show these newer values automatically, because they go through the same loaders and engine.
- The engine work the views need is done here (T8–T14, T25 grid + worker, #92 `missionRun`, #93 never-up/never-sets). Only **one** engine addition: `illuminationAt` (P2).
- **One new data file:** `terrain-display.bin` + `.json` (P3). It is generated from the LOLA DEMs already on this machine. The demo's copy should come out byte-identical (same DEMs and grid extent); P3 regenerates it here and compares with the demo's file to prove it.
- #104 (SPEC-engine grid API + fixtures) and #89 (stale-golden fingerprint) merged on 2026-11-15 as #122 / #121. The only open engine issue, #103 (lint guard on `_` imports), doesn't block UI v2.

## 11. Still open (small)

- Exact criterion 7 wording in P0: the team agreed on the substance; you confirm the sentence.
