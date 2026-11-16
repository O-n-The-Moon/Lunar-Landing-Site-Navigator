> **Reference copy, do not edit.** Copied verbatim from `O-n-The-Moon/Lunar-Landing-Site-Navigator-demo` @ `121986b` (branch `ui-v2-mission-console`, file `tasks/ui-v2-mission-console-plan.md`) on 2026-11-15. It is the **design source** (look, layout, modes, §8a build spec). How it lands in *this* repo is decided in [`ui-v2-integration-plan.md`](ui-v2-integration-plan.md); where they differ, the integration plan wins. Its workflow lines ("demo-fork exception", "never merge to main") apply to the demo repo only.

# Plan: UI v2, "Mission Console"

> **Branch:** `ui-v2-mission-console` (demo repo; demo-fork exception, never merge to `main`) · **Scope:** `web/` UI + one display-only pipeline step · **Status:** Slice 1 built, QA'd and reviewed; awaiting preview + user decision (see "Slice 1 status"). Slice 2 not started.
> **Starting point:** `bad5a52` on `main` (live at lunar-landing-site-navigator-demo.vercel.app, 654 tests green).

## Slice 1 status (2026-11-15 evening)

**S0–S4 are built, QA'd in Chrome, code-reviewed and fixed (`1141489`).** All checks green (716 web tests, 254 pipeline tests). The user said "look is right". Awaiting: a Vercel preview (to measure real load time and fps) and the user's decision on small gaps vs Slice 2. Details, decisions and gotchas: `handoffs/apokhrel7/2026-11-15-1822-ui-v2-slice1-reviewed.md`.
Deviations from §8a worth knowing: world X is not exactly `xKm` (true sphere; click-to-add inverts via `worldToLatLon`); display terrain uses `DemStack` (far-field fallback); beacon hover is a tooltip; no scale bar and no bloom in Slice 1. SPEC criterion 7 (≤ 3 MB initial) is exceeded in practice by the default 3D tab (2 MB display terrain + 11.4 MB horizon grid fetched after first frame); needs a team decision. Slice 2 is untouched.

## 1. Goal in one line

Turn the app from a nice dashboard into a **lunar mission control console**: a live 3D south pole whose **shadows move with the real Sun**, with telemetry, GO/NO-GO calls and the slip slider around it. A judge should say "wow" in the first 5 seconds and understand the answer by second 15.

**The demo moment:** drag the slip. On the 3D terrain the shadows sweep across the pole, the Athena beacon turns from green to red, the battery curve falls to zero, and the board flips to "NO-GO · Sun never clears the ridge". All of that is real ephemeris and terrain except the battery, which is labelled illustrative.

## 2. Decisions made

| Topic | Decision |
|---|---|
| 3D stack | `three` + `@react-three/fiber` **v8** (React 18) + `@react-three/drei` v9 + `@react-three/postprocessing` v2. Lazy-loaded chunk. **Approved by the user 2026-11-15.** Slice 1 skips postprocessing and adds `@types/three` (see §8a.1). |
| Layout | **Full mission console.** A full-bleed 3D stage with glass HUD panels around it. The existing charts move into an **Analysis** mode, not deleted. |
| Intro | **About 4 s skippable fly-in**, orbit → south pole, with a "systems online" boot log built from real data counts. Skipped by `?nointro`, Esc, the Skip button, or `prefers-reduced-motion`. |
| Illustrative models | **Battery/power**, **GO/NO-GO board**, **comms link + DSN handover strip**. Each mock carries an `ILLUSTRATIVE` badge, and its assumptions live in one constants file. |
| Kept as-is | Engine math, the existing data contract files, `state.ts`, `use-scenario-results.ts`, the grid worker. Additive only: `illuminationAt` in the engine, new display-terrain files, new loaders in `data.ts` (§8a.4). |

## 2b. Revised scope (2026-11-15, after the mock-up): visual slice first

The user liked the **3D terrain (OPS)** and **SURFACE** views most. So we build **only those two, very well**, inside the **current app** (its shell, sidebar, Compare, Map and Validation stay as they are), and the user reviews before anything else is built.

- **Slice 1** = §8 phases S0–S4: high-res display terrain, the 3D terrain view with live shadows, the Surface view, and a compact time/slip bar inside both.
- **Slice 2** (only if wanted after review) = the rest of this plan: console shell, telemetry rail, GO/NO-GO, battery/DSN, intro, restyle.
- **Why:** the current app already answers the question well. What it lacks is **visual impact**: it opens on cards and bars, the terrain is never *seen*, the slip changes numbers but you don't *watch* shadows move, and the panorama is precise but flat. These two views fix exactly that, and the full shell can wait until they're proven.

