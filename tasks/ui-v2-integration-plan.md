# Plan: bring UI v2 (3D Terrain + Surface, then the Mission Console) into this repo

> **Status:** plan only, nothing built (2026-11-15). **Owner:** apokhrel7.
> **Design source:** [`ui-v2-mission-console-plan.md`](ui-v2-mission-console-plan.md), a verbatim copy of the demo repo plan. Its §3–§7 (look, layout, modes, architecture) and §8a (Slice 1 build spec) still apply. **This file decides how the work lands here; where they differ, this file wins.**
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
- **Slice 2 changes the whole layout.** It collides with teammates' in-flight work on the same views. Start it after **CP2 (#43)**, land it as small PRs, and finish it before **feature freeze (#44)**.
- **Slice 1 is additive** (new tabs, new files), so it can start now.

## 1. Ground truth: how far apart the two repos are

```
upstream main:  … 19c82f9 ──► 11 team PRs (T30 T26 T22 T21 T19 T27 #116–#120) ──► 0fcb688  (this repo, today)
                    │
demo repo:          └─► demo redesign (758f9b8..bad5a52, 50 files) ──► Slice 1 (81e90d0..1141489, 55 files)
```

- The demo branch is Slice 1, on top of a **demo-only redesign**, on top of a **main that's 11 PRs old**.
- Main has since built its own versions of the same areas: custom sites on the grid (T26), timeline ghosts + cursor (T21), panorama tracks (T22), opportunity map v0 (T27), PGDA validation (T19) and `missionRun` (#92). **About 18 files were changed on both sides.**
- **So: no `git merge`, no cherry-pick.** We **port**: copy the Slice 1 *new* files as they are, and re-write the few integration points against main's current APIs. Main's logic wins over the demo redesign's logic wherever both exist.
- Good news: the engine-facing types match. `SiteRun`/`SiteResult` are identical, main's `isIn` (`panorama/tracks.ts:33`) has the same rule as the demo's `isUpAt`, and `MAP_LAYERS` / `cursorMs` / `setCursor` already exist in main's `state.ts`.

## 2. Decisions

| Topic | Decision | Source |
|---|---|---|
| Demo redesign (site cards, slip hero + outlook strip, presets, top-bar restyle) | **Not ported on its own.** Slice 1 takes only the small helpers it needs (§3). Site cards, outlook strip and presets come back in **Slice 2** (ANALYSIS + bottom deck) with the v2 look, so nothing is restyled twice. | User, 2026-11-15 |
| Team sign-off: deps, pulling "3D panorama" out of Deferred, Display-assets contract addition, SPEC criterion 7 | **Already agreed by the team.** P0 writes it into `SPEC.md` so the repo matches. | User, 2026-11-15 |
| Slice 2 mock panels (battery SoC, DSN handover) | **Real data only first.** Battery/DSN become an opt-in phase (S2-8) with `ILLUSTRATIVE` badges; they stay in SPEC Deferred until then. | User, 2026-11-15 |
| Default tab during Slice 1 | **3D Terrain.** The horizon grid streams in after first paint, and criterion 7 is reworded to cover that (P0). | User, 2026-11-15 |
| Existing tabs | **Kept.** Slice 1 adds tabs `3D Terrain · Surface · Compare · Opportunity Map · Validation`. Slice 2 *regroups* them into modes (OPS / SURFACE / ANALYSIS / VERIFY) and deletes nothing that still has a job. Old chrome (tab bar, old layout CSS) is removed only in the last cleanup PR (S2-7). | User + design plan §2 |
| 3D stack | Exact pins: `three@0.187.0`, `@types/three@0.187.0`, `@react-three/fiber@8.18.0`, `@react-three/drei@9.122.0`. No postprocessing in Slice 1 (bloom = S2-6, would pin three ≤ 0.187). Lazy chunk. | Demo plan §8a.1 |
| Workflow | **One branch per slice.** Slice 1 on `ui-v2-slice1` (created 2026-11-15 from `main` @ `0fcb688`), one small commit per phase P0–P9, **one PR** after the user's and Claude's review. Slice 2 starts on a **new branch from `main`** only after the Slice 1 PR merges. One umbrella issue per slice for the `Closes #N` line (the Slice 1 PR also closes #97, #29, #33); the branch is renamed `<N>-ui-v2-slice1` once that issue exists. No per-phase issues. Teammates already agreed, so no coordination step. **No push / merge without an explicit OK in-session.** Before the PR: a fresh `agent-skills:code-reviewer` subagent on `git diff main...HEAD` (CLAUDE.md). | User, 2026-11-15 + AGENTS.md |
| Demo repo | Read-only reference. Never merged into main; it keeps its own preview. | Demo plan §12 |

## 3. What Slice 1 imports from demo-only code, and what it uses here

Every non-new import in the demo's `scene/`, `surface/`, `controls/time-bar.tsx`, `terrain-data.ts`, `panorama/bodies.ts`:

| Demo import | Exists on main? | Action in the port |
|---|---|---|
| `map/projection`: `MapFrame`, `rhoKm`, `latLonToKm(frame,…)`, `kmToLatLon(frame,…)`, `cellAt` | **Different API.** Main: `latLonToKm(sphereRadiusKm, lat, lon)`, `kmToLatLon(R, x, y)`, `ringRadiusKm`, `gridExtentKm`. | **Don't change main's signatures** (the map uses them). Add a small `scene/frame.ts` adapter (`frameOf(grid)`, `rhoKm`, `cellAt`) built on main's functions, with a test. Scene modules import from it. |
| `map/colormaps`: `rampRgb`, `rampCss`, `RampName` | **No.** Main has PGDA ramps in `map/pgda-raster.ts` (`rampRgb(layer, pct)`, `rampCssGradient`). | PGDA overlays use **main's** `pgda-raster` ramps, so 3D colours equal the 2D map's. Score ramps arrive with #29 (P5): put them in `map/pgda-raster.ts` or a new `map/colormaps.ts` that both the 2D and 3D views use. |
| `map/use-grid-scores` (window scores via the worker) | **No.** This is open issue **#29** (assigned to you). | Port it as the #29 PR (P5): 2D map score layer first, then the 3D overlays reuse it. |
| `timeline/mission-timeline` → `isUpAt` | Same rule as `isIn` in `panorama/tracks.ts`. | Use `isIn`. Don't port `mission-timeline.tsx` (main's T21 timeline replaces it). |
| `panorama/bodies.ts` (`bodyAt`, `track`) | `bodyAt` is private in `panorama/panorama-panel.tsx:20`; tracks are in `panorama/tracks.ts` (`missionTracks`). | Export `bodyAt` from a new `panorama/bodies.ts` (move it, don't copy). Surface uses `missionTracks` from main where it fits, plus a thin adapter for 3D track points. Touches T22's files; say so in the PR. |
| `timeline/use-play-cursor` | **No.** Issue **#33** (assigned to **mfarabih**; owned file `timeline/playback.ts`). | Team agreed. Land the demo hook as `timeline/playback.ts` (#33's owned file; the PR closes #33). If a #33 PR already exists by then, build on it (§7 step 2). |
| `ui/names` (`siteLetter`, `splitSiteName`, `formatClock`, `formatDayShort`) and `ui/icons` (`PlayIcon`, `PauseIcon`) | **No.** | Port as two small new files with only the functions used (+ tests for `names`). |
| `controls/slip-outlook` | **No** (demo redesign). | **Drop it in Slice 1.** The time bar has no outlook strip; it comes back in S2-2. |
| `controls/slip-slider` | Yes, but main's `SlipSlider()` takes no props and lives in the sidebar. | Time bar = cursor scrubber + Play + speeds + a compact slip readout. **The sidebar slider stays the one slip control** in Slice 1 (no two sliders). S2-2 moves it into the bottom deck. |
| `use-scenario-results`: `ScenarioResultsProvider` | **No.** Main's `useScenarioResults()` runs the engine **once per caller**. That's open issue **#97**. | **Do #97 first (P1).** With 3D + Surface mounted, main would run the engine 5× per slip step otherwise, which risks SPEC criterion 5 (≤ 33 ms). |
| `data`: `useTerrainHeights`, `useDisplayTerrain`, `useGridWhen`, `useRetryTerrainHeights`, `loadGridHeights`, `loadDisplayTerrain` | Main has `useGrid(enabled)`, `usePgdaLayers`, `LazyResource`, `DataSource.loadGrid/loadPgda`. | Add `loadGridHeights` + `loadDisplayTerrain` to `DataSource` (fetch + fixture), and `useTerrainHeights` / `useDisplayTerrain` / retry on main's `LazyResource` pattern. Use main's `useGrid(enabled)` instead of `useGridWhen`. |
| `map/map-view` (2D fallback) | Yes (`MapView()`, no `active` prop). | Use as is. |
| `map/use-pgda-values` | Yes; signature looks compatible: `usePgdaValues(url, decode?)`. | Check the return type at port time. |
| `engine`: `gridSiteContext`, `scoreGrid`, `azEl`, `bodyVectorKm`, `horizonElevAt`, `visibleDiskFraction` | Yes. | Add only `illuminationAt` (P2). |
| Tests: `test-utils.tsx` `renderAppOnCompare()`, global `./app/scene/webgl` mock in `test-setup.ts` | No. | Needed because the default tab changes. It touches ~5 test files owned by others (compare, slip slider, timeline, panorama); list them in the PR. |

## 4. Slice 1 port: phases → issues → PRs

Each row is one commit or a few commits on `ui-v2-slice1`, in this order; every row leaves the branch green (§8). "Port" = copy the demo file, then adapt per §3. The whole slice ships as **one PR** after review (P9). The "PR" column is the commit-message title.

| # | PR (proposed issue title) | Port from demo | Adapt / new | Tests and done-when |
|---|---|---|---|---|
| **P0** | `[Docs] UI v2: SPEC updates the team agreed` | demo `SPEC.md` "Display assets" section | `SPEC.md`: move "3D … with animated shadows" from Deferred to V1 (3D Terrain + Surface tabs); add the 4 deps to the allowed list; **criterion 7** → "first paint ≤ 3 MB; terrain/grid files stream after first paint with a visible loading state; interactive ≤ 3 s on broadband"; "Display assets" contract section (files additive, never read by the engine). `SPEC-app.md`: add the 3D Terrain / Surface sections (from demo plan §5 OPS/SURFACE, trimmed) and the new tab order. Link both plan files from `tasks/plan.md`. | Docs only. The team sees the agreement in writing. |
| **P1** | **#97** Share scenario results (provider) | demo `use-scenario-results.ts` provider parts (`bad5a52`) | `ScenarioResultsProvider` inside `ScenarioProvider` (`app.tsx`); `useScenarioResults()` reads context; memo stages unchanged. **Keep main's T26 grid/custom-site logic** (`useGridForSetups`, `GridAvailability`), not the demo's. | Existing tests green; a test that two consumers share one result object. Measure slip-step time before/after (issue's method). |
| **P2** | `[Engine] illuminationAt: visible Sun fraction per grid cell` | `web/src/engine/grid.ts` (`illuminationAt` + WeakMap frame cache), `grid.test.ts` additions (`0d974dc`, `1141489`) | Reconcile with main's `grid.ts` (12.6 kB; T25/#104 changes). Document in `SPEC-engine.md` (check #104 isn't editing the same section). | Both demo tests: vs `scoreGrid` (hysteresis 0) and vs `gridSiteContext`+`azEl`+`horizonElevAt`+`visibleDiskFraction` for every fixture cell; RangeError outside the ephemeris. Golden parity untouched. |
| **P3** | `[Pipeline] display-terrain: LOLA 80 m display heights (1024²)` | `pipeline/src/lunarnav/display_terrain.py`, `tests/test_display_terrain.py`, `web/public/data/terrain-display.{bin,json}`, `io.py` + `cli.py` lines (`edc1357`) | Rebase on main's `dem.py` (+12), `io.py`, `cli.py`, `test_cli.py`. Fold in **review item 12**: derive the extent and origin from the grid constants (`GRID_NX * GRID_CELL_KM`, `GRID_ORIGIN_KM`), and add an always-on test comparing the committed `.bin` with `grid-heights.bin` (median ≤ 50 m, p95 ≤ 250 m). Record source DEM file names in `terrain-display.json` the same way #119 does for `grid.json`. **Not** in `BUILD_STEPS`. **Regenerate here** (`uv run lunarnav fetch` first, about 400 MB, gitignored). | `uv run pytest && ruff check && ruff format --check`. Acceptance numbers met; files ≤ 2.5 MB. |
| **P4** | `[UI] 3D foundations: deps, display-terrain loaders, pure scene modules` | `package.json` pins (`81e90d0`); `app/terrain-data.ts`; `data.ts` loader parts (`a2ebda1`); `scene/world.ts`, `terrain-mesh.ts`, `overlay-textures.ts`, `site-status.ts`, `overlay-layers.ts`, `webgl.ts` + tests (`8714416`, `1141489`) | New `scene/frame.ts` adapter (§3). `site-status` uses `isIn`. `overlay-textures` uses main's ramps. `data.ts` additions on main's `LazyResource` (§3). No UI yet, so nothing visible changes. | `npm ci` then `tsc -b`, `npm run lint`, `vitest`, `build` green. Bundle unchanged (three isn't imported by any live code yet). |
| **P5** | **#29** Opportunity map v1: window-score layer | `map/use-grid-scores.ts` + test, the score-ramp parts of `map/colormaps.ts` | Wire into main's `map-view.tsx` / `opportunity-map.tsx` (T27's files; listed in the PR). Uses the existing `workers/grid-score.worker.ts`. 300 ms debounce per SPEC-app P0-6. | SPEC criterion 6 (≤ 3 s, non-blocking). Score layers render; the `score-*` fallback note in `map-view.tsx:20` goes away. |
| **P6** | **#33** Play / animate the cursor + time bar | `timeline/use-play-cursor.ts` + test (`c14f771`), `controls/time-bar.{tsx,css}` | Hook lands as `timeline/playback.ts`. `TimelinePanel` gets Play (24 s sweep default; 1 h/s · 6 h/s · 1 d/s in the time bar). No outlook strip; slip = readout only. Remove the duplicate `HOUR_MS` (review item). | Hook tests (one frame per `act`; see gotchas). Play keeps timeline + panorama in sync (#33 acceptance). |
| **P7** | `[UI] 3D Terrain tab (live shadows, beacons, overlays)` | `scene/terrain-view.tsx`, `ops-scene.tsx`, `terrain-material.ts`, `compass.tsx`, `scene-error-boundary.tsx`, `scene.css` (`da660ea`, `fdf1095`, `1141489`) | Move `bodyAt` out of `panorama-panel.tsx` into `panorama/bodies.ts` (T22's file; say so). `app.tsx`: tabs `3D Terrain` (default) · `Surface` · `Compare` · `Opportunity Map` · `Validation`. Mount-on-first-open; Compare is no longer always mounted. Port the `test-utils.tsx` `renderAppOnCompare()` helper and the global webgl mock; rewrite `app.test.tsx` **on purpose** (tab list, staged load order 2 km heights → display terrain → grid, WebGL fallback). **Fold in review item 14**: build the 1024² mesh/normals off the main thread or in chunks (179 ms freeze), and **item 11**: load PGDA only when a PGDA overlay is picked. | Demo §8a S2/S3 done-whens: ≥ 50 fps at 1440p, beacons on the right cells, overlay values = 2D map values, shadows refresh ≤ 100 ms. Port the matching `views-3d.test.tsx` cases. |
| **P8** | `[UI] Surface tab (first-person skyline, Sun/Earth with phase)` | `surface/*` (`10f9a7f`, `fdf1095`, `1141489`) | Uses `bodies.ts` (moved in P7) and `missionTracks`. Fix the review leftovers: "EARTH BLOCKED · ridge at …" wording when Earth fails only the margin/hysteresis; the unused Earth texture in the Sun `Disk`; give the 2D fallback a time control. | S4 done-when: the Sun disk drops behind the ridge in the frame `isIn` turns false (threshold rule). Remaining `views-3d.test.tsx` cases (lit/blocked agreement at 9 times, keyboard yaw, drag guard, Follow Sun). |
| **P9** | `[UI] Slice 1 QA + preview measurements` | — | Visual QA in Chrome at 1440 / 1024 / 390 (DevTools emulation for 390; the demo never tested true 390). Vercel **preview** (ask before deploying): real transfer sizes (brotli for `grid-horizons.bin`, `terrain-display.bin`), fps at the demo machine's resolution, `Loading terrain shadows…` chip on Slow 4G. Update `docs/demo.md` with the 3D beat. Small fixes only. | Screenshots + a short GIF for the team. **Checkpoint: Slice 1 done; stop for user review.** |

**Order notes:** P2 and P3 are independent of the UI rows. P1 must be in before P7 (perf). P5 and P6 need P4.

## 5. Slice 2 (after Slice 1 review, real data only)

Design source: demo plan §3 (design contract), §4 (layout), §5 (modes), §6 (panels, **minus battery/DSN**), §7 (architecture). Start after **CP2 (#43)**, since this changes the layout every teammate works in. Every phase leaves the app working.

| # | PR | Delivers | Done when |
|---|---|---|---|
| **S2-0** | Design lock (no code) | Re-open the mock-up (`https://claude.ai/artifact/HYXWoavbJ2fvc3PzQKnnce`) and update it with the real 3D screenshots from P9. Agree on fonts (Inter + JetBrains Mono, OFL, self-hosted woff2 in `public/fonts/`, ≈ 150 kB) and tokens. | User (and team) OK the look. |
| **S2-1** | Design system v2 + console shell | `ui/tokens.css`, `hud.css`, `shell/` (top bar with mission clock, mode switch `OPS · SURFACE · ANALYSIS · VERIFY` as APG tabs, collapsible left rail = today's sidebar, bottom-deck placeholder). Mapping: OPS = 3D Terrain, SURFACE = Surface, ANALYSIS = Compare + 2D map, VERIFY = Validation. | **The app works exactly as before inside the shell**; all tests green (update the tab-name queries). |
| **S2-2** | Bottom deck | The slip control moves out of the sidebar into the deck: SlipSlider + time bar + compact Sun/Earth/Both strips with a shared cursor. **From the demo redesign:** slip outlook heat strip (`slip-outlook.tsx`), "Try +N d" target button, scenario presets. Reconcile the presets with main's T30 scenarios (`docs/demo.md`, `pipeline/src/lunarnav/demo.py`), so one source of scenarios. | One slip control on screen; slip ≤ 33 ms with everything mounted (criterion 5, measured). |
| **S2-3** | Telemetry rail (real) | Mission clock `UTC … · L+Xd hh:mm · SLIP +15 d`; Sun telemetry (elevation, clearance, visible-fraction gauge, "sunset in …" from `nextEvents`); Earth link (elevation, clearance, **range km**, **one-way light time** from `bodyVectorKm`); status pills. Pure helpers with tests; no physics in components. | Every value matches the engine/timeline at the cursor (tests on fixtures). |
| **S2-4** | GO/NO-GO board + ANALYSIS | `gonogo/rules.ts` (thresholds visible in the header: POWER, COMMS, BOTH, LONGEST DARK, SLOPE → OVERALL) from real `missionMetrics`. **From the demo redesign:** site cards (`site-cards.tsx`: Both % ring, Sun/Earth bars, `explain()` sentence), restyled. The metric-cards table stays under "All metrics". Timeline, 2D panorama and 2D map stay. | Rules unit-tested; each cell has an icon + text (never colour alone). |
| **S2-5** | Intro + motion | ≈ 4 s skippable fly-in (`?nointro`, Esc, Skip, `prefers-reduced-motion`), boot log from real counts. Moon texture (approved; **ask before downloading**, ≈ 0.5 MB public domain). Number ticking, status pulses, cinema mode (`[` `]`), presentation mode. | Intro ≤ 4.5 s, never with `?nointro`; reduced motion respected. |
| **S2-6** | Slice 1 gap items | Scale bar; beacon hover mini-readout; stars in OPS; labels occluded by terrain. **Bloom only if wanted** (`@react-three/postprocessing` is one more dep; pin three ≤ 0.187). | Visual QA. |
| **S2-7** | Hardening + cleanup | Perf (budgets in demo plan §10), a11y (contrast ≥ 4.5:1 on glass, canvas text summaries, keyboard), responsive 1440/1024/390. **Remove dead chrome**: old tab bar and old layout CSS, leftover duplicate controls. Update `docs/demo.md` / demo script. Code review on the whole Slice 2 diff. | All checks green; preview smoke-tested; 30-second demo (demo plan §9) runs end to end. |
| **S2-8** | *(opt-in, later)* Illustrative models | Battery SoC (`power-model.ts`) and DSN handover strip (`dsn-mock.ts`), each with an `ILLUSTRATIVE` badge + assumptions popover. Needs a SPEC Deferred → V1 note first. | Only if the user asks. |

**Cut line:** S2-1 → S2-4 is the "console" demo. S2-5 and S2-6 are bonuses. If time runs out mid-Slice 2, the app still works because every phase keeps the old views reachable.

## 6. Risks for this migration

| Risk | Mitigation |
|---|---|
| Main keeps moving (teammates merge every ~30 min) | Small PRs, new files first, rebase before each PR. Check `gh pr list` and touched-file owners before starting each PR. |
| Port silently drops a demo fix | For each ported file, diff it against the demo file at `121986b` and list every intended difference in the PR description. |
| Two implementations of one thing (projection, colour ramps, tracks, Play) | §3 picks one per item. Main's wins unless the demo version is the only one. Never keep both. |
| Default-tab change breaks teammates' tests | `renderAppOnCompare()` helper + global webgl mock, in the same PR as the default change (P7). Tell the team in the PR. |
| 13 MB streamed after first paint on venue Wi-Fi | P9 measures brotli sizes on the preview. Fallback: defer the horizon grid until a shadow/overlay is needed (the demo handoff's `useGridWhen(displaySettled)` idea). |
| Slice 2 lands mid-feature-freeze | Start after #43; S2-1 keeps behaviour identical; cut line above. |
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
- Open data/engine issues (#104 SPEC-engine doc + fixtures, #103 lint guard, #89 stale-golden check) don't block UI v2.

## 11. Still open (small)

- Exact criterion 7 wording in P0: the team agreed on the substance; you confirm the sentence.
