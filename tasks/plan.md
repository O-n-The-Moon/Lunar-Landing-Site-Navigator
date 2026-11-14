# Implementation Plan: Lunar Landing Site Navigator V1

Source spec: [`SPEC.md`](../SPEC.md) (+ `SPEC-data-pipeline.md`, `SPEC-engine.md`, `SPEC-app.md`)
**Tasks are tracked as GitHub issues** in [O-n-The-Moon/Lunar-Landing-Site-Navigator](https://github.com/O-n-The-Moon/Lunar-Landing-Site-Navigator/issues). Each issue has its acceptance criteria, verification, owned files, dependencies, and branch name. The index below is the ordered map; the issues are the source of truth for task details. Workflow: [`CONTRIBUTING.md`](../CONTRIBUTING.md).

## Overview
48-hour build of a static web app. Python precomputes Sun/Earth ephemeris and LOLA terrain horizons; the browser turns them into instant, terrain-aware power and DTE answers for south-pole landing sites. Centerpiece: a live slip slider, horizon panorama and opportunity map, all validated against JPL Horizons and PGDA.

## Architecture Decisions
- **Data contract first.** All modules build in parallel against fixtures (#3); real data swaps in later. Contract changes need team agreement.
- **Pre-created files, single owners.** #2 pre-registers every pipeline command and module stub, #3 stubs the whole engine API, and #7 defines the full app state plus a placeholder for every view. After that, each issue owns its own files, so there are minimal merge conflicts.
- **Prop-driven visuals.** Timeline, panorama and map components take data as props and are built against fixtures, so Viz never waits on Engine or UI.
- **Thin vertical slice before breadth.** By h16, one real site works end-to-end and is deployed (Checkpoint 1 go/no-go).
- **Riskiest work first.** Data download (#4) and the horizon ray-march (#8) start immediately; the PGDA terrain check (#20) happens before Checkpoint 1.

## Labels & Milestones
- **Priority:** `priority:P0-critical` (critical path / blocks many) · `P0` (must-have) · `P1` (after all P0) · `P2` (only if time)
- **Area:** `area:pipeline` · `area:engine` · `area:ui` · `area:viz` · `area:validation` · `area:devops-docs` · **Size:** `size:XS/S/M` · `risk`
- **Milestones** = phases. **Checkpoint issues** (#41–#44) are phase gates blocked by every issue in their phase.

## Suggested roles (4 people, assign yourselves on the issues)
| Role | Issues |
|---|---|
| **Data** (Python, critical path) | #4 #6 #8 #9 #11 #24 #25 #31 |
| **Engine** (TS math + validation) | #2 #3 #10 #12 #13 #14 #18 #20 #26 |
| **UI** (React app) | #7 #15 #19 #21 #27 #30 #32 #34 #39 |
| **Viz** (visuals + research + demo) | #5 #16 #17 #22 #23 #28 #29 #33 #36 #38 |
| Anyone / all | #1 #35 #37 #40 |

## Issue Index

### Phase 0: Foundation (h0–3)
| Issue | Task | Prio | Blocked by |
|---|---|---|---|
| #1 | Spec, plan, contributing guide | P0-crit | — |
| #2 | Repo scaffold + pre-created stubs | P0-crit | — |
| #3 | Engine types, API stubs, fixtures | P0-crit | #2 |
| #4 | Data fetch spike (kernels, DEMs, PGDA) ⚠️ | P0-crit | #2 |
| #5 | Curated site catalog | P0 | — |
| #6 | Ephemeris + Python geometry | P0-crit | #4 |
| #7 | App shell, full state, placeholders | P0-crit | #3 |
| #46 | Make `ci` a required check on `main` | P0 | #2 |
| #47 | Agent skill guide in CLAUDE.md | P0 | — |
| **#41** | **Checkpoint 0** | | all above |

### Phase 1: One real site end-to-end (h3–16)
| Issue | Task | Prio | Blocked by |
|---|---|---|---|
| #8 | Horizon ray-march core ⚠️ | P0-crit | #4 #6 |
| #9 | Site horizons → sites.json | P0-crit | #5 #8 |
| #10 | Engine geometry | P0 | #3 |
| #11 | Golden vectors | P0-crit | #6 #9 |
| #12 | Golden parity tests | P0 | #10 #11 |
| #13 | Sampling, windows, events | P0 | #10 |
| #14 | Mission metrics + diff | P0 | #13 #11 |
| #15 | Real engine + metric cards | P0 | #14 #7 |
| #16 | Timeline strip | P0 | #3 (soft #7) |
| #17 | Horizon panorama v1 | P0 | #3 (soft #7) |
| #18 | Validation: Horizons | P0 | #6 |
| #19 | Vercel deploy | P0 | #7 |
| #20 | Validation: PGDA ⚠️ | P0-crit | #9 |
| **#42** | **Checkpoint 1: GO/NO-GO** | | all above |

### Phase 2: All P0 features (h16–30)
| Issue | Task | Prio | Blocked by |
|---|---|---|---|
| #21 | Compare + slip slider + deltas | P0 | #15 |
| #22 | Timeline ghost + shared cursor | P0 | #16 #21 |
| #23 | Panorama mission tracks | P0 | #17 |
| #24 | Grid horizons build | P0-crit | #8 |
| #25 | PGDA map layers | P0 | #4 |
| #26 | Grid engine + worker | P0 | #14 |
| #27 | Custom site + options | P0 | #7 #26 |
| #28 | Opportunity map v0 | P0 | #7 (soft #25) |
| #29 | Opportunity map v1 (window scores) | P0 | #24 #26 #28 |
| #30 | Validation panel | P0 | #7 (soft #18 #20) |
| #31 | Demo scenario finder | P0 | #9 |
| **#43** | **Checkpoint 2**: no new P0 after this | | all above |

### Phase 3: Polish + demo (h30–44)
| Issue | Task | Prio | Blocked by |
|---|---|---|---|
| #32 | Shareable URL | P1 | #21 |
| #33 | Play/animate | P1 | #22 #23 |
| #34 | Polish, labels, a11y | P0 | #21 |
| #35 | Fresh-user test | P0 | #43 |
| #36 | Demo script, video, slides | P0 | #31 #43 |
| #37 | Bug bash + perf | P0 | #43 |
| #38 | Map zoom/pan | P2 | #29 |
| #39 | CSV export | P2 | #21 |
| **#44** | **Checkpoint 3: FEATURE FREEZE** | | #34–#37 |

### Phase 4: Submit (h44–48)
| #40 | Final deploy + submission | P0 | #44 |
|---|---|---|---|

## Critical Path
`#4 → #6 → #8 → #9 → #11 / #20 → (#42) → #24 → #29`. Keep the Data person on only this. If Data falls behind, Engine takes #11 (golden vectors).

## Risks and Mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| DEM names/sizes differ from expectations | High | #4 at h0; SPEC Open Q4 answered by Checkpoint 0 |
| Horizons disagree with PGDA | High | Checked at Checkpoint 1, not at the end; align definitions/observer height first (Open Q2) |
| Grid build too slow | Med | 60-min budget → 4 km grid; manifest-driven, so no app change |
| Artemis III points unclear | Med | #5 decides via the SPEC Open Q1 rule by h3 |
| Slip slider misses 33 ms | Med | Engine 5 ms/site budget; measure in #21 |
| Merge conflicts | Med | Pre-created files (#2, #3, #7), owned-files lists, small PRs |
| Scope creep | Med | New ideas → SPEC "Deferred"; no new P0 after #43 |

## Open Questions
- Project board: add all issues to [Project #1](https://github.com/orgs/O-n-The-Moon/projects/1) (needs `gh auth refresh -s project`).
- Branch protection: enabled (PR required, 0 approvals, squash-only). Make `ci` a required check via #46.
