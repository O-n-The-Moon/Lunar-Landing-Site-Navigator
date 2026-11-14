# Lunar Landing Site Navigator: Decision Record

> **What this is:** why we chose this direction, and which ideas we dropped or deferred. Read it before proposing new features.
> **Authoritative scope lives in [`SPEC.md`](../../SPEC.md)**. If this file and the spec disagree, the spec wins.

## Problem Statement
How might we let a mission planner go from *"the launch slipped 3 weeks"* to *"here is the best site/date now, and why"* in under a minute?

## Audience
**Mission planners only** (team decision). No educator/public mode in V1. Judges are generalists, so the planner visuals must still read in 5 seconds without explanation.

## Recommended Direction
Precompute everything. Sun and Earth positions come from SPICE (the Moon's MOON_ME frame, corrected for light travel time). Terrain horizon outlines come from LOLA elevation data. With both precomputed, every view updates instantly in the browser with no backend.

The product is built around a **slip slider**. Changing the landing date updates the metrics, timelines, horizon panorama and opportunity map live, so planners see what a delay costs and why (which ridge blocks the Sun or Earth). Credibility comes from validating against **JPL Horizons** (Sun/Earth positions) and **NASA PGDA product 69** (terrain-aware long-term averages).

Existing tools (Quickmap, Moon Trek, Horizons, PGDA maps, SVS animations) are either one query at a time or long-term averages. Nobody offers fast, date-specific comparison of Sun and Earth together across scenarios. That gap is our angle.

## Ideas Considered

| # | Idea | Decision | Why |
|---|---|---|---|
| 1 | Slip simulator (drag landing date, see what you lose) | ✅ **MVP core** | The challenge's actual pain: schedule slips |
| 2 | Sky view with terrain horizon + Sun/Earth tracks | ✅ **MVP**, as an **unrolled 360° panorama** | Explains *why*. Fisheye rejected: at the pole everything sits within ±5° of the horizon, so it collapses into a thin ring |
| 3 | 3D first-person panorama with animated shadows | ⏸ Nice-to-have #2 | Biggest wow, but costly; the 2D panorama already explains "why" |
| 4 | Feasibility calendar (sites × days grid) | ✅ Partial: timeline strips + side-by-side compare | The full grid is visually dull on its own |
| 5 | Opportunity map (date window → south pole heatmap) | ✅ **MVP** (promoted after review) | Obvious visual for judges; PGDA averages give a free v0 |
| 6 | AI mission copilot | ⏸ Nice-to-have (last) | Judges see many LLM wrappers; only worth it on top of a real engine |
| 7 | Power model: vertical panels + battery charge | ⏸ Nice-to-have #3 | Strong expert credibility, but needs hardware assumptions |
| 8 | Scenario diff + PDF export | ⏸ Nice-to-have (last) | Table stakes, low differentiation |

## MVP: Must-Haves
1. SPICE ephemeris pipeline (MOON_ME frame, light-time corrected, 2026–2032, hourly, static file)
2. Terrain horizon outlines from LOLA: curated sites (2 m and 10 m observer) + a 2 km grid over 84–90°S
3. Client engine: az/el, visible fraction of the Sun and Earth disks, windows/events, mission metrics
4. Site picker: curated list (Artemis III regions, IM-2, reference sites) + custom lat/lon snapped to the grid
5. Timeline strips with a ghost of the original date and time to sunset/Earthset at the cursor
6. Slip slider with live Δ vs the original date
7. Horizon panorama (unrolled, vertically exaggerated)
8. Side-by-side comparison of 2–3 sites, including slope
9. Opportunity map: v0 PGDA averages → v1 date-window heatmap (Web Worker)
10. Validation panel: Horizons + PGDA comparisons, read from `validation.json`

## Not Doing (and Why)
- **Backend / live Horizons calls:** Horizons has no CORS; precomputed data is faster and works offline
- **Smooth-sphere (no-terrain) answers for custom points:** confidently wrong at the pole; we snap to terrain-aware grid cells instead
- **Global coverage / Apollo / far side:** the south pole (84–90°S) is the challenge's focus. Chandrayaan-3 (69°S) and Chang'e-6 (far side, no Earth view) are excluded
- **DSN scheduling, link budgets:** V1 uses "geometric DTE + elevation margin", clearly labelled
- **Educator/public mode, accounts, saved scenarios:** audience is planners; no backend
- **5 m south pole DEM for horizons:** 3.3 GB and too small an area; 80 m + 240 m DEMs suffice

## Nice-to-Haves (priority order, only after the MVP works end-to-end)
1. Shareable URL, play/animate, map zoom, CSV export (app P1)
2. 3D first-person panorama (#3)
3. Power model: vertical panels + battery charge (#7)
4. Auto-suggest alternate sites/dates after a slip (extends #1)
5. AI copilot (#6), PDF decision brief (#8)

## Key Assumptions to Validate
- [ ] **Our terrain horizons are accurate enough.** Test: long-term averages per site within ±5 pp of PGDA product 69 (day 1, highest risk; fallback: published masks / coarser grid)
- [ ] **Ephemeris matches JPL.** Test: ≤ 0.02° vs the Horizons API
- [ ] **A 9-day-ish slip visibly changes the outcome at a real site.** Test: find a concrete demo scenario in the data (`docs/demo.md`)
- [ ] **The grid computation fits the time budget.** Test: 2 km grid in ≤ 60 min, otherwise 4 km

## What the Review Changed
An independent review (no shared context) caught:
- the fisheye chart problem → panorama
- PA vs ME frame mismatch → MOON_ME
- missing light-time correction
- wrong Earth-parallax number: ~0.26°, not ~1°
- treating the Sun as a point → disk fraction + hysteresis
- "Earth above the horizon" ≠ a usable link → margin, labelled "geometric DTE"
- the opportunity map being deferred → promoted
- smooth-sphere custom sites → grid snap
- out-of-coverage sites in the list

It also pointed us to PGDA product 69 for validation.

## Open Questions
See [`SPEC.md` → Open Questions](../../SPEC.md#open-questions).
