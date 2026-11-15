// Regenerates every fixture in this folder: `node src/engine/__fixtures__/generate.mjs` (from web/).
// Synthetic, deterministic, dependency-free. The math below is a simplified stand-in for the engine
// (no bisection refinement, threshold-only grid scoring); it is NOT a parity reference. golden.json is.
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const OUT = new URL('./', import.meta.url)
const write = (name, data) => writeFileSync(new URL(name, OUT), data)
const writeJson = (name, obj) => write(name, JSON.stringify(obj, null, 2) + '\n')

const DEG = Math.PI / 180
const R_MOON_KM = 1737.4
const R_SUN_KM = 695_700
const R_EARTH_KM = 6_371
const H_MS = 3_600_000
const START_UTC = '2026-03-01T00:00:00Z'
const START_MS = Date.parse(START_UTC)
const HOURS = 48
const OPTS = { sunThreshold: 0.5, hysteresis: 0.05, earthMarginDeg: 1.0, earthHysteresisDeg: 0.1 }
const OBSERVER_HEIGHT_M = 2
const round = (x, d = 6) => Math.round(x * 10 ** d) / 10 ** d

// ---------------------------------------------------------------------------
// Ephemeris: 49 hourly samples (48 h inclusive), Sun and Earth relative to the Moon, MOON_ME, km.
// Sun: subsolar longitude drifts west one revolution per synodic month; subsolar latitude ≈ −1.2°.
// Earth: sub-Earth point librates in lon/lat (amplitudes ~6°, periods ~27 d).
// ---------------------------------------------------------------------------
const COUNT = HOURS + 1
function sphToVec(distKm, latDeg, lonDeg) {
  const [la, lo] = [latDeg * DEG, lonDeg * DEG]
  return [distKm * Math.cos(la) * Math.cos(lo), distKm * Math.cos(la) * Math.sin(lo), distKm * Math.sin(la)]
}
function sunAt(h) {
  return sphToVec(1.4855e8, -1.2 + 0.02 * Math.sin((2 * Math.PI * h) / 708), 109 - (360 * h) / (29.53 * 24))
}
function earthAt(h) {
  const lon = 6.0 * Math.sin((2 * Math.PI * h) / (27.55 * 24) + 0.4)
  const lat = -6.4 * Math.sin((2 * Math.PI * h) / (27.21 * 24) - 0.05)
  return sphToVec(383_000, lat, lon)
}
const positions = new Float32Array(COUNT * 2 * 3)
for (let t = 0; t < COUNT; t++) {
  positions.set(sunAt(t), t * 6)
  positions.set(earthAt(t), t * 6 + 3)
}
const ephBuf = Buffer.alloc(positions.length * 4)
positions.forEach((v, i) => ephBuf.writeFloatLE(v, i * 4))
write('ephemeris.bin', ephBuf)
writeJson('ephemeris.json', {
  schemaVersion: 1,
  frame: 'MOON_ME',
  abcorr: 'LT+S',
  observer: 'MOON',
  startUtc: START_UTC,
  stepS: 3600,
  count: COUNT,
  bodies: ['sun', 'earth'],
  units: 'km',
  dtype: 'float32-le',
  layout: '[t][body][xyz]',
  kernels: ['synthetic-fixture'],
})

function bodyVec(body, tMs) {
  const x = (tMs - START_MS) / H_MS
  const i = Math.min(Math.max(Math.floor(x), 0), COUNT - 2)
  const f = x - i
  const o = body === 'sun' ? 0 : 3
  return [0, 1, 2].map((k) => positions[i * 6 + o + k] * (1 - f) + positions[(i + 1) * 6 + o + k] * f)
}

