"""Why are notes wrong? For each key note found within 100 ms whose shown note has a different note name,
classify the shown note by the singer's pitch curve (FCPE, 10 ms frames) over its span:
  slide     the voice never holds the shown pitch for 60 ms (a scoop, glide or fall passing through it)
  sung      the voice holds the shown pitch: the singer really sang it (an interpretation difference)
  octave    off by an octave (counted by note name as right, so not listed)
  unpitched less than a quarter of the note has a pitch

    .venv/bin/python scripts/accuracy/wrong_notes.py --method refined_fcpe [--song despacito]
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import evaluate as E  # noqa: E402


def stable_ms(midi: np.ndarray, conf: np.ndarray, a: int, b: int, target: int, tol: float = 0.35) -> float:
    best = run = 0
    for i in range(a, b):
        if conf[i] >= 0.5 and abs(midi[i] - target) <= tol:
            run += 1
            best = max(best, run)
        else:
            run = 0
    return best * 10.0


def classify(method: str, songs: list[str] | None, overrides: dict | None = None) -> dict:
    out = {}
    for name, d, kp in E.popular_songs():
        if songs and name not in songs:
            continue
        song = json.loads((d / "song.json").read_text())
        key = json.loads(kp.read_text())
        est = sorted(E.METHODS[method](*E._vc(song["id"], d, None), overrides), key=lambda n: n["start"])
        vocals, _, cache, _ = E._vc(song["id"], d, None)
        midi, conf, db = E._pitch(vocals, cache, "fcpe")
        strict = sorted([n for n in key["notes"] if n["agreement"] >= 0.75], key=lambda n: n["start"])
        pairs = E._greedy(strict, est, 0.10, False)
        c = Counter()
        for i, j in pairs:
            r, e = strict[i], est[j]
            if (e["midi"] - r["midi"]) % 12 == 0:
                c["right"] += 1
                continue
            a, b = int(e["start"] / 0.01), min(len(midi), int(e["end"] / 0.01))
            if b <= a or (conf[a:b] >= 0.5).mean() < 0.25:
                c["unpitched"] += 1
            elif stable_ms(midi, conf, a, b, e["midi"]) < 60:
                c["slide"] += 1
            else:
                c["sung"] += 1
        out[name] = dict(c)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--method", default="refined_fcpe")
    ap.add_argument("--song", action="append")
    ap.add_argument("--set", action="append", default=[])
    a = ap.parse_args()
    overrides = {k: (v.lower() == "true" if v.lower() in ("true", "false") else float(v)) for k, v in (x.split("=", 1) for x in a.set)} or None
    res = classify(a.method, a.song, overrides)
    tot = Counter()
    for name, c in res.items():
        tot.update(c)
        wrong = sum(v for k, v in c.items() if k != "right")
        print(f"{name:18s} right {c.get('right', 0):3d}  wrong {wrong:3d}: slide {c.get('slide', 0):3d}  sung {c.get('sung', 0):3d}  unpitched {c.get('unpitched', 0):3d}")
    wrong = sum(v for k, v in tot.items() if k != "right")
    print(f"{'ALL':18s} right {tot.get('right', 0):3d}  wrong {wrong:3d}: slide {tot.get('slide', 0):3d}  sung {tot.get('sung', 0):3d}  unpitched {tot.get('unpitched', 0):3d}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
