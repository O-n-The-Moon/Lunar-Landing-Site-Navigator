"""Golden cross-language test vectors (`shared/fixtures/golden.json`).

The TS engine must reproduce these (SPEC-engine.md -> Testing). Inputs are the
shipped contract files (`ephemeris.bin`, `sites.json`), so generation needs no
SPICE and no network, and uses the same float32 samples the app loads.

Single cases follow the engine's per-instant definitions: body vectors are linear
between hourly samples, the horizon is linear between azimuth bins, and the Sun
is a disk. Mission scenarios are an independent brute-force reference: a 1-minute
walk with the same hysteresis rules as the engine, which instead samples every
10 minutes and bisects events to 1 minute. Agreement within the 10-minute
tolerance is therefore a real check, not a restatement of the engine.
"""

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray

from lunarnav import io
from lunarnav.constants import SCHEMA_VERSION, SITE_HEIGHTS_M
from lunarnav.geometry import angular_radius_deg, az_el, visible_disk_fraction

SEED = 20260101
N_CASES = 240
H_MS = 3_600_000
MIN_MS = 60_000
DURATION_H = 14 * 24
BODY_SUN, BODY_EARTH = 0, 1

# Engine defaults (SPEC-engine.md -> VisibilityOpts).
OPTS = {
    "sunThreshold": 0.5,
    "hysteresis": 0.05,
    "earthMarginDeg": 1.0,
    "earthHysteresisDeg": 0.1,
    "observerHeightM": 2,
}

# (id, siteId, landing UTC). Chosen so Sun and Earth each have transitions, with
# different mixes: both setting, Sun-only setting (Earth stays up), long common windows.
SCENARIOS: tuple[tuple[str, str, str], ...] = (
    ("nobile-rim-2-2030-12", "nobile-rim-2", "2030-12-01T00:00:00Z"),
    ("mons-mouton-im2-2028-06", "mons-mouton-im2", "2028-06-01T00:00:00Z"),
    ("connecting-ridge-2030-12", "connecting-ridge", "2030-12-01T00:00:00Z"),
)


@dataclass(frozen=True)
class Ephemeris:
    start_ms: int
    step_ms: int
    count: int
    positions_km: NDArray[np.float64]  # [t][sun, earth][xyz]


@dataclass(frozen=True)
class Inputs:
    ephemeris: Ephemeris
    sites: dict[str, Any]
    ephemeris_manifest: dict[str, Any]


def load_inputs() -> Inputs:
    manifest = json.loads(io.EPHEMERIS_JSON.read_text(encoding="utf-8"))
    count = int(manifest["count"])
    raw = np.fromfile(io.EPHEMERIS_BIN, dtype="<f4")
    if raw.size != count * 2 * 3:
        raise ValueError("ephemeris.bin does not match ephemeris.json")
    start = datetime.fromisoformat(manifest["startUtc"])
    eph = Ephemeris(
        start_ms=round(start.timestamp() * 1000),
        step_ms=int(manifest["stepS"]) * 1000,
        count=count,
        positions_km=raw.astype(np.float64).reshape(count, 2, 3),
    )
    sites = json.loads(io.SITES_JSON.read_text(encoding="utf-8"))
    return Inputs(eph, sites, manifest)


def body_vectors_km(eph: Ephemeris, t_ms: ArrayLike) -> NDArray[np.float64]:
    """[n][sun, earth][xyz], linear between samples; ValueError outside coverage."""
    t = np.asarray(t_ms, dtype=np.float64)
    x = (t - eph.start_ms) / eph.step_ms
    if not np.all((x >= 0) & (x <= eph.count - 1)):
        raise ValueError("time is outside the ephemeris coverage")
    i = np.clip(np.floor(x).astype(np.int64), 0, eph.count - 2)
    f = (x - i)[..., np.newaxis, np.newaxis]
    p0, p1 = eph.positions_km[i], eph.positions_km[i + 1]
    return p0 + (p1 - p0) * f


