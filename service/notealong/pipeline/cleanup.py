"""Step 3: turn raw (polyphonic, noisy) Basic Pitch notes into one clean,
playable melody line.

Input notes: dicts with start, end, midi (concert), amp (0..1).
Output notes: dicts with id, start, end, midi, confidence.

The pipeline is:
  1. drop notes outside the vocal range, below the confidence floor, or in
     near-silent parts of the vocals stem (instrument bleed)
  2. drop notes much quieter than their surroundings (ghost notes, harmonies)
  3. reduce to one note at a time with a frame-wise "lead voice" tracker
  4. join same-pitch notes separated by tiny gaps
  5. absorb or drop very short notes (slides, ornaments, runs)
"""
from __future__ import annotations

from statistics import median

from ..config import DETAIL_LEVELS, DEFAULT_DETAIL_LEVEL, TEMPO_REFERENCE_BPM, TEMPO_SCALED, TEMPO_SCALE_FLOOR, CleanupParams

FRAME = 0.01  # seconds


def params_for(detail_level: str | None, overrides: dict | None = None) -> CleanupParams:
    base = DETAIL_LEVELS.get(detail_level or DEFAULT_DETAIL_LEVEL, DETAIL_LEVELS[DEFAULT_DETAIL_LEVEL])
    if overrides:
        allowed = {k: v for k, v in overrides.items() if k in base.to_dict()}
        base = CleanupParams(**{**base.to_dict(), **allowed})
    return base


def tempo_scaled(p: CleanupParams, tempo_bpm: float | None) -> CleanupParams:
    """Thresholds that follow the tempo.

    The time thresholds were chosen for a song at about 100 beats per minute, where a sixteenth note
    lasts 0.15 s. In a fast song real notes are shorter than that, and a fixed minimum length throws
    them away or glues them to their neighbours. So for songs faster than the reference tempo the
    time thresholds shrink in proportion (never below 60 % of their normal value: detected tempos
    are sometimes double the felt tempo). Slow songs keep the normal values.
    """
    if not tempo_bpm or tempo_bpm <= 0:
        return p
    k = max(TEMPO_SCALE_FLOOR, min(1.0, TEMPO_REFERENCE_BPM / float(tempo_bpm)))
    if k >= 0.999:
        return p
    d = p.to_dict()
    for key in TEMPO_SCALED:
        d[key] = round(d[key] * k, 4)
    return CleanupParams(**d)


def _dur(n: dict) -> float:
    return n["end"] - n["start"]


def filter_basic(notes: list[dict], p: CleanupParams) -> list[dict]:
    return [n for n in notes
            if p.pitch_min <= n["midi"] <= p.pitch_max
            and n.get("amp", 1.0) >= p.min_confidence
            and n.get("level_db", 0.0) >= p.min_level_db
            and _dur(n) > 0]


def filter_relative_amplitude(notes: list[dict], p: CleanupParams, window: float = 2.0) -> list[dict]:
    if not notes:
        return notes
    notes = sorted(notes, key=lambda n: n["start"])
    starts = [n["start"] for n in notes]
    out = []
    j0 = 0
    for i, n in enumerate(notes):
        while starts[j0] < n["start"] - window:
            j0 += 1
        j1 = i
        while j1 + 1 < len(notes) and starts[j1 + 1] <= n["start"] + window:
            j1 += 1
        local = [m["amp"] for m in notes[j0:j1 + 1]]
        if n["amp"] >= p.min_relative_amp * median(local):
            out.append(n)
    return out