// ---------------------------------------------------------------------------
// Geometry (same conventions as the contract: az clockwise from north, elev above spherical horizontal)
// ---------------------------------------------------------------------------
function siteFrame(latDeg, lonDeg, surfaceHeightM, observerHeightM) {
  const la = Math.max(-89.999, Math.min(89.999, latDeg)) * DEG
  const lo = lonDeg * DEG
  const r = R_MOON_KM + (surfaceHeightM + observerHeightM) / 1000
  const up = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)]
  return {
    pos: up.map((c) => c * r),
    east: [-Math.sin(lo), Math.cos(lo), 0],
    north: [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)],
    up,
  }
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
function azEl(frame, bodyKm) {
  const v = bodyKm.map((c, k) => c - frame.pos[k])
  const [e, n, u] = [dot(v, frame.east), dot(v, frame.north), dot(v, frame.up)]
  return {
    azDeg: ((Math.atan2(e, n) / DEG) % 360 + 360) % 360,
    elevDeg: Math.atan2(u, Math.hypot(e, n)) / DEG,
    distKm: Math.hypot(e, n, u),
  }
}
function horizonAt(mask, azStepDeg, azDeg) {
  const x = azDeg / azStepDeg
  const i0 = Math.floor(x) % mask.length
  const f = x - Math.floor(x)
  return mask[i0] * (1 - f) + mask[(i0 + 1) % mask.length] * f
}
function diskFraction(centerElevDeg, horizonElevDeg, radiusDeg) {
  const d = Math.max(-1, Math.min(1, (centerElevDeg - horizonElevDeg) / radiusDeg))
  return 1 - (Math.acos(d) - d * Math.sqrt(1 - d * d)) / Math.PI
}
const angRadiusDeg = (body, distKm) => Math.asin((body === 'sun' ? R_SUN_KM : R_EARTH_KM) / distKm) / DEG

// ---------------------------------------------------------------------------
// Sites: two synthetic sites with bumpy horizons (gaussian peaks over a low base).
// ---------------------------------------------------------------------------
function mask(azStepDeg, baseDeg, peaks, heightOffsetDeg) {
  return Array.from({ length: 360 / azStepDeg }, (_, i) => {
    const az = i * azStepDeg
    let h = baseDeg + 0.15 * Math.sin(3 * az * DEG)
    for (const [az0, ampDeg, widthDeg] of peaks) {
      const dAz = ((az - az0 + 540) % 360) - 180
      h += ampDeg * Math.exp(-((dAz / widthDeg) ** 2))
    }
    return round(h - heightOffsetDeg, 3)
  })
}
const SITE_DEFS = [
  {
    id: 'fixture-plateau',
    name: 'Fixture Plateau (synthetic)',
    category: 'clps',
    latDeg: -84.79,
    lonDeg: 29.2,
    surfaceHeightM: 1520,
    slopeDeg: 4.2,
    pgdaAvgSunPct: 58,
    pgdaAvgEarthPct: 64,
    base: 0.4,
    peaks: [[70, 4.5, 4], [335.5, 8, 1.5], [180, 1.5, 20]],
  },
  {
    id: 'fixture-ridge',
    name: 'Fixture Ridge (synthetic)',
    category: 'reference',
    latDeg: -89.9, // ~3 km from the pole: inside the 8 × 8 fixture grid
    lonDeg: -137.3,
    surfaceHeightM: 1980,
    slopeDeg: 11.5,
    pgdaAvgSunPct: 81,
    pgdaAvgEarthPct: 42,
    base: -0.4,
    peaks: [[236, 2, 3], [60, 1.2, 10], [345, 0.9, 6]],
  },
]
const sites = SITE_DEFS.map(({ base, peaks, ...s }) => ({
  ...s,
  coordSource: 'synthetic test fixture (not a real site)',
  horizonElevDeg: { 2: mask(0.5, base, peaks, 0), 10: mask(0.5, base, peaks, 0.08) },
}))
writeJson('sites.json', { schemaVersion: 1, azStepDeg: 0.5, heightsM: [2, 10], sites })

// ---------------------------------------------------------------------------
// Output fixtures: samples → windows → metrics → deltas, per site at 2 m.
// ---------------------------------------------------------------------------
function sampleSite(site, startMs, endMs, stepMin) {
  const frame = siteFrame(site.latDeg, site.lonDeg, site.surfaceHeightM, OBSERVER_HEIGHT_M)
  const m = site.horizonElevDeg[OBSERVER_HEIGHT_M]
  const out = { stepMin, tUtcMs: [], sunAzDeg: [], sunElevDeg: [], sunHorizonDeg: [], sunFraction: [], earthAzDeg: [], earthElevDeg: [], earthHorizonDeg: [] }
  for (let t = startMs; t <= endMs; t += stepMin * 60_000) {
    const sun = azEl(frame, bodyVec('sun', t))
    const earth = azEl(frame, bodyVec('earth', t))
    const sunH = horizonAt(m, 0.5, sun.azDeg)
    out.tUtcMs.push(t)
    out.sunAzDeg.push(round(sun.azDeg))
    out.sunElevDeg.push(round(sun.elevDeg))
    out.sunHorizonDeg.push(round(sunH))
    out.sunFraction.push(round(diskFraction(sun.elevDeg, sunH, angRadiusDeg('sun', sun.distKm))))
    out.earthAzDeg.push(round(earth.azDeg))
    out.earthElevDeg.push(round(earth.elevDeg))
    out.earthHorizonDeg.push(round(horizonAt(m, 0.5, earth.azDeg)))
  }
  return out
}

