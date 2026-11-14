"""Melody Lab: fix the tuning / held-out split, once, before any experiment is run.

    .venv/bin/python scripts/lab/split.py        -> scripts/lab/split.json (titles only, committed)

About 30 % of the songs that have an answer key are held out. They are drawn only from songs that no
earlier tuning round ever looked at (rounds 1 and 2 used Let It Be, Just Give Me a Reason, Despacito and
the nine "popular" songs, so those are all tuning songs), in the order of a hash of the song's name, at
most every second song of a style, so nobody chose them.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import score  # noqa: E402
from common import BY_SLUG  # noqa: E402


def main() -> int:
    keyed = score.keyed_slugs()
    old = [s for s in keyed if BY_SLUG[s].get("upload") or BY_SLUG[s].get("popular")]
    new = sorted((s for s in keyed if s not in old), key=lambda s: hashlib.sha1(s.encode()).hexdigest())
    want = round(0.3 * len(keyed))
    held, per_style = [], {}
    total = {}
    for s in new:
        total[BY_SLUG[s]["style"]] = total.get(BY_SLUG[s]["style"], 0) + 1
    for s in new:
        st = BY_SLUG[s]["style"]
        if len(held) < want and per_style.get(st, 0) < max(1, (total[st] + 1) // 2):
            held.append(s)
            per_style[st] = per_style.get(st, 0) + 1
    out = {"tuning": sorted(s for s in keyed if s not in held), "held_out": sorted(held)}
    (Path(__file__).parent / "split.json").write_text(json.dumps(out, indent=1))
    print(len(out["tuning"]), "tuning,", len(held), "held out:", ", ".join(f"{s} ({BY_SLUG[s]['style']})" for s in out["held_out"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