## 3. Design direction ("design contract")

**Feel:** a NASA/SpaceX flight-ops console, not a sci-fi game. Calm, dark and precise. The 3D scene is the hero; the chrome is thin and quiet.

| Element | Rule |
|---|---|
| Color | Space black `#05070a` with regolith greys. Keep the **3 signals**: Sun amber, Earth blue, Both green. Add **one alert red** for NO-GO and **one cyan HUD accent** for focus and selection only. No purple and no rainbow gradients. |
| Type | **Inter** for UI and **JetBrains Mono** for every number, timestamp and coordinate (tabular). Labels are small caps with wide tracking (`SUN ELEV`, `L+3d 04:12`). Fonts are self-hosted woff2 files in `public/fonts/`, so there are no runtime calls. |
| Panels | Translucent glass (`backdrop-filter: blur`), 1 px hairline border, **corner-bracket ticks** instead of rounded cards, radius ≤ 4 px. |
| Motion | Numbers tick to their new value (150 ms). Status lights pulse once when they change. Panels slide in on mode change. The camera eases (about 1 s). Nothing loops forever except Play. |
| Honesty | Every 3D view shows its **vertical exaggeration** (for example `TERRAIN ×3`). Mock panels carry an `ILLUSTRATIVE` badge. Hillshade and lighting are "display only". No invented crater geometry. |
| Reject | Fisheye sky view, fake procedural terrain, emoji or cartoon icons, a carousel of identical cards, color as the only signal (always add an icon or text). |

**Reference:** lunalink-moon.vercel.app, for its cinematic 3D south pole, low-chrome typography and mono labels. We borrow the *feeling*, not the layout or branding. Ours is denser and built for decisions, because the user is a planner, not a student.

## 4. Screen layout (≥ 1280 px)

