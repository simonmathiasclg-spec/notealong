"""The leftover-vocal estimate must separate a clean backing from one with audible voice in it."""
import numpy as np
import soundfile as sf

from notealong.pipeline.stems import leftover_vocal_db


def _voice(sr, secs, seed=1):
    rng = np.random.default_rng(seed)
    t = np.arange(int(sr * secs)) / sr
    # a sung-ish line: a few sustained tones with harmonics and gaps between phrases
    out = np.zeros_like(t)
    for k in range(int(secs / 1.5)):
        f = 220 * 2 ** (rng.integers(0, 12) / 12)
        on = (t >= k * 1.5 + 0.1) & (t < k * 1.5 + 1.2)
        out += on * sum(0.5 ** h * np.sin(2 * np.pi * f * (h + 1) * t) for h in range(6))
    return 0.3 * out


def _band(sr, secs, seed=2):
    rng = np.random.default_rng(seed)
    t = np.arange(int(sr * secs)) / sr
    bass = 0.3 * np.sin(2 * np.pi * 55 * t) * (np.sin(2 * np.pi * 2 * t) > 0)
    chords = sum(0.08 * np.sin(2 * np.pi * f * t) for f in (330, 415, 494, 660))
    noise = 0.05 * rng.standard_normal(len(t)) * (np.sin(2 * np.pi * 4 * t) > 0.9)
    return bass + chords + noise


def test_leak_is_detected(tmp_path):
    sr, secs = 22050, 12
    v, b = _voice(sr, secs), _band(sr, secs)
    sf.write(tmp_path / "v.wav", v, sr)
    sf.write(tmp_path / "clean.wav", b, sr)
    sf.write(tmp_path / "leak.wav", b + 0.3 * v, sr)
    clean = leftover_vocal_db(tmp_path / "v.wav", tmp_path / "clean.wav")
    leak = leftover_vocal_db(tmp_path / "v.wav", tmp_path / "leak.wav")
    assert clean < -30, clean
    assert leak > clean + 10, (clean, leak)
    assert leak > -20, leak      # 30 % of the voice left in is clearly audible
