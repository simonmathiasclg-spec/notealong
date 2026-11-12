"""Try sax-melody settings on the whole test set: one row per song, per setting.

    PYTHONPATH=. .venv/bin/python scripts/accuracy/try_params.py base "w_time=20" "w_time=20,melisma_beats=0.3"
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import syllable_eval as se  # noqa: E402
from line_diff import diff  # noqa: E402
from notealong.pipeline.saxmelody import SaxParams  # noqa: E402

SLUGS = [s for s in se.SONGS if (se.HUMAN / f"{s}.txt").exists() and (se.SONGS[s]["dir"] / "song.json").exists()]


def run(spec: str, slugs: list[str]) -> dict:
    kw = {}
    if spec != "base":
        for part in spec.split(","):
            k, v = part.split("=")
            kw[k] = type(getattr(SaxParams(), k))(v) if not isinstance(getattr(SaxParams(), k), bool) else v == "True"
    se.PARAMS = SaxParams(**kw)
    out = {}
    for s in slugs:
        d = diff(s, "sax")
        if d is None:
            r = se.evaluate(s, "sax")
            out[s] = {"syll": r.get("syll"), "missed": None}
            continue
        t = d["totals"] if d["lines"] else None
        c = d.get("cover")
        out[s] = {"syll": d["summary"]["syll"], "recall": d["summary"]["recall"], "ratio": d["summary"]["notes_ratio"],
                  "missed": t and t["missed"], "extra": t and t["extra"], "wrong": t and t["wrong"], "human": t and t["human"],
                  "onset": c and c["onset_med"]}
    return out


def main() -> None:
    args = sys.argv[1:]
    slugs = SLUGS
    if args and args[0].startswith("--songs="):
        slugs = args.pop(0)[8:].split(",")
    specs = args or ["base"]
    res = {sp: run(sp, slugs) for sp in specs}
    for sp in specs:
        print(f"\n== {sp}")
        for s in slugs:
            r = res[sp][s]
            f = lambda v, fmt="{:.0f}": "  -" if v is None else fmt.format(v)   # noqa: E731
            print(f"  {s:24s} syll {100 * r['syll']:3.0f}%  recall {100 * r.get('recall', 0):3.0f}%  ratio {r.get('ratio', 0):.2f}  "
                  f"missed {f(r.get('missed')):>3s} extra {f(r.get('extra')):>3s} wrong {f(r.get('wrong')):>3s}  onset {f(r.get('onset'))}")
        print(f"  {'mean':24s} syll {100 * sum(r['syll'] for r in res[sp].values()) / len(slugs):3.1f}%")


if __name__ == "__main__":
    main()