def reduce_monophonic(notes: list[dict], p: CleanupParams) -> list[dict]:
    """Frame-by-frame choose the most likely lead note among overlapping ones."""
    if not notes:
        return []
    notes = sorted(notes, key=lambda n: n["start"])
    t_end = max(n["end"] for n in notes)
    n_frames = int(t_end / FRAME) + 1
    chosen: list[int] = [-1] * n_frames  # index into notes
    active: list[int] = []
    nxt = 0
    current = -1
    prev_midi: float | None = None
    for f in range(n_frames):
        t = f * FRAME
        while nxt < len(notes) and notes[nxt]["start"] <= t:
            active.append(nxt)
            nxt += 1
        active = [i for i in active if notes[i]["end"] > t]
        if not active:
            current = -1
            continue
        best, best_score = -1, -1e9
        active_midis = {notes[i]["midi"]: notes[i]["amp"] for i in active}
        for i in active:
            n = notes[i]
            s = n["amp"]
            if i == current:
                s += p.continuity_bonus
            if prev_midi is not None:
                s -= p.leap_penalty * abs(n["midi"] - prev_midi)
            # an octave-harmonic of a sounding note is probably not the melody
            for interval in (12, 19, 24):
                low = n["midi"] - interval
                if low in active_midis and active_midis[low] >= n["amp"] * (1 - p.octave_bias):
                    s -= p.octave_bias
                    break
            if s > best_score:
                best, best_score = i, s
        chosen[f] = best
        current = best
        prev_midi = notes[best]["midi"]

    # Convert frame choices into note segments.
    out: list[dict] = []
    f = 0
    while f < n_frames:
        i = chosen[f]
        if i < 0:
            f += 1
            continue
        g = f
        while g + 1 < n_frames and chosen[g + 1] == i:
            g += 1
        src = notes[i]
        start = max(src["start"], f * FRAME)
        end = min(src["end"], (g + 1) * FRAME)
        if end > start:
            out.append({"start": start, "end": end, "midi": src["midi"], "amp": src["amp"]})
        f = g + 1
    return out


def merge_same_pitch(notes: list[dict], gap: float, min_len: float = 0.0) -> list[dict]:
    """Join same-pitch notes separated by a tiny gap when at least one of them
    is a fragment (shorter than min_len). Two full-length notes of the same
    pitch are kept apart: that is a singer repeating the note on a new syllable."""
    out: list[dict] = []
    for n in sorted(notes, key=lambda n: n["start"]):
        if (out and out[-1]["midi"] == n["midi"] and n["start"] - out[-1]["end"] <= gap
                and (_dur(out[-1]) < min_len or _dur(n) < min_len or n["start"] < out[-1]["end"])):
            out[-1]["end"] = max(out[-1]["end"], n["end"])
            out[-1]["amp"] = max(out[-1]["amp"], n["amp"])
        else:
            out.append(dict(n))
    return out


def absorb_short_notes(notes: list[dict], p: CleanupParams) -> list[dict]:
    """Short notes are absorbed into a neighbour of similar pitch (slides,
    grace notes, runs) or dropped if isolated. Repeats until stable."""
    notes = [dict(n) for n in sorted(notes, key=lambda n: n["start"])]
    absorb_gap = max(p.merge_gap * 1.5, 0.1)
    changed = True
    while changed:
        changed = False
        for i, n in enumerate(notes):
            if _dur(n) >= p.min_note_len:
                continue
            cands = []
            if i > 0:
                prev = notes[i - 1]
                if n["start"] - prev["end"] <= absorb_gap and abs(prev["midi"] - n["midi"]) <= p.neighbour_semitones:
                    cands.append((abs(prev["midi"] - n["midi"]), 1, i - 1))  # 1 = earlier (tie loses)
            if i + 1 < len(notes):
                nx = notes[i + 1]
                if nx["start"] - n["end"] <= absorb_gap and abs(nx["midi"] - n["midi"]) <= p.neighbour_semitones:
                    cands.append((abs(nx["midi"] - n["midi"]), 0, i + 1))  # following note wins ties
            if cands:
                cands.sort()
                j = cands[0][2]
                target = notes[j]
                target["start"] = min(target["start"], n["start"])
                target["end"] = max(target["end"], n["end"])
                target["amp"] = max(target["amp"], n["amp"])
            del notes[i]
            changed = True
            break
    return notes


def clean_notes(raw_notes: list[dict], detail_level: str | None = None,
                overrides: dict | None = None, tempo: float | None = None) -> tuple[list[dict], CleanupParams]:
    p = tempo_scaled(params_for(detail_level, overrides), tempo)
    notes = filter_basic(raw_notes, p)
    notes = filter_relative_amplitude(notes, p)
    notes = reduce_monophonic(notes, p)
    notes = merge_same_pitch(notes, p.merge_gap, p.min_note_len)
    notes = absorb_short_notes(notes, p)
    notes = merge_same_pitch(notes, p.merge_gap, p.min_note_len)
    notes = [n for n in notes if _dur(n) >= p.min_note_len * 0.999]
    out = []
    for i, n in enumerate(notes):
        out.append({"id": f"n{i + 1}", "start": round(n["start"], 3), "end": round(n["end"], 3),
                    "midi": int(n["midi"]), "confidence": round(float(min(1.0, n["amp"])), 3)})
    return out, p
