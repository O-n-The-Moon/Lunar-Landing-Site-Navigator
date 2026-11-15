// Grid: cell lookup, per-cell site context, and window scoring over the whole grid (SPEC-engine → Performance).
import { angularRadiusDeg, bodyVectorKm, siteFrame } from './geometry'
import type { Ephemeris, Grid, GridCellRef, GridScores, SiteContext, VisibilityOpts } from './types'
import { sunHysteresisLevels } from './windows'

const H_MS = 3_600_000
const DEG = Math.PI / 180
const NO_DATA = 255
/** Hourly lead-in before startMs, so the hysteresis state at startMs comes from history (as in missionMetrics). */
const PRE_ROLL_H = 48

/** Cell index `iy · nx + ix`, or -1 if (ix, iy) is not a cell of the grid. */
function cellIndex(grid: Grid, ix: number, iy: number): number {
  const { nx, ny } = grid.manifest
  const ok = Number.isInteger(ix) && Number.isInteger(iy) && ix >= 0 && ix < nx && iy >= 0 && iy < ny
  return ok ? iy * nx + ix : -1
}

/** True if any azimuth bin of the cell is 255 (the pipeline writes no-data cells as 255 in every bin). */
function isNoData(grid: Grid, c: number): boolean {
  const { azBins } = grid.manifest
  const h = grid.horizonsU8
  for (let i = c * azBins, end = i + azBins; i < end; i++) if (h[i] === NO_DATA) return true
  return false
}

/** Lat/lon of a cell center: inverse south polar stereographic (x = ρ sin lon, y = ρ cos lon, ρ = 2R tan(c/2)). */
function cellCenterLatLon(grid: Grid, ix: number, iy: number): { latDeg: number; lonDeg: number } {
  const { originKm, cellKm, sphereRadiusKm } = grid.manifest
  const xKm = originKm[0] + (ix + 0.5) * cellKm
  const yKm = originKm[1] + (iy + 0.5) * cellKm
  const rhoKm = Math.hypot(xKm, yKm)
  const colatRad = 2 * Math.atan(rhoKm / (2 * sphereRadiusKm))
  return { latDeg: -90 + colatRad / DEG, lonDeg: rhoKm === 0 ? 0 : Math.atan2(xKm, yKm) / DEG }
}

/** Great-circle distance on a sphere (haversine). */
function greatCircleKm(radiusKm: number, lat1Deg: number, lon1Deg: number, lat2Deg: number, lon2Deg: number): number {
  const sinDLat = Math.sin(((lat2Deg - lat1Deg) * DEG) / 2)
  const sinDLon = Math.sin(((lon2Deg - lon1Deg) * DEG) / 2)
  const a = sinDLat * sinDLat + Math.cos(lat1Deg * DEG) * Math.cos(lat2Deg * DEG) * sinDLon * sinDLon
  return 2 * radiusKm * Math.asin(Math.min(1, Math.sqrt(a)))
}

/**
 * Grid cell whose center is nearest to (lat, lon), with the great-circle distance to that center. Null outside the
 * grid extent or on a no-data cell (no terrain horizon there). Throws RangeError for non-finite or |lat| > 90.
 */
export function nearestGridCell(grid: Grid, latDeg: number, lonDeg: number): GridCellRef | null {
  if (!(Number.isFinite(latDeg) && Number.isFinite(lonDeg) && Math.abs(latDeg) <= 90)) {
    throw new RangeError(`invalid coordinates (${latDeg}, ${lonDeg})`)
  }
  const { originKm, cellKm, sphereRadiusKm } = grid.manifest
  const rhoKm = 2 * sphereRadiusKm * Math.tan(((90 + latDeg) * DEG) / 2)
  const ix = Math.floor((rhoKm * Math.sin(lonDeg * DEG) - originKm[0]) / cellKm)
  const iy = Math.floor((rhoKm * Math.cos(lonDeg * DEG) - originKm[1]) / cellKm)
  const c = cellIndex(grid, ix, iy)
  if (c < 0 || isNoData(grid, c)) return null
  const center = cellCenterLatLon(grid, ix, iy)
  const lonNormDeg = lonDeg - 360 * Math.round(lonDeg / 360) // −180…180, so 315° and −45° give identical distances
  return { ix, iy, snapDistKm: greatCircleKm(sphereRadiusKm, latDeg, lonNormDeg, center.latDeg, center.lonDeg) }
}

