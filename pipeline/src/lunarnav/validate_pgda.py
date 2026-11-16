"""Our terrain-aware visibility vs. PGDA product 69 (validation.json -> pgda).

Method agreed in #57 (pipeline/DATA_SOURCES.md, SPEC-data-pipeline.md section 5):

- PGDA definition, validation only: a body counts as visible when any part of
  its disc clears our terrain horizon mask (Sun elevation + nominal 0.265 deg;
  Earth elevation + its actual angular radius, about 0.95 deg). App metrics
  (mean disc fraction, Earth centre + margin) are unchanged.
- Hourly over about 18.6 years, with Sun/Earth vectors taken straight from the
  pinned SPICE kernels (the shipped ephemeris.bin only covers 2026-2032).
- Primary comparison at 0 m (surface level, a working assumption: product 69
  does not document its observer height). The app's 2 m and 10 m heights are
  sensitivity runs, not assumptions about PGDA.
- PGDA pixel: bilinear at the site, plus the range over +/-2 pixels (our
  near-field DEM is 80 m, the raster 120 m).

The validation.json rows carry the 0 m result only (the contract has no fields
for the rest yet, see #71). The sensitivity runs and pixel ranges are printed
and quoted in each outlier's explanation. Any +/-5 pp result may only be stated
as CLAIM_LABEL, never as accuracy against truth or as "height-matched".
"""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Protocol

import numpy as np
import yaml
from numpy.typing import ArrayLike, NDArray

from lunarnav import io
from lunarnav.constants import FRAME, SITE_AZ_BINS, SITE_AZ_STEP_DEG
from lunarnav.dem import DemStack, PdsRaster, lat_lon_to_xy_km
from lunarnav.ephemeris import ABCORR, BODIES, KERNEL_NAMES, OBSERVER
from lunarnav.geometry import angular_radius_deg, az_el
from lunarnav.golden import horizon_elev_at

CLAIM_LABEL = "agreement with PGDA under the any-disc definition, surface level assumed"
THRESHOLD_PP = 5.0
CRITERION_2_FRACTION = 0.8  # SPEC.md success criterion 2: >= 80 % of sites
PRIMARY_HEIGHT_M = 0
SENSITIVITY_HEIGHTS_M = (2, 10)
SUN_RADIUS_DEG = 0.265  # nominal, as in Bryant (2009) and the #57 disposition
PIXEL_RANGE_PX = 2

# Any 18.6-year window spans one lunar nodal cycle; PGDA does not give its
# exact interval. Start where the app's ephemeris starts.
SPAN_START_UTC = "2026-01-01T00:00:00Z"
SPAN_HOURS = round(18.6 * 365.25 * 24)

SITES_YAML = Path(__file__).resolve().parents[2] / "sites.yaml"
PGDA_SUN_LBL = io.RAW_DIR / "pgda/AVGVISIB_75S_120M_201608.LBL"
PGDA_EARTH_LBL = io.RAW_DIR / "pgda/AVGVISIB_75S_120M_201608_EARTH.LBL"

# Written by a person after inspecting a run: one entry per outlier site
# (|diff| > THRESHOLD_PP for Sun or Earth at 0 m). run() refuses to write an
# outlier without one. Evidence (pixel range, 2/10 m results) is appended.
EXPLANATIONS: dict[str, str] = {}

_PCT_DIGITS = 2


class Raster(Protocol):
    cell_km: float

    def sample(self, x_km: ArrayLike, y_km: ArrayLike) -> NDArray: ...


HorizonFn = Callable[[float, float, float], NDArray[np.float64]]
SurfaceFn = Callable[[float, float], float]


def utc_samples() -> list[str]:
    """Hourly UTC instants from SPAN_START_UTC, SPAN_HOURS of them."""
    start = datetime.fromisoformat(SPAN_START_UTC)
    step = timedelta(hours=1)
    return [
        (start + i * step).strftime("%Y-%m-%dT%H:%M:%SZ") for i in range(SPAN_HOURS)
    ]


