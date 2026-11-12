"""Line by line: the human letter notes against ours, with every missed, extra and wrong note and its cause.

    PYTHONPATH=. .venv/bin/python scripts/accuracy/line_diff.py --song let-it-be [--method sax|current|file:<dir>]
                                                                [--out diff.txt] [--json diff.json] [--quiet]

For every word the human page gives notes for, our notes on that word are lined up with the human's (after
undoing the page's transposition) and each difference is named:

  missed   a note the human wrote that we do not show          extra   a note we show that the human did not write
  wrong    a note in the right place with the wrong name

and given a likely cause, judged from the singer's pitch curve:

  syllables  we counted fewer syllables in the word than the human wrote notes, and the word has no melisma to
             explain it (or more, for an extra note)
  melisma    the missing pitch is held inside the word, but too briefly for the rule that allows a second
             note on one syllable
  merge      we had a syllable for the note but two syllables came out as one note (same pitch, or one skipped)
  timing     the right pitch is held just outside the word: the boundary between words is in the wrong place
  pitch      the right pitch is not held anywhere near: the pitch itself was heard or rounded wrongly

The output (which quotes the human page) goes to the gitignored test-recordings/ folder only.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from syllable_eval import HUMAN, NAMES, SONGS, compare, load_song, norm, onset_check, parse_human  # noqa: E402
from difflib import SequenceMatcher  # noqa: E402


def _align(h: list[int], o: list[int]) -> list[tuple[str, int | None, int | None]]:
    """Edit script between two rows of pitch classes: (op, index in h, index in o), op in = / wrong / missed / extra."""
    H, O = len(h), len(o)
    D = np.zeros((H + 1, O + 1))
    D[:, 0] = np.arange(H + 1)
    D[0, :] = np.arange(O + 1)
    for i in range(1, H + 1):
        for j in range(1, O + 1):
            D[i, j] = min(D[i - 1, j - 1] + (0 if h[i - 1] == o[j - 1] else 1.2), D[i - 1, j] + 1, D[i, j - 1] + 1)
    ops, i, j = [], H, O
    while i or j:
        if i and j and D[i, j] == D[i - 1, j - 1] + (0 if h[i - 1] == o[j - 1] else 1.2):
            ops.append(("=" if h[i - 1] == o[j - 1] else "wrong", i - 1, j - 1))
            i, j = i - 1, j - 1
        elif i and D[i, j] == D[i - 1, j] + 1:
            ops.append(("missed", i - 1, None))
            i -= 1
        else:
            ops.append(("extra", None, j - 1))
            j -= 1
    return ops[::-1]


def _runs_of(slug: str, song: dict):
    """The held stretches of the singer's curve (as the sax method hears them) for judging causes."""
    from notealong.pipeline import saxmelody as sm
    from notealong.pipeline.songkey import vocal_histogram
    d = SONGS[slug]["dir"]
    z = np.load(d / "pitch.npz")
    p = sm.SaxParams()
    x = sm.clean_curve(z["midi"], z["conf"], z["db"], p)
    xs = sm.smooth_curve(x)
    delta = sm.tuning_offset(x, xs)
    return sm.note_runs(xs - delta, shortest=4), xs - delta


