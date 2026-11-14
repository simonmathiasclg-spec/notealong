"""Melody Lab: where each test song lives. Internal testing only; all audio is in the gitignored test-recordings/."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
TEST = ROOT / "test-recordings"
LAB = TEST / "lab"
KEYS = LAB / "keys"
SONGS = json.loads((Path(__file__).parent / "songs.json").read_text())
BY_SLUG = {s["slug"]: s for s in SONGS}


def song_dir(slug: str) -> Path:
    s = BY_SLUG[slug]
    return ROOT / "library" / s["upload"] if s.get("upload") else TEST / "library" / slug


def cover_files(slug: str) -> list[Path]:
    out = sorted((LAB / slug / "covers").glob("*.m4a"))
    if BY_SLUG[slug].get("popular") and slug != "wonderwall":
        out += sorted((TEST / "popular" / slug / "covers").glob("*.m4a"))
    if slug == "despacito":
        out += [p for p in sorted((TEST / "youtube").glob("*.m4a")) if (p.with_suffix("") / "stems").exists()]
    return out


def load_song(slug: str) -> dict:
    return json.loads((song_dir(slug) / "song.json").read_text())