// Hysteresis on a series; crossing times interpolated linearly and rounded to the minute.
function windowsFromSeries(t, v, onAt, offAt) {
  const wins = []
  const cross = (i, level) => {
    const f = (level - v[i - 1]) / (v[i] - v[i - 1])
    return Math.round((t[i - 1] + f * (t[i] - t[i - 1])) / 60_000) * 60_000
  }
  let on = v[0] >= (onAt + offAt) / 2
  let start = t[0]
  for (let i = 1; i < t.length; i++) {
    if (!on && v[i] >= onAt) {
      on = true
      start = cross(i, onAt)
    } else if (on && v[i] <= offAt) {
      on = false
      wins.push({ startMs: start, endMs: cross(i, offAt), clippedStart: start === t[0], clippedEnd: false })
    }
  }
  if (on) wins.push({ startMs: start, endMs: t[t.length - 1], clippedStart: start === t[0], clippedEnd: true })
  return wins
}
function intersect(a, b) {
  const out = []
  for (const x of a) {
    for (const y of b) {
      const s = Math.max(x.startMs, y.startMs)
      const e = Math.min(x.endMs, y.endMs)
      if (e > s) {
        out.push({
          startMs: s,
          endMs: e,
          clippedStart: (s === x.startMs && x.clippedStart) || (s === y.startMs && y.clippedStart),
          clippedEnd: (e === x.endMs && x.clippedEnd) || (e === y.endMs && y.clippedEnd),
        })
      }
    }
  }
  return out.sort((p, q) => p.startMs - q.startMs)
}
function detectWindows(s) {
  const { sunThreshold: th, hysteresis: hy, earthMarginDeg: em, earthHysteresisDeg: eh } = OPTS
  const earthClear = s.earthElevDeg.map((e, i) => e - s.earthHorizonDeg[i] - em)
  const sun = windowsFromSeries(s.tUtcMs, s.sunFraction, th + hy, th - hy)
  const earth = windowsFromSeries(s.tUtcMs, earthClear, eh, -eh)
  return { sun, earth, both: intersect(sun, earth) }
}

function onMs(wins, a, b) {
  return wins.reduce((sum, w) => sum + Math.max(0, Math.min(w.endMs, b) - Math.max(w.startMs, a)), 0)
}
function longestGapMs(wins, a, b) {
  let longest = 0
  let cursor = a
  for (const w of wins) {
    if (w.endMs <= a || w.startMs >= b) continue
    longest = Math.max(longest, Math.max(w.startMs, a) - cursor)
    cursor = Math.min(w.endMs, b)
  }
  return Math.max(longest, b - cursor)
}
function firstSetH(wins, a, b) {
  const w = wins.find((x) => !x.clippedEnd && x.endMs > a && x.endMs < b)
  return w ? round((w.endMs - a) / H_MS, 4) : null
}
function missionMetrics(samples, wins, landingMs, durationH) {
  const endMs = landingMs + durationH * H_MS
  const pct = (ws) => round((100 * onMs(ws, landingMs, endMs)) / (endMs - landingMs), 4)
  const inMission = samples.sunFraction.filter((_, i) => samples.tUtcMs[i] >= landingMs && samples.tUtcMs[i] <= endMs)
  return {
    landingMs,
    durationH,
    sunlitPct: pct(wins.sun),
    earthPct: pct(wins.earth),
    bothPct: pct(wins.both),
    longestSunGapH: round(longestGapMs(wins.sun, landingMs, endMs) / H_MS, 4),
    longestEarthGapH: round(longestGapMs(wins.earth, landingMs, endMs) / H_MS, 4),
    firstSunsetH: firstSetH(wins.sun, landingMs, endMs),
    firstEarthsetH: firstSetH(wins.earth, landingMs, endMs),
    meanSunFraction: round(inMission.reduce((x, y) => x + y, 0) / inMission.length),
  }
}
function eventDelta(a, b) {
  if (a === null || b === null) {
    return { deltaH: null, change: a === b ? 'none' : a === null ? 'appeared' : 'disappeared' }
  }
  const deltaH = round(b - a, 4)
  return { deltaH, change: deltaH === 0 ? 'none' : 'shifted' }
}
function diffMetrics(a, b) {
  const d = (k) => round(b[k] - a[k], 4)
  return {
    ...Object.fromEntries(['sunlitPct', 'earthPct', 'bothPct', 'longestSunGapH', 'longestEarthGapH', 'meanSunFraction'].map((k) => [k, d(k)])),
    firstSunsetH: eventDelta(a.firstSunsetH, b.firstSunsetH),
    firstEarthsetH: eventDelta(a.firstEarthsetH, b.firstEarthsetH),
  }
}

