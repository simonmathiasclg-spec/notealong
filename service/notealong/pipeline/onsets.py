"""Articulation evidence from the vocals stem: where does the singer start a
new sound, and where do they simply keep holding one?

Two curves are measured once per song and cached next to the stems:
  - onset strength (spectral flux): spikes at consonants and fresh attacks
  - level in dB relative to the loud parts: dips at closures (p, t, k, b, d) and breaths

Cleanup uses them to tell a held note that the pitch tracker chopped up
(vibrato, swells, accents) from a note that is really sung again.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np

ENV_SR = 22050
ENV_HOP = 256          # 11.6 ms
ENV_VERSION = 1


def vocal_envelope(vocals_path: Path) -> dict:
    import librosa
    from .audio import load_mono
    y, sr = load_mono(vocals_path, sr=ENV_SR)
    onset = librosa.onset.onset_strength(y=y, sr=sr, hop_length=ENV_HOP, aggregate=np.median, fmax=8000, n_mels=96)
    rms = librosa.feature.rms(y=y, frame_length=1024, hop_length=ENV_HOP)[0]
    db = 20 * np.log10(rms + 1e-9)
    ref = float(np.percentile(db, 95))
    level = db - ref
    n = min(len(onset), len(level))
    onset, level = onset[:n], level[:n]
    # Scale so that 1.0 is a typical strong onset of this singer in this mix:
    # the 98th percentile of the curve where the voice is actually present.
    voiced = level > -30
    scale = float(np.percentile(onset[voiced], 98)) if voiced.sum() > 50 else float(onset.max() or 1.0)
    onset = onset / (scale or 1.0)
    return {"version": ENV_VERSION, "hop": ENV_HOP / ENV_SR,
            "onset": [round(float(v), 3) for v in onset],
            "level": [round(float(v), 1) for v in level]}


class Articulation:
    """Answers questions about one junction between two notes."""

    def __init__(self, env: dict):
        self.hop = float(env["hop"])
        self.onset = np.asarray(env["onset"], dtype=np.float32)
        self.level = np.asarray(env["level"], dtype=np.float32)

    def _idx(self, t: float) -> int:
        return int(max(0, min(len(self.onset) - 1, round(t / self.hop))))

    def onset_at(self, t: float, window: float = 0.05) -> float:
        """Strongest onset within `window` seconds either side of t."""
        a, b = self._idx(t - window), self._idx(t + window)
        return float(self.onset[a:b + 1].max()) if b >= a else 0.0

    def dip_at(self, t0: float, t1: float, context: float = 0.12) -> float:
        """How far the level drops around the junction [t0, t1], in dB below
        the quieter of the two sides (0 = no dip)."""
        a, b = self._idx(t0 - 0.03), self._idx(t1 + 0.03)
        if b < a:
            return 0.0
        low = float(self.level[a:b + 1].min())
        la, lb = self._idx(t0 - 0.03 - context), self._idx(t1 + 0.03 + context)
        before = self.level[la:a] if a > la else self.level[a:a + 1]
        after = self.level[b + 1:lb + 1] if lb > b else self.level[b:b + 1]
        side = min(float(np.median(before)) if len(before) else low, float(np.median(after)) if len(after) else low)
        return max(0.0, side - low)

    def rearticulated(self, prev_end: float, next_start: float, onset_min: float, dip_min: float) -> bool:
        return self.onset_at(next_start) >= onset_min or self.dip_at(prev_end, next_start) >= dip_min
