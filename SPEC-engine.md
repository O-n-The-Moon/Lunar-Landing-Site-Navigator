# Spec: `engine` — V1

> Module of `SPEC.md`. Lives in `web/src/engine/`. Pure TypeScript: no React, DOM, or fetch. Data arrives as already-parsed objects/ArrayBuffers.

## Objective

Turn the data-contract files into everything the UI shows: Sun and Earth az/el, visibility, windows/events, mission metrics, and grid scores. Fast enough for live slip dragging, and numerically identical to the Python reference (`golden.json`).

## Public API

```ts
// data
loadEphemeris(manifest: EphemerisManifest, buf: ArrayBuffer): Ephemeris
loadGrid(manifest: GridManifest, horizons: ArrayBuffer, heights: ArrayBuffer): Grid

// geometry
bodyVectorKm(eph: Ephemeris, body: Body, tUtcMs: number): Vec3        // linear interp between hourly samples
siteFrame(latDeg: number, lonDeg: number, surfaceHeightM: number, observerHeightM: number): SiteFrame // position + ENU
azEl(site: SiteFrame, bodyVecKm: Vec3): AzEl                           // topocentric = body − site
horizonElevAt(maskDeg: ArrayLike<number>, azStepDeg: number, azDeg: number): number // linear, wraps at 360
angularRadiusDeg(body: Body, distKm: number): number                   // Sun 695,700 km, Earth 6,371 km
visibleDiskFraction(centerElevDeg, horizonElevDeg, radiusDeg): number  // circular-segment formula

// time series & events
sampleSite(ctx: SiteContext, startMs: number, endMs: number, stepMin = 10): SiteSamples
detectWindows(samples: SiteSamples, opts: VisibilityOpts): { sun: Window[]; earth: Window[]; both: Window[] }
nextEvents(windows, tUtcMs): { sunsetInH; sunriseInH; earthsetInH; earthriseInH }  // null if none in range

// metrics
missionMetrics(ctx: SiteContext, landingMs: number, durationH: number, opts: VisibilityOpts): MissionMetrics
diffMetrics(a: MissionMetrics, b: MissionMetrics): MetricDelta          // slip vs baseline

// grid
scoreGrid(grid: Grid, eph: Ephemeris, startMs: number, endMs: number, opts: VisibilityOpts): GridScores // Float32Array per metric
nearestGridCell(grid: Grid, latDeg: number, lonDeg: number): { ix; iy; snapDistKm } | null
```

`VisibilityOpts` defaults: `{ sunThreshold: 0.5, hysteresis: 0.05, earthMarginDeg: 1.0, earthHysteresisDeg: 0.1, observerHeightM: 2 }`.

## Definitions (the contract with the UI)

| Term | Definition |
|---|---|
| **Sunlit** | Sun visible-disk fraction ≥ `sunThreshold` (turns on at ≥ threshold + hysteresis, off at ≤ threshold − hysteresis) |
| **Earth link (geometric DTE)** | Earth-center elevation ≥ terrain horizon + `earthMarginDeg` (± hysteresis) |
| **Both** | Sunlit ∧ Earth link |
| `sunlitPct`, `earthPct`, `bothPct` | % of mission duration in each state |
| `longestSunGapH`, `longestEarthGapH` | longest continuous off-period inside the mission window |
| `firstSunsetH`, `firstEarthsetH` | hours from landing to the first on→off transition (null if never) |
| `meanSunFraction` | mean visible fraction over the mission (power proxy) |
| `sunElevDeg` at cursor | geometric elevation, plus `sunClearanceDeg` = elevation − terrain horizon |

Events are found on the 10-min samples, then refined by bisection to **1 min**.

## Performance
- `sampleSite` + `detectWindows` + `missionMetrics` for 30 days: ≤ 5 ms per site (supports the SPEC.md 33 ms slip budget for 3 sites + rendering).
- `scoreGrid` for 33k cells × 30 days at a 1 h step: ≤ 3 s in a Web Worker. Body vectors are computed once per hour and shared across cells; each cell only does local ENU dot products. No per-call allocation in the inner loop (preallocated typed arrays).

## Testing (Vitest)
- **Golden parity** with `shared/fixtures/golden.json`: az/el ≤ 1e-3°, fraction ≤ 1e-3, scenario totals ≤ 10 min.
- **Unit:** `visibleDiskFraction` (d = −1, 0, 1, symmetry); `horizonElevAt` wrap at 359.75° → 0°; interpolation at hour boundaries; hysteresis suppresses flicker on a synthetic grazing series; `nextEvents` when no event exists; `nearestGridCell` outside coverage → null; site exactly at −90° handled (clamped to −89.999°).
- Fixture-sized test data lives in `web/src/engine/__fixtures__/` (small slices, not the full files).

## Boundaries (additions)
- **Always:** degrees at the API boundary, radians internally; every exported function has a test.
- **Never:** import from `src/app`, React, or browser globals; mutate input buffers.