const SCENARIO = { startMs: START_MS, endMs: START_MS + HOURS * H_MS, baselineLandingMs: START_MS, slipH: 12, durationH: 24, observerHeightM: OBSERVER_HEIGHT_M, opts: OPTS }
const outputs = { scenario: SCENARIO, sites: {} }
for (const site of sites) {
  const samples = sampleSite(site, SCENARIO.startMs, SCENARIO.endMs, 10)
  const windows = detectWindows(samples)
  const baseline = missionMetrics(samples, windows, SCENARIO.baselineLandingMs, SCENARIO.durationH)
  const slipped = missionMetrics(samples, windows, SCENARIO.baselineLandingMs + SCENARIO.slipH * H_MS, SCENARIO.durationH)
  const f = siteFrame(site.latDeg, site.lonDeg, site.surfaceHeightM, OBSERVER_HEIGHT_M)
  const frame = { latDeg: site.latDeg, lonDeg: site.lonDeg, positionKm: f.pos, east: f.east, north: f.north, up: f.up }
  outputs.sites[site.id] = { frame, samples, windows, metrics: { baseline, slipped }, metricDelta: diffMetrics(baseline, slipped) }
}
writeJson('outputs.json', outputs)

// ---------------------------------------------------------------------------
// Grid: 8 × 8 cells at 2 km around the pole, 360 az bins, 2 m. Cell (7, 7) has no data.
// Projection assumption (south polar stereographic): x = ρ sin(lon), y = ρ cos(lon), ρ = 2R tan(c/2).
// ---------------------------------------------------------------------------
const GRID = { nx: 8, ny: 8, cellKm: 2, originKm: [-8, -8], azBins: 360 }
const gridManifest = {
  schemaVersion: 1,
  projection: 'polar-stereographic-south',
  sphereRadiusKm: R_MOON_KM,
  originKm: GRID.originKm,
  cellKm: GRID.cellKm,
  nx: GRID.nx,
  ny: GRID.ny,
  azBins: GRID.azBins,
  heightM: 2,
  dtype: 'uint8',
  encoding: 'elevDeg = v * 0.1 - 5.0; 255 = no data',
  cellSurfaceHeightM: 'grid-heights.bin (int16-le, row-major)',
}
writeJson('grid.json', gridManifest)
const cells = GRID.nx * GRID.ny
const horizonsU8 = new Uint8Array(cells * GRID.azBins)
const heightsBuf = Buffer.alloc(cells * 2)
const noData = (ix, iy) => ix === 7 && iy === 7
for (let iy = 0; iy < GRID.ny; iy++) {
  for (let ix = 0; ix < GRID.nx; ix++) {
    const c = iy * GRID.nx + ix
    heightsBuf.writeInt16LE(1000 + 25 * ix - 10 * iy, c * 2)
    const m = mask(360 / GRID.azBins, 0.3 + 0.05 * iy, [[(ix * 45 + iy * 20) % 360, 2.5, 15]], 0)
    for (let a = 0; a < GRID.azBins; a++) {
      horizonsU8[c * GRID.azBins + a] = noData(ix, iy) ? 255 : Math.max(0, Math.min(254, Math.round((m[a] + 5) / 0.1)))
    }
  }
}
write('grid-horizons.bin', horizonsU8)
write('grid-heights.bin', heightsBuf)