def body_vectors_km(
    samples_utc: Sequence[str], raw_dir: Path = io.RAW_DIR
) -> NDArray[np.float64]:
    """[t][sun, earth][xyz] Moon-centred km in MOON_ME, as ephemeris.py computes.

    Uses only the pinned local kernels; each UTC sample is converted to ET.
    """
    import spiceypy as spice

    paths = [raw_dir / "kernels" / name for name in KERNEL_NAMES]
    for path in paths:
        if not path.is_file():
            raise FileNotFoundError(f"Missing SPICE kernel {path}; run lunarnav fetch")
    with spice.KernelPool([str(path.resolve()) for path in paths]):
        et_s = spice.str2et(list(samples_utc))
        positions_km = np.stack(
            [
                spice.spkpos(body.upper(), et_s, FRAME, ABCORR, OBSERVER)[0]
                for body in BODIES
            ],
            axis=1,
        )
    positions_km = positions_km.reshape(len(samples_utc), len(BODIES), 3)
    if not np.all(np.isfinite(positions_km)):
        raise ValueError("SPICE returned nonfinite body positions")
    return positions_km


def visibility_pct(
    mask_deg: ArrayLike,
    body_vecs_km: NDArray[np.float64],
    lat_deg: float,
    lon_deg: float,
    height_m: float = 0.0,
) -> tuple[float, float]:
    """(Sun %, Earth %) of samples with any part of the disc above the mask.

    height_m is the observer's total height above the 1737.4 km sphere
    (surface + observer height), matching the height the mask was built for.
    """
    pct = []
    for b, body in enumerate(BODIES):
        az_deg, elev_deg, dist_km = az_el(
            body_vecs_km[:, b], lat_deg, lon_deg, height_m
        )
        radius_deg = (
            np.full_like(elev_deg, SUN_RADIUS_DEG)
            if body == "sun"
            else angular_radius_deg("earth", dist_km)
        )
        horizon_deg = horizon_elev_at(mask_deg, SITE_AZ_STEP_DEG, az_deg)
        pct.append(100.0 * float(np.mean(elev_deg + radius_deg > horizon_deg)))
    return pct[0], pct[1]


def pgda_pixel_pct(
    raster: Raster, x_km: float, y_km: float, radius_px: int = PIXEL_RANGE_PX
) -> tuple[float, float, float]:
    """(bilinear %, min %, max %) at the site and over +/-radius_px pixels."""
    offsets_km = np.arange(-radius_px, radius_px + 1) * raster.cell_km
    dx, dy = np.meshgrid(offsets_km, offsets_km)
    centre = float(raster.sample(x_km, y_km))
    if not np.isfinite(centre):
        raise ValueError("No PGDA coverage at site")
    around = np.asarray(raster.sample(x_km + dx, y_km + dy), dtype=float)
    around = around[np.isfinite(around)]
    return 100.0 * centre, 100.0 * float(around.min()), 100.0 * float(around.max())


@dataclass(frozen=True)
class SiteResult:
    site_id: str
    # observer height (m) -> (Sun %, Earth %)
    ours_pct_by_height: Mapping[int, tuple[float, float]]
    # (bilinear %, min %, max %) over +/-PIXEL_RANGE_PX pixels
    pgda_sun: tuple[float, float, float]
    pgda_earth: tuple[float, float, float]


def _evidence(result: SiteResult, b: int, body: str) -> str:
    _, lo, hi = (result.pgda_sun, result.pgda_earth)[b]
    sens = ", ".join(
        f"{h} m: {result.ours_pct_by_height[h][b]:.1f} %" for h in SENSITIVITY_HEIGHTS_M
    )
    return (
        f"{body}: PGDA within ±{PIXEL_RANGE_PX} px {lo:.1f}–{hi:.1f} %; ours at {sens}."
    )