/**
 * Context for a grid cell (a grid-snapped custom site): frame at the cell center on the cell surface height, at the
 * grid observer height (`manifest.heightM`, 2 m), with the cell's decoded horizon as the mask.
 * Throws RangeError for an index outside the grid or a no-data cell.
 */
export function gridSiteContext(eph: Ephemeris, grid: Grid, cell: Pick<GridCellRef, 'ix' | 'iy'>): SiteContext {
  const c = cellIndex(grid, cell.ix, cell.iy)
  if (c < 0) throw new RangeError(`cell (${cell.ix}, ${cell.iy}) is not in the grid`)
  if (isNoData(grid, c)) throw new RangeError(`cell (${cell.ix}, ${cell.iy}) has no horizon data`)
  const { azBins, heightM } = grid.manifest
  const horizonMaskDeg = new Float64Array(azBins)
  for (let i = 0; i < azBins; i++) horizonMaskDeg[i] = grid.horizonsU8[c * azBins + i] * 0.1 - 5
  const { latDeg, lonDeg } = cellCenterLatLon(grid, cell.ix, cell.iy)
  const frame = siteFrame(latDeg, lonDeg, grid.surfaceHeightM[c], heightM)
  return { eph, frame, horizonMaskDeg, azStepDeg: 360 / azBins, observerHeightM: heightM }
}

/** Same option checks as detectWindows. */
function checkOpts({ sunThreshold, hysteresis, earthMarginDeg, earthHysteresisDeg }: VisibilityOpts): void {
  if (!(sunThreshold >= 0 && sunThreshold <= 1)) throw new RangeError(`sunThreshold must be in [0, 1], got ${sunThreshold}`)
  if (!Number.isFinite(earthMarginDeg)) throw new RangeError(`earthMarginDeg must be finite, got ${earthMarginDeg}`)
  if (!(hysteresis >= 0 && earthHysteresisDeg >= 0)) {
    throw new RangeError(`hysteresis must be ≥ 0, got ${hysteresis} / ${earthHysteresisDeg}°`)
  }
}

/**
 * Sun / Earth / both % per cell over [startMs, endMs). Hourly samples at startMs, startMs + 1 h, …, each standing
 * for one hour (the last one for what is left of the range). Sunlit and Earth link follow SPEC-engine → Definitions,
 * with hysteresis applied on the hourly samples and the state at startMs taken from up to 48 h of hourly lead-in
 * (clamped to the ephemeris start), as in missionMetrics. No refinement between samples. No-data cells are NaN.
 *
 * Body vectors are computed once per sample and shared by all cells; the Sun's angular radius per sample is taken
 * from the Moon-center distance (the site offset changes it by < 1e-5 relative). `onProgress` gets the fraction of
 * rows done after each row. Throws RangeError for an empty/inverted range, a range outside the ephemeris, or bad opts.
 */
