"""The beat grid of a song, and gently pulling note starts onto it.

Beats and downbeats come from Beat This! (CPJKU, MIT licence, weights included) run on the backing track.
A note start is moved to the nearest beat subdivision only when it is already close (a few tens of
milliseconds), so the rhythm reads cleanly while a singer who is clearly ahead of or behind the beat keeps
their phrasing.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np

_MODEL = {}


def detect_beats(path: Path) -> dict:
    """{"beats": [s...], "downbeats": [s...]} from an audio file."""
    from beat_this.inference import File2Beats
    from .stems import _pick_device
    dev = _pick_device()
    if dev == "mps":
        dev = "cpu"            # small model; the CPU avoids MPS operator gaps
    if dev not in _MODEL:
        _MODEL[dev] = File2Beats(checkpoint_path="final0", device=dev, dbn=False)
    beats, downbeats = _MODEL[dev](str(path))
    return {"beats": [round(float(b), 4) for b in beats], "downbeats": [round(float(b), 4) for b in downbeats]}


def grid(beats: list[float], subdivisions: int = 4) -> np.ndarray:
    """Every subdivision point between consecutive beats (sixteenths for 4 in 4/4)."""
    b = np.asarray(beats, dtype=float)
    if len(b) < 2:
        return b
    pts = [b[i] + (b[i + 1] - b[i]) * k / subdivisions for i in range(len(b) - 1) for k in range(subdivisions)]
    pts.append(b[-1])
    return np.asarray(pts)


def snap_notes(notes: list[dict], beats: list[float], subdivisions: int = 4, tol: float = 0.04, tol_frac: float = 0.3,
               ends: bool = False, report: dict | None = None) -> list[dict]:
    """Moves note starts (and optionally ends) onto the grid when within min(tol, tol_frac of a subdivision)."""
    g = grid(beats, subdivisions)
    rep = report if report is not None else {}
    rep["snapped"] = 0
    if len(g) < 4:
        return notes
    step = float(np.median(np.diff(g)))
    limit = min(tol, tol_frac * step)
    notes = sorted(notes, key=lambda n: n["start"])
    for k, nt in enumerate(notes):
        if nt.get("edited"):
            continue
        i = int(np.searchsorted(g, nt["start"]))
        cands = [g[j] for j in (i - 1, i) if 0 <= j < len(g)]
        if not cands:
            continue
        t = min(cands, key=lambda x: abs(x - nt["start"]))
        if 0 < abs(t - nt["start"]) <= limit and t < nt["end"] - 0.05:
            prev = notes[k - 1] if k > 0 else None
            if prev is None or t > prev["start"] + 0.05:
                if prev is not None and prev["end"] > t:
                    prev["end"] = round(float(t), 3)
                elif prev is not None and 0 < t - prev["end"] < 0.03:
                    prev["end"] = round(float(t), 3)
                nt["start"] = round(float(t), 3)
                rep["snapped"] += 1
        if ends:
            j = int(np.searchsorted(g, nt["end"]))
            ce = [g[x] for x in (j - 1, j) if 0 <= x < len(g)]
            if ce:
                te = min(ce, key=lambda x: abs(x - nt["end"]))
                nxt = notes[k + 1]["start"] if k + 1 < len(notes) else None
                if 0 < abs(te - nt["end"]) <= limit and te > nt["start"] + 0.05 and (nxt is None or te <= nxt):
                    nt["end"] = round(float(te), 3)
    return notes
