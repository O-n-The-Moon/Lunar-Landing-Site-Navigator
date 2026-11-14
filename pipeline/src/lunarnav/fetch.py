"""Download pinned science inputs; verify the local cache offline on reuse."""

import hashlib
import json
import logging
import time
from dataclasses import dataclass
from http.client import IncompleteRead
from pathlib import Path
from urllib.request import Request, urlopen

RAW_DIR = Path(__file__).resolve().parents[2] / "data" / "raw"
NAIF = "https://naif.jpl.nasa.gov/pub/naif/generic_kernels"
LOLA = "https://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/IMG"
PGDA = "https://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG"
LOG = logging.getLogger(__name__)


@dataclass(frozen=True)
class Source:
    """Pinned URL, local relative path, and optional authoritative byte count."""

    url: str
    path: str
    size_bytes: int | None = None


SOURCES = (
    tuple(
        Source(f"{NAIF}/{remote}", f"kernels/{remote.rsplit('/', 1)[1]}")
        for remote in (
            "lsk/naif0012.tls",
            "spk/planets/de440s.bsp",
            "pck/moon_pa_de440_200625.bpc",
            "fk/satellites/moon_de440_250416.tf",
            "pck/pck00011.tpc",
        )
    )
    + tuple(
        Source(
            f"{base}/{stem}.{ext}",
            f"{group}/{stem}.{ext}",
            size if ext == "IMG" else None,
        )
        for base, group, stem, size in (
            (LOLA, "dem", "LDEM_80S_80M", 115520000),
            (LOLA, "dem", "LDEM_75S_240M", 29062688),
            (PGDA, "pgda", "AVGVISIB_75S_120M_201608", 116250752),
            (PGDA, "pgda", "AVGVISIB_75S_120M_201608_EARTH", 116250752),
        )
        for ext in ("LBL", "IMG")
    )
    + (
        Source(
            "https://imbrium.mit.edu/EXTRAS/ILLUMINATION/README_ILLUMINATION_2016.TXT",
            "pgda/README_ILLUMINATION_2016.TXT",
        ),
    )
)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(source: Source, raw_dir: Path = RAW_DIR) -> Path:
    """Cache atomically, checking size and SHA-256 on every reuse (no HTTP)."""
    target = raw_dir / source.path
    target.parent.mkdir(parents=True, exist_ok=True)
    receipt = target.with_name(target.name + ".json")
    if target.is_file() and receipt.is_file():
        try:
            meta = json.loads(receipt.read_text())
            valid = (
                meta["url"] == source.url
                and meta["sizeBytes"] == target.stat().st_size
                and (
                    source.size_bytes is None or meta["sizeBytes"] == source.size_bytes
                )
                and meta["sha256"] == _sha256(target)
            )
        except (ValueError, KeyError, TypeError):
            valid = False
        if valid:
            LOG.info("cache %s", source.path)
            return target
    part = target.with_name(target.name + ".part")
    for attempt in range(3):
        try:
            LOG.info("download %s", source.url)
            request = Request(
                source.url, headers={"User-Agent": "lunarnav/0.1 science-data-fetch"}
            )
            with urlopen(request, timeout=120) as response, part.open("wb") as out:
                if response.status != 200:
                    raise ValueError(f"Unexpected HTTP status: {response.status}")
                length = response.headers.get("Content-Length")
                for chunk in iter(lambda: response.read(1024 * 1024), b""):
                    out.write(chunk)
            size_bytes = part.stat().st_size
            if size_bytes == 0 or (length and size_bytes != int(length)):
                raise ValueError(f"Incomplete response: {source.url}")
            if source.size_bytes is not None and size_bytes != source.size_bytes:
                raise ValueError(f"Unexpected size for {source.path}: {size_bytes}")
            with part.open("rb") as stream:
                prefix = stream.read(256).lstrip().lower()
            if prefix.startswith((b"<!doctype html", b"<html")):
                raise ValueError(f"HTML returned instead of science data: {source.url}")
            meta = {"url": source.url, "sizeBytes": size_bytes, "sha256": _sha256(part)}
            part.replace(target)
            receipt_part = receipt.with_name(receipt.name + ".part")
            receipt_part.write_text(json.dumps(meta, indent=2) + "\n")
            receipt_part.replace(receipt)
            return target
        except (OSError, ValueError, IncompleteRead):
            part.unlink(missing_ok=True)
            if attempt == 2:
                raise
            time.sleep(2**attempt)
    raise RuntimeError("Unreachable")


def fetch_all(raw_dir: Path = RAW_DIR) -> tuple[Path, ...]:
    """Fetch catalog and write provenance for downstream pipeline manifests."""
    paths = tuple(download(source, raw_dir) for source in SOURCES)
    manifest = [
        {
            "path": source.path,
            **json.loads(path.with_name(path.name + ".json").read_text()),
        }
        for source, path in zip(SOURCES, paths, strict=True)
    ]
    temporary = raw_dir / "sources.json.part"
    temporary.write_text(json.dumps(manifest, indent=2) + "\n")
    temporary.replace(raw_dir / "sources.json")
    return paths


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    fetch_all()
