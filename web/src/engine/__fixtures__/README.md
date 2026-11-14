# Engine fixtures

Tiny **synthetic** data so UI and viz work can start before the pipeline or the engine math exist. None of it is real lunar data, and it is **not** a parity reference: `shared/fixtures/golden.json` is.

Import the typed versions from `src/engine/__fixtures__` (`index.ts`):

| Export | What |
|---|---|
| `fixtureEphemeris` (+ manifest, raw bin) | 48 h, hourly (49 samples) from 2026-03-01T00:00Z. Sun ~1 AU, Earth ~383,000 km with libration |
| `fixtureSitesFile` | 2 sites (`fixture-plateau` ≈ 84.8°S, `fixture-ridge` 89.9°S, inside the fixture grid), 720-bin masks at 2 m and 10 m |
| `fixtureGrid` (+ manifest, raw bins) | 8 × 8 cells at 2 km around the pole, 360 az bins; cell (ix 7, iy 7) is no-data (255) |
| `fixturePgdaLayers`, `fixturePgdaPngUrls` | 8 × 8 grayscale PNGs (value = %) on the grid extent |
| `fixtureValidation` | Horizons rows/summary and PGDA rows/summary, including one > 5 pp outlier with an explanation |
| `fixtureScenario` | Baseline landing at range start, 24 h mission, slip +12 h, default `VisibilityOpts` |
| `fixtureOutputs[siteId]` | `ctx` (real `SiteContext`; frame precomputed), `samples` (10 min), `windows`, `metrics.{baseline,slipped}`, `metricDelta` |
| `fixtureGridScores` | Grid scores over the 48 h range (NaN = no data) |

What the outputs exercise: sunsets and sunrises at both sites; at the plateau Earth sets after the slip; at the ridge Earth rises after the slip; `firstEarthsetH` null at baseline, so its delta is `change: 'appeared'`; a no-data grid cell.

## Regenerate

```bash
cd web && node src/engine/__fixtures__/generate.mjs
```

`generate.mjs` uses no dependencies. Its math stands in for the engine, simplified: crossings are interpolated linearly to the minute (no bisection), and grid scores apply the thresholds without hysteresis. Once T8/T11/T12/T25 land, the output fixtures can be regenerated from the real engine. Assumptions made here that the owning tasks may change:

- Grid `originKm` is the lower-left corner; cell centers are at `originKm + (i + 0.5) × cellKm`; row `iy = 0` is the lowest y.
- South polar stereographic: `x = ρ sin(lon)`, `y = ρ cos(lon)`, `ρ = 2R tan(c/2)`.
- The PNG's top row is the highest y.
- Grid scores sample hours `startMs … endMs − 1 h` (half-open range, 48 samples for 48 h), each sample standing for one hour.
