"""Melody Lab, internal testing only: two checks of the answer keys themselves.

    .venv/bin/python scripts/lab/check_keys.py

1. Against people: for the songs that also have a human letter-note transcription (test-recordings/human/),
   how many of its syllables get the same note name from the cover key (same measure as
   scripts/accuracy/syllable_eval.py, the key standing in for the app).
2. The ceiling: every cover that voted, scored as if it were an algorithm. A person playing the tune does
   not score 100 against the key, so neither can the app; this says how high "perfect" is. (It flatters
   the covers a little: each one helped to write the key it is scored against.)
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "accuracy"))
import keys as K  # noqa: E402
import score  # noqa: E402
from common import KEYS, LAB, load_song  # noqa: E402


def human_agreement() -> dict:
    import syllable_eval as se
    from line_diff import diff
    out = {}
    tmp = LAB / "as-songs"
    tmp.mkdir(parents=True, exist_ok=True)
    for slug in se.SONGS:
        if not (se.HUMAN / f"{slug}.txt").exists() or score.material(slug) is None:
            continue
        key = score.material(slug)["key"]
        song = load_song(slug)
        song["notes"] = [{"id": f"k{i}", "start": n["start"], "end": n["start"] + n["duration"], "midi": n["midi"], "word": n["word"], "syl": n["syl"],
                          "line": n["line"] or 0} for i, n in enumerate(key["notes"]) if n.get("word")]
        (tmp / f"{slug}.json").write_text(json.dumps(song))
        d = diff(slug, f"file:{tmp}")
        if d and d["lines"]:
            out[slug] = {"syllables_same": d["summary"]["syll"], "human_notes": d["totals"]["human"], "missed": d["totals"]["missed"],
                         "extra": d["totals"]["extra"], "wrong": d["totals"]["wrong"]}
    return out


def ceiling() -> dict:
    out = {}
    for slug in score.keyed_slugs():
        key = score.material(slug)["key"]
        rows = []
        for c in key["covers_used"]:
            notes = cover_notes(slug, c)
            if notes:
                r = score.score_song(slug, notes)
                rows.append({q: r[q] for q in ("overall", "correct", "missed", "extra", "onset_med_ms")})
        if rows:
            out[slug] = {q: round(float(np.mean([r[q] for r in rows])), 1) for q in rows[0]}
    return out


def cover_notes(slug: str, cover_id: str) -> list[dict]:
    f = LAB / "cover-notes" / f"{slug}.json"
    if not f.exists():
        return []
    return json.loads(f.read_text()).get(cover_id, [])


def main() -> int:
    h = human_agreement()
    print("cover key against the human letter notes (syllables with the same note name):")
    for s, v in h.items():
        print(f"  {s:<24} {v}")
    c = ceiling()
    print("covers scored against the key they voted for (the ceiling):")
    for s, v in c.items():
        print(f"  {s:<24} {v}")
    if c:
        print("  mean", {q: round(float(np.mean([v[q] for v in c.values()])), 1) for q in next(iter(c.values()))})
    (LAB / "key-checks.json").write_text(json.dumps({"human": h, "ceiling": c}, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
