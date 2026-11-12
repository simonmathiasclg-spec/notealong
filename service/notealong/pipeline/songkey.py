"""The key of a whole song.

The old detection (keydetect.py) looked only at the transcribed melody, so a handful of wrong or sliding
notes could tip it into a neighbouring key (Let It Be came out as E minor instead of C major). Here the key
is judged on everything heard over the whole song, weighted by how long it lasts:

  * what the band plays: the chroma of the backing track in every beat (score.song_harmony);
  * what the singer sings: the pitch curve of the vocals, frame by frame, so no note decisions are involved;
  * the chords: a key's own six chords should cover the song, and the song should sit on its home chord.

The first two pick the scale (which seven notes). The chords then choose between the major key and its
relative minor, which share a scale: the one whose home chord is played most, opens the sections and ends
the song.
"""
from __future__ import annotations

import numpy as np

from .keydetect import KEY_NAMES_MAJOR, KEY_NAMES_MINOR, MAJOR, MINOR

_MAJ = np.asarray(MAJOR) - np.mean(MAJOR)
_MIN = np.asarray(MINOR) - np.mean(MINOR)
_SCALE = np.asarray([1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1], float)


def _corr(hist: np.ndarray, profile: np.ndarray) -> float:
    h = hist - hist.mean()
    den = np.linalg.norm(h) * np.linalg.norm(profile)
    return float(h @ profile / den) if den else 0.0


def _profile_scores(hist: np.ndarray) -> np.ndarray:
    """Correlation of a pitch-class histogram with every key: [12 major, 12 minor]."""
    out = np.zeros(24)
    if hist.sum() <= 0:
        return out
    for t in range(12):
        r = np.roll(hist, -t)
        out[t] = _corr(r, _MAJ)
        out[12 + t] = _corr(r, _MIN)
    return out


def _scale_fit(hist: np.ndarray) -> np.ndarray:
    """Share of the histogram inside each major scale (index = the major tonic)."""
    tot = hist.sum()
    if tot <= 0:
        return np.zeros(12)
    return np.asarray([float(np.roll(hist, -t) @ _SCALE) / tot for t in range(12)])


def vocal_histogram(midi_curve: np.ndarray, tuning: float = 0.0) -> np.ndarray:
    """Seconds sung on each pitch class, from the cleaned pitch curve (NaN where nobody sings)."""
    y = midi_curve[~np.isnan(midi_curve)] - tuning
    if not len(y):
        return np.zeros(12)
    near = np.abs(y - np.round(y)) < 0.35             # slides between notes say nothing about the key
    return np.bincount((np.round(y[near]).astype(int)) % 12, minlength=12).astype(float)


def detect_song_key(chroma: np.ndarray | None, energy: np.ndarray | None, vocal: np.ndarray | None,
                    chords: list[dict] | None = None, detail: dict | None = None) -> dict | None:
    """The key as {"tonic", "mode", "name", "confidence"}.

    `chroma` is (12, beats) from the backing track, `energy` its loudness per beat, `vocal` the singer's
    pitch-class histogram, `chords` the chords found without assuming a key ({"start","end","root","quality"})."""
    band = np.zeros(12)
    if chroma is not None and chroma.size:
        c = chroma / (chroma.sum(axis=0, keepdims=True) + 1e-9)
        w = np.ones(c.shape[1])
        if energy is not None and len(energy) == c.shape[1]:
            w = (energy > 0.05 * np.percentile(energy, 90)).astype(float)
        band = (c * w).sum(axis=1)
    voice = np.asarray(vocal, float) if vocal is not None else np.zeros(12)
    if band.sum() <= 0 and voice.sum() <= 0:
        return None
    # 1. the scale: which seven notes the song is made of
    fit = np.zeros(12)
    if band.sum() > 0:
        b = band / band.sum()
        ps = _profile_scores(b)
        fit += 0.5 * np.maximum(ps[:12], np.roll(ps[12:], -9)) + 1.0 * (_scale_fit(b) - 7 / 12)
    if voice.sum() > 0:
        v = voice / voice.sum()
        ps = _profile_scores(v)
        fit += 0.5 * np.maximum(ps[:12], np.roll(ps[12:], -9)) + 1.6 * (_scale_fit(v) - 7 / 12)
    chord_time = np.zeros(24)                           # seconds on every major [0..11] and minor [12..23] chord
    first = last = None
    if chords:
        named = [c for c in chords if c.get("root") is not None]
        for c in named:
            chord_time[c["root"] + (12 if c["quality"].startswith("m") else 0)] += c["end"] - c["start"]
        if named:
            first, last = named[0], named[-1]
        tot = chord_time.sum()
        if tot > 0:
            for t in range(12):
                own = sum(chord_time[(t + k) % 12] for k in (0, 5, 7)) + sum(chord_time[12 + (t + k) % 12] for k in (2, 4, 9))
                fit[t] += 1.4 * (own / tot - 0.5)
    order = np.argsort(fit)[::-1]
    home = int(order[0])
    margin = float(fit[order[0]] - fit[order[1]])
    # 2. major, or the relative minor on the same notes
    rel = (home + 9) % 12
    major = minor = 0.0
    tot = chord_time.sum()
    if tot > 0:
        major += 2.0 * chord_time[home] / tot
        minor += 2.0 * (chord_time[12 + rel] + 0.6 * chord_time[(rel + 7) % 12]) / tot   # the major dominant only exists in minor
        for c, w in ((first, 0.12), (last, 0.2)):
            if c is None:
                continue
            if c["root"] == home and not c["quality"].startswith("m"):
                major += w
            if c["root"] == rel and c["quality"].startswith("m"):
                minor += w
    if band.sum() > 0:
        ps = _profile_scores(band / band.sum())
        major += 0.5 * ps[home]
        minor += 0.5 * ps[12 + rel]
    if voice.sum() > 0:
        ps = _profile_scores(voice / voice.sum())
        major += 0.35 * ps[home]
        minor += 0.35 * ps[12 + rel]
    mode = "major" if major >= minor else "minor"
    tonic = home if mode == "major" else rel
    conf = max(0.0, min(1.0, 0.35 + 2.5 * margin)) * (0.75 + 0.25 * min(1.0, abs(major - minor) * 4))
    if detail is not None:
        detail.update({"fit": [round(float(x), 3) for x in fit], "major": round(major, 3), "minor": round(minor, 3), "margin": round(margin, 3)})
    names = KEY_NAMES_MAJOR if mode == "major" else KEY_NAMES_MINOR
    return {"tonic": int(tonic), "mode": mode, "name": f"{names[tonic]} {mode}", "confidence": round(float(conf), 3)}