function cellLatLon(ix, iy) {
  const x = GRID.originKm[0] + (ix + 0.5) * GRID.cellKm
  const y = GRID.originKm[1] + (iy + 0.5) * GRID.cellKm
  const c = 2 * Math.atan(Math.hypot(x, y) / (2 * R_MOON_KM))
  return { latDeg: -90 + c / DEG, lonDeg: Math.atan2(x, y) / DEG }
}
const scores = { startMs: SCENARIO.startMs, endMs: SCENARIO.endMs, nx: GRID.nx, ny: GRID.ny, sunPct: [], earthPct: [], bothPct: [] }
for (let iy = 0; iy < GRID.ny; iy++) {
  for (let ix = 0; ix < GRID.nx; ix++) {
    if (noData(ix, iy)) {
      scores.sunPct.push(null)
      scores.earthPct.push(null)
      scores.bothPct.push(null)
      continue
    }
    const c = iy * GRID.nx + ix
    const { latDeg, lonDeg } = cellLatLon(ix, iy)
    const frame = siteFrame(latDeg, lonDeg, heightsBuf.readInt16LE(c * 2), 2)
    const m = Array.from(horizonsU8.subarray(c * GRID.azBins, (c + 1) * GRID.azBins), (v) => v * 0.1 - 5)
    let sunN = 0, earthN = 0, bothN = 0
    for (let h = 0; h < HOURS; h++) {
      const t = START_MS + h * H_MS
      const sun = azEl(frame, bodyVec('sun', t))
      const earth = azEl(frame, bodyVec('earth', t))
      const lit = diskFraction(sun.elevDeg, horizonAt(m, 1, sun.azDeg), angRadiusDeg('sun', sun.distKm)) >= OPTS.sunThreshold
      const link = earth.elevDeg - horizonAt(m, 1, earth.azDeg) >= OPTS.earthMarginDeg
      sunN += lit
      earthN += link
      bothN += lit && link
    }
    scores.sunPct.push(round((100 * sunN) / HOURS, 3))
    scores.earthPct.push(round((100 * earthN) / HOURS, 3))
    scores.bothPct.push(round((100 * bothN) / HOURS, 3))
  }
}
writeJson('grid-scores.json', scores)

