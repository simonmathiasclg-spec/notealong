"""Melody Lab: sweep the Sax-friendly settings one at a time, on the TUNING set only.

    .venv/bin/python scripts/lab/coord.py "start=spec" [passes]

Each setting in GRID is tried at a few values around its current one; a value is adopted when the tuning
score rises by at least 0.3 (smaller gains are noise and would only fit the tuning songs). The held-out set
is never touched here: the result is judged on it afterwards with search.py.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import algos  # noqa: E402
import score  # noqa: E402
import search  # noqa: E402

GRID = {
    "melisma_max": [0.1, 0.14], "melisma_min": [0.08], "melisma_beats": [0.15, 0.25],
    "rest_beats": [0.2, 0.5], "rest_max": [0.2, 0.4],
    "w_time": [20, 50], "w_time_inner": [1, 6], "time_cap": [0.25, 0.5], "early": [1, 3],
    "win_tail": [0.1, 0.4], "w_in": [0, 3], "w_gap": [5, 20], "gap_min": [0.2, 0.45],
    "w_att": [0, 3, 10], "att_min": [0.6, 1.0], "att_tol": [0.06, 0.2],
    "w_empty": [8, 20], "empty_full": [4, 10], "w_two": [0, 5, 20], "two_min": [15, 30],
    "skip_sure": [8, 20], "skip_doubt": [1, 6],
    "chromatic_min": [0.3, 0.7], "chromatic_lean": [0.2, 0.35], "lean_sure": [0.1, 0.3], "prior": [0.5, 2.0],
    "min_syl": [0.04, 0.1], "free_min": [0.1, 0.2], "free_hold": [0.12, 0.25], "stray_len": [0.0, 0.3],
    "phrase_gap": [0.6, 1.1], "reach_after": [0.8, 1.5], "reach_before": [0.4, 0.8], "conf_min": [0.4, 0.6],
    "glitch_len": [0.25, 0.5], "pickup_min": [0.15], "level_floor_db": [30, 46],
}


def main() -> int:
    cur = search.parse(sys.argv[1]) if len(sys.argv) > 1 else {}
    passes = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    tune = search.SPLIT["tuning"]
    best = score.score_set(tune, algos.sax(cur))["mean"]["overall"]
    print("start", best, cur, flush=True)
    for _ in range(passes):
        changed = False
        for k, values in GRID.items():
            for v in values:
                trial = {**cur, k: type(getattr(algos.sm.SaxParams(), k))(v)}
                s = score.score_set(tune, algos.sax(trial))["mean"]["overall"]
                mark = ""
                if s >= best + 0.3:
                    best, cur, changed, mark = s, trial, True, "  ADOPTED"
                print(f"{k}={v}: {s}{mark}", flush=True)
        if not changed:
            break
    print("end", best, ",".join(f"{k}={v}" for k, v in cur.items()), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
