"""Melody Lab, internal testing only: the answer key of a song from its solo-instrument covers.

    .venv/bin/python scripts/lab/keys.py [slug ...]        -> test-recordings/lab/keys/<slug>.json

1. every cover: key difference undone (chroma, all 12 transpositions), octave moved to the singer's
   register, time-aligned to the original (chroma DTW of the two mixes);
   and, separately, its melody line aligned straight to the singer's pitch line (DTW on note names);
   whichever of the two fits the singer better is used;
2. then lined up finely with the original's VOCAL stem: in 8 s windows the cover's pitch line is slid up to
   0.6 s either way to where it agrees best with the singer's pitch line (note names only). Windows
   where it never agrees are cut: an intro, a solo, a verse the cover leaves out or adds;
3. vote: a note two or more covers play at the same moment (same note name, starts within 150 ms)
   is a key note. Covers that agree with the best pair on under 45 % of their notes are left out, and at most the
   four that agree best vote;
4. per lyric line: how much of what the covers play there became key notes, and how often the singer's
   own pitch line passes through the key's notes. Lines where the covers do not agree, and songs with
   too few agreed lines, are dropped.

The singer's pitch line is used only to line things up and to throw out lines (never to choose a note),
so the notes are the players'. The cost: the lines that survive lean towards lines where the pitch
tracker hears the singer well.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "accuracy"))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import answer_key as ak  # noqa: E402
from common import KEYS, SONGS, cover_files, load_song, song_dir  # noqa: E402
from notealong.pipeline import saxmelody as sm  # noqa: E402
from notealong.pipeline.syllables import count_syllables  # noqa: E402

HOP = 0.01
ak.F0_NAME = "f0_lead.npz"
TOL = 0.15


def singer_curve(d: Path) -> np.ndarray:
    z = np.load(d / "pitch.npz")
    return sm.clean_curve(z["midi"], z["conf"], z["db"])


def cover_on_song(cov: Path, song_c: np.ndarray, k: int, n: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """The cover's pitch line on the song's timeline (NaN where it does not play), and the time map."""
    z = np.load(cov.with_suffix("") / ak.F0_NAME)
    tc, ts = ak.dtw_map(np.roll(ak.chroma(cov), -k, axis=0), song_c)
    per, db, midi = z["periodicity"], z["db"], z["midi"]
    voiced = (per > 0.5) & (db > np.percentile(db[per > 0.5], 10)) if (per > 0.5).any() else per > 0.5
    t_song = np.interp(np.arange(len(midi)) * HOP, tc, ts, left=np.nan, right=np.nan)
    line = np.full(n, np.nan)
    ok = voiced & ~np.isnan(t_song)
    idx = np.clip(np.round(t_song[ok] / HOP).astype(int), 0, n - 1)
    line[idx] = midi[ok] - k
    return line, tc, ts


def pc_features(line: np.ndarray, hop: int = 5) -> np.ndarray:
    """A pitch line as note-name vectors every 50 ms (12 x frames); silence is a flat vector."""
    n = len(line) // hop
    f = np.full((12, n), 0.05, np.float32)
    seg = line[:n * hop].reshape(n, hop)
    for i in range(n):
        v = seg[i][~np.isnan(seg[i])]
        if len(v) >= 2:
            pc = int(round(float(np.median(v)))) % 12
            f[:, i] = 0.0
            f[pc, i] = 1.0
            f[(pc + 1) % 12, i] = f[(pc - 1) % 12, i] = 0.15
    return f / np.linalg.norm(f, axis=0, keepdims=True)


def melody_map(cov: Path, voice: np.ndarray) -> tuple[int, np.ndarray, np.ndarray]:
    """The cover's lead line aligned straight to the singer's pitch line: (key difference, cover times, song times)."""
    import librosa
    z = np.load(cov.with_suffix("") / ak.F0_NAME)
    per, db = z["periodicity"], z["db"]
    voiced = (per > 0.5) & (db > np.percentile(db[per > 0.5], 10)) if (per > 0.5).any() else per > 0.5
    lead = np.where(voiced, z["midi"], np.nan)
    # key: the turn of the note-name histogram that fits the singer's best
    hc = np.bincount(np.round(lead[~np.isnan(lead)]).astype(int) % 12, minlength=12).astype(float)
    hs = np.bincount(np.round(voice[~np.isnan(voice)]).astype(int) % 12, minlength=12).astype(float)
    hc, hs = hc / max(1, hc.sum()), hs / max(1, hs.sum())
    order = sorted(range(12), key=lambda k: -float(np.dot(np.roll(hc, -k), hs)))
    best = None
    fs = pc_features(voice)
    for k in order[:3]:
        fc = np.roll(pc_features(lead), -k, axis=0)
        D, wp = librosa.sequence.dtw(X=fc, Y=fs, metric="cosine", subseq=True, backtrack=True, step_sizes_sigma=ak.STEPS,
                                     weights_add=ak.WEIGHTS_ADD, weights_mul=ak.WEIGHTS_MUL)
        cost = float(D[-1, wp[0, 1]]) / len(wp)
        if best is None or cost < best[0]:
            best = (cost, k, wp[::-1])
    _, k, wp = best
    k = ((k + 6) % 12) - 6
    tc, ts = wp[:, 0] * 0.05, wp[:, 1] * 0.05
    keep = np.concatenate([[True], np.diff(tc) > 0])
    return k, tc[keep], ts[keep]


def line_on_song(cov: Path, k: int, tc: np.ndarray, ts: np.ndarray, n: int) -> np.ndarray:
    z = np.load(cov.with_suffix("") / ak.F0_NAME)
    per, db, midi = z["periodicity"], z["db"], z["midi"]
    voiced = (per > 0.5) & (db > np.percentile(db[per > 0.5], 10)) if (per > 0.5).any() else per > 0.5
    t_song = np.interp(np.arange(len(midi)) * HOP, tc, ts, left=np.nan, right=np.nan)
    line = np.full(n, np.nan)
    ok = voiced & ~np.isnan(t_song)
    line[np.clip(np.round(t_song[ok] / HOP).astype(int), 0, n - 1)] = midi[ok] - k
    return line


def pc_match(a: np.ndarray, b: np.ndarray) -> float:
    both = ~np.isnan(a) & ~np.isnan(b)
    if both.sum() < 60:
        return 0.0
    d = np.abs(((a[both] - b[both]) + 6) % 12 - 6)
    return float((d <= 0.7).mean())


def lags(line: np.ndarray, voice: np.ndarray, win: float = 8.0, hop: float = 2.0, reach: float = 0.6):
    """Per window: the shift (s) that makes the cover agree best with the singer, and how well it then agrees."""
    w, h, r = int(win / HOP), int(hop / HOP), int(reach / HOP)
    n = len(voice)
    centres, best, score = [], [], []
    for a in range(0, max(1, n - w), h):
        seg = voice[a:a + w]
        sc = {}
        for lag in range(-r, r + 1, 3):
            lo, hi = a - lag, a - lag + w
            if lo < 0 or hi > n:
                continue
            sc[lag] = pc_match(line[lo:hi], seg)
        if not sc:
            continue
        top = max(sc, key=lambda q: (sc[q], -abs(q)))
        centres.append((a + w / 2) * HOP)
        best.append(top * HOP if sc[top] > sc.get(0, 0) + 0.05 else 0.0)
        score.append(sc[top])
    return np.asarray(centres), np.asarray(best), np.asarray(score)


def build(slug: str, verbose: bool = True) -> dict | None:
    d = song_dir(slug)
    covers = list({c.stem: c for c in cover_files(slug) if (c.with_suffix("") / ak.F0_NAME).exists()}.values())
    if len(covers) < 2 or not (d / "song.json").exists():
        return None
    song = load_song(slug)
    mix = next(iter(sorted(d.glob("original.*"))))
    song_c = ak.chroma(mix)
    voice = singer_curve(d)
    n = len(voice)
    register = float(np.nanmedian(voice)) if (~np.isnan(voice)).any() else 60.0
    per = {}
    for cov in covers:
        try:
            k, costs = ak.best_shift(cov, mix)
            # the key by the singer's pitch line as well: the transposition whose notes the singer sings most
            line, tc, ts = cover_on_song(cov, song_c, k, n)
            alt = {}
            for sh in range(-6, 6):
                alt[sh] = pc_match(line - sh, voice)
            sh = max(alt, key=alt.get)
            if sh != 0 and alt[sh] > alt[0] + 0.15:
                k += sh
                line, tc, ts = cover_on_song(cov, song_c, k, n)
            cen, lag, sc = lags(line, voice)
            how = "mix"
            k2, tc2, ts2 = melody_map(cov, voice)
            line2 = line_on_song(cov, k2, tc2, ts2, n)
            cen2, lag2, sc2 = lags(line2, voice)
            if len(sc2) and (not len(sc) or float(np.mean(sc2)) > float(np.mean(sc)) + 0.03):
                k, tc, ts, cen, lag, sc, how = k2, tc2, ts2, cen2, lag2, sc2, "melody"
            notes = ak.segment(*(np.load(cov.with_suffix("") / ak.F0_NAME)[q] for q in ("midi", "periodicity", "db")))
        except Exception as e:  # noqa: BLE001
            print(f"  {cov.stem}: failed ({e})")
            continue
        out = []
        for nt in notes:
            s0, e0 = float(np.interp(nt["start"], tc, ts)), float(np.interp(nt["end"], tc, ts))
            if len(cen) == 0 or e0 - s0 < 0.05:
                continue
            i = int(np.argmin(np.abs(cen - s0)))
            if sc[i] < 0.3:                      # the cover is not playing what the singer sings here
                continue
            out.append({"start": s0 + float(lag[i]), "end": e0 + float(lag[i]), "midi": nt["midi"] - k})
        if not out:
            continue
        med = float(np.median([x["midi"] for x in out]))
        octv = int(round((register - med) / 12.0)) * 12
        for x in out:
            x["midi"] += octv
        out.sort(key=lambda x: x["start"])
        per[cov.stem] = {"notes": out, "shift": k, "octave": octv, "singer_match": round(float(np.mean(sc)), 3),
                         "kept_windows": round(float((sc >= 0.3).mean()), 2), "tempo_ratio": round(float(np.polyfit(tc, ts, 1)[0]), 3), "aligned_by": how}
        if verbose:
            print(f"  {cov.stem}: key {k:+d} ({how}), {len(out)} notes, singer match {per[cov.stem]['singer_match']:.2f}, windows kept {per[cov.stem]['kept_windows']:.2f}", flush=True)
    ids = list(per)
    if len(ids) < 2:
        return None
    pair = max(((a, b) for a in ids for b in ids if a < b),
               key=lambda ab: ak._agree(per[ab[0]]["notes"], per[ab[1]]["notes"]) + ak._agree(per[ab[1]]["notes"], per[ab[0]]["notes"]))
    anchor = sorted(per[pair[0]]["notes"] + per[pair[1]]["notes"], key=lambda x: x["start"])
    for c in ids:
        other = per[pair[1] if c == pair[0] else pair[0]]["notes"] if c in pair else anchor
        per[c]["agreement"] = round(ak._agree(per[c]["notes"], other), 3)
    used = sorted((c for c in ids if per[c]["agreement"] >= 0.45), key=lambda c: -per[c]["agreement"])[:4]   # more players add more ornaments than notes
    if len(used) < 2:
        if verbose:
            print(f"  {slug}: the covers do not agree ({ {c: per[c]['agreement'] for c in ids} }), no key")
        return {"slug": slug, "dropped": "covers do not agree", "covers": {c: {k: v for k, v in per[c].items() if k != "notes"} for c in ids}, "notes": [], "lines": []}

    # the vote
    allnotes = sorted((x["start"], x["end"], x["midi"], c) for c in used for x in per[c]["notes"])
    need = max(2, int(np.ceil(0.5 * len(used))))
    taken, keyn = set(), []
    for i, (s0, e0, m0, c0) in enumerate(allnotes):
        if i in taken:
            continue
        mem, idx = {c0: (s0, e0, m0)}, [i]
        for j in range(i + 1, len(allnotes)):
            s2, e2, m2, c2 = allnotes[j]
            if s2 - s0 > TOL:
                break
            if j in taken or c2 in mem or (m2 - m0) % 12:
                continue
            mem[c2] = (s2, e2, m2)
            idx.append(j)
        if len(mem) >= need:
            taken.update(idx)
            mids = [v[2] for v in mem.values()]
            vals, cnt = np.unique(mids, return_counts=True)
            top = vals[cnt == cnt.max()]
            keyn.append({"start": float(np.median([v[0] for v in mem.values()])), "end": float(np.median([v[1] for v in mem.values()])),
                         "midi": int(top[np.argmin(np.abs(top - register))]), "agreement": round(len(mem) / len(used), 2), "members": len(mem)})
    keyn.sort(key=lambda x: x["start"])
    clean: list[dict] = []
    for x in keyn:
        if clean and x["start"] < clean[-1]["end"] - 0.03:
            p = clean[-1]
            if x["start"] - p["start"] < 0.1:
                if x["agreement"] > p["agreement"]:
                    clean[-1] = x
                continue
            p["end"] = x["start"]
        clean.append(x)

    # syllables and lines
    words = song.get("words", [])
    lang = (song.get("language") or {}).get("code") if isinstance(song.get("language"), dict) else song.get("language")
    wstart = np.asarray([w["start"] for w in words]) if words else np.zeros(0)
    seen: dict[str, int] = {}
    for x in clean:
        x["word"], x["syl"], x["line"] = None, None, None
        if len(words):
            i = int(np.searchsorted(wstart, x["start"] + 0.12)) - 1
            if i >= 0 and x["start"] < words[i]["end"] + 0.12:
                w = words[i]
                k = seen.get(w["id"], 0)
                seen[w["id"]] = k + 1
                x["word"], x["text"], x["line"] = w["id"], w["text"], w.get("line")
                x["syl"] = min(k, max(0, count_syllables(w["text"], lang) - 1))
    used_starts = {c: np.asarray([y["start"] for y in per[c]["notes"]]) for c in used}
    lines = []
    for ln in song.get("lines", []):
        if ln.get("kind") == "instrumental":
            continue
        a, b = ln["start"] - 0.25, ln["end"] + 0.25
        kn = [x for x in clean if a <= x["start"] < b]
        played = sum(int(((used_starts[c] >= a) & (used_starts[c] < b)).sum()) for c in used)
        voted = sum(x["members"] for x in kn)
        hit = 0
        for x in kn:
            i0, i1 = max(0, int((x["start"] - 0.1) / HOP)), min(n, int((x["end"] + 0.1) / HOP) + 1)
            seg = voice[i0:i1]
            seg = seg[~np.isnan(seg)]
            if len(seg) and (np.abs(((seg - x["midi"]) + 6) % 12 - 6) <= 0.7).mean() >= 0.25:
                hit += 1
        share = voted / played if played else 0.0
        sing = hit / len(kn) if kn else 0.0
        conf = "high" if len(kn) >= 3 and share >= 0.6 and sing >= 0.7 else "medium" if len(kn) >= 3 and share >= 0.45 and sing >= 0.5 else "dropped"
        for x in kn:
            x["line"] = ln["index"]
        lines.append({"index": ln["index"], "start": ln["start"], "end": ln["end"], "notes": len(kn), "covers_agree": round(share, 2),
                      "singer_passes": round(sing, 2), "confidence": conf})
    good = [ln for ln in lines if ln["confidence"] != "dropped"]
    key = {"slug": slug, "concert_pitch": True, "covers_used": used, "need": need,
           "covers": {c: {k: v for k, v in per[c].items() if k != "notes"} | {"used": c in used} for c in ids},
           "lines": lines,
           "notes": [{"start": round(x["start"], 3), "duration": round(max(0.05, x["end"] - x["start"]), 3), "midi": x["midi"], "word": x.get("word"),
                      "text": x.get("text"), "syl": x.get("syl"), "line": x.get("line"), "agreement": x["agreement"]} for x in clean],
           "scored_lines": len(good), "scored_notes": sum(ln["notes"] for ln in good)}
    if len(good) < 6 or key["scored_notes"] < 40:
        key["dropped"] = "too few lines where the covers agree"
    if verbose:
        print(f"  {slug}: {len(clean)} notes, {len(good)}/{len(lines)} lines kept ({sum(1 for g in good if g['confidence'] == 'high')} high), "
              f"{key['scored_notes']} notes scored{'  DROPPED' if key.get('dropped') else ''}", flush=True)
    return key


def main() -> int:
    KEYS.mkdir(parents=True, exist_ok=True)
    for slug in sys.argv[1:] or [s["slug"] for s in SONGS]:
        print(slug, flush=True)
        key = build(slug)
        if key is not None:
            (KEYS / f"{slug}.json").write_text(json.dumps(key, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