// ---------------------------------------------------------------------------
// PGDA layers: 8 × 8 8-bit grayscale PNGs (value = %), synthetic gradients on the grid extent.
// ---------------------------------------------------------------------------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function grayPng(width, height, valueAt) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.set([8, 0, 0, 0, 0], 8) // 8-bit, grayscale, deflate, no filter, no interlace
  // PNG rows run top to bottom; grid row iy = 0 is the bottom (y = originKm[1]).
  const raw = Buffer.alloc(height * (width + 1))
  for (let row = 0; row < height; row++) {
    for (let ix = 0; ix < width; ix++) raw[row * (width + 1) + 1 + ix] = valueAt(ix, height - 1 - row)
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
write('pgda-sun.png', grayPng(GRID.nx, GRID.ny, (ix, iy) => Math.min(100, 30 + 6 * ix + 3 * iy)))
write('pgda-earth.png', grayPng(GRID.nx, GRID.ny, (ix, iy) => Math.min(100, 45 + 5 * iy - 2 * ix)))
writeJson('pgda-layers.json', {
  schemaVersion: 1,
  source: 'synthetic test fixture (stands in for PGDA product 69)',
  resolutionM: 2000,
  observerHeightM: null,
  projection: 'polar-stereographic-south',
  originKm: GRID.originKm,
  cellKm: GRID.cellKm,
  nx: GRID.nx,
  ny: GRID.ny,
  encoding: '8-bit grayscale, value = percent; top PNG row = highest y',
  layers: { sun: 'pgda-sun.png', earth: 'pgda-earth.png' },
})

// ---------------------------------------------------------------------------
// validation.json: hand-picked small errors; one PGDA outlier with an explanation.
// ---------------------------------------------------------------------------
const hzRows = []
for (const [si, site] of sites.entries()) {
  for (const [ei, h] of [6, 30].entries()) {
    for (const body of ['sun', 'earth']) {
      const t = START_MS + h * H_MS
      const frame = siteFrame(site.latDeg, site.lonDeg, 0, 0)
      const ours = azEl(frame, bodyVec(body, t))
      const azErr = round(0.002 + 0.003 * si + 0.001 * ei + (body === 'earth' ? 0.004 : 0), 4)
      const elErr = round(0.001 + 0.002 * ei + (body === 'earth' ? 0.003 : 0), 4)
      hzRows.push({
        siteId: site.id,
        tUtcMs: t,
        body,
        oursAzDeg: round(ours.azDeg, 4),
        oursElevDeg: round(ours.elevDeg, 4),
        horizonsAzDeg: round(ours.azDeg + azErr, 4),
        horizonsElevDeg: round(ours.elevDeg - elErr, 4),
        azErrDeg: azErr,
        elevErrDeg: elErr,
      })
    }
  }
}
const mean = (xs) => round(xs.reduce((a, b) => a + b, 0) / xs.length, 4)
const pgdaRows = [
  { siteId: sites[0].id, oursSunPct: 60.4, pgdaSunPct: 58, sunDiffPp: 2.4, oursEarthPct: 62.9, pgdaEarthPct: 64, earthDiffPp: -1.1, explanation: null },
  {
    siteId: sites[1].id,
    oursSunPct: 74.2,
    pgdaSunPct: 81,
    sunDiffPp: -6.8,
    oursEarthPct: 43.5,
    pgdaEarthPct: 42,
    earthDiffPp: 1.5,
    explanation: 'Synthetic outlier: ridge-top site where a 2 km cell under-resolves the local horizon.',
  },
]
writeJson('validation.json', {
  schemaVersion: 1,
  horizons: {
    rows: hzRows,
    summary: {
      n: hzRows.length,
      maxAzErrDeg: Math.max(...hzRows.map((r) => r.azErrDeg)),
      maxElevErrDeg: Math.max(...hzRows.map((r) => r.elevErrDeg)),
      meanAzErrDeg: mean(hzRows.map((r) => r.azErrDeg)),
      meanElevErrDeg: mean(hzRows.map((r) => r.elevErrDeg)),
    },
  },
  pgda: {
    rows: pgdaRows,
    summary: {
      thresholdPp: 5,
      sitesWithinThreshold: pgdaRows.filter((r) => Math.abs(r.sunDiffPp) <= 5 && Math.abs(r.earthDiffPp) <= 5).length,
      sitesTotal: pgdaRows.length,
      maxAbsSunDiffPp: Math.max(...pgdaRows.map((r) => Math.abs(r.sunDiffPp))),
      maxAbsEarthDiffPp: Math.max(...pgdaRows.map((r) => Math.abs(r.earthDiffPp))),
    },
  },
})

// Summary for eyeballing that the fixtures exercise transitions.
for (const [id, o] of Object.entries(outputs.sites)) {
  const s = o.samples
  const span = (xs) => `${Math.min(...xs).toFixed(2)}…${Math.max(...xs).toFixed(2)}`
  console.log(id, {
    sunAz: span(s.sunAzDeg),
    sunElev: span(s.sunElevDeg),
    sunHorizon: span(s.sunHorizonDeg),
    earthAz: `${s.earthAzDeg[0].toFixed(2)}→${s.earthAzDeg.at(-1).toFixed(2)}`,
    sunAzDir: `${s.sunAzDeg[0].toFixed(2)}→${s.sunAzDeg.at(-1).toFixed(2)}`,
    earthElev: `${s.earthElevDeg[0].toFixed(2)}→${s.earthElevDeg.at(-1).toFixed(2)}`,
    sunElevDir: `${s.sunElevDeg[0].toFixed(2)}→${s.sunElevDeg.at(-1).toFixed(2)}`,
    earthHorizon: span(s.earthHorizonDeg),
    sunWindows: o.windows.sun.length,
    earthWindows: o.windows.earth.length,
    bothWindows: o.windows.both.length,
  })
  console.log('  baseline', o.metrics.baseline)
  console.log('  delta   ', o.metricDelta)
}
console.log('grid sun%', scores.sunPct.join(' '))
console.log('grid earth%', scores.earthPct.join(' '))
