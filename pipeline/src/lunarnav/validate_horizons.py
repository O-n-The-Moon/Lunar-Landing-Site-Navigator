"""Our smooth-sphere Sun/Earth az/el vs. JPL Horizons (validation.json -> horizons).

Pipeline-time only: one Horizons API request per site and body, carrying every
epoch in a TLIST, cached under pipeline/data/raw/horizons-cache/ so re-runs work
offline. Our side reads the shipped ephemeris.bin at exact hourly samples (no
interpolation) and calls geometry.az_el at zero height (no terrain).

Horizons API: https://ssd-api.jpl.nasa.gov/doc/horizons.html. A response header
confirms the Moon site model matches ours: "Center pole/equ : MEAN_ME" and
"Center radii : 1737.4, 1737.4, 1737.4 km", so geodetic = planetocentric here.
Quantity 4 is the airless apparent az/el (light-time, deflection, aberration),
azimuth clockwise from north. TIME_TYPE='UT' is UTC after 1962, like tUtcMs.
"""

import hashlib
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np

from lunarnav import golden, io
from lunarnav.geometry import az_el

API_URL = "https://ssd.jpl.nasa.gov/api/horizons.api"
API_MAJOR_VERSION = "1"
CACHE_DIR = io.RAW_DIR / "horizons-cache"
MIN_REQUEST_INTERVAL_S = 1.0
BODY_COMMANDS = {"sun": "10", "earth": "399"}
BODY_INDEX = {"sun": golden.BODY_SUN, "earth": golden.BODY_EARTH}

# Spread in longitude (-150 to 125 E) and latitude (83.7 to 89.5 S).
SITE_IDS = (
    "peak-near-cabeus-b",
    "malapert-massif",
    "mons-mouton-im2",
    "nobile-rim-2",
    "slater-plain",
    "connecting-ridge",
)
# 28 epochs about a quarter apart; 2191 h is not a multiple of a day, so the
# hour of day varies too.
N_EPOCHS = 28
EPOCH_STEP_H = 2191
FIRST_EPOCH_UTC = "2026-01-01T00:00:00Z"
# Horizons prints 9 decimals with EXTRA_PREC; ours match.
DIGITS = 9

Fetch = Callable[[str], dict[str, Any]]
Throttle = Callable[[], None]


def epochs_utc_ms() -> list[int]:
    start_ms = round(datetime.fromisoformat(FIRST_EPOCH_UTC).timestamp() * 1000)
    return [start_ms + k * EPOCH_STEP_H * golden.H_MS for k in range(N_EPOCHS)]


def _horizons_time(t_utc_ms: int) -> str:
    return datetime.fromtimestamp(t_utc_ms / 1000, UTC).strftime("%Y-%m-%d %H:%M:%S")


def request_params(
    lat_deg: float, lon_deg: float, body: str, t_utc_ms: Sequence[int]
) -> dict[str, str]:
    """Observer-table parameters for one Moon-surface site, one body, many times."""
    return {
        "format": "json",
        "COMMAND": f"'{BODY_COMMANDS[body]}'",
        "OBJ_DATA": "'NO'",
        "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'OBSERVER'",
        "CENTER": "'coord@301'",
        "COORD_TYPE": "'GEODETIC'",
        # E-lon (deg), lat (deg), altitude (km) above the 1737.4 km sphere.
        "SITE_COORD": f"'{round(lon_deg % 360, 9)!r},{lat_deg!r},0'",
        "TLIST": ",".join(f"'{_horizons_time(t)}'" for t in t_utc_ms),
        "TIME_TYPE": "'UT'",
        "QUANTITIES": "'4'",
        "ANG_FORMAT": "'DEG'",
        "CSV_FORMAT": "'YES'",
        "EXTRA_PREC": "'YES'",
        "TIME_DIGITS": "'SECONDS'",
    }