def horizon_elev_at(
    mask_deg: NDArray[np.float64] | list[float], az_step_deg: float, az_deg: ArrayLike
) -> NDArray[np.float64]:
    """Terrain horizon, linear between azimuth bins, wrapping at 360 degrees."""
    mask = np.asarray(mask_deg, dtype=np.float64)
    n = mask.size
    if abs(n * az_step_deg - 360) > 1e-9:
        raise ValueError("mask must cover exactly 360 degrees")
    x = ((np.asarray(az_deg, dtype=np.float64) % 360.0) / az_step_deg) % n
    i0 = np.floor(x).astype(np.int64)
    f = x - i0
    return mask[i0] + (mask[(i0 + 1) % n] - mask[i0]) * f


def hysteresis_states(
    values: NDArray[np.float64], on_at: float, off_at: float
) -> NDArray[np.bool_]:
    """On at v >= on_at; off at v <= off_at (and v < on_at); else hold.

    The first sample is on if it is at or above the band midpoint.
    """
    out = np.empty(values.size, dtype=bool)
    on = bool(values[0] >= (on_at + off_at) / 2)
    out[0] = on
    for i in range(1, values.size):
        v = values[i]
        if not on and v >= on_at:
            on = True
        elif on and v <= off_at and v < on_at:
            on = False
        out[i] = on
    return out


def run_stats(on: NDArray[np.bool_], step_min: float) -> dict[str, Any]:
    """Time on, longest continuous off run, and first on->off transition (hours).

    Sample k holds the state for [k, k+1) steps, so durations are counts of steps.
    """
    h_per_step = step_min / 60.0
    longest = run = 0
    for state in on:
        run = 0 if state else run + 1
        longest = max(longest, run)
    falls = np.flatnonzero(on[:-1] & ~on[1:])
    return {
        "onH": float(on.sum()) * h_per_step,
        "longestGapH": longest * h_per_step,
        "firstOffH": float(falls[0] + 1) * h_per_step if falls.size else None,
    }


def _round(x: float, digits: int = 9) -> float:
    return round(float(x), digits)


def _site_state(
    inputs: Inputs, site: dict[str, Any], height_m: int, t_ms: NDArray[np.float64]
) -> dict[str, NDArray[np.float64]]:
    vec = body_vectors_km(inputs.ephemeris, t_ms)
    mask = site["horizonElevDeg"][str(height_m)]
    step = inputs.sites["azStepDeg"]
    total_height_m = site["surfaceHeightM"] + height_m
    sun_az, sun_el, sun_d = az_el(
        vec[:, BODY_SUN], site["latDeg"], site["lonDeg"], total_height_m
    )
    earth_az, earth_el, earth_d = az_el(
        vec[:, BODY_EARTH], site["latDeg"], site["lonDeg"], total_height_m
    )
    sun_h = horizon_elev_at(mask, step, sun_az)
    earth_h = horizon_elev_at(mask, step, earth_az)
    fraction = visible_disk_fraction(sun_el, sun_h, angular_radius_deg("sun", sun_d))
    return {
        "sunAzDeg": sun_az,
        "sunElevDeg": sun_el,
        "sunDistKm": sun_d,
        "sunHorizonDeg": sun_h,
        "sunFraction": fraction,
        "earthAzDeg": earth_az,
        "earthElevDeg": earth_el,
        "earthDistKm": earth_d,
        "earthHorizonDeg": earth_h,
    }


def _coverage_ms(eph: Ephemeris) -> tuple[int, int]:
    return eph.start_ms, eph.start_ms + (eph.count - 1) * eph.step_ms