export function scoreGrid(
  grid: Grid,
  eph: Ephemeris,
  startMs: number,
  endMs: number,
  opts: VisibilityOpts,
  onProgress?: (fraction: number) => void,
): GridScores {
  if (!(Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs)) {
    throw new RangeError(`invalid score range [${startMs}, ${endMs})`)
  }
  if (startMs < eph.startUtcMs || endMs > eph.startUtcMs + (eph.count - 1) * eph.stepMs) {
    throw new RangeError(`range [${startMs}, ${endMs}) is outside the ephemeris coverage`)
  }
  checkOpts(opts)

  // --- per-sample data, shared by every cell ---
  const preH = Math.min(PRE_ROLL_H, Math.floor((startMs - eph.startUtcMs) / H_MS))
  const nScored = Math.ceil((endMs - startMs) / H_MS)
  const m = preH + nScored
  const sunKm = new Float64Array(m * 3)
  const earthKm = new Float64Array(m * 3)
  const sunRadiusDeg = new Float64Array(m)
  const weightPct = new Float64Array(m) // 0 during the lead-in
  for (let k = 0; k < m; k++) {
    const tMs = startMs + (k - preH) * H_MS
    const sun = bodyVectorKm(eph, 'sun', tMs)
    const earth = bodyVectorKm(eph, 'earth', tMs)
    for (let j = 0; j < 3; j++) {
      sunKm[k * 3 + j] = sun[j]
      earthKm[k * 3 + j] = earth[j]
    }
    sunRadiusDeg[k] = angularRadiusDeg('sun', Math.hypot(sun[0], sun[1], sun[2]))
    if (k >= preH) weightPct[k] = (100 * (Math.min(tMs + H_MS, endMs) - tMs)) / (endMs - startMs)
  }

  const { nx, ny, azBins, heightM } = grid.manifest
  const binsPerDeg = azBins / 360
  const { onFraction, offFraction } = sunHysteresisLevels(opts)
  const sunSeed = (onFraction + offFraction) / 2
  const { earthMarginDeg, earthHysteresisDeg: earthOn } = opts
  const earthOff = -earthOn
  const out: GridScores = {
    startMs,
    endMs,
    nx,
    ny,
    sunPct: new Float32Array(nx * ny),
    earthPct: new Float32Array(nx * ny),
    bothPct: new Float32Array(nx * ny),
  }
  // Decoded horizon of the current cell, with bin 0 repeated at the end so interpolation needs no wrap branch.
  const mask = new Float64Array(azBins + 1)

  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const c = iy * nx + ix
      if (isNoData(grid, c)) {
        out.sunPct[c] = out.earthPct[c] = out.bothPct[c] = NaN
        continue
      }
      const base = c * azBins
      for (let i = 0; i < azBins; i++) mask[i] = grid.horizonsU8[base + i] * 0.1 - 5
      mask[azBins] = mask[0]
      const { latDeg, lonDeg } = cellCenterLatLon(grid, ix, iy)
      const f = siteFrame(latDeg, lonDeg, grid.surfaceHeightM[c], heightM)
      const [px, py, pz] = f.positionKm
      const [ex, ey, ez] = f.east
      const [nx_, ny_, nz] = f.north
      const [ux, uy, uz] = f.up

      /** Terrain horizon at the azimuth of (e, n), linear between bins. */
      const horizonDeg = (e: number, n: number): number => {
        let x = (Math.atan2(e, n) / DEG) * binsPerDeg
        if (x < 0) x += azBins
        let i0 = Math.floor(x)
        const fr = x - i0
        if (i0 >= azBins) i0 -= azBins
        return mask[i0] + (mask[i0 + 1] - mask[i0]) * fr
      }

      let sunOn = false
      let earthLink = false
      let sunAcc = 0
      let earthAcc = 0
      let bothAcc = 0
      for (let k = 0; k < m; k++) {
        // Sun: visible-disk fraction above the terrain horizon.
        let vx = sunKm[k * 3] - px
        let vy = sunKm[k * 3 + 1] - py
        let vz = sunKm[k * 3 + 2] - pz
        let e = vx * ex + vy * ey + vz * ez
        let n = vx * nx_ + vy * ny_ + vz * nz
        let u = vx * ux + vy * uy + vz * uz
        const d = Math.max(-1, Math.min(1, (Math.atan2(u, Math.sqrt(e * e + n * n)) / DEG - horizonDeg(e, n)) / sunRadiusDeg[k]))
        const frac = d === 1 ? 1 : d === -1 ? 0 : 1 - (Math.acos(d) - d * Math.sqrt(1 - d * d)) / Math.PI

        // Earth: center elevation above horizon + margin.
        vx = earthKm[k * 3] - px
        vy = earthKm[k * 3 + 1] - py
        vz = earthKm[k * 3 + 2] - pz
        e = vx * ex + vy * ey + vz * ez
        n = vx * nx_ + vy * ny_ + vz * nz
        u = vx * ux + vy * uy + vz * uz
        const clearDeg = Math.atan2(u, Math.sqrt(e * e + n * n)) / DEG - horizonDeg(e, n) - earthMarginDeg

        // Hysteresis as in detectWindows: seed from the band midpoint, then on at ≥ on, off at ≤ off and < on.
        if (k === 0) {
          sunOn = frac >= sunSeed
          earthLink = clearDeg >= 0
        } else {
          if (!sunOn && frac >= onFraction) sunOn = true
          else if (sunOn && frac <= offFraction && frac < onFraction) sunOn = false
          if (!earthLink && clearDeg >= earthOn) earthLink = true
          else if (earthLink && clearDeg <= earthOff && clearDeg < earthOn) earthLink = false
        }
        const w = weightPct[k]
        if (sunOn) sunAcc += w
        if (earthLink) earthAcc += w
        if (sunOn && earthLink) bothAcc += w
      }
      out.sunPct[c] = sunAcc
      out.earthPct[c] = earthAcc
      out.bothPct[c] = bothAcc
    }
    onProgress?.((iy + 1) / ny)
  }
  return out
}
