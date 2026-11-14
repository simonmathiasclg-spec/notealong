"""Melody Lab: the scorer. Compares any algorithm's notes with a song's answer key, line by line.

Only lines the answer key kept (confidence high or medium) are scored. Within them:
  correct  a key note with an output note of the same note name starting within 200 ms
  wrong    a key note whose only output note in reach has another note name (off-key ones counted apart)
  missed   a key note with no output note starting within 200 ms
  extra    an output note with no key note within 200 ms
  unjudged an unmatched output note that one of the voting covers also plays there (same note name within
           200 ms) while the others do not: it is in no key, but nobody can call it wrong. Not counted.
  repeat   an unmatched output note on the note name the key is holding at that moment: not judged.
           The covers cannot say reliably whether a held pitch was struck again (four syllables on one
           pitch), so repeats are left to the one-attack-per-syllable rule and count neither way
  timing   start-time error of the correct notes: median and 90th percentile
  sounds-like  the output as a pitch line over time (each note sounding from its start to its end, which
           is what "Hear it played" plays) against the singer's own pitch line over the whole song:
           the harmonic mean of (share of sung frames where the output is within a semitone of the
           singer, octaves ignored) and (share of output frames that fall where the singer sings)

  overall = 100 * (0.40*C + 0.20*(1 - min(1, 2*M)) + 0.20*(1 - min(1, E)) + 0.10*T + 0.10*L)
      C = correct / key notes, M = missed / key notes, E = extra / key notes,
      T = 1 - min(1, median start error / 150 ms), L = sounds-like
A key note that three or four of the four voting covers play counts in full; one that only two play counts
half (as correct, wrong or missed alike): it may be one pair's ornament.
A missed note costs twice: it is not correct, and M is doubled. Extra notes weigh as much as missed
ones do before the doubling, so neither "too simple" nor "tat tat tat" can win.
"""
from __future__ import annotations

import json
import sys
from functools import lru_cache
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from common import KEYS, LAB, load_song, song_dir  # noqa: E402
from notealong.pipeline import saxmelody as sm  # noqa: E402

HOP = 0.01
TOL = 0.2
MAJOR, MINOR = (0, 2, 4, 5, 7, 9, 11), (0, 2, 3, 5, 7, 8, 10, 11)


@lru_cache(maxsize=None)
def material(slug: str) -> dict | None:
    f = KEYS / f"{slug}.json"
    if not f.exists():
        return None
    key = json.loads(f.read_text())
    if key.get("dropped"):
        return None
    d = song_dir(slug)
    song = load_song(slug)
    z = np.load(d / "pitch.npz")
    voice = sm.smooth_curve(sm.clean_curve(z["midi"], z["conf"], z["db"]))
    lines = [ln for ln in key["lines"] if ln["confidence"] != "dropped"]
    idx = {ln["index"] for ln in lines}
    k = song.get("key") or {}
    scale = {(k.get("tonic", 0) + s) % 12 for s in (MINOR if k.get("mode") == "minor" else MAJOR)} if k else set(range(12))
    cf = LAB / "cover-notes" / f"{slug}.json"
    played = sorted((x["start"], x["midi"] % 12) for v in (json.loads(cf.read_text()) if cf.exists() else {}).values() for x in v)
    return {"key": key, "song": song, "dir": d, "voice": voice, "lines": lines, "scale": scale,
            "cover_starts": np.asarray([p[0] for p in played]), "cover_pcs": np.asarray([p[1] for p in played], int),
            "notes": [n for n in key["notes"] if n["line"] in idx]}


def keyed_slugs() -> list[str]:
    return sorted(p.stem for p in KEYS.glob("*.json") if material(p.stem) is not None)


def sounds_like(notes: list[dict], voice: np.ndarray) -> float:
    n = len(voice)
    line = np.full(n, np.nan)
    for x in notes:
        line[max(0, int(x["start"] / HOP)):min(n, int(x["end"] / HOP))] = x["midi"]
    sung, out = ~np.isnan(voice), ~np.isnan(line)
    if not sung.any() or not out.any():
        return 0.0
    both = sung & out
    near = np.abs(((line[both] - voice[both]) + 6) % 12 - 6) <= 1.0
    recall = near.sum() / sung.sum()
    wide = np.convolve(sung.astype(float), np.ones(31), "same") > 0          # a 0.15 s margin around the singing
    precision = (out & wide).sum() / out.sum()
    return float(2 * recall * precision / (recall + precision)) if recall + precision else 0.0