def build_cases(inputs: Inputs) -> list[dict[str, Any]]:
    rng = np.random.default_rng(SEED)
    sites = inputs.sites["sites"]
    heights = sorted(set(SITE_HEIGHTS_M))
    lo, hi = _coverage_ms(inputs.ephemeris)
    times = rng.integers(lo, hi, size=N_CASES, endpoint=True)
    margin = OPTS["earthMarginDeg"]
    cases = []
    for k in range(N_CASES):
        site = sites[k % len(sites)]
        height_m = heights[(k // len(sites)) % len(heights)]
        t = int(times[k])
        s = _site_state(inputs, site, height_m, np.array([float(t)]))
        v = {key: float(arr[0]) for key, arr in s.items()}
        clearance = v["earthElevDeg"] - v["earthHorizonDeg"]
        cases.append(
            {
                "siteId": site["id"],
                "observerHeightM": height_m,
                "tUtcMs": t,
                **{key: _round(val) for key, val in v.items()},
                "earthVisible": bool(clearance >= margin),
            }
        )
    return cases


def _scenario(
    inputs: Inputs, sc_id: str, site_id: str, landing_iso: str
) -> dict[str, Any]:
    site = next(s for s in inputs.sites["sites"] if s["id"] == site_id)
    landing = datetime.fromisoformat(landing_iso)
    landing_ms = round(landing.astimezone(UTC).timestamp() * 1000)
    n = DURATION_H * 60
    t = landing_ms + np.arange(n + 1, dtype=np.float64) * MIN_MS
    st = _site_state(inputs, site, OPTS["observerHeightM"], t)

    thr, hys = OPTS["sunThreshold"], OPTS["hysteresis"]
    sun_on = hysteresis_states(
        st["sunFraction"], min(1.0, thr + hys), max(0.0, thr - hys)
    )
    clearance = st["earthElevDeg"] - st["earthHorizonDeg"] - OPTS["earthMarginDeg"]
    eh = OPTS["earthHysteresisDeg"]
    earth_on = hysteresis_states(clearance, eh, -eh)
    both_on = sun_on & earth_on

    # Minute k holds its state until k + 1, so the mission covers samples 0..n-1.
    s_stats = run_stats(sun_on[:n], 1)
    e_stats = run_stats(earth_on[:n], 1)
    b_stats = run_stats(both_on[:n], 1)
    hourly = slice(None, None, 60)
    return {
        "id": sc_id,
        "siteId": site_id,
        "observerHeightM": OPTS["observerHeightM"],
        "landingUtcMs": landing_ms,
        "durationH": DURATION_H,
        "stepMin": 1,
        "hourlyStepMin": 60,
        "hourly": {
            "sunFraction": [_round(x, 6) for x in st["sunFraction"][hourly]],
            "sunlit": sun_on[hourly].astype(int).tolist(),
            "earthLink": earth_on[hourly].astype(int).tolist(),
            "both": both_on[hourly].astype(int).tolist(),
        },
        "totals": {
            "sunlitH": _round(s_stats["onH"], 6),
            "earthH": _round(e_stats["onH"], 6),
            "bothH": _round(b_stats["onH"], 6),
            "sunlitPct": _round(100 * s_stats["onH"] / DURATION_H, 6),
            "earthPct": _round(100 * e_stats["onH"] / DURATION_H, 6),
            "bothPct": _round(100 * b_stats["onH"] / DURATION_H, 6),
            "longestSunGapH": _round(s_stats["longestGapH"], 6),
            "longestEarthGapH": _round(e_stats["longestGapH"], 6),
            "firstSunsetH": None
            if s_stats["firstOffH"] is None
            else _round(s_stats["firstOffH"], 6),
            "firstEarthsetH": None
            if e_stats["firstOffH"] is None
            else _round(e_stats["firstOffH"], 6),
            "meanSunFraction": _round(float(np.mean(st["sunFraction"][:n])), 6),
        },
    }


def build_golden(inputs: Inputs) -> dict[str, Any]:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "generatedBy": "lunarnav golden",
        "seed": SEED,
        "opts": OPTS,
        "notes": {
            "cases": "tUtcMs -> az/el, horizon, Sun fraction; earthVisible = "
            "earthElevDeg - earthHorizonDeg >= earthMarginDeg (no hysteresis).",
            "scenarios": "1-minute reference with engine hysteresis; totals over "
            "[landing, landing + durationH); hourly series sampled on the hour.",
        },
        "cases": build_cases(inputs),
        "scenarios": [_scenario(inputs, *sc) for sc in SCENARIOS],
    }


def main() -> None:
    io.write_json(io.GOLDEN_JSON, build_golden(load_inputs()))