def to_row(result: SiteResult, explanations: Mapping[str, str]) -> dict[str, Any]:
    """One validation.json pgda row at PRIMARY_HEIGHT_M.

    Outliers (|diff| > THRESHOLD_PP) need a written explanation; the PGDA pixel
    range and the 2/10 m results for each outlying body are appended to it.
    """
    ours = [round(v, _PCT_DIGITS) for v in result.ours_pct_by_height[PRIMARY_HEIGHT_M]]
    pgda = [round(p[0], _PCT_DIGITS) for p in (result.pgda_sun, result.pgda_earth)]
    diffs = [round(o - p, _PCT_DIGITS) for o, p in zip(ours, pgda)]
    outlying = [b for b, d in enumerate(diffs) if abs(d) > THRESHOLD_PP]
    explanation = None
    if outlying:
        text = explanations.get(result.site_id)
        if not text:
            raise ValueError(
                f"PGDA outlier {result.site_id} (diffs {diffs} pp) needs an entry "
                "in validate_pgda.EXPLANATIONS"
            )
        names = ("Sun", "Earth")
        explanation = " ".join(
            [text.strip()] + [_evidence(result, b, names[b]) for b in outlying]
        )
    return {
        "siteId": result.site_id,
        "oursSunPct": ours[0],
        "pgdaSunPct": pgda[0],
        "sunDiffPp": diffs[0],
        "oursEarthPct": ours[1],
        "pgdaEarthPct": pgda[1],
        "earthDiffPp": diffs[1],
        "explanation": explanation,
    }


def _within(row: Mapping[str, Any]) -> bool:
    return (
        abs(row["sunDiffPp"]) <= THRESHOLD_PP
        and abs(row["earthDiffPp"]) <= THRESHOLD_PP
    )


