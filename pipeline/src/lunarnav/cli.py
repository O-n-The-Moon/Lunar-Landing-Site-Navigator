"""Command line entry point. Every command dispatches to its own module."""

import argparse
from collections.abc import Callable, Sequence

from lunarnav import (
    demo,
    ephemeris,
    fetch,
    golden,
    horizons_grid,
    horizons_sites,
    pgda_layers,
    validate,
)

BUILD_STEPS: tuple[Callable[[], None], ...] = (
    ephemeris.main,
    horizons_sites.main,
    horizons_grid.main,
    pgda_layers.main,
)


def build_all() -> None:
    for step in BUILD_STEPS:
        step()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="lunarnav", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("fetch", help="download SPICE kernels, LOLA DEMs, PGDA rasters")
    sub.add_parser("ephemeris", help="write ephemeris.json + ephemeris.bin")
    horizons = sub.add_parser("horizons", help="terrain horizon profiles")
    target = horizons.add_mutually_exclusive_group(required=True)
    target.add_argument("--sites", action="store_true", help="curated sites")
    target.add_argument("--grid", action="store_true", help="polar grid")
    sub.add_parser("pgda", help="reproject PGDA layers")
    sub.add_parser("validate", help="write validation.json")
    sub.add_parser("golden", help="write shared/fixtures/golden.json")
    sub.add_parser("demo", help="demo data")
    sub.add_parser("build-all", help="ephemeris, sites, grid, pgda")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    commands: dict[str, Callable[[], None]] = {
        "fetch": fetch.main,
        "ephemeris": ephemeris.main,
        "pgda": pgda_layers.main,
        "validate": validate.main,
        "golden": golden.main,
        "demo": demo.main,
        "build-all": build_all,
    }
    if args.command == "horizons":
        (horizons_sites.main if args.sites else horizons_grid.main)()
    else:
        commands[args.command]()
