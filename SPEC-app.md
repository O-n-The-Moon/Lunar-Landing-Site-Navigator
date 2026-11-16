# Spec: `app` — V1

> Module of `SPEC.md`. Lives in `web/src/app/` (+ `web/src/workers/`). Consumes `engine` only. No physics in components.

## Objective

A single-page planner tool. Load → pick sites → set date → drag the slip → read the answer and the reason. Dense, technical, dark UI suited to mission-ops (planners only, no tutorial mode).

## Priorities
- **P0:** must ship. Build in this order.
- **P1:** only once all P0 items work end-to-end on Vercel (target: hour 30).

## Layout

```
┌───────────────┬─────────────────────────────────────────────────────┐
│ Scenario      │  [3D Terrain] [Surface] [Compare] [Opportunity Map] [Validation]  (tabs) │
│ - sites (≤3)  │  ┌ metric cards: Site A | Site B | Site C ────────┐ │
│ - landing UTC │  │ sunlit% earth% both% gaps slope next-sunset Δ  │ │
│ - duration    │  └────────────────────────────────────────────────┘ │
│ - SLIP slider │  timeline strips (one per site, shared cursor)       │
│ - obs height  │  horizon panorama (focused site)                     │
│ - thresholds  │                                                     │
└───────────────┴─────────────────────────────────────────────────────┘
```

**3D Terrain is the default tab.** The Compare content above shows when the Compare tab is open. Tabs mount on first open and then stay mounted (a hidden 3D tab freezes its render loop). A later slice may trim the tab set; see `tasks/ui-v2-integration-plan.md`.

## Features & acceptance

### P0-1 Data loading
- Load `ephemeris`, `sites.json`, `validation.json` on startup. The app is interactive as soon as these are in.
- **Staged load** for the default 3D Terrain tab, each stage with a visible state: (1) the 2 km heights (`grid-heights.bin`) draw a coarse terrain; (2) `terrain-display.bin` replaces it with the 1024² display terrain; (3) the horizon grid (`grid.json` + `grid-horizons.bin`) streams in with progress, and the shadow layer and score overlays appear when it lands. PGDA rasters load only when a PGDA overlay is picked. The grid files also load when another tab needs them (Opportunity Map, custom sites).
- **Accept:** SPEC.md criterion 7; a load error shows a clear message, not a blank screen; a failed terrain or grid fetch offers a retry and leaves the other tabs working.

### P0-2 Scenario controls
- Site picker: curated list grouped by category, showing slope; add up to 3; remove; set a focused site.
- Custom site: lat/lon input, snapped to the nearest grid cell; label shows "Custom 85.12°S 30.40°E (snapped 0.8 km)". Outside coverage → inline error.
- Landing date/time (UTC), mission duration (1–30 days, default 14), **slip slider** (−30…+90 days, 1-day steps, plus fine ±12 h), observer height (2 / 10 m; grid-snapped sites: 2 m only, labelled), Sun threshold (visible-disk fraction 0–1, default 0.5), Earth margin (0–10°, default 1°).
- **Accept:** all controls drive the engine; the slip slider meets SPEC.md criterion 5.

### P0-3 Metric cards (compare)
- One column per site: sunlit %, Earth link %, both %, longest Sun gap, longest Earth gap, first sunset/Earthset after landing, mean Sun fraction, slope (red if > 10°).
- Each metric shows a **Δ vs. unslipped baseline** when slip ≠ 0 (green better / red worse).
- **Accept:** values equal `missionMetrics` output; Δ appears and disappears correctly at slip = 0.

### P0-4 Timeline strips
- Per site: three bands (Sun / Earth / Both) across the mission window, with a faint **ghost of the baseline** (slip = 0) under each band so losses are visible.
- Shared draggable cursor; at the cursor show Sun elevation, clearance, "sunset in Xh Ym", "Earthset in Xh Ym".
- **Accept:** band edges match `detectWindows` within 1 px; cursor readouts match `nextEvents`.

### P0-5 Horizon panorama (focused site)
- Unrolled 360° view: x = azimuth (re-centerable on Sun or Earth), y = elevation −5°…+12° with **visible vertical-exaggeration label**.
- Filled terrain silhouette (selected observer height); Sun track over the mission (colored lit/blocked, day ticks); Earth track (libration loop); Sun (0.53°) and Earth (~1.9°) disks drawn **to angular scale** at the cursor time.
- Hover → az, elev, horizon elevation, time.
- **Accept:** at a cursor time where the timeline says "blocked", the Sun disk is drawn below the silhouette.