def W(k: dict) -> float:
    return 1.0 if k.get("agreement", 1.0) >= 0.7 else 0.5


def score_song(slug: str, notes: list[dict]) -> dict | None:
    m = material(slug)
    if m is None:
        return None
    notes = sorted(notes, key=lambda x: x["start"])
    per_line, tot = [], {"key": 0, "correct": 0, "wrong": 0, "offkey": 0, "missed": 0, "extra": 0, "repeat": 0, "out": 0}
    errs: list[float] = []
    for ln in m["lines"]:
        a, b = ln["start"] - 0.25, ln["end"] + 0.25
        K = [x for x in m["notes"] if x["line"] == ln["index"]]
        O = [x for x in notes if a <= x["start"] < b]
        pairs = sorted(((x["midi"] - k["midi"]) % 12 != 0, abs(x["start"] - k["start"]), i, j)
                       for i, k in enumerate(K) for j, x in enumerate(O) if abs(x["start"] - k["start"]) <= TOL)
        ku, ou, r = set(), set(), {"line": ln["index"], "key": len(K), "correct": 0, "wrong": 0, "offkey": 0, "missed": 0, "extra": 0, "repeat": 0, "out": len(O)}
        for bad, dt, i, j in pairs:
            if i in ku or j in ou:
                continue
            ku.add(i)
            ou.add(j)
            w = W(K[i])
            if bad:
                r["wrong"] += w
                r["offkey"] += w * (O[j]["midi"] % 12 not in m["scale"])
            else:
                r["correct"] += w
                errs.append(dt)
        rep = 0
        for j, x in enumerate(O):
            if j in ou:
                continue
            held = [k for k in K if k["start"] - 0.05 <= x["start"] <= k["start"] + k["duration"] + 0.25]
            if any((x["midi"] - k["midi"]) % 12 == 0 for k in held[-2:]):
                rep += 1
            elif len(m["cover_starts"]):
                # one of the covers plays this note here, the others do not: nobody can call it wrong
                i0, i1 = np.searchsorted(m["cover_starts"], x["start"] - TOL), np.searchsorted(m["cover_starts"], x["start"] + TOL)
                rep += bool((m["cover_pcs"][i0:i1] == x["midi"] % 12).any())
        r["key"] = sum(W(k) for k in K)
        r["missed"], r["extra"], r["repeat"] = sum(W(k) for i, k in enumerate(K) if i not in ku), len(O) - len(ou) - rep, rep
        per_line.append(r)
        for q in tot:
            tot[q] += r[q]
    kn = max(1, tot["key"])
    C, M, E = tot["correct"] / kn, tot["missed"] / kn, tot["extra"] / kn
    med = float(np.median(errs)) if errs else 0.3
    p90 = float(np.percentile(errs, 90)) if errs else 0.3
    L = sounds_like(notes, m["voice"])
    overall = 100 * (0.4 * C + 0.2 * (1 - min(1, 2 * M)) + 0.2 * (1 - min(1, E)) + 0.1 * (1 - min(1, med / 0.15)) + 0.1 * L)
    return {"slug": slug, "overall": round(overall, 1), "correct": round(100 * C, 1), "missed": round(100 * M, 1), "extra": round(100 * E, 1),
            "wrong": round(100 * tot["wrong"] / kn, 1), "offkey": round(100 * tot["offkey"] / kn, 1), "onset_med_ms": round(1000 * med),
            "onset_p90_ms": round(1000 * p90), "sounds_like": round(100 * L, 1), "key_notes": round(tot["key"], 1), "lines": per_line}


def score_set(slugs: list[str], algo) -> dict:
    rows = [r for r in (score_song(s, algo(s)) for s in slugs) if r]
    mean = {q: round(float(np.mean([r[q] for r in rows])), 1) for q in ("overall", "correct", "missed", "extra", "wrong", "offkey", "onset_med_ms", "onset_p90_ms", "sounds_like")} if rows else {}
    worst = sorted(rows, key=lambda r: r["overall"])[:3]
    return {"mean": mean, "songs": {r["slug"]: {q: v for q, v in r.items() if q != "lines"} for r in rows},
            "worst": [(r["slug"], r["overall"]) for r in worst], "lowest_correct": min((r["correct"] for r in rows), default=0)}