def diff(slug: str, method: str = "sax") -> dict | None:
    from notealong.pipeline.syllables import count_syllables
    song = load_song(slug, method)
    hf = HUMAN / f"{slug}.txt"
    if song is None or not hf.exists():
        return None
    human = parse_human(hf)
    summary = compare(human, song)
    shift = summary["shift"]
    words = song.get("words", [])
    lang = (song.get("language") or {}).get("override") or (song.get("language") or {}).get("detected")
    ours = [norm(w.get("roman") or w["text"]) or norm(w["text"]) for w in words]
    notes = sorted(song.get("notes", []), key=lambda n: n["start"])
    by_word: dict[str, list[dict]] = {}
    for n in notes:
        if n.get("word"):
            by_word.setdefault(n["word"], []).append(n)
    flat = [(li, wi, w) for li, l in enumerate(human) for wi, w in enumerate(l["words"])]
    sm_ = SequenceMatcher(a=[f[2] for f in flat], b=ours, autojunk=False)
    match: dict[tuple[int, int], int] = {}
    for blk in sm_.get_matching_blocks():
        if blk.size < 2:
            continue
        for k in range(blk.size):
            li, wi, _ = flat[blk.a + k]
            match[(li, wi)] = blk.b + k
    runs, y = _runs_of(slug, song)

    def held(pc: int, t0: float, t1: float) -> float:
        """Longest time the pitch class is held between t0 and t1 (seconds)."""
        best = 0.0
        for a, b, pitch in runs:
            if b * 0.01 <= t0 or a * 0.01 >= t1:
                continue
            if int(round(pitch)) % 12 == pc:
                best = max(best, (min(b * 0.01, t1) - max(a * 0.01, t0)))
        return best

    lines, tot = [], {"human": 0, "ours": 0, "right": 0, "missed": 0, "extra": 0, "wrong": 0, "causes": {}}
    for li, l in enumerate(human):
        if not l["by_word"]:
            continue
        row = {"line": li + 1, "words": [], "human": 0, "right": 0, "missed": 0, "extra": 0, "wrong": 0, "causes": {}}
        for wi, hw in enumerate(l["words"]):
            j = match.get((li, wi))
            if j is None:
                row["words"].append({"word": hw, "matched": False})
                continue
            w = words[j]
            mine = by_word.get(w["id"], [])
            h = [(m + shift) % 12 for m in l["groups"][wi]]
            o = [n["midi"] % 12 for n in mine]
            nsyl = count_syllables(w.get("text", ""), lang, w.get("roman"))
            sy = len({n.get("syl") for n in mine})
            t0 = mine[0]["start"] if mine else w["start"]
            t1 = mine[-1]["end"] if mine else w["end"]
            issues = []
            for op, hi, oi in _align(h, o):
                if op == "=":
                    row["right"] += 1
                    continue
                if op == "missed":
                    pc = h[hi]
                    inside = held(pc, t0 - 0.03, t1 + 0.03)
                    near = held(pc, t0 - 0.45, t1 + 0.45)
                    if len(h) > nsyl and inside >= 0.04:
                        cause = "melisma"
                    elif len(h) <= nsyl and len(o) < nsyl:
                        cause = "merge"
                    elif inside >= 0.04:
                        cause = "melisma"
                    elif near >= 0.05:
                        cause = "timing"
                    elif len(h) > nsyl:
                        cause = "syllables"
                    else:
                        cause = "pitch"
                    issues.append({"op": op, "note": NAMES[pc], "cause": cause, "held": round(inside, 2)})
                elif op == "extra":
                    cause = "syllables" if nsyl > len(h) and len(o) <= nsyl else "melisma"
                    issues.append({"op": op, "note": NAMES[o[oi]], "cause": cause})
                else:
                    pc = h[hi]
                    inside = held(pc, mine[oi]["start"] - 0.03, mine[oi]["end"] + 0.03)
                    near = held(pc, mine[oi]["start"] - 0.45, mine[oi]["end"] + 0.45)
                    cause = "pitch" if inside < 0.05 and near < 0.05 else ("timing" if inside < 0.05 else "pitch-choice")
                    issues.append({"op": op, "note": NAMES[pc], "got": NAMES[o[oi]], "cause": cause, "held": round(inside, 2)})
                row[op] += 1
                row["causes"][issues[-1]["cause"]] = row["causes"].get(issues[-1]["cause"], 0) + 1
            row["human"] += len(h)
            tot["ours"] += len(o)
            row["words"].append({"word": hw, "matched": True, "t": round(w["start"], 2), "syl": nsyl, "human": [NAMES[k] for k in h],
                                 "ours": [NAMES[k] for k in o], "issues": issues})
        for k in ("human", "right", "missed", "extra", "wrong"):
            tot[k] += row[k]
        for c, v in row["causes"].items():
            tot["causes"][c] = tot["causes"].get(c, 0) + v
        lines.append(row)
    cov = onset_check(song, SONGS[slug]["cover"])
    return {"slug": slug, "shift": shift, "summary": summary, "totals": tot, "lines": lines, "cover": cov}


def text(d: dict) -> str:
    out = [f"{d['slug']}: transposed by {d['shift']}; syllables right {100 * d['summary']['syll']:.0f}%, "
           f"human notes {d['totals']['human']}, right {d['totals']['right']}, missed {d['totals']['missed']}, "
           f"extra {d['totals']['extra']}, wrong {d['totals']['wrong']}; causes {d['totals']['causes']}"]
    for r in d["lines"]:
        hs, os_, marks = [], [], []
        for w in r["words"]:
            if not w["matched"]:
                hs.append(f"[{w['word']}?]")
                os_.append("[?]")
                continue
            hs.append(f"{w['word']}:" + "-".join(w["human"]))
            os_.append("-".join(w["ours"]) or "·")
            for i in w["issues"]:
                marks.append(f"{w['word']}: {i['op']} {i['note']}" + (f" (got {i['got']})" if i.get("got") else "") + f" [{i['cause']}]")
        out.append(f"\nline {r['line']}  right {r['right']}/{r['human']}  missed {r['missed']}  extra {r['extra']}  wrong {r['wrong']}")
        out.append("  key : " + "  ".join(hs))
        out.append("  app : " + "  ".join(os_))
        for m in marks:
            out.append("    " + m)
    return "\n".join(out)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--song", action="append")
    ap.add_argument("--method", default="sax")
    ap.add_argument("--out")
    ap.add_argument("--json")
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args()
    res, chunks = [], []
    for slug in a.song or list(SONGS):
        d = diff(slug, a.method)
        if d is None or not d["lines"]:
            continue
        res.append(d)
        chunks.append(text(d))
        t = d["totals"]
        print(f"{slug:24s} syll {100 * d['summary']['syll']:3.0f}%  human {t['human']:4d}  missed {t['missed']:3d}  extra {t['extra']:3d}  "
              f"wrong {t['wrong']:3d}  ratio {d['summary']['notes_ratio']:.2f}  onset {d['cover']['onset_med'] if d['cover'] else 'n/a'}  {t['causes']}")
    if not a.quiet:
        print("\n\n".join(chunks))
    if a.out:
        Path(a.out).parent.mkdir(parents=True, exist_ok=True)
        Path(a.out).write_text("\n\n".join(chunks) + "\n")
    if a.json:
        Path(a.json).parent.mkdir(parents=True, exist_ok=True)
        Path(a.json).write_text(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