def summarize(rows: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    return {
        "thresholdPp": THRESHOLD_PP,
        "sitesWithinThreshold": sum(_within(r) for r in rows),
        "sitesTotal": len(rows),
        "maxAbsSunDiffPp": max(abs(r["sunDiffPp"]) for r in rows),
        "maxAbsEarthDiffPp": max(abs(r["earthDiffPp"]) for r in rows),
    }


def criterion_2_passes(summary: Mapping[str, Any]) -> bool:
    """SPEC.md criterion 2, read under the #57 definition."""
    return (
        summary["sitesWithinThreshold"] >= CRITERION_2_FRACTION * summary["sitesTotal"]
    )


def compare_site(
    site: Mapping[str, Any],
    horizon_deg: HorizonFn,
    surface_height_m: SurfaceFn,
    pgda_sun: Raster,
    pgda_earth: Raster,
    body_vecs_km: NDArray[np.float64],
) -> SiteResult:
    lat_deg, lon_deg = float(site["latDeg"]), float(site["lonDeg"])
    surface_m = float(surface_height_m(lat_deg, lon_deg))
    if not np.isfinite(surface_m):
        raise ValueError(f"Missing terrain at site {site['id']}")
    ours = {
        h: visibility_pct(
            horizon_deg(lat_deg, lon_deg, h),
            body_vecs_km,
            lat_deg,
            lon_deg,
            surface_m + h,
        )
        for h in (PRIMARY_HEIGHT_M, *SENSITIVITY_HEIGHTS_M)
    }
    x_km, y_km = (float(v) for v in lat_lon_to_xy_km(lat_deg, lon_deg))
    return SiteResult(
        site_id=str(site["id"]),
        ours_pct_by_height=ours,
        pgda_sun=pgda_pixel_pct(pgda_sun, x_km, y_km),
        pgda_earth=pgda_pixel_pct(pgda_earth, x_km, y_km),
    )


def report(results: Sequence[SiteResult]) -> str:
    """Human-readable table: every height against the PGDA pixel and range."""
    heights = (PRIMARY_HEIGHT_M, *SENSITIVITY_HEIGHTS_M)
    lines = [
        f"PGDA product 69 comparison: {CLAIM_LABEL}.",
        f"Any-disc definition, hourly x {SPAN_HOURS} h from {SPAN_START_UTC}; "
        f"primary {PRIMARY_HEIGHT_M} m, sensitivity "
        + ", ".join(f"{h} m" for h in SENSITIVITY_HEIGHTS_M)
        + ".",
        "",
        f"{'site':<22} {'body':<5} {'PGDA':>6} {'±2 px range':>13} "
        + " ".join(f"{f'{h} m':>7} {'diff':>6}" for h in heights),
    ]
    for r in results:
        for b, (name, pgda) in enumerate(
            (("Sun", r.pgda_sun), ("Earth", r.pgda_earth))
        ):
            cells = " ".join(
                f"{r.ours_pct_by_height[h][b]:>7.2f} "
                f"{r.ours_pct_by_height[h][b] - pgda[0]:>+6.2f}"
                for h in heights
            )
            lines.append(
                f"{r.site_id:<22} {name:<5} {pgda[0]:>6.2f} "
                f"{f'{pgda[1]:.1f}–{pgda[2]:.1f}':>13} {cells}"
            )
    lines.append("")
    for h in heights:
        diffs = np.array(
            [
                [
                    r.ours_pct_by_height[h][b] - (r.pgda_sun, r.pgda_earth)[b][0]
                    for b in range(2)
                ]
                for r in results
            ]
        )
        within = int(np.sum(np.all(np.abs(diffs) <= THRESHOLD_PP, axis=1)))
        lines.append(
            f"{h:>3} m: {within}/{len(results)} sites within ±{THRESHOLD_PP:g} pp; "
            f"mean |diff| Sun {np.mean(np.abs(diffs[:, 0])):.2f} pp, "
            f"Earth {np.mean(np.abs(diffs[:, 1])):.2f} pp"
        )
    return "\n".join(lines)


def run(
    sites: Sequence[Mapping[str, Any]] | None = None,
    horizon_deg: HorizonFn | None = None,
    surface_height_m: SurfaceFn | None = None,
    pgda_sun: Raster | None = None,
    pgda_earth: Raster | None = None,
    body_vecs_km: NDArray[np.float64] | None = None,
    explanations: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    """The pgda section of validation.json. Defaults load the real inputs."""
    if horizon_deg is None or surface_height_m is None:
        # numba compiles on import; only load it for real runs.
        from lunarnav.horizon import compute_horizon_deg

        terrain = DemStack()

        def horizon_deg(lat: float, lon: float, h: float) -> NDArray[np.float64]:
            return compute_horizon_deg(terrain, lat, lon, h, SITE_AZ_BINS)

        def surface_height_m(lat: float, lon: float) -> float:
            return float(terrain.height_m(*lat_lon_to_xy_km(lat, lon)))

    if pgda_sun is None or pgda_earth is None:
        pgda_sun, pgda_earth = PdsRaster(PGDA_SUN_LBL), PdsRaster(PGDA_EARTH_LBL)
    if sites is None:
        sites = yaml.safe_load(SITES_YAML.read_text(encoding="utf-8"))["sites"]
    if body_vecs_km is None:
        body_vecs_km = body_vectors_km(utc_samples())
    explanations = EXPLANATIONS if explanations is None else explanations

    results = [
        compare_site(
            s, horizon_deg, surface_height_m, pgda_sun, pgda_earth, body_vecs_km
        )
        for s in sites
    ]
    # Print the full evidence before any missing-explanation error stops the run.
    print(report(results))
    rows = [to_row(r, explanations) for r in results]
    summary = summarize(rows)
    verdict = "PASS" if criterion_2_passes(summary) else "FAIL"
    print(
        f"SPEC criterion 2 (>= {CRITERION_2_FRACTION:.0%} of sites within "
        f"±{THRESHOLD_PP:g} pp at {PRIMARY_HEIGHT_M} m): {verdict} "
        f"({summary['sitesWithinThreshold']}/{summary['sitesTotal']})"
    )
    return {"rows": rows, "summary": summary}


def main() -> None:
    run()
