"""Where the sampled (SFZ) instruments come from, and how to fetch them into service/models/sfz.

Nothing here is shipped with the app: only the backing tracks rendered from these samples are.
Every library allows that (CC0 or CC BY; see catalog/LICENSES.md, which also records the check date).

    cd service && .venv/bin/python -m notealong.catalog.sfz_sources            # fetch everything
    cd service && .venv/bin/python -m notealong.catalog.sfz_sources salamander # one library
"""
from __future__ import annotations

import subprocess
import sys
import tarfile
import zipfile
from pathlib import Path

from .render import SFZ_DIR, SFZ_LIBS

SOURCES: dict[str, dict] = {
    "salamander": {
        "title": "Salamander Grand Piano V3 (Yamaha C5), Alexander Holm", "licence": "CC BY 3.0",
        "url": "https://freepats.zenvoid.org/Piano/SalamanderGrandPiano/SalamanderGrandPiano-SFZ+FLAC-V3+20200602.tar.gz",
        "kind": "tar", "folder": "SalamanderGrandPiano-SFZ+FLAC-V3+20200602", "sfz": "SalamanderGrandPiano-V3+20200602.sfz",
    },
    "virtuosity": {
        "title": "Virtuosity Drums (contemporary jazz kit), Versilian Studios with Karoryfer Samples", "licence": "CC0 1.0",
        "url": "https://github.com/sfzinstruments/virtuosity_drums.git", "kind": "git", "folder": "virtuosity_drums",
        "sfz": "Programs/01-basic-kit.sfz",
    },
    "swagbass": {
        "title": "Swagbass (electric bass), Karoryfer Samples (D. Smolken)", "licence": "CC0 1.0",
        "url": "https://github.com/sfzinstruments/karoryfer.swagbass.git", "kind": "git", "folder": "karoryfer.swagbass",
        "sfz": "swagbass_clean.sfz",
    },
}
SFZ_LIBS.update({k: {"folder": v["folder"], "sfz": v["sfz"]} for k, v in SOURCES.items()})


def fetch(name: str) -> Path:
    src = SOURCES[name]
    dest = SFZ_DIR / src["folder"]
    SFZ_DIR.mkdir(parents=True, exist_ok=True)
    if (dest / src["sfz"]).exists():
        return dest
    print(f"Fetching {src['title']} ({src['licence']}) into {dest} …", flush=True)
    if src["kind"] == "git":
        subprocess.run(["git", "clone", "-q", "--depth", "1", src["url"], str(dest)], check=True)
    else:
        archive = SFZ_DIR / Path(src["url"]).name
        if not archive.exists():
            subprocess.run(["curl", "-sS", "-L", "--fail", "-o", str(archive), src["url"]], check=True)
        if src["kind"] == "tar":
            with tarfile.open(archive) as tf:
                tf.extractall(SFZ_DIR, filter="data")
        else:
            with zipfile.ZipFile(archive) as zf:
                zf.extractall(SFZ_DIR)
    return dest


def main(argv: list[str]) -> int:
    for name in argv or list(SOURCES):
        d = fetch(name)
        ok = (d / SOURCES[name]["sfz"]).exists()
        print(f"{name}: {'ok' if ok else 'MISSING ' + SOURCES[name]['sfz']} ({d})")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
