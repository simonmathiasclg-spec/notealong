"""The sax-friendly melody: what a person writing letter notes, or a sax player playing the tune, would write.

The detailed pipeline (melody.py, cleanup.py, pitchnotes.py) transcribes the singer literally and then tidies
up: every scoop, slide and wobble starts life as a note. This module works the other way round. The words
decide how many notes there are:

  1. every word is split into syllables (syllables.py), and every syllable gets ONE note;
  2. where each syllable is sung is found on the singer's pitch curve: within a phrase the boundaries between
     syllables are placed so that each stretch holds one pitch as purely as possible, close to where the
     lyric timing says the word starts, and preferably on a fresh attack of the voice (a small dynamic
     programme per phrase);
  3. the note is the pitch the syllable settles on: the scoop into it, the fall off it and the vibrato are
     ignored;
  4. a second note appears only for a real melisma: the voice moves to another pitch and holds it;
  5. the note lasts until the next syllable starts, unless the singer really stops (a breath, a rest);
  6. a pitch outside the song's key needs strong evidence (long, steady, well in tune) to survive, otherwise
     it becomes its neighbour in the key that the voice leans towards;
  7. a single note an octave away from everything around it is put back;
  8. starts close to a beat subdivision are moved onto it;
  9. singing without words ("ooh", humming) gets notes by the same one-held-note logic.

Everything works on the 10 ms pitch curve of the vocals stem (pitch.npz), so no model runs here.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .syllables import count_syllables

HOP = 0.01          # seconds per frame of the pitch curve

MAJOR_SCALE = (0, 2, 4, 5, 7, 9, 11)
MINOR_SCALE = (0, 2, 3, 5, 7, 8, 10, 11)      # natural minor plus the raised seventh


@dataclass
class SaxParams:
    conf_min: float = 0.5            # pitch tracker confidence for a frame to count as sung
    level_floor_db: float = 38.0     # and no quieter than this below the loud parts
    glitch_len: float = 0.35         # octave slips of the tracker shorter than this are folded back
    phrase_gap: float = 0.8          # a pause between words this long starts a new phrase
    reach_before: float = 0.6        # how far before / after the lyric timing a syllable may really start
    reach_after: float = 1.1
    w_time: float = 35.0             # cost per second of straying from the lyric timing (1.0 = one wrong frame)
    w_time_inner: float = 3.0        # the same for syllables inside a word, whose timing is only a guess
    time_slack: float = 0.05
    time_cap: float = 0.35           # beyond this the lyric timing is simply wrong, and being more wrong costs little
    w_time_far: float = 6.0
    aligner: str = "frames"
    lean_sure: float = 0.2           # an out-of-key pitch leaning less than this goes where its neighbours are
    w_melisma: float = 6.0           # cost of a second held note in one syllable ...
    melisma_full: float = 20.0       # ... in full once that note lasts this many frames
    w_time_in: float = 3.0           # cost per second of straying from the lyric timing inside the sounding note
    onset_full: float = 1.0          # an attack this strong makes splitting a held note free
    w_split: float = 0.0             # cost of starting a syllable in the middle of a steady note, with no fresh attack
    skip_sure: float = 14.0          # cost of leaving a word without a note: one the lyrics are sure of ...
    skip_doubt: float = 3.0          # ... and one they are not (a word the recogniser may have made up)
    early: float = 2.0               # word timings start early more often than late, so early costs more
    w_onset: float = 0.0             # reward for starting a syllable on a fresh attack
    w_empty: float = 14.0            # cost of a syllable with nothing sung in it
    grid: int = 2                    # boundaries are searched every this many frames
    prior: float = 1.0               # how much the song's usual notes decide a pitch that sits between two notes
    min_syl: float = 0.06
    melisma_beats: float = 0.6       # a second pitch inside one syllable must be held this long (in beats) ...
    melisma_min: float = 0.18        # ... and at least / at most this many seconds
    melisma_max: float = 0.5
    melisma_step: float = 0.8        # and differ this much (semitones) from the main pitch
    rest_beats: float = 0.5          # silence this long (in beats) after a note is a real rest ...
    rest_min: float = 0.22
    rest_max: float = 0.45
    free_min: float = 0.14           # shortest wordless note
    free_hold: float = 0.18          # a wordless stretch changes note when the new pitch is held this long
    chromatic_min: float = 0.45      # an out-of-key note survives when it is this long ...
    chromatic_lean: float = 0.27     # ... this well in tune (semitones from the note) ...
    chromatic_steady: float = 0.7    # ... and this steady
    snap_tol: float = 0.06           # note starts within this of a beat subdivision move onto it
    one_per_syllable: bool = True


# ------------------------------------------------------------------ the curve

def _runs(mask: np.ndarray) -> list[tuple[int, int]]:
    """[start, end) of every run of True."""
    if not len(mask):
        return []
    d = np.diff(np.concatenate([[0], mask.astype(np.int8), [0]]))
    return list(zip(np.flatnonzero(d == 1).tolist(), np.flatnonzero(d == -1).tolist()))


def _nan_filter(x: np.ndarray, width: int, how) -> np.ndarray:
    from numpy.lib.stride_tricks import sliding_window_view
    pad = width // 2
    xp = np.concatenate([np.full(pad, np.nan), x, np.full(pad, np.nan)])
    win = sliding_window_view(xp, width)
    with np.errstate(all="ignore"):
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            return how(win, axis=1)


def clean_curve(midi: np.ndarray, conf: np.ndarray, db: np.ndarray, p: SaxParams | None = None) -> np.ndarray:
    """The sung pitch per frame in (fractional) MIDI numbers, NaN where nobody sings. Octave slips of the
    tracker are folded back and holes of a few frames are bridged."""
    p = p or SaxParams()
    n = min(len(midi), len(conf), len(db))
    midi, conf, db = np.asarray(midi[:n], float), np.asarray(conf[:n], float), np.asarray(db[:n], float)
    sure = conf >= p.conf_min
    loud = float(np.percentile(db[sure], 95)) if sure.sum() > 50 else -20.0
    voiced = sure & (db >= loud - p.level_floor_db) & (midi > 20)
    x = np.where(voiced, midi, np.nan)
    if not voiced.any():
        return x
    width = int(round(2 * p.glitch_len / HOP)) | 1
    med = _nan_filter(x, width, np.nanmedian)
    d = x - med
    for k in (12.0, -12.0, 24.0, -24.0, 19.0, -19.0):
        hit = np.abs(d - k) < 2.0
        x[hit] -= (k if abs(k) != 19.0 else np.sign(k) * 12.0) if abs(k) != 19.0 else 0.0
        if abs(k) == 19.0:
            x[hit] = np.nan                         # a twelfth away for a moment: the tracker caught an overtone
    # what is still far from everything around it for a moment is not a note
    d = x - _nan_filter(x, width, np.nanmedian)
    x[np.abs(d) > 7.5] = np.nan
    # bridge holes of up to 3 frames inside one pitch
    holes = _runs(np.isnan(x))
    for a, b in holes:
        if 0 < a and b < len(x) and b - a <= 3 and abs(x[a - 1] - x[b]) < 1.0:
            x[a:b] = np.linspace(x[a - 1], x[b], b - a + 2)[1:-1]
    return x


def smooth_curve(x: np.ndarray, width: int = 9) -> np.ndarray:
    """The curve with vibrato and jitter averaged out (still NaN where nobody sings)."""
    s = _nan_filter(x, width, np.nanmean)
    s[np.isnan(x)] = np.nan
    return s


def tuning_offset(x: np.ndarray, xs: np.ndarray) -> float:
    """How far the singer sits from concert pitch, in semitones (-0.5..0.5), judged on the steady frames."""
    ok = ~np.isnan(x) & ~np.isnan(xs)
    ok[ok] &= np.abs(x[ok] - xs[ok]) < 0.25
    if ok.sum() < 100:
        return 0.0
    ang = 2 * np.pi * xs[ok]
    return float(np.angle(np.mean(np.exp(1j * ang))) / (2 * np.pi))


# ------------------------------------------------------------------ syllables

def syllable_plan(words: list[dict], language: str | None) -> list[dict]:
    """One entry per sung syllable, in order: {"word": id, "k": index in the word, "n": syllables in the word,
    "t": where the lyric timing puts its start, "end": the word's end, "inner": not the first of its word}."""
    out = []
    for w in sorted(words, key=lambda w: w["start"]):
        n = count_syllables(w.get("text", ""), language, w.get("roman"))
        dur = max(0.0, w["end"] - w["start"])
        n = max(1, min(n, int(dur / 0.07) or 1))           # no more syllables than fit in the word
        for k in range(n):
            c = w.get("confidence")
            out.append({"word": w["id"], "line": w.get("line", 0), "k": k, "n": n,
                        "t": w["start"] + dur * k / n, "end": w["end"], "inner": k > 0,
                        "sure": 1.0 if c is None else float(max(0.0, min(1.0, c)))})
    return out


def _phrases(syls: list[dict], gap: float, longest: int = 36) -> list[list[dict]]:
    out: list[list[dict]] = []
    for s in syls:
        if out and not s["inner"] and s["t"] - out[-1][-1]["end"] <= gap or (out and s["inner"]):
            out[-1].append(s)
        else:
            out.append([s])
    # very long phrases are cut at their widest pauses, to keep the search small
    done = []
    for ph in out:
        stack = [ph]
        while stack:
            q = stack.pop()
            if len(q) <= longest:
                done.append(q)
                continue
            cuts = [i for i in range(4, len(q) - 4) if not q[i]["inner"]]
            if not cuts:
                done.append(q)
                continue
            i = max(cuts, key=lambda i: (q[i]["t"] - q[i - 1]["end"], -abs(i - len(q) / 2)))
            stack += [q[:i], q[i:]]
    done.sort(key=lambda q: q[0]["t"])
    return done


def _border(voiced: np.ndarray, a: float, b: float) -> int:
    """The frame between two phrases (a = end of the last word before, b = start of the first word after):
    the middle of the first real silence, so a held last note runs to its breath."""
    n = len(voiced)
    lo = int(max(0, min(n, round((a - 0.15) / HOP))))
    hi = int(max(lo, min(n, round((b + 0.2) / HOP))))
    quiet = _runs(~voiced[lo:hi])
    if not quiet:
        return int(max(lo, min(hi, round((b - 0.1) / HOP))))
    for q0, q1 in quiet:
        if q1 - q0 >= 15:
            return lo + (q0 + q1) // 2
    q0, q1 = max(quiet, key=lambda q: q[1] - q[0])
    return lo + (q0 + q1) // 2


def _edge_before(voiced: np.ndarray, t: float, reach: float = 0.6) -> int:
    """Where a phrase that starts around t may begin: the last real silence before it."""
    hi = int(max(0, min(len(voiced), round((t + 0.15) / HOP))))
    lo = int(max(0, round((t - reach) / HOP)))
    quiet = [q for q in _runs(~voiced[lo:hi]) if q[1] - q[0] >= 12]
    if quiet:
        q0, q1 = quiet[-1]
        return lo + (q0 + q1) // 2
    return int(max(lo, round((t - 0.1) / HOP)))


def _edge_after(voiced: np.ndarray, t: float, reach: float = 4.0) -> int:
    """Where a phrase whose last word ends around t may end: the first real silence after it."""
    lo = int(max(0, min(len(voiced), round((t - 0.15) / HOP))))
    hi = int(min(len(voiced), round((t + reach) / HOP)))
    for q0, q1 in _runs(~voiced[lo:hi]):
        if q1 - q0 >= 15:
            return lo + (q0 + q1) // 2
    return hi


def note_runs(y: np.ndarray, tol: float = 0.75, shortest: int = 5, hole: int = 5) -> list[tuple[int, int, float]]:
    """The curve cut into held stretches: [(first frame, end frame, pitch)]. A stretch ends when the pitch
    leaves it by more than `tol` semitones or the voice stops for more than `hole` frames; anything shorter
    than `shortest` frames is a slide between notes and is left out."""
    runs: list[list] = []                    # [start, end, values]
    for f in np.flatnonzero(~np.isnan(y)):
        f = int(f)
        r = runs[-1] if runs else None
        if r is not None and f - r[1] <= hole:
            vals = r[2]
            centre = float(np.median(vals[-40:]))
            if abs(float(y[f]) - centre) <= tol:
                r[1] = f + 1
                vals.append(float(y[f]))
                continue
        runs.append([f, f + 1, [float(y[f])]])
    return [(a, b, float(np.median(vals))) for a, b, vals in runs if len(vals) >= shortest]


def held_runs(y: np.ndarray, scale: frozenset[int] | None, usual: np.ndarray | None, p: SaxParams) -> list[dict]:
    """The held stretches of the song with the note each one is: [{"a", "b", "pitch", "midi", "lean",
    "snapped", "steady"}].

    Singers scoop into notes and sing a little flat or sharp, so a stretch is not always on a note. One that
    sits between two notes becomes the one the song uses more (`usual`: the share of singing on each pitch
    class). One that is outside the key has to be long, steady and well centred to stay; otherwise it is the
    start or the tail of the note next to it, or simply the in-key note it leans to."""
    runs = [{"a": a, "b": b, "pitch": pc, "steady": float((~np.isnan(y[a:b])).mean())} for a, b, pc in note_runs(y)]
    prior = None
    if usual is not None and usual.sum() > 0:
        prior = usual / usual.sum()
        if scale is not None:
            prior = prior + np.asarray([0.05 if k in scale else 0.0 for k in range(12)])
        prior = np.log(prior + 0.02)
    for r in runs:
        yv = r["pitch"]
        m = int(round(yv))
        if prior is not None and abs(yv - m) > 0.2:
            other = m + (1 if yv > m else -1)
            if -3 * abs(yv - other) + p.prior * prior[other % 12] > -3 * abs(yv - m) + p.prior * prior[m % 12]:
                m = other
        r["midi"], r["snapped"], r["lean"], r["round"] = m, False, yv - m, int(round(yv))
    if scale is None:
        return runs
    starts = np.asarray([r["a"] for r in runs])
    inkey = np.asarray([(r["b"] - r["a"]) if r["round"] % 12 in scale else 0 for r in runs], float)
    size = np.asarray([r["b"] - r["a"] for r in runs], float)
    for i, r in enumerate(runs):
        if r["midi"] % 12 in scale:
            continue
        lo, hi = np.searchsorted(starts, r["a"] - 1200), np.searchsorted(starts, r["a"] + 1200)
        if inkey[lo:hi].sum() / max(1.0, size[lo:hi].sum()) < 0.72:
            continue                                   # a stretch of the song in another key is left alone
        if abs(r["lean"]) > 0.5:
            continue
        dur = (r["b"] - r["a"]) * HOP
        if dur >= p.chromatic_min and abs(r["lean"]) <= p.chromatic_lean and r["steady"] >= p.chromatic_steady:
            continue
        up = r["lean"] > 0
        if abs(r["lean"]) < p.lean_sure:
            nxt = runs[i + 1] if i + 1 < len(runs) and runs[i + 1]["a"] - r["b"] <= 8 else None
            prv = runs[i - 1] if i > 0 and r["a"] - runs[i - 1]["b"] <= 8 else None
            if nxt is not None and abs(nxt["round"] - r["midi"]) == 1 and nxt["round"] % 12 in scale:
                up = nxt["round"] > r["midi"]          # the scoop into the next note
            elif prv is not None and abs(prv["round"] - r["midi"]) == 1 and prv["round"] % 12 in scale:
                up = prv["round"] > r["midi"]          # the tail of the note before
            elif abs(r["lean"]) < 0.08:
                up = True                              # voices come at a note from below far more often
        r["midi"] += 1 if up else -1
        r["snapped"] = True
    return runs


def runs_to_notes(runs: list[dict], starts: np.ndarray, a: int, b: int, hold: int) -> list[dict]:
    """The notes sung in frames [a, b): the note most of it is on, and any other that is really held (at
    least `hold` frames). Slides and short turns are left out; their time goes to the notes around them."""
    parts: list[dict] = []
    for r in runs[max(0, int(np.searchsorted(starts, a)) - 1):int(np.searchsorted(starts, b))]:
        s0, e0 = max(a, r["a"]), min(b, r["b"])
        if e0 - s0 < 2:
            continue
        f = e0 - s0
        if parts and parts[-1]["midi"] == r["midi"]:
            q = parts[-1]
            if f > q["big"]:
                q.update(big=f, lean=r["lean"], snapped=r["snapped"], pitch=r["pitch"])
            q["b"], q["frames"] = e0, q["frames"] + f
        else:
            parts.append({"a": s0, "b": e0, "midi": r["midi"], "frames": f, "big": f, "lean": r["lean"],
                          "snapped": r["snapped"], "pitch": r["pitch"], "steady0": r["steady"]})
    if not parts:
        return []
    count: dict[int, int] = {}
    for q in parts:
        count[q["midi"]] = count.get(q["midi"], 0) + q["frames"]
    main = max(count, key=lambda k: count[k])
    kept: list[dict] = []
    for q in parts:
        if q["midi"] != main and q["frames"] < hold:
            continue
        if kept and kept[-1]["midi"] == q["midi"]:
            kept[-1]["b"], kept[-1]["frames"] = q["b"], kept[-1]["frames"] + q["frames"]
        else:
            kept.append(dict(q))
    total = sum(q["frames"] for q in parts)
    share = sum(q["frames"] for q in kept) / max(1, total)
    for q in kept:
        q["steady"] = min(1.0, q["frames"] / max(1, q["b"] - q["a"])) * q["steady0"]
        q["share"] = share
    kept[0]["a"] = parts[0]["a"]                       # the slide in and the fall after belong to the notes
    kept[-1]["b"] = parts[-1]["b"]
    for i in range(1, len(kept)):
        kept[i - 1]["b"] = kept[i]["a"]
    return kept


def align_frames(y: np.ndarray, onset: np.ndarray | None, lo: int, hi: int, syls: list[dict], p: SaxParams) -> list[int]:
    """Frames where each syllable of a phrase starts (the first is `lo`), plus `hi` at the end.

    `y` is the smoothed, tuning-corrected pitch curve. A stretch costs one for every sung frame away from the
    stretch's main pitch (a semitone-wide band), so the best cut puts every pitch change on a boundary."""
    K, N = len(syls), hi - lo
    guess = [int(round(s["t"] / HOP)) - lo for s in syls]
    fallback = [lo] + [lo + int(max(1, min(N - 1, g))) for g in guess[1:]] + [hi]
    for i in range(1, len(fallback)):
        fallback[i] = max(fallback[i], fallback[i - 1] + 1)
    if K == 1 or N < 2 * K:
        return fallback if N >= 2 * K or K == 1 else [lo + round(i * N / K) for i in range(K)] + [hi]
    seg = y[lo:hi]
    v = ~np.isnan(seg)
    V = np.concatenate([[0], np.cumsum(v)]).astype(np.float32)
    if v.sum() == 0:
        return fallback
    hb = np.floor(2 * seg[v]).astype(int)
    base, B = hb.min(), hb.max() - hb.min() + 2
    P = np.zeros((N + 1, B), np.float32)
    P[np.flatnonzero(v) + 1, hb - base] = 1
    P = np.cumsum(P, axis=0)
    PP = P[:, :-1] + P[:, 1:]
    on = np.zeros(N + 1, np.float32)
    if onset is not None and len(onset):
        o = onset[lo:hi + 1]
        on[:len(o)] = o
        on = np.maximum(on, np.concatenate([on[1:], [0]]))
        on = np.maximum(on, np.concatenate([on[2:], [0, 0]]))
    # how clearly something new starts at each frame: an attack, a change of pitch, or the voice coming in
    yy = np.where(v, seg, 0.0)
    ev = np.zeros(N + 1, np.float32)
    w6 = 6
    for f in range(0, N + 1):
        a0, b0 = max(0, f - w6), min(N, f + w6)
        va, vb = v[a0:f], v[f:b0]
        if va.sum() < 3 or vb.sum() < 3 or not v[max(0, f - 3):min(N, f + 3)].all():
            ev[f] = 1.0
        else:
            ev[f] = min(1.0, abs(float(np.median(yy[f:b0][vb])) - float(np.median(yy[a0:f][va]))) / 0.8)
    ev = np.maximum(ev, np.minimum(1.0, on))
    ev = np.maximum(ev, np.maximum(np.concatenate([ev[1:], [0]]), np.concatenate([[0], ev[:-1]])))
    min_len = max(2, int(round(p.min_syl / HOP)))
    before, after = int(round(p.reach_before / HOP)), int(round(p.reach_after / HOP))

    cands: list[np.ndarray] = [np.asarray([0])]
    for k in range(1, K):
        a = max(guess[k] - before, 0)
        b = min(guess[k] + after, N)
        if b < a:
            a = b = int(max(0, min(N, guess[k])))
        g = p.grid
        a, b = -(-a // g) * g, max(-(-a // g) * g, (b // g) * g)
        cands.append(np.arange(a, min(b, N) + 1, g))
    cands.append(np.asarray([N]))

    cost = np.zeros(1, np.float32)
    back: list[np.ndarray] = []
    for k in range(1, K + 1):
        prev, cur = cands[k - 1], cands[k]
        dom = (PP[cur][None, :, :] - PP[prev][:, None, :]).max(axis=2)
        mis = (V[cur][None, :] - V[prev][:, None]) - dom
        c = mis + p.w_empty * np.clip(1.0 - dom / 6.0, 0.0, 1.0)
        length = cur[None, :] - prev[:, None]
        c[length < min_len] = np.inf
        if True:
            sure = syls[k - 1]["sure"]
            c[length == 0] = p.skip_doubt + (p.skip_sure - p.skip_doubt) * sure
        total = cost[:, None] + c
        arg = total.argmin(axis=0)
        best = total[arg, np.arange(len(cur))]
        if k < K:
            dev = (cur - guess[k]) * HOP
            w = p.w_time_inner if syls[k]["inner"] else p.w_time
            off = np.maximum(0.0, np.where(dev < 0, -p.early * dev, dev) - p.time_slack)
            best = best + w * np.minimum(off, p.time_cap) + p.w_time_far * np.maximum(0.0, off - p.time_cap) \
                - p.w_onset * np.minimum(1.5, on[cur]) + p.w_split * (1.0 - ev[cur])
        back.append(arg)
        cost = best.astype(np.float32)
    if not np.isfinite(cost[0]):
        return fallback
    idx, cut = 0, [hi]
    for k in range(K, 0, -1):
        idx = int(back[k - 1][idx])
        cut.append(lo + int(cands[k - 1][idx]))
    return cut[::-1]


def align_phrase(y: np.ndarray, onset: np.ndarray | None, lo: int, hi: int, syls: list[dict], p: SaxParams,
                 runs: list[dict] | None = None) -> list[int]:
    """Frames where each syllable of a phrase starts (the first is `lo`), plus `hi` at the end.

    The phrase is first heard as a row of held notes (`note_runs`). The best cut gives every syllable its own
    note: a syllable that takes two notes pays for a melisma, one that starts in the middle of a held note
    with no fresh attack pays for splitting it, and a word may go without a note if the lyrics doubt it.
    The lyric timing only has to be roughly right: anywhere in the note that is sounding at that time is as
    good as the exact moment."""
    K, N = len(syls), hi - lo
    guess = [int(round(s["t"] / HOP)) - lo for s in syls]
    fallback = [lo] + [lo + int(max(1, min(N - 1, g))) for g in guess[1:]] + [hi]
    for i in range(1, len(fallback)):
        fallback[i] = max(fallback[i], fallback[i - 1] + 1)
    if K == 1 or N < 4:
        return fallback if K == 1 else [lo + round(i * N / K) for i in range(K)] + [hi]
    if runs is None:
        runs = held_runs(y, None, None, p)
    notes = [(max(0, r["a"] - lo), min(N, r["b"] - lo), r["midi"]) for r in runs if r["b"] > lo and r["a"] < hi]
    if not notes:
        return fallback
    innote = np.zeros(N + 1, bool)
    fresh = np.zeros(N + 1, np.float32)            # 1 where a note starts (or nothing is sounding)
    W = np.zeros(N + 2, np.float32)                # melisma cost of the notes starting before each frame
    nxt = np.full(N + 1, N, np.int32)              # the first frame at or after f that is in a note
    own_a = np.arange(N + 1)                       # the stretch each frame may move in for free: its note
    own_b = np.arange(N + 1)
    prev_end, prev_pc, group = 0, None, 0
    sizes: dict[int, int] = {}
    groups: list[tuple[int, int, int]] = []
    for a, b, pc in notes:                         # stretches on one note, one after the other, are one note
        if pc != prev_pc or a - prev_end > 8:
            group = a
        sizes[group] = sizes.get(group, 0) + (b - a)
        groups.append((a, b, group))
        prev_end, prev_pc = b, pc
    prev_end, prev_pc = 0, None
    for (a, b, pc), (_, _, group) in zip(notes, groups):
        innote[a:b] = True
        fresh[a:min(N + 1, a + 3)] = 1.0
        if pc != prev_pc:
            W[a + 1] += p.w_melisma * min(1.0, sizes[group] / p.melisma_full)
        own_a[a:b] = group
        own_b[group:b] = b
        own_b[prev_end:a] = np.maximum(own_b[prev_end:a], a)   # in a silence: free to wait for the next note
        own_a[prev_end:a] = np.minimum(own_a[prev_end:a], np.arange(prev_end, a))
        prev_end, prev_pc = b, pc
    fresh[~innote] = 1.0
    W = np.cumsum(W)
    NF = np.concatenate([[0], np.cumsum(innote[:N])]).astype(np.float32)
    last = N
    for f in range(N, -1, -1):
        if f < N and innote[f]:
            last = f
        nxt[f] = last
    on = np.zeros(N + 1, np.float32)
    if onset is not None and len(onset):
        o = onset[lo:hi + 1]
        on[:len(o)] = o
        on = np.maximum(on, np.concatenate([on[1:], [0]]))
        on = np.maximum(on, np.concatenate([[0], on[:-1]]))
    split = p.w_split * (1.0 - np.maximum(fresh, np.minimum(1.0, on / p.onset_full)))

    g = p.grid
    spots = np.zeros(N + 1, bool)
    spots[::g] = True
    for a, b, pc in notes:
        spots[a] = True
    spots[N] = False
    before, after = int(round(p.reach_before / HOP)), int(round(p.reach_after / HOP))
    cands: list[np.ndarray] = [np.asarray([0])]
    for k in range(1, K):
        gk = int(max(0, min(N - 1, guess[k])))
        a = max(0, min(gk, own_a[gk]) - before)
        b = min(N - 1, max(gk, own_b[gk]) + after)
        c = np.flatnonzero(spots[a:b + 1]) + a
        cands.append(c if len(c) else np.asarray([gk]))
    cands.append(np.asarray([N]))

    cost = np.zeros(1, np.float32)
    back: list[np.ndarray] = []
    for k in range(1, K + 1):
        prev, cur = cands[k - 1], cands[k]
        length = cur[None, :] - prev[:, None]
        first = nxt[prev]                                           # where the syllable's first note starts
        extra = W[cur][None, :] - W[np.minimum(first + 1, N + 1)][:, None]
        sung = NF[cur][None, :] - NF[prev][:, None]
        c = np.where(sung >= 4, np.maximum(0.0, extra), p.w_empty)
        c[length < 0] = np.inf
        c[length == 0] = p.skip_doubt + (p.skip_sure - p.skip_doubt) * syls[k - 1]["sure"]
        total = cost[:, None] + c
        arg = total.argmin(axis=0)
        best = total[arg, np.arange(len(cur))]
        if k < K:
            gk = int(max(0, min(N - 1, guess[k])))
            fa, fb = min(gk, int(own_a[gk])), max(gk, int(own_b[gk]))
            out = np.maximum(0, np.maximum(fa - cur, cur - fb)) * HOP           # outside the free stretch
            inside = np.abs(cur - gk) * HOP
            w = p.w_time_inner if syls[k]["inner"] else p.w_time
            best = best + w * np.minimum(out, p.time_cap) + p.w_time_far * np.maximum(0.0, out - p.time_cap) \
                + p.w_time_in * np.minimum(inside, 1.0) + split[cur] - p.w_onset * np.minimum(1.5, on[cur])
        back.append(arg)
        cost = best.astype(np.float32)
    if not np.isfinite(cost[0]):
        return fallback
    idx, cut = 0, [hi]
    for k in range(K, 0, -1):
        idx = int(back[k - 1][idx])
        cut.append(lo + int(cands[k - 1][idx]))
    return cut[::-1]


# ------------------------------------------------------------------ notes of one stretch

def span_notes(x: np.ndarray, y: np.ndarray, a: int, b: int, hold: int, step: float, single: bool = True) -> list[dict]:
    """The notes sung in frames [a, b): the main sustained pitch, and any other pitch that is really held.

    `x` is the raw curve, `y` the smoothed tuning-corrected one. Returns [{"a", "b", "pitch", "steady"}] with
    frames and the fractional pitch (raw); the scoop before the first note and the fall after the last one
    belong to those notes."""
    seg = y[a:b]
    v = ~np.isnan(seg)
    if v.sum() < 4:
        return []
    r = np.where(v, np.round(np.where(v, seg, 0)), -999).astype(int)
    # runs of one rounded pitch; a hole of a few frames does not end a run
    runs: list[list[int]] = []                       # [start, end, pitch, frames]
    for i in np.flatnonzero(v):
        if runs and runs[-1][2] == r[i] and i - runs[-1][1] <= 6:
            runs[-1][1] = i + 1
            runs[-1][3] += 1
        else:
            runs.append([int(i), int(i) + 1, int(r[i]), 1])
    count: dict[int, int] = {}
    for s, e, pc, f in runs:
        if f >= 3:
            count[pc] = count.get(pc, 0) + f
    if not count:
        for s, e, pc, f in runs:
            count[pc] = count.get(pc, 0) + f
    main = max(count, key=lambda k: count[k])

    def pitch_of(frames: np.ndarray) -> float:
        vals = x[a:b][frames]
        vals = vals[~np.isnan(vals)]
        return float(np.median(vals)) if len(vals) else float("nan")

    main_frames = np.zeros(b - a, bool)
    for s, e, pc, f in runs:
        if pc == main:
            main_frames[s:e] |= v[s:e]
    main_pitch = pitch_of(main_frames)
    kept: list[dict] = []
    for s, e, pc, f in runs:
        is_main = pc == main
        if not is_main:
            if f < hold:
                continue
            fr = np.zeros(b - a, bool)
            fr[s:e] = v[s:e]
            if abs(pitch_of(fr) - main_pitch) < step:
                continue
        elif f < 3 and count[main] >= 3:
            continue
        if kept and kept[-1]["pc"] == pc:
            kept[-1]["e"] = e
            kept[-1]["f"] += f
        else:
            kept.append({"s": s, "e": e, "pc": pc, "f": f})
    if not kept:
        return []
    if single and len(kept) > 1 and not any(k["pc"] != main for k in kept):
        kept = [dict(kept[0], e=kept[-1]["e"], f=sum(k["f"] for k in kept))]
    total = int(v.sum())
    out = []
    for i, k in enumerate(kept):
        fr = np.zeros(b - a, bool)
        fr[k["s"]:k["e"]] = v[k["s"]:k["e"]] & (r[k["s"]:k["e"]] == k["pc"])
        out.append({"a": a + k["s"], "b": a + k["e"], "pitch": pitch_of(fr), "frames": k["f"],
                    "steady": k["f"] / max(1, (k["e"] - k["s"]))})
    # the scoop into the first note and the fall after the last belong to them (as far as the voice is continuous)
    first, last = out[0], out[-1]
    i = first["a"] - a
    while i > 0 and (v[i - 1] or (i >= 2 and v[max(0, i - 6):i].any())):
        i -= 1
    first["a"] = a + i
    j = last["b"] - a
    while j < b - a and (v[j] or v[j:j + 8].any()):
        j += 1
    last["b"] = a + j
    for i in range(1, len(out)):
        out[i - 1]["b"] = out[i]["a"] = (out[i - 1]["b"] + out[i]["a"] + 1) // 2 if out[i]["a"] > out[i - 1]["b"] else out[i]["a"]
    share = sum(k["frames"] for k in out) / max(1, total)
    for k in out:
        k["share"] = share
    return out


# ------------------------------------------------------------------ the key as a judge

def scale_of(key: dict | tuple | None) -> frozenset[int] | None:
    if not key:
        return None
    tonic, mode = (key["tonic"], key["mode"]) if isinstance(key, dict) else key
    return frozenset((tonic + k) % 12 for k in (MAJOR_SCALE if mode == "major" else MINOR_SCALE))


def _snap_to_key(notes: list[dict], delta: float, scale: frozenset[int] | None, p: SaxParams,
                 usual: np.ndarray | None = None) -> None:
    """Sets note["midi"] from note["pitch"]. A pitch that sits between two notes becomes the one the song uses
    more (`usual`: the share of singing on each pitch class); doubtful out-of-key notes move to the in-key
    neighbour they lean to."""
    prior = None
    if usual is not None and usual.sum() > 0:
        prior = usual / usual.sum()
        if scale is not None:
            prior = prior + np.asarray([0.05 if k in scale else 0.0 for k in range(12)])
        prior = np.log(prior + 0.02)
    for n in notes:
        yv = n["pitch"] - delta
        r = int(round(yv))
        if prior is not None and abs(yv - r) > 0.2:
            other = r + (1 if yv > r else -1)
            if -3 * abs(yv - other) + p.prior * prior[other % 12] > -3 * abs(yv - r) + p.prior * prior[r % 12]:
                r = other
        n["midi"], n["snapped"] = r, False
        n["lean"] = yv - r
    if scale is None:
        return
    # stretches of the song that do not fit the key (a key change) are left alone
    starts = np.asarray([n["start"] for n in notes])
    for i, n in enumerate(notes):
        if n["midi"] % 12 in scale:
            continue
        near = [m for m in notes[np.searchsorted(starts, n["start"] - 12):np.searchsorted(starts, n["start"] + 12)]]
        tot = sum(m["end0"] - m["start"] for m in near) or 1.0
        fit = sum(m["end0"] - m["start"] for m in near if int(round(m["pitch"] - delta)) % 12 in scale) / tot
        if fit < 0.72:
            continue
        dur = n["end0"] - n["start"]
        if dur >= p.chromatic_min and abs(n["lean"]) <= p.chromatic_lean and n["steady"] >= p.chromatic_steady:
            continue
        if abs(n["lean"]) > 0.5:
            continue                                   # already moved to the likelier neighbour
        up = n["lean"] > 0
        if abs(n["lean"]) < 0.08:                      # dead centre: go towards the notes around it
            around = [m["pitch"] - delta for m in notes[max(0, i - 2):i + 3] if m is not n]
            up = bool(around) and float(np.mean(around)) > n["midi"]
        n["midi"] += 1 if up else -1
        n["snapped"] = True


def _octave_sanity(notes: list[dict]) -> None:
    for i, n in enumerate(notes):
        around = [m["midi"] for m in notes[max(0, i - 3):i + 4] if m is not n and abs(m["start"] - n["start"]) < 6.0]
        if len(around) < 2:
            continue
        ref = float(np.median(around))
        for k in (12, -12):
            if abs(n["midi"] - ref) >= 9 and abs(n["midi"] - k - ref) <= 4.5:
                n["midi"] -= k
                n["octave_fixed"] = True
                break


# ------------------------------------------------------------------ the whole song

def sax_notes(midi: np.ndarray, conf: np.ndarray, db: np.ndarray, words: list[dict], *, language: str | None = None,
              beats: list[float] | None = None, onset: np.ndarray | None = None, onset_hop: float | None = None,
              key: dict | tuple | None = None, keep: list[dict] | None = None, p: SaxParams | None = None,
              info: dict | None = None) -> list[dict]:
    """The sax-friendly notes of a song: [{"start", "end", "midi", "confidence", "word", "syl"}], sorted.

    `words` are the timed lyrics ({"id", "text", "start", "end"}); `beats` the beat times; `onset` the attack
    strength of the vocals (onsets.py) every `onset_hop` seconds; `key` the song's key ({"tonic", "mode"}),
    which judges doubtful notes; `keep` are notes fixed by hand, which stay and push fresh notes aside.
    `info` receives what was found on the way (tuning, syllables, how many notes were moved into the key)."""
    p = p or SaxParams()
    info = info if info is not None else {}
    x = clean_curve(midi, conf, db, p)
    xs = smooth_curve(x)
    delta = tuning_offset(x, xs)
    y = xs - delta
    voiced = ~np.isnan(x)
    n_frames = len(x)
    beat = float(np.median(np.diff(beats))) if beats is not None and len(beats) > 3 else 0.5
    while beat > 1.0:               # thresholds are meant for a walking pulse, whatever the tracker counted
        beat /= 2
    while beat < 0.33:
        beat *= 2
    hold = int(round(min(p.melisma_max, max(p.melisma_min, p.melisma_beats * beat)) / HOP))
    rest = min(p.rest_max, max(p.rest_min, p.rest_beats * beat))
    on = None
    if onset is not None and onset_hop:
        on = np.interp(np.arange(n_frames + 1) * HOP, np.arange(len(onset)) * onset_hop, onset).astype(np.float32)

    from .songkey import vocal_histogram
    runs = held_runs(y, scale_of(key), vocal_histogram(x, delta), p)
    starts = np.asarray([r["a"] for r in runs])
    syls = syllable_plan(words, language)
    phrases = _phrases(syls, p.phrase_gap)
    raw: list[dict] = []
    covered = np.zeros(n_frames, bool)
    edges: list[tuple[int, int]] = []
    for i, ph in enumerate(phrases):
        lo = _edge_before(voiced, ph[0]["t"])
        hi = _edge_after(voiced, ph[-1]["end"])
        if i > 0:
            lo = max(lo, edges[-1][1]) if edges[-1][1] <= int(ph[0]["t"] / HOP) + 15 else _border(voiced, phrases[i - 1][-1]["end"], ph[0]["t"])
        if i + 1 < len(phrases):
            nxt = phrases[i + 1][0]["t"]
            if hi > int(round((nxt - 0.1) / HOP)):
                hi = _border(voiced, ph[-1]["end"], nxt)
        lo = max(0, min(lo, n_frames - 1))
        hi = max(lo + 1, min(hi, n_frames))
        if edges and lo < edges[-1][1]:
            lo = edges[-1][1]
            hi = max(hi, lo + 1)
        edges.append((lo, hi))
        cut = align_frames(y, on, lo, hi, ph, p) if p.aligner == "frames" else align_phrase(y, on, lo, hi, ph, p, runs)
        covered[lo:hi] = True
        for k, s in enumerate(ph):
            a, b = cut[k], cut[k + 1]
            if b <= a:
                continue                                   # a word the singer did not sing
            got = runs_to_notes(runs, starts, a, b, hold)
            if not got:                                    # nothing held: whatever pitch there is
                vals = y[a:b][~np.isnan(y[a:b])]
                if len(vals) >= 6:
                    f = np.flatnonzero(~np.isnan(y[a:b]))
                    m = float(np.median(vals))
                    got = [{"a": a + int(f[0]), "b": a + int(f[-1]) + 1, "midi": int(round(m)), "pitch": m,
                            "lean": m - round(m), "snapped": False, "steady": 0.4, "share": 0.5}]
            for j, nt in enumerate(got):
                raw.append({**nt, "word": s["word"], "syl": s["k"], "part": j})
    # singing without words: every continuous stretch of voice outside the phrases
    free_hold = int(round(p.free_hold / HOP))
    stretch: list[list[int]] = []
    for a, b in _runs(voiced & ~covered):
        if stretch and a - stretch[-1][1] <= 8 and not covered[stretch[-1][1]:a].any():
            stretch[-1][1] = b
        else:
            stretch.append([a, b])
    for a, b in stretch:
        if (b - a) * HOP < p.free_min:
            continue
        for j, nt in enumerate(runs_to_notes(runs, starts, a, b, free_hold)):
            if (nt["b"] - nt["a"]) * HOP >= p.free_min:
                raw.append({**nt, "word": None, "syl": 0, "part": j})
    raw.sort(key=lambda n: n["a"])

    notes: list[dict] = []
    for nt in raw:
        notes.append({"start": nt["a"] * HOP, "end0": nt["b"] * HOP, "pitch": nt["pitch"] + delta, "steady": nt["steady"],
                      "share": nt["share"], "word": nt["word"], "syl": nt["syl"], "part": nt["part"],
                      "midi": int(nt["midi"]), "snapped": bool(nt["snapped"]), "lean": float(nt["lean"])})
    for i in range(1, len(notes)):
        if notes[i]["start"] < notes[i - 1]["start"] + 0.02:
            notes[i]["start"] = notes[i - 1]["start"] + 0.02
    for i, n in enumerate(notes):
        n["end0"] = max(n["start"] + 0.03, min(n["end0"], notes[i + 1]["start"]) if i + 1 < len(notes) else n["end0"])

    _octave_sanity(notes)

    # two notes of one syllable that ended up on the same pitch are one note
    merged: list[dict] = []
    for n in notes:
        m = merged[-1] if merged else None
        if m and n["word"] is not None and m["word"] == n["word"] and m["syl"] == n["syl"] and m["midi"] == n["midi"]:
            m["end0"] = n["end0"]
            continue
        merged.append(n)
    notes = merged

    # hand-fixed notes stay; fresh notes that overlap them give way
    keep = keep or []
    if keep:
        notes = [n for n in notes if not any(e["start"] < n["end0"] - 0.02 and e["end"] > n["start"] + 0.02 for e in keep)]

    if beats is not None and len(beats) > 3:
        from .beats import grid
        g = grid(list(beats), 4)
        if len(g) > 4:
            stepg = float(np.median(np.diff(g)))
            lim = min(p.snap_tol, 0.34 * stepg)
            last = -1.0
            for n in notes:
                j = int(np.searchsorted(g, n["start"]))
                c = [g[q] for q in (j - 1, j) if 0 <= q < len(g)]
                t = min(c, key=lambda q: abs(q - n["start"]))
                if abs(t - n["start"]) <= lim and t > last + 0.05 and t < n["end0"] - 0.04:
                    n["start"] = float(t)
                last = n["start"]

    # legato: a note lasts until the next one starts, unless the singer really stops
    out: list[dict] = []
    everything = sorted(notes + [dict(e, end0=e["end"], kept=True) for e in keep], key=lambda n: n["start"])
    for i, n in enumerate(everything):
        if n.get("kept"):
            out.append({k: v for k, v in n.items() if k not in ("end0", "kept")})
            continue
        end = n["end0"]
        if i + 1 < len(everything):
            nxt = everything[i + 1]["start"]
            end = nxt if nxt - end < rest else end
            end = min(end, nxt)
        end = max(end, n["start"] + 0.04)
        dur = end - n["start"]
        c = 0.3 + 0.7 * min(1.0, n["steady"]) * min(1.0, 0.35 + n["share"])
        if n["snapped"]:
            c *= 0.62
        if n.get("octave_fixed"):
            c *= 0.7
        if dur < 0.1:
            c *= 0.75
        if abs(n["lean"]) > 0.38 and not n["snapped"]:
            c *= 0.8
        out.append({"start": round(n["start"], 3), "end": round(end, 3), "midi": int(n["midi"]),
                    "confidence": round(float(max(0.05, min(1.0, c))), 3), "word": n["word"], "syl": n["syl"], "edited": False})
    info.update({"tuning": round(delta, 3), "syllables": len(syls), "phrases": len(phrases),
                 "snapped": sum(1 for n in notes if n["snapped"]), "octave_fixed": sum(1 for n in notes if n.get("octave_fixed")),
                 "wordless": sum(1 for n in out if n.get("word") is None), "hold": hold * HOP, "rest": rest})
    return out


def pitch_histogram(notes: list[dict]) -> list[float]:
    hist = [0.0] * 12
    for n in notes:
        hist[n["midi"] % 12] += max(0.0, n["end"] - n["start"])
    return hist


# ------------------------------------------------------------------ a song folder

def song_key(d, curve: np.ndarray | None = None, tuning: float = 0.0, harmony: dict | None = None, detail: dict | None = None) -> dict | None:
    """The key of the song in folder `d`, from its cached harmony (harmony.npz) and the singer's pitch curve."""
    from . import score, songkey
    h = harmony
    chroma = energy = chords = None
    if h and len(h["beats"]):
        chroma, energy = h["chroma"], h["energy"]
        chords = score.chords_on_beats((h["chroma"], h["bass"], h["energy"]), h["beats"], h["per_bar"], h["phase"])
    vocal = songkey.vocal_histogram(curve, tuning) if curve is not None else None
    return songkey.detect_song_key(chroma, energy, vocal, chords, detail)


def sax_song(d, song: dict, detailed: bool = False, p: SaxParams | None = None, info: dict | None = None) -> dict:
    """For the accuracy scripts: the song with its notes (and key) as the sax-friendly method writes them,
    from what is cached in its folder. Nothing is saved."""
    from pathlib import Path
    from . import score
    d = Path(d)
    if detailed:
        return song
    z = np.load(d / "pitch.npz")
    midi, conf, db = z["midi"], z["conf"], z["db"]
    p = p or SaxParams()
    h = score.song_harmony(d / "backing.mp3", d / "harmony.npz", float(song.get("duration") or 0)) if (d / "harmony.npz").exists() else None
    x = clean_curve(midi, conf, db, p)
    delta = tuning_offset(x, smooth_curve(x))
    key = song_key(d, x, delta, h) or song.get("key")
    onset = hop = None
    env = d / "envelope.json"
    if env.exists():
        import json
        e = json.loads(env.read_text())
        onset, hop = np.asarray(e["onset"], np.float32), float(e["hop"])
    lang = (song.get("language") or {}).get("override") or (song.get("language") or {}).get("detected")
    info = info if info is not None else {}
    notes = sax_notes(midi, conf, db, song.get("words", []), language=lang, beats=h["beats"] if h else None,
                      onset=onset, onset_hop=hop, key=key, p=p, info=info)
    for i, n in enumerate(notes):
        n["id"] = f"n{i}"
    return {**song, "notes": notes, "key": key}
