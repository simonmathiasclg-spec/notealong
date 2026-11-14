"""Melody Lab, internal testing only: the cover keys against human letter-note transcriptions.

    .venv/bin/python scripts/lab/human_check.py

Per song that has both: the line's sequence of note names with repeats collapsed (the covers cannot show
repeats), human against key. "found" = share of the human's notes the key also has in order; "clean" = share
of the key's notes the human also has. The same two numbers for the app's current notes are printed as a
yardstick. Lines the key does not cover are left out.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "accuracy"))
import check_keys  # noqa: E402
from common import LAB  # noqa: E402


def lcs(a, b):
    D = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
    for i in range(len(a)):
        for j in range(len(b)):
            D[i + 1][j + 1] = D[i][j] + 1 if a[i] == b[j] else max(D[i][j + 1], D[i + 1][j])
    return D[len(a)][len(b)]


def col(x):
    return [v for i, v in enumerate(x) if i == 0 or x[i - 1] != v]


def sim(slug: str, method: str, only: set[int] | None = None):
    from line_diff import diff
    d = diff(slug, method)
    if not d or not d["lines"]:
        return None
    num = den = den2 = 0
    lines = set()
    for l in d["lines"]:
        h = col([p for w in l["words"] for p in (w.get("human") or [])])
        o = col([p for w in l["words"] for p in (w.get("ours") or [])])
        if only is None and len(o) < max(2, 0.5 * len(h)) or only is not None and l["line"] not in only:
            continue
        lines.add(l["line"])
        num, den, den2 = num + lcs(h, o), den + len(h), den2 + len(o)
    return {"found": round(num / max(1, den), 2), "clean": round(num / max(1, den2), 2), "human_notes": den}, lines


def main() -> int:
    import syllable_eval as se
    check_keys.human_agreement()                  # writes the keys as songs
    for s in se.SONGS:
        k = sim(s, f"file:{LAB / 'as-songs'}")
        if not k or not k[0]["human_notes"]:
            continue
        a = sim(s, "sax", k[1])
        print(f"{s:<24} key {k[0]}   app {a[0] if a else None}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