def fetch_json(url: str) -> dict[str, Any]:
    request = urllib.request.Request(url, headers={"User-Agent": "lunarnav"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.load(response)
    except urllib.error.HTTPError as e:
        # A 400 carries the reason in its body ("message" when JSON).
        body = e.read().decode("utf-8", errors="replace")
        try:
            body = json.loads(body).get("message", body)
        except (json.JSONDecodeError, AttributeError):
            pass
        raise RuntimeError(f"Horizons HTTP {e.code}: {body}") from e


def make_throttle(
    min_interval_s: float,
    clock: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
) -> Throttle:
    """Waits so that successive calls are at least min_interval_s apart."""
    last_s: float | None = None

    def throttle() -> None:
        nonlocal last_s
        if last_s is not None:
            wait_s = last_s + min_interval_s - clock()
            if wait_s > 0:
                sleep(wait_s)
        last_s = clock()

    return throttle


def query(
    params: dict[str, str], cache_dir: Path, fetch: Fetch, throttle: Throttle
) -> str:
    """Horizons text result for params, from the cache when present.

    Only responses with an ephemeris block are cached, keyed by a hash of the
    parameters. An unreadable cache file (e.g. a write cut short) is fetched again.
    """
    key = hashlib.sha256(json.dumps(params, sort_keys=True).encode()).hexdigest()[:24]
    path = cache_dir / f"{key}.json"
    if path.is_file():
        try:
            return json.loads(path.read_text(encoding="utf-8"))["response"]["result"]
        except (json.JSONDecodeError, KeyError, TypeError):
            pass
    throttle()
    url = f"{API_URL}?{urllib.parse.urlencode(params, quote_via=urllib.parse.quote)}"
    response = fetch(url)
    # Horizons reports its own errors with HTTP 200 and an "error" field.
    if "error" in response:
        raise RuntimeError(f"Horizons error: {response['error']}")
    version = str(response.get("signature", {}).get("version", ""))
    if version.split(".")[0] != API_MAJOR_VERSION:
        raise RuntimeError(f"Unsupported Horizons API version {version!r}")
    # Other problems come back inside "result" with HTTP 200: never cache those.
    parse_az_el(response["result"])
    io.write_json(path, {"params": params, "response": response})
    return response["result"]


def parse_az_el(result: str) -> list[tuple[int, float, float]]:
    """(tUtcMs, azDeg, elevDeg) rows from a CSV quantity-4 observer table."""
    if "$$SOE" not in result or "$$EOE" not in result:
        raise ValueError("Horizons result has no $$SOE/$$EOE ephemeris block")
    block = result.split("$$SOE", 1)[1].split("$$EOE", 1)[0]
    rows = []
    for line in block.strip().splitlines():
        # date, solar-presence flag, interfering-body flag, az, el, ""
        stamp, _, _, az, el, *_ = line.split(",")
        t = datetime.strptime(stamp.strip(), "%Y-%b-%d %H:%M:%S.%f").replace(tzinfo=UTC)
        rows.append((round(t.timestamp() * 1000), float(az), float(el)))
    return rows


def az_err_deg(a_deg: float, b_deg: float) -> float:
    """Absolute azimuth difference, wrapped so 359.99 vs 0.01 is 0.02."""
    return abs((a_deg - b_deg + 180.0) % 360.0 - 180.0)


# SPEC.md success criterion 1: max Sun and Earth az/el error vs Horizons.
TARGET_MAX_ERR_DEG = 0.02


def summarize(rows: Sequence[dict[str, Any]]) -> dict[str, Any]:
    az = np.array([r["azErrDeg"] for r in rows], dtype=float)
    elev = np.array([r["elevErrDeg"] for r in rows], dtype=float)
    return {
        "n": len(rows),
        "maxAzErrDeg": float(az.max()),
        "maxElevErrDeg": float(elev.max()),
        "meanAzErrDeg": float(az.mean()),
        "meanElevErrDeg": float(elev.mean()),
        "targetMaxErrDeg": TARGET_MAX_ERR_DEG,
    }


def run(
    inputs: golden.Inputs | None = None,
    cache_dir: Path | None = None,
    fetch: Fetch | None = None,
    throttle: Throttle | None = None,
) -> dict[str, Any]:
    """The horizons section of validation.json: per-row errors plus a summary."""
    # Resolved at call time, so patching the module globals reaches them.
    inputs = inputs or golden.load_inputs()
    cache_dir = cache_dir or CACHE_DIR
    fetch = fetch or fetch_json
    throttle = throttle or make_throttle(MIN_REQUEST_INTERVAL_S)
    sites = {s["id"]: s for s in inputs.sites["sites"]}
    epochs = epochs_utc_ms()
    # Raises outside coverage before any request; epochs are exact samples.
    body_vecs_km = golden.body_vectors_km(inputs.ephemeris, epochs)
    rows = []
    for site_id in SITE_IDS:
        site = sites[site_id]
        lat_deg, lon_deg = site["latDeg"], site["lonDeg"]
        for body, b in BODY_INDEX.items():
            params = request_params(lat_deg, lon_deg, body, epochs)
            theirs = parse_az_el(query(params, cache_dir, fetch, throttle))
            if [t for t, _, _ in theirs] != epochs:
                raise ValueError(f"Horizons returned other times for {site_id}/{body}")
            ours_az, ours_el, _ = az_el(body_vecs_km[:, b], lat_deg, lon_deg)
            for t, h_az, h_el, o_az, o_el in zip(
                epochs, (r[1] for r in theirs), (r[2] for r in theirs), ours_az, ours_el
            ):
                o_az, o_el = round(float(o_az), DIGITS), round(float(o_el), DIGITS)
                rows.append(
                    {
                        "siteId": site_id,
                        "tUtcMs": t,
                        "body": body,
                        "oursAzDeg": o_az,
                        "oursElevDeg": o_el,
                        "horizonsAzDeg": h_az,
                        "horizonsElevDeg": h_el,
                        "azErrDeg": round(az_err_deg(o_az, h_az), DIGITS),
                        "elevErrDeg": round(abs(o_el - h_el), DIGITS),
                    }
                )
    return {"rows": rows, "summary": summarize(rows)}


def main() -> None:
    print(json.dumps(run()["summary"], indent=2))