```
┌ TOP BAR ─────────────────────────────────────────────────────────────────────────────────────────┐
│ ◐ LUNAR NAV   [ OPS | SURFACE | ANALYSIS | VERIFY ]   UTC 2029-02-21 04:12  L+1d 16:12   ● PWR ● COM │
│                                                        (mission clock)              (GO/NO-GO pills)│
├──────────────┬────────────────────────────────────────────────────────────────┬───────────────────┤
│ LEFT RAIL    │                                                                │ RIGHT RAIL         │
│ Scenarios    │             3D STAGE (full-bleed, behind the rails)            │ Focus site: A      │
│ Sites A B C  │   shaded south-pole terrain · LIVE shadows · site beacons      │ POWER  ▲ GO        │
│ Mission set  │   Sun ray + Earth ray · lat rings · overlay legend             │ Sun elev / clear   │
│ Assumptions  │                                                    ┌───────┐   │ Earth elev / range │
│ (collapsible)│                                                    │compass│   │ Battery SoC ▁▃▅▇▅▂ │
│              │                                                    └───────┘   │ DSN strip (illus.) │
├──────────────┴────────────────────────────────────────────────────────────────┴───────────────────┤
│ BOTTOM DECK  ▶ 1d/s │ SLIP  −30 ───────●──────── +90 d  [launch-window ribbon]  Try +15 d  Reset   │
│              A ████████░░░░  B ██░░░░████  C ░░██████   (compact Sun/Earth/Both strips, shared cursor)│
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- The rails and bottom deck **collapse** (chevron, plus `[` and `]` keys) for a "cinema" view of the stage.
- **≤ 1024 px:** rails become bottom sheets and the stage keeps 60 % of the height. **≤ 600 px:** the stage is 45 vh, then panels stack in order (answer first, as today).

## 5. The four modes

### OPS (default): 3D south pole
- **Terrain (display only):** a new **high-res display terrain** (see §5b) for the look; `grid-heights.bin` (182×182, 2 km) is the fallback until it loads. **×3 exaggeration (labelled)**, a regolith material and a circular fade-out at 84°S. Built once in a pure `terrain-mesh.ts` (tested).
- **Live shadows (the hero):** for the cursor time, compute each grid cell's **visible Sun fraction** (Sun az/el from the ephemeris vs. that cell's terrain horizon in `grid-horizons.bin`), in a worker, into a 182² texture that shades the terrain. These are real terrain-aware shadows, not WebGL shadow maps. Play animates them.
- **Sun and Earth:** a directional light at the real Sun azimuth/elevation (shading only), a thin glowing **Sun ray** and **Earth ray** from the pole toward each body, and a small compass dial (bottom right) with both bodies' azimuths.
- **Site beacons:** light pillars with HTML labels `A · IM-2 Athena`, colored by GO/NO-GO at the cursor and pulsing when the status changes. Click → the camera flies to the site and focuses it. Hover → a mini readout.
- **Overlays** (segmented control and legend): `Live shadows` · `PGDA avg Sun` · `PGDA avg Earth` · `Window score Sun/Earth/Both` (existing worker). Draped as textures. This **replaces the 2D Opportunity Map** as the primary view; the 2D map stays in Analysis.
- **Extras:** 85° and 88° lat rings, lon spokes with a `0°E` label, a scale bar, and a camera reset. Bloom only on the Sun, beacons and rays, plus a vignette.
- **Click terrain** → "Add custom site here (snapped to 2 km cell)", reusing the existing custom-site flow.

### SURFACE: standing at the lander (3D first-person)
- The camera sits at the focused site at eye height. The **horizon ring** is built from `horizonElevDeg` (0.5° azimuth steps, ×5 exaggeration as in the 2D view, labelled). Two or three fainter ridge layers sit in front for depth, always **below** the real silhouette, so the skyline stays the true one.
- **Sky:** a starfield (decorative), a **Sun disk with bloom** at its real az/el, and the **Earth** at its real az/el with a computed phase. Dotted **Sun and Earth tracks** for the mission, with day ticks (same data as the 2D panorama).
- **Lighting follows the engine:** when the engine says the Sun is blocked, the scene drops to earthshine and the HUD shows `SUN BLOCKED · ridge at az 112°, +1.4°`.
- Drag to look around (yaw only). During Play the camera follows the Sun. An "Engineering view" toggle shows the existing 2D unrolled panorama, unchanged.

### ANALYSIS: the numbers
- **GO/NO-GO board** (new, on top): rows are sites; columns are POWER, COMMS, BOTH, LONGEST DARK, SLOPE, then OVERALL. Each cell has an icon, text, the value and a Δ vs. the baseline. Thresholds are shown in the header.
- Existing **site cards, all-metrics table, mission timeline, 2D horizon panorama and 2D polar map**, restyled with the v2 tokens and no logic changes.
- **Battery chart** per site (illustrative), stacked with the Sun band.

### VERIFY: the trust story
- The existing Validation panel, restyled as a "verification console": big readouts (`EPHEMERIS vs JPL HORIZONS · MAX 0.00003°`, `TERRAIN vs PGDA · N/M within 5 pp`). **Every number still comes from `validation.json`.** Tables stay collapsible.

## 5b. High-res display terrain (pipeline, additive, display only)

The 2 km grid looks soft in 3D. To get close to a "real photo of the Moon" look, add a terrain file **only for drawing**. Every number (shadows, metrics, scores) still comes from the existing data.

- **Source:** `LDEM_80S_80M` (LOLA 80 m polar DEM, 7600², ±304 km), listed in `pipeline/src/lunarnav/fetch.py`. `fetch_all()` has no per-file option, so `uv run lunarnav fetch` downloads **all** sources (about 400 MB) into the gitignored `pipeline/data/raw/`. Nothing is on this machine yet.
- **No reprojection needed:** `PdsRaster` (`pipeline/src/lunarnav/dem.py:39`) already checks that this DEM uses the same south polar stereographic projection as the grid (centre −90°/0°, R 1737.4 km). The grid's ±182 km square lies inside it.
- **New command** `uv run lunarnav display-terrain` (new module `pipeline/src/lunarnav/display_terrain.py`; add the output paths to `io.py` and the command to `cli.py`, but **not** to `BUILD_STEPS`):
  - Heights = `PdsRaster(...).sample(x_km, y_km)` at the cell centres from `cell_centers_km((-182, -182), 364/1024, 1024, 1024)` (`horizons_grid.py:59`), **averaging 4×4 sub-samples per cell** (355.5 m is not a multiple of 80 m).
  - `web/public/data/terrain-display.bin`: 1024×1024 **int16-le** heights in metres, row-major `iy·nx + ix`, **iy = 0 = lowest y** (same order as `grid-heights.bin`). 2 MB raw.
  - `web/public/data/terrain-display.json`: manifest with `projection`, `sphereRadiusKm`, `originKm [-182,-182]`, `cellKm 364/1024`, `nx`, `ny`, `dtype`, `rowOrder`, `sourceDem`, `resampling: "mean of 4x4 samples"`, `note: "display only; never used for visibility"`.
  - **No normal-map image:** the pipeline has no image library (deps are numba, numpy, pyyaml, spiceypy; `pgda_layers.py` hand-writes PNGs). Pillow would be a new dep. **Compute normals in the browser** from the 1024² heights instead.
  - **Test** (`pipeline/tests/test_display_terrain.py`): build a synthetic DEM with the `write_raster` helper in `tests/test_dem.py`; check shape, row order and that a known cone apex lands in the right cell.
  - **Acceptance:** compared with `grid-heights.bin` at the 2 km cell centres (bilinear from the 1024² array), median |Δ| ≤ 50 m and p95 |Δ| ≤ 250 m.
- **Contract:** these are **new, additive files**; document them under a new "Display assets" heading in `SPEC.md`. Existing files are unchanged, and the engine never reads them.
- **Web:** loaded after the app is interactive; the 2 km mesh shows until they arrive, then swaps in. Same polar-stereographic square, so site positions and the shadow texture line up.
- **Honesty:** a label in the corner reads "Terrain: LOLA 80 m DEM, resampled · ×3 vertical · display only; visibility uses the 2 km horizon grid".

## 6. New panels (right rail and top bar)

| Panel | Data | Notes |
|---|---|---|
| Mission clock | Real (cursor, landing) | `UTC …` plus `L+Xd hh:mm`, with a slip badge `SLIP +15 d` in amber. |
| Status pills | Real metrics + rules | `PWR GO` / `COM NO-GO` / `SLOPE GO` for the focused site at the cursor and over the mission. |
| Sun telemetry | Real | Elevation, horizon clearance, visible-disk-fraction arc gauge, "sunset in 3d 04h". |
| Earth/comms link | Real + **illustrative** | Real: Earth elevation, clearance, **range (km)** and **one-way light time (≈1.28 s)** from the ephemeris vector. Illustrative: a **DSN handover strip** (Goldstone / Madrid / Canberra), each lit when the Moon is above that station's horizon (simple Earth-rotation model), shown as "link possible = Earth in view ∧ a station up". |
| Battery SoC | **Illustrative** | Integrates `panel W × Sun fraction − load W` over the mission. Defaults in `power-model.ts`: 2 kWh battery, 400 W array, 150 W load, start 100 %. Shows "Depleted at L+4.2 d" in red. Assumption values are visible in a popover. |

All models are **pure functions with unit tests**, and no component calls physics directly. Anything that needs body vectors goes through engine exports (`bodyVectorKm`, `azEl`, …).

## 7. Architecture

```
web/src/app/
  shell/        console-shell.tsx · top-bar.tsx · mode-switch.tsx · hud-panel.tsx (glass+brackets) · mission-clock.tsx · bottom-deck.tsx
  scene/        (lazy chunk) ops-scene.tsx · terrain-mesh.ts* · overlay-textures.ts* · site-beacons.tsx · celestial-rays.tsx
                camera-rig.tsx · compass.tsx · use-illumination.ts (main thread, see §8a.3)
  surface/      (lazy chunk) surface-scene.tsx · horizon-ring.ts* · sky.tsx · earth-phase.ts*
  telemetry/    telemetry-rail.tsx · gauges.tsx · power-model.ts* · battery-chart.tsx · comms-panel.tsx · dsn-mock.ts*
  gonogo/       go-no-go-board.tsx · rules.ts*
  intro/        intro-sequence.tsx (boot log + camera fly-in, reuses ops-scene)
  ui/           tokens.css (v2) · hud.css · icons.tsx (extend)
