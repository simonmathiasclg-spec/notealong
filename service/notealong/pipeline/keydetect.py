"""Key detection with the Krumhansl-Schmuckler algorithm on a duration-weighted
pitch-class profile of the cleaned melody."""
from __future__ import annotations

import math

MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
# Conventional spelling of key names (flats where that is the usual key signature)
KEY_NAMES_MAJOR = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
KEY_NAMES_MINOR = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"]


def _corr(a: list[float], b: list[float]) -> float:
    n = len(a)
    ma, mb = sum(a) / n, sum(b) / n
    num = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    den = math.sqrt(sum((x - ma) ** 2 for x in a) * sum((y - mb) ** 2 for y in b))
    return num / den if den else 0.0


def pitch_class_profile(notes: list[dict]) -> list[float]:
    hist = [0.0] * 12
    for n in notes:
        hist[n["midi"] % 12] += max(n["end"] - n["start"], 0.0)
    return hist


def detect_key(notes: list[dict]) -> dict | None:
    hist = pitch_class_profile(notes)
    if sum(hist) <= 0:
        return None
    scores = []
    for tonic in range(12):
        rotated = hist[tonic:] + hist[:tonic]
        scores.append((_corr(rotated, MAJOR), tonic, "major"))
        scores.append((_corr(rotated, MINOR), tonic, "minor"))
    scores.sort(reverse=True)
    best, second = scores[0], scores[1]
    corr, tonic, mode = best
    # confidence: how clearly the best key beats the runner-up (0..1)
    margin = max(0.0, best[0] - second[0])
    confidence = max(0.0, min(1.0, 0.5 * max(corr, 0) + 0.5 * min(1.0, margin * 5)))
    names = KEY_NAMES_MAJOR if mode == "major" else KEY_NAMES_MINOR
    return {"tonic": tonic, "mode": mode, "name": f"{names[tonic]} {mode}", "confidence": round(confidence, 3)}
