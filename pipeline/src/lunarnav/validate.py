"""Merge the Horizons and PGDA validations into validation.json."""

from collections.abc import Callable

from lunarnav import io, validate_horizons, validate_pgda


def _section(run: Callable[[], dict]) -> dict | None:
    """A section is None until its validator is implemented."""
    try:
        return run()
    except NotImplementedError:
        return None


def build() -> dict:
    return {
        "schemaVersion": 1,
        "horizons": _section(validate_horizons.run),
        "pgda": _section(validate_pgda.run),
    }


def main() -> None:
    io.write_json(io.VALIDATION_JSON, build())
