"""Melody Lab queue, internal testing only: one heavy job at a time, each through scripts/heavy.sh.

    .venv/bin/python scripts/lab/prepare.py [slug ...]

For every song: the original through the upload pipeline into test-recordings/library/<slug> (unless it is
an upload or already there), then every cover split and pitch-tracked (CREPE tiny from F3 up on the vocals and other stems mixed, 10 ms).
"""
from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from common import BY_SLUG, LAB, ROOT, SONGS, cover_files, song_dir  # noqa: E402

SERVICE = ROOT / "service"


def heavy(args: list[str]) -> int:
    for _ in range(40):
        r = subprocess.run(["scripts/heavy.sh", *args], cwd=SERVICE, capture_output=True, text=True,
                           env={**__import__("os").environ, "NOTEALONG_HEAVY_MIN_MB": "3500"})
        if r.returncode in (3, 4):           # no memory, or another heavy job: wait, never run two at once
            print("  waiting:", r.stderr.strip()[-120:], flush=True)
            time.sleep(60)
            continue
        tail = (r.stdout + r.stderr).strip().splitlines()[-1:] or [""]
        print("  ", tail[0][-160:], flush=True)
        return r.returncode
    return 3


def main() -> int:
    want = sys.argv[1:] or [s["slug"] for s in SONGS]
    for slug in want:
        s = BY_SLUG[slug]
        t0 = time.time()
        d = song_dir(slug)
        orig = LAB / slug / "original.m4a"
        ready = (d / "song.json").exists() and '"status": "ready"' in (d / "song.json").read_text()
        if not ready:
            if not orig.exists():
                print(slug, "no original, skipped", flush=True)
                continue
            heavy([".venv/bin/python", "scripts/accuracy/process_test_song.py", str(orig), slug, "--title", s["title"]])
        todo = [c for c in cover_files(slug) if not (c.with_suffix("") / "f0_lead.npz").exists()]
        for c in todo:
            heavy([".venv/bin/python", "scripts/accuracy/prepare_covers.py", str(c), "--tracker", "lead"])
        print(f"{slug}: done in {time.time() - t0:.0f} s", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