### P0-6 Opportunity map
- Canvas, polar-stereographic grid extent, pole at center, lat rings (85°, 88°) and lon spokes. The same layers also drape on the 3D Terrain tab (P0-8); this 2D map stays as the WebGL fallback. A hidden map does not score.
- Layers: **v0** PGDA average Sun / Earth (static); **v1** window score (Sun % / Earth % / Both %) for [landing, landing + duration], computed by `scoreGrid` in a **Web Worker**, recomputed when the window changes (debounced 300 ms).
- Curated site markers; hover readout (lat, lon, value); click → add as custom site.
- **Accept:** SPEC.md criterion 6; UI stays responsive during computation.

### P0-7 Validation panel
- Summary badges (e.g. "Ephemeris vs JPL Horizons: max 0.0X°", "Terrain vs PGDA: N/M sites within 5 pp") read directly from `validation.json`; detail tables; a short methods list (frame, kernels, DEMs, definitions, assumptions such as "geometric DTE").
- **Accept:** every number shown comes from `validation.json`.

### P0-8 3D Terrain tab (default)
- The south pole as terrain: the 1024² display terrain (look only, labelled "display terrain, not used for visibility") with **×3 vertical exaggeration, shown on screen**, and a fade-out at 84°S. Real sphere geometry; lat rings (85°, 88°), lon spokes with a `0°E` label, compass dial.
- **Live shadows:** at the cursor time, each grid cell's visible Sun fraction (`illuminationAt`, from `grid-horizons.bin`) shades the terrain. Real terrain-aware shadows, not WebGL shadow maps. The shadow update is deferred so a slip step never waits on it. A directional light at the real Sun az/el shades the mesh; Sun and Earth rays point to the bodies.
- **Site beacons:** a pillar and label per selected site (`A · IM-2 Athena`), colored by the timeline's own state at the cursor and labelled in words (`SUN + EARTH`, `SUN ONLY`, `EARTH ONLY`, `NO SUN, NO EARTH`). No GO/NO-GO wording. Click focuses the site. Hover explains which horizon mask the state uses (the site's own 0.5° mask).
- **Overlays** (segmented control, legend): `Live shadows` · `PGDA avg Sun` · `PGDA avg Earth` · `Window score Sun/Earth/Both` (the existing grid-scoring worker; score overlays carry the "grid-approximate (2 km)" label). Draped on the terrain; values equal the 2D map's for the same cell.
- Click terrain → add as custom site (snapped to the 2 km cell), through the existing custom-site flow.
- Without WebGL, or if the scene throws, the tab falls back to the 2D map with a short notice.
- **Accept:** beacons sit on the right cells; the overlay value at a cell equals the 2D map's; shadows refresh ≤ 100 ms after a cursor move; the slip slider stays ≤ 33 ms (criterion 5) with this tab visible; one grid-scoring job per window change however many consumers are mounted.

### P0-9 Surface tab (first-person)
- The camera stands at the focused site at eye height. The horizon ring comes from the site's `horizonElevDeg` (the same mask as the 2D panorama, with a **visible exaggeration label**); fainter ridge layers sit in front, always below the real silhouette.
- Sun disk and Earth (with computed phase) at their real az/el; dotted Sun and Earth tracks with day ticks (the same tracks as P0-5). When the engine says the Sun is blocked, the scene drops to earthshine and the HUD names the ridge (`SUN BLOCKED · ridge at az 112°, +1.4°`). Earth text distinguishes "EARTH BLOCKED" from a margin/hysteresis miss.
- Drag or arrow keys to look around (yaw only); Follow Sun; an "Engineering view (2D)" toggle shows the P0-5 panorama; the cursor is controllable here too.
- **Accept:** the Sun disk is below the silhouette in exactly the frames where the timeline says blocked (same threshold rule, `isIn`).

### P1 (only after P0 is complete)
1. URL-encoded scenario (sites, landing, slip, duration, opts) for sharing between teams.
2. Play/animate the cursor through the mission (panorama + timeline move together).
3. Map zoom/pan.
4. CSV export of windows per site.

## State
- React `useReducer` + context for scenario state; derived engine results in `useMemo`. No state library (adding one counts as a dependency, so "ask first").

## Testing
- Vitest + Testing Library: metric cards render a fixture scenario correctly, including Δ values at slip ≠ 0; the custom-site snap message.
- Manual demo checklist in `docs/demo.md`.

## Boundaries (additions)
- **Always:** label assumptions next to the numbers they affect (observer height, DTE margin, terrain resolution); keyboard-operable slider and cursor.
- **Never:** compute physics in components (call the engine); block the main thread with grid scoring.
