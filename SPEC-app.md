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
│ Scenario      │  [Compare]  [Opportunity Map]  [Validation]  (tabs) │
│ - sites (≤3)  │  ┌ metric cards: Site A | Site B | Site C ────────┐ │
│ - landing UTC │  │ sunlit% earth% both% gaps slope next-sunset Δ  │ │
│ - duration    │  └────────────────────────────────────────────────┘ │
│ - SLIP slider │  timeline strips (one per site, shared cursor)       │
│ - obs height  │  horizon panorama (focused site)                     │
│ - thresholds  │                                                     │
└───────────────┴─────────────────────────────────────────────────────┘
```

## Features & acceptance

### P0-1 Data loading
- Load `ephemeris`, `sites.json`, `validation.json` on startup. Load the grid files lazily when the Map tab first opens (show progress).
- **Accept:** SPEC.md criterion 7; a load error shows a clear message, not a blank screen.

### P0-2 Scenario controls
- Site picker: curated list grouped by category, showing slope; add up to 3; remove; set a focused site.
- Custom site: lat/lon input, snapped to the nearest grid cell; label shows "Custom 85.12°S 30.40°E (snapped 0.8 km)". Outside coverage → inline error.
- Landing date/time (UTC), mission duration (1–30 days, default 14), **slip slider** (−30…+90 days, 1-day steps, plus fine ±12 h), observer height (2 / 10 m; grid-snapped sites: 2 m only, labelled), Sun threshold, Earth margin.
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
- Canvas, polar-stereographic grid extent, pole at center, lat rings (85°, 88°) and lon spokes.
- Layers: **v0** PGDA average Sun / Earth (static); **v1** window score (Sun % / Earth % / Both %) for [landing, landing + duration], computed by `scoreGrid` in a **Web Worker**, recomputed when the window changes (debounced 300 ms).
- Curated site markers; hover readout (lat, lon, value); click → add as custom site.
- **Accept:** SPEC.md criterion 6; UI stays responsive during computation.

### P0-7 Validation panel
- Summary badges (e.g. "Ephemeris vs JPL Horizons: max 0.0X°", "Terrain vs PGDA: N/M sites within 5 pp") read directly from `validation.json`; detail tables; a short methods list (frame, kernels, DEMs, definitions, assumptions such as "geometric DTE").
- **Accept:** every number shown comes from `validation.json`.

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