web/src/engine/grid.ts  (+ illuminationAt(eph, grid, tUtcMs, opts) → Float32Array, additive, tested)   * = pure + unit-tested
```

- **State:** no changes. `cursorMs`, slip, sites and focus already live in `state.ts`, and all views follow them. Add `mode` and `overlay` to UI state (local to the shell).
- **Engine:** one **additive** function, `illuminationAt`, built from the existing `azEl`, `horizonElevAt` and `visibleDiskFraction`. Every other engine function and the data contract stay as they are. This is the only non-UI code and it gets a test.
- **Lazy loading:** the 3D chunk loads through `React.lazy` after first paint. `grid-horizons.bin` (11.4 MB raw) starts downloading during the intro; until it arrives the terrain shows plain hillshade with the real Sun direction, and the shadows fade in when ready.
- **Fallbacks:** without WebGL → OPS shows the 2D polar map and SURFACE shows the 2D panorama, with a small notice. In jsdom tests the scene is mocked and the fallback is tested.

## 8. Phases (ordered by demo value; every checkpoint is demoable)

### Slice 1: build now (then stop for user review)

The views live **inside the current app** as two new tabs, **3D Terrain** (first and default) and **Surface**, next to Compare / Opportunity Map / Validation. The sidebar (sites, date, options) keeps driving them. **§8a is the build spec; where it conflicts with §5, §7 or §10, §8a wins.**

| # | Step | Delivers | Done when |
|---|---|---|---|
| S0 | **Prep** | Install the deps (§8a.1). Run `uv run lunarnav fetch` (about 400 MB, gitignored). Record a baseline: bundle size and `vitest` count. | `npm ci && npm run build` is green with the deps; DEM cached. |
| S1 | **Display terrain** | `lunarnav display-terrain` + pytest → `terrain-display.bin` + `.json` (§5b). | Acceptance numbers in §5b met; files ≤ 2.5 MB total. |
| S2 | **3D Terrain view** | Mesh on the sphere (§8a.2), browser-computed normals, regolith material, Sun light from the real Sun vector, Sun/Earth rays, site beacons (click = focus), 85°/88° rings, compass, camera fly-to, overlays (§8a.6), click terrain → add custom site, WebGL fallback to the 2D map. | ≥ 50 FPS at 1440p on an M1-class laptop; beacons on the right cells; overlay values = 2D map values. |
| S3 | **Live shadows + time bar** | `illuminationAt` (§8a.3) → shadow texture. Time bar (§8a.5): `SlipSlider` + a new cursor scrubber + Play with 1 h/s · 6 h/s · 1 d/s. | Shadows refresh ≤ 100 ms after a slip/cursor change; test in §8a.3 passes; the shadow check in §8a.3 holds for custom sites. |
| S4 | **Surface view** | Per §8a.7: horizon ring from the real mask (×5, labelled), depth layers below it, ground, starfield, Sun disk with a sprite glow, Earth with phase, mission tracks with day ticks, lit/blocked lighting + HUD banner, drag to look, follow the Sun during Play, a toggle to the existing 2D panorama. | The Sun disk drops behind the ridge in the same frame that `isUpAt` turns false (within the threshold rule in §8a.7). |

**After S4:** `cd web && npx tsc -b && npx eslint src && npx vitest run && npm run build` and `cd pipeline && uv run pytest && uv run ruff check .` all green; screenshots and a short GIF for the user. **Stop and wait for review.** No push and no merge.

### 8a. Slice 1 build spec (checked against the code on 2026-11-15)

**1. Dependencies (pin exact versions, because Vercel runs `npm ci`).** `three` + `@types/three` (same minor; three ships no types), `@react-three/fiber@8.x`, `@react-three/drei@9.x` (the last v9 is 9.122.0; import single components only, since it pulls in heavy deps).
- **Skip `@react-three/postprocessing` in Slice 1.** Its `postprocessing` 6.x requires three `>=0.168 <0.188`, and a sprite or additive glow on the Sun disk is enough. If bloom is added later, pin three ≤ 0.187.
- `@types/three` is a fifth package; it's types only, but confirm with the user at S0.
- Check peer ranges with `npm view <pkg> peerDependencies` before installing (`source-driven-development`).

**2. Coordinates.**
- Map plane: `latLonToKm(frame, latDeg, lonDeg)` / `kmToLatLon` / `cellAt` in `web/src/app/map/projection.ts`. Grid cell (ix, iy) centre = `originKm + (i + 0.5)·cellKm`.
- **3D world** (do not use a flat plane): the grid spans about 6° of colatitude, and the sphere drops about 9.5 km at 182 km from the pole, which is as large as the relief.
  - Put each vertex on the sphere at radius `R + 3·h` (R = 1737.4 km, h = height in km, ×3 exaggeration) along its MOON_ME radial.
  - Then map MOON_ME → world as **`world = (Ym, −Zm − R, −Xm)`**: the pole sits at the origin, world X = `xKm`, world Z = −`yKm`, and 0°E points to −Z, as on the 2D map.
- **Sun and Earth directions** = normalized `bodyVectorKm(eph, 'sun' | 'earth', t)` mapped the same way. Never use a single "azimuth at the pole" (it is undefined there; AGENTS.md gotcha).
- Mesh: a **512²** vertex grid sampling the 1024² heights; normals from the 1024² heights; the 2 km `grid-heights.bin` (182²) until the display file loads. `frameloop="demand"` (invalidate on cursor/slip/camera change, continuous only during Play) and DPR ≤ 1.5.

**3. `illuminationAt` (engine, additive, `web/src/engine/grid.ts`).**
- Signature: `illuminationAt(grid: Grid, eph: Ephemeris, tUtcMs: number, out?: Float32Array): Float32Array`. It returns the **raw visible Sun-disk fraction** 0…1 per cell, NaN for no-data cells. There is **no hysteresis**, because that needs history and this is one instant.
- Cache per-cell site frames in a `WeakMap<Grid, …>`. Read the u8 horizons directly and interpolate between the two neighbouring 1° bins; do not decode all masks to Float64 (that would be about 95 MB).
- Take the Sun angular radius from the Moon-centre distance, as `scoreGrid` does (`grid.ts:108`). Use `azEl`, `horizonElevAt` and `visibleDiskFraction` logic.
- **Main thread, not a worker:** about 33k cells take a few ms, and a worker would copy the 13 MB grid again. Drop `illumination.worker.ts`.
- **Test:** on `fixtureGrid`, with `opts = {...DEFAULT_VISIBILITY_OPTS, hysteresis: 0}` (check the field name in `types.ts`), `scoreGrid(grid, eph, t, t + 3_600_000, opts).sunPct[c]` must equal `frac[c] >= sunThreshold ? 100 : 0`. Skip cells within 0.02 of the threshold.
- **Shadow vs. timeline:** curated sites use their own 0.5° masks from `sites.json` at the exact point and at 2 or 10 m. The texture uses the 2 km cell's 1° mask at 2 m, up to about 1.4 km away. So "a blocked site sits in shadow" is checked **only for custom (grid) sites**. For curated sites, add a hint in the beacon tooltip: "map shading = 2 km cell; site status = site's own horizon".

**4. Data loading (this changes `data.ts`, contrary to §2 "kept as-is").**
- SPEC criterion 7 sets the first load at ≤ 3 MB. `grid-horizons.bin` is 11.4 MB raw (about 4.8 MB gzip), so it can't load at startup even though the 3D tab is the default.
- Order:
  1. Draw the 2 km mesh from `grid-heights.bin` (65 KB). This needs a heights-only loader, because `loadGrid` fetches horizons and heights together.
  2. Fetch `terrain-display.*` after the app is interactive.
  3. Fetch horizons (the existing `useGridOnDemand`) after first render, with a "Loading terrain shadows…" chip.
- Add `loadDisplayTerrain` (and a heights-only loader) to `DataSource` in `data.ts`, with a fixture fallback.
- **Update `app.test.tsx` deliberately:** it checks the exact tab list (line 22) and "loads the grid only when the Opportunity Map tab first opens" (line 35). Rewrite those tests for the new load order; don't delete them.

**5. Play / time bar.**
- Play lives in `timeline/timeline-panel.tsx` (`PLAY_SECONDS = 24`, stops when `active` = false, i.e. off the Compare tab). `SlipSlider` has no `active` prop. The only cursor scrubber is `MissionTimeline`'s `onCursorChange`.
- Extract **`usePlayCursor({ active, speedHPerS? })`** into its own hook. With no speed it keeps the current 24 s sweep, so existing tests still pass. `TimelinePanel` and the new time bar both use it.
- New `time-bar.tsx`: `SlipSlider` + a range-input cursor scrubber that dispatches `{ type: 'setCursor', cursorMs }` + Play + speed buttons. It's `active` when either 3D tab is showing.

**6. Overlays and beacons.**
- `state.ts` already has `mapLayer` (5 `MAP_LAYERS`: pgda-sun/earth, score-sun/earth/both). Reuse it, and add only a local "shadows" option in the 3D tab.
- Window scores (`use-grid-scores.ts`) and `pgdaPixelsToGrid` are in grid order (`iy·nx+ix`, iy = 0 lowest y), so upload them as a `DataTexture` with `flipY = false` (v = 0 at the lowest y). Colors come from `map/colormaps.ts`.
- Beacons: position from `latLonToKm`; height from `site.surfaceHeightM` (curated) or `grid.surfaceHeightM[c]` (custom).
- Click-to-add reuses `nearestGridCell` + the `addCustomSite` dispatch used by `pick` in `map/map-view.tsx`.

**7. Surface view data.**
- Move the private `bodyAt` and `track` from `panorama/panorama-panel.tsx` (lines 16, 33) into an exported `panorama/bodies.ts`, used by both views.
- Blocked = `isUpAt(windows, t)` from `timeline/mission-timeline.tsx`.
- Mask step = `ctx.azStepDeg`: 0.5° for curated sites, 1° for custom sites. Never hardcode it.
- Vertical exaggeration ×5: multiply the ridge, the Sun and Earth centre elevations and the disks' vertical radii by the same factor (the 2D view uses `ELEV_UNITS_PER_DEG / AZ_UNITS_PER_DEG` from `panorama/horizon-panorama.tsx`), or the sinking-Sun check fails.
- Lit/blocked follows the threshold and hysteresis rules, so a half-visible disk can still read "blocked". Show the visible fraction in the HUD (`SUN 38 % VISIBLE · BLOCKED`) so this reads as intended.
- Earth phase: a pure `earth-phase.ts` from the two `bodyVectorKm` results (Sun, Earth), with a unit test.

**8. Tests in jsdom.** There is no WebGL or ResizeObserver, so `vi.mock` the lazy scene modules in `app.test.tsx`. Add a `hasWebGL()` helper (mockable) so the 2D fallback is tested. Pure modules (`terrain-mesh.ts`, `earth-phase.ts`, `horizon-ring.ts`, `illuminationAt`, `usePlayCursor`) get unit tests.

**9. Files touched in Slice 1:** new `web/src/app/scene/*`, `web/src/app/surface/*`, `web/src/app/controls/time-bar.tsx`, `web/src/app/timeline/use-play-cursor.ts`, `web/src/app/panorama/bodies.ts`. Edited: `app.tsx`, `app.test.tsx`, `data.ts`, `timeline-panel.tsx`, `panorama-panel.tsx`, `engine/grid.ts` (+ test), `package.json` / lockfile, `pipeline/src/lunarnav/{display_terrain.py, io.py, cli.py}` + test, `SPEC.md` (Display assets), `web/public/data/terrain-display.*`.

### Slice 2: only if the user wants it after review

| # | Phase | Delivers | Done when |
|---|---|---|---|
| 0 | **Prep** | Dep approval. Font files. Small NASA Moon texture for the intro (public domain, about 0.5 MB, **ask before downloading**). Perf baseline (bundle, FPS). *Optional:* a visual mock-up of the console as a Claude Artifact (design intent) to lock the look before coding. | The team says yes to the deps; the look is agreed. |
| 1 | **Design system v2 + console shell** | Tokens, HUD panel, top bar with mission clock and pills, mode switch, bottom deck (slip + compact strips), rails. Existing views placed into ANALYSIS and VERIFY. The stage is a placeholder. | **CP1:** the app works exactly as before inside the new shell. Tests green. |
| 2 | **OPS 3D terrain** | Terrain mesh, camera rig, beacons, Sun/Earth rays, compass, overlays (PGDA + window score), click-to-focus, click-to-add-site, WebGL fallback. | **CP2:** 3D pole renders with ≥ 50 FPS on a laptop; overlays match the 2D map values. |
| 3 | **Live shadows + Play** ⭐ | `illuminationAt` + worker + texture. Play moves shadows, beacons and the clock together; speed control (1 h/s · 6 h/s · 1 d/s). | **CP3:** dragging the slip or cursor updates shadows in ≤ 100 ms; a "blocked" site sits in shadow. |
| 4 | **Telemetry + GO/NO-GO** | Right rail (Sun, comms, battery, DSN), status pills, GO/NO-GO board in ANALYSIS. | **CP4 = minimum shippable demo.** |
| 5 | **SURFACE 3D** | Horizon ring, sky, Sun/Earth with phase, tracks, blocked-Sun lighting, engineering-view toggle. | The Sun disk sinks behind the ridge exactly when the timeline says blocked. |
| 6 | **Intro + polish** | Fly-in, boot log ("EPHEMERIS · 61,368 epochs · SITES 12 · GRID 182×182"), number ticking, status pulses, cinema mode, **presentation mode** (higher contrast for projectors). | Intro ≤ 4.5 s, skippable, never shown with `?nointro`. |
| 7 | **Hardening + ship** | Perf pass, a11y pass, responsive pass, code review (`agent-skills:code-reviewer` on `git diff main...HEAD`), Vercel preview, updated demo script. | All checks below green; preview URL smoke-tested. |

**Cut line:** if time is short, ship **Phases 1–4** (shell + 3D + live shadows + telemetry). That is already the wow. SURFACE and the intro are bonuses.

## 9. Updated 30-second demo (target)

| s | Screen | Beat |
|---|---|---|
| 0–4 | Intro fly-in → OPS | "The Moon's south pole. The Sun skims the horizon, so mountains cast shadows hundreds of km long." |
| 4–10 | OPS, shadows, beacons A/B green | "These are real shadows from NASA terrain and ephemeris. Athena: power GO, comms GO." |
| 10–18 | Click **Try +15 d** | Shadows sweep, Athena turns red, battery hits zero, board: "NO-GO · Sun never clears the ridge". The ridge site turns green. |
| 18–24 | SURFACE on Athena, Play | "From the lander: the Sun slides along the ridge and never comes up." |
| 24–30 | VERIFY | "Checked against JPL Horizons, max error 0.00003°." |

## 10. Budgets and checks

- **Perf (measure first, `performance-optimization`):** slip slider ≤ 33 ms (existing); illumination update ≤ 100 ms; OPS ≥ 50 FPS at 1440p on an M1-class laptop and ≥ 30 FPS on integrated GPUs (DPR capped at 1.5); initial JS (non-3D) ≤ 120 kB gzip; 3D chunk ≤ 300 kB gzip; first paint ≤ 3 MB as today, with the grid loaded after it.
- **a11y:** every 3D fact is also in a panel as text; the canvas gets an `aria-label` summary; mode switch = APG tabs; beacons are reachable by keyboard through the site list; `prefers-reduced-motion` disables the intro, camera easing and pulses; contrast ≥ 4.5:1 on the glass panels.
- **Tests:** keep all 654 green (wrap them in the new shell). New unit tests for every `*` file in §7, `illuminationAt` against the existing grid scores (a cell lit at t ⇔ the score counts it), rules and models, and the fallback render. 3D is checked visually in Chrome at 1440 / 1024 / 390 px with screenshots.
- **Each phase:** `cd web && npx tsc -b && npx eslint src && npx vitest run && npm run build`.

## 11. Risks

| Risk | Mitigation |
|---|---|
| A 2 km grid looks soft up close | High-res display terrain from the LOLA 80 m DEM (§5b) + normal map; low-angle real lighting and shadows. No fake detail geometry. If the DEM download fails, ship on the 2 km mesh with smooth upsampling. |
| Judge laptop or projector GPU is slow | DPR cap, an `on-demand` render loop (render only on change or Play), 2D fallback, presentation mode. Test on the actual demo machine. |
| 11 MB grid download on venue Wi-Fi | Starts during the intro; check its gzip/brotli transfer size on Vercel; hillshade-only state looks fine until it arrives. |
| R3F/drei version clash with React 18 | Pin R3F v8 / drei v9; check the docs before installing. React 19 upgrade is out of scope. |
| Mock panels read as real | `ILLUSTRATIVE` badge, assumptions popover, separate color treatment (dashed outline). |
| Scope creep | Cut line above; map zoom, CSV export and URL sharing stay deferred. |

## 12. Resolved (2026-11-15)

1. **Deps approved:** `three`, `@react-three/fiber` v8, `@react-three/drei` v9, `@react-three/postprocessing` v2.
2. **Workflow:** demo-fork exception, no issue. All v2 work stays on `ui-v2-mission-console`. **Never merge it into `main`** (and never push without an explicit OK in that session). Demo it from a Vercel **preview** deployment of this branch.
3. **Moon texture:** approved. Download a downscaled public-domain NASA LRO CGI Moon Kit color map (about 0.5 MB) in Phase 0 / 6.
4. **Mock-up first:** a quick clickable Claude Artifact of the console (OPS / SURFACE / ANALYSIS / VERIFY with fake but realistic numbers) is used to agree the look before Phase 1. Feedback on it goes into §3 and §4 before any code.
   **Mock-up v1:** https://claude.ai/artifact/HYXWoavbJ2fvc3PzQKnnce (private; the 3D stage is drawn as flat SVG, and its numbers are placeholders except Athena/ridge at 0 d and the 0.00003° Horizons figure).
