"""Second opinion on detected notes: compares every note with a pYIN pitch
track of the vocals stem and fixes the clear mistakes, the way a careful human
would in edit mode. Each change is marked `edited: True` in the song data."""
from __future__ import annotations

from pathlib import Path

import numpy as np


def pyin_track(vocals: Path, sr: int = 22050, hop: int = 256) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    import librosa
    y, _ = librosa.load(str(vocals), sr=sr, mono=True)
    f0, voiced, prob = librosa.pyin(y, fmin=librosa.note_to_hz("C2"), fmax=librosa.note_to_hz("C6"), sr=sr, hop_length=hop, frame_length=2048)
    times = librosa.frames_to_time(np.arange(len(f0)), sr=sr, hop_length=hop)
    midi = np.where(np.isnan(f0), np.nan, 69 + 12 * np.log2(np.where(np.isnan(f0), 1, f0) / 440.0))
    return times, midi, prob


def review_notes(notes: list[dict], vocals: Path, min_voiced: float = 0.4) -> tuple[list[dict], dict]:
    """Returns (notes, report). Rules:
    - a note where pYIN hears no voice for most of its length is dropped (bleed / breath)
    - a note whose pitch disagrees with the pYIN median by an octave is moved an octave
    - a note that disagrees by 1 or more semitones (but not an octave) takes the pYIN pitch
      when the tracker is confident, otherwise it is kept as is
    """
    times, track, prob = pyin_track(vocals)
    out: list[dict] = []
    report = {"checked": len(notes), "dropped": 0, "octave_fixed": 0, "pitch_fixed": 0, "kept": 0}
    for n in sorted(notes, key=lambda n: n["start"]):
        s, e = n["start"], n["end"]
        sel = (times >= s) & (times < e)
        if sel.sum() == 0:
            out.append(n)
            report["kept"] += 1
            continue
        seg = track[sel]
        voiced = ~np.isnan(seg)
        frac = float(voiced.mean())
        if frac < min_voiced and (e - s) < 0.6:
            report["dropped"] += 1
            continue
        if voiced.sum() == 0:
            out.append(n)
            report["kept"] += 1
            continue
        med = float(np.median(seg[voiced]))
        conf = float(np.median(prob[sel][voiced])) if voiced.any() else 0.0
        diff = med - n["midi"]
        m = dict(n)
        if abs(abs(diff) - 12) <= 0.6:
            m["midi"] = int(n["midi"] + (12 if diff > 0 else -12))
            m["edited"] = True
            report["octave_fixed"] += 1
        elif abs(diff) >= 0.75 and conf >= 0.5 and frac >= 0.6:
            m["midi"] = int(round(med))
            m["edited"] = True
            report["pitch_fixed"] += 1
        else:
            report["kept"] += 1
        out.append(m)
    return out, report


def drop_outliers(notes: list[dict], max_from_median: int = 14, neighbour_gap: int = 9, max_len: float = 0.4) -> tuple[list[dict], int]:
    """Removes isolated far-away notes (a shriek of instrument bleed or a
    harmonic): more than `max_from_median` semitones from the song's median
    pitch, short, and far from both neighbouring notes."""
    if len(notes) < 8:
        return notes, 0
    seq = sorted(notes, key=lambda n: n["start"])
    med = sorted(n["midi"] for n in seq)[len(seq) // 2]
    keep: list[dict] = []
    dropped = 0
    for i, n in enumerate(seq):
        far = abs(n["midi"] - med) > max_from_median
        prev_m = seq[i - 1]["midi"] if i > 0 else None
        next_m = seq[i + 1]["midi"] if i + 1 < len(seq) else None
        lonely = all(m is None or abs(n["midi"] - m) > neighbour_gap for m in (prev_m, next_m))
        if far and lonely and (n["end"] - n["start"]) <= max_len:
            dropped += 1
            continue
        keep.append(n)
    return keep, dropped
