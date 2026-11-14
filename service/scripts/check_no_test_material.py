#!/usr/bin/env python3
"""Fails (exit 1) if internal test material could be committed or shipped.

Test material is everything under the gitignored test-recordings/: recordings, covers, lyrics and
transcriptions of copyrighted songs, collected only to measure the note algorithm (docs/MELODY_LAB.md).
Run by the web build (web/scripts/check-no-test-material.mjs), by the Python tests and by deploy.sh.

Checks:
  1. test-recordings/ is gitignored and nothing in it is tracked by git;
  2. nothing that ships (web/, service/notealong, service/modal_app.py, catalog/, supabase/) mentions it;
  3. no tracked file, and no file in web/public or catalog/, is a copy of a file in test-recordings/;
  4. no file or folder in web/public or catalog/ is named after a test video or a copyrighted test song;
  5. no answer key or lyric transcript of a test song sits in a tracked folder.
Standard library only, so it runs anywhere the build runs.
"""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEST = ROOT / "test-recordings"
SHIPPED = ["web/src", "web/public", "service/notealong", "service/modal_app.py", "catalog", "supabase"]
TEXT = {".py", ".ts", ".tsx", ".js", ".mjs", ".json", ".sql", ".toml", ".sh", ".md", ".css", ".html", ".yml", ".yaml"}


def sha(p: Path) -> str:
    h = hashlib.sha1()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def git(*args: str) -> list[str]:
    r = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True)
    return r.stdout.splitlines() if r.returncode == 0 else []


def main() -> int:
    bad: list[str] = []
    in_git = (ROOT / ".git").exists()
    tracked = git("ls-files") if in_git else []
    # 1
    if in_git:
        if any(t.startswith("test-recordings/") for t in tracked):
            bad.append("files under test-recordings/ are tracked by git")
        if "test-recordings/" not in (ROOT / ".gitignore").read_text().split():
            bad.append(".gitignore no longer lists test-recordings/")
    # 2
    for rel in SHIPPED:
        base = ROOT / rel
        files = [base] if base.is_file() else [p for p in base.rglob("*") if p.is_file() and p.suffix in TEXT and "node_modules" not in p.parts] if base.exists() else []
        for p in files:
            if p.stat().st_size < 2_000_000 and "test-recordings" in p.read_text(errors="ignore"):
                bad.append(f"{p.relative_to(ROOT)} mentions test-recordings")
    # 3: copies, found by size first so only candidates are hashed
    sizes: dict[int, list[Path]] = {}
    names: set[str] = set()
    if TEST.exists():
        for p in TEST.rglob("*"):
            if p.is_file() and p.stat().st_size > 200:
                sizes.setdefault(p.stat().st_size, []).append(p)
        for m in TEST.glob("lab/manifest.json"):
            for slug, v in json.loads(m.read_text()).items():
                names.update(v.get("covers", {}))
                if v.get("original"):
                    names.add(v["original"]["id"])
    candidates = {ROOT / t for t in tracked}
    for rel in ("web/public", "catalog"):
        if (ROOT / rel).exists():
            candidates.update(p for p in (ROOT / rel).rglob("*") if p.is_file())
    for p in candidates:
        if not p.is_file():
            continue
        twins = sizes.get(p.stat().st_size, [])
        if twins and any(sha(p) == sha(t) for t in twins):
            bad.append(f"{p.relative_to(ROOT)} is a copy of a file in test-recordings/")
    # 4
    songs = json.loads((ROOT / "service/scripts/lab/songs.json").read_text()) if (ROOT / "service/scripts/lab/songs.json").exists() else []
    names.update(s["slug"] for s in songs if s.get("style") != "public-domain")
    names.update(s["upload"] for s in songs if s.get("upload"))
    for rel in ("web/public", "catalog"):
        base = ROOT / rel
        for p in (base.rglob("*") if base.exists() else []):
            if p.stem in names or p.name in names:
                bad.append(f"{p.relative_to(ROOT)} is named after a test song or a test video")
    # 5
    for t in tracked:
        p = ROOT / t
        if p.suffix == ".json" and p.is_file() and p.stat().st_size < 5_000_000 and not t.startswith(("catalog/", "web/")):
            head = p.read_text(errors="ignore")[:4000]
            if '"covers_used"' in head or '"cover_notes"' in head:
                bad.append(f"{t} looks like an answer key of a test song")
    for line in bad:
        print("TEST MATERIAL WOULD SHIP:", line, file=sys.stderr)
    if not bad:
        print("check_no_test_material: ok")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
