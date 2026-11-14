"""Melody Lab: run one experiment (an algorithm) on the tuning set and the held-out set, and log it.

    .venv/bin/python scripts/lab/search.py baselines
    .venv/bin/python scripts/lab/search.py params "name" "k=v,k=v"        one setting of the Sax-friendly rules
    .venv/bin/python scripts/lab/search.py sweep k v1,v2,v3                one setting swept, the rest as they are
    .venv/bin/python scripts/lab/search.py table                           the results table as Markdown

Every run is one row in test-recordings/lab/experiments.jsonl (what changed, tuning score, held-out score,
worst songs). The rule (docs/MELODY_LAB.md): settings are chosen on the tuning set only; a change is kept
only if the held-out score improves and no held-out song loses more than 3 points.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import algos  # noqa: E402
import score  # noqa: E402
from common import LAB  # noqa: E402
from notealong.pipeline.saxmelody import SaxParams  # noqa: E402

LOG = LAB / "experiments.jsonl"
SPLIT = json.loads((Path(__file__).parent / "split.json").read_text()) if (Path(__file__).parent / "split.json").exists() else {"tuning": [], "held_out": []}


def parse(spec: str) -> dict:
    kw = {}
    for part in filter(None, spec.split(",")):
        k, v = part.split("=")
        cur = getattr(SaxParams(), k)
        kw[k] = (v == "True") if isinstance(cur, bool) else type(cur)(v)
    return kw


def run(name: str, algo, what: str, log: bool = True, held: bool = True) -> dict:
    t0 = time.time()
    tune = score.score_set(SPLIT["tuning"], algo)
    out = score.score_set(SPLIT["held_out"], algo) if held else None
    row = {"name": name, "what": what, "tuning": tune["mean"], "held_out": out and out["mean"],
           "held_out_songs": out and {s: v["overall"] for s, v in out["songs"].items()},
           "tuning_songs": {s: v["overall"] for s, v in tune["songs"].items()},
           "worst": (out or tune)["worst"], "lowest_correct": (out or tune)["lowest_correct"], "seconds": round(time.time() - t0)}
    if log:
        with LOG.open("a") as f:
            f.write(json.dumps(row) + "\n")
    show(row)
    return row


def show(r: dict) -> None:
    t, h = r["tuning"], r["held_out"] or {}
    print(f"{r['name']:<34} tuning {t.get('overall', 0):5.1f} (ok {t.get('correct', 0):4.1f} miss {t.get('missed', 0):4.1f} extra {t.get('extra', 0):4.1f})"
          + (f"  held-out {h.get('overall', 0):5.1f} (ok {h.get('correct', 0):4.1f} miss {h.get('missed', 0):4.1f} extra {h.get('extra', 0):4.1f} "
             f"wrong {h.get('wrong', 0):4.1f} onset {h.get('onset_med_ms', 0):.0f}/{h.get('onset_p90_ms', 0):.0f} ms like {h.get('sounds_like', 0):4.1f})" if h else "")
          + f"  worst {r['worst'][:2]}", flush=True)


def table() -> str:
    rows = [json.loads(x) for x in LOG.read_text().splitlines()] if LOG.exists() else []
    out = ["| # | Experiment | What changed | Tuning | Held-out | Correct | Missed | Extra | Onset (median) | Worst held-out songs |", "|---|---|---|---|---|---|---|---|---|---|"]
    for i, r in enumerate(rows, 1):
        h = r["held_out"] or {}
        worst = ", ".join(f"{s} {v}" for s, v in r["worst"][:2])
        out.append(f"| {i} | {r['name']} | {r['what']} | {r['tuning'].get('overall', '')} | {h.get('overall', 'not run')} | {h.get('correct', '')} | {h.get('missed', '')} | "
                   f"{h.get('extra', '')} | {h.get('onset_med_ms', '')} | {worst} |")
    return "\n".join(out)


def main() -> int:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "baselines"
    if cmd == "baselines":
        run("Detailed", algos.detailed, "baseline: the literal transcription")
        run("Sax-friendly round 1", algos.sax(module=algos.old_module("527b12a")), "baseline: one note per syllable, as first shipped")
        run("Sax-friendly round 2", algos.sax(), "baseline: the default before the lab")
    elif cmd == "params":
        run(sys.argv[2], algos.sax(parse(sys.argv[3])), sys.argv[3])
    elif cmd == "sweep":
        k = sys.argv[2]
        for v in sys.argv[3].split(","):
            run(f"sweep {k}={v}", algos.sax(parse(f"{k}={v}")), f"{k}={v}", log=False, held=False)
    elif cmd == "table":
        print(table())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
