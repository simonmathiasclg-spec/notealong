"""Melody Lab: turn the notes marked "This note sounds wrong" in the player into test cases.

    .venv/bin/python scripts/lab/flags_to_cases.py            -> test-recordings/lab/flag-cases.json

The marks are read from library/.me/flags.json (written by the player when the app runs locally). Each
becomes a case: this song, this moment, this note was wrong. `still_wrong(algo)` then says, for any
algorithm, how many of the marked notes it would still write (same note name, start within 100 ms), so a
change can be judged against everything the owner has flagged so far. A mark on a song that has no
answer key yet is listed under "needs_key": the next round should collect covers for it.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from common import KEYS, LAB, ROOT, SONGS  # noqa: E402

CASES = LAB / "flag-cases.json"


def build() -> dict:
    src = ROOT / "library" / ".me" / "flags.json"
    flags = json.loads(src.read_text()) if src.exists() else []
    by_upload = {s["upload"]: s["slug"] for s in SONGS if s.get("upload")}
    cases, needs = [], set()
    for f in flags:
        slug = by_upload.get(f["song_id"])
        case = {"song_id": f["song_id"], "slug": slug, "start": f["start"], "end": f.get("end"), "midi": f["midi"], "line": f.get("line"),
                "word": f.get("word"), "melody": f.get("melody"), "pipeline": f.get("pipeline"), "marked_at": f.get("at")}
        if slug and (KEYS / f"{slug}.json").exists():
            key = json.loads((KEYS / f"{slug}.json").read_text())
            near = [n for n in key.get("notes", []) if abs(n["start"] - f["start"]) <= 0.6]
            case["key_notes_nearby"] = [{"start": n["start"], "midi": n["midi"]} for n in near]
        else:
            needs.add(f["song_id"])
        cases.append(case)
    return {"cases": cases, "needs_key": sorted(needs)}


def still_wrong(algo, cases: list[dict]) -> dict:
    """How many marked notes an algorithm (slug -> notes) still writes. Only cases on lab songs can be checked."""
    by_slug: dict[str, list[dict]] = {}
    for c in cases:
        if c.get("slug"):
            by_slug.setdefault(c["slug"], []).append(c)
    same = total = 0
    for slug, cs in by_slug.items():
        notes = algo(slug)
        for c in cs:
            total += 1
            same += any(abs(n["start"] - c["start"]) <= 0.1 and (n["midi"] - c["midi"]) % 12 == 0 for n in notes)
    return {"marked": total, "still_written": same}


def main() -> int:
    out = build()
    LAB.mkdir(parents=True, exist_ok=True)
    CASES.write_text(json.dumps(out, indent=1))
    print(f"{len(out['cases'])} marked notes -> {CASES.relative_to(ROOT)}; songs without an answer key yet: {out['needs_key'] or 'none'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
