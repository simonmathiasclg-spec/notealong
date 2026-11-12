"""How well the instrumental-hook finder works, measured with a tune whose notes are known.

A sax-like tone playing a made-up melody is mixed into a stretch of a real backing track at several levels.
The hook finder (notealong/pipeline/hooks.py) then has to find it again, and the play-along render has to
turn it down without hurting the band.

    python scripts/accuracy/hooks_eval.py <song-id> <start-s> <end-s> [lead dB re. the band ...]
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from notealong import library                      # noqa: E402
from notealong.pipeline import hooks               # noqa: E402

SR = hooks.SR
HOP = 0.01


def synth(notes, n, sr=SR):
    y = np.zeros(n, np.float32)
    for a, b, m in notes:
        i, j = int(a * sr), int(b * sr)
        t = np.arange(j - i) / sr
        f = 440 * 2 ** ((m - 69) / 12) * (1 + 0.004 * np.sin(2 * np.pi * 5.5 * t) * np.minimum(1, t / 0.4))
        ph = 2 * np.pi * np.cumsum(f) / sr
        s = sum(w * np.sin(k * ph) for k, w in enumerate((1, .6, .45, .3, .2, .12, .08), 1))
        y[i:j] += (s * np.minimum(1, t / 0.03) * np.minimum(1, (t[-1] - t) / 0.05 + 1e-3)).astype(np.float32)
    return y


def melody(seconds: float, seed: int = 1):
    rng = np.random.default_rng(seed)
    scale = [60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79]
    notes, t, k = [], 0.5, 5
    while t < seconds - 1.5:
        d = float(rng.choice([0.25, 0.4, 0.6, 0.9, 1.4]))
        k = int(np.clip(k + rng.integers(-3, 4), 0, len(scale) - 1))
        notes.append((t, t + d, scale[k]))
        t += d + (0.0 if rng.random() < .75 else 0.35)
    return notes


def db(x):
    return 20 * np.log10(np.sqrt(np.mean(np.square(x))) + 1e-9)


def main():
    import librosa
    import soundfile as sf
    song, t0, t1 = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
    levels = [float(v) for v in sys.argv[4:]] or [0.0, -6.0, -10.0]
    band, _ = librosa.load(str(library.song_dir(song) / "backing.mp3"), sr=SR, offset=t0, duration=t1 - t0)
    truth = melody(t1 - t0)
    lead = synth(truth, len(band))
    n = int((t1 - t0) / HOP)
    want = np.full(n, np.nan)
    for a, b, m in truth:
        want[int(a / HOP):int(b / HOP)] = m
    section = [{"start": 0.0, "end": t1 - t0, "label": "Solo"}]
    for level in levels:
        g = 10 ** ((db(band) + level - db(lead[lead != 0])) / 20)
        fd, tmp = tempfile.mkstemp(suffix=".wav")
        os.close(fd)
        sf.write(tmp, band + g * lead, SR)
        midi, strength = hooks.lead_curve(Path(tmp), section, t1 - t0)
        os.unlink(tmp)
        got = midi[:n]
        on = ~np.isnan(want)
        frames = float(np.mean(np.abs(got[on] - want[on]) < 0.5))
        notes = hooks.hook_notes(midi, strength, section)
        # a note is right when it has the pitch of the true note sounding at its middle
        right = sum(1 for x in notes if abs(want[min(n - 1, int((x["start"] + x["end"]) / 2 / HOP))] - x["midi"]) < 0.5)
        # a true note is found when some note of that pitch covers its middle
        found = sum(1 for a, b, m in truth if any(x["midi"] == m and x["start"] - 0.1 <= (a + b) / 2 <= x["end"] + 0.1 for x in notes))
        # play-along: the same gains applied to the lead alone and to the band alone
        both = np.stack([g * lead, band])
        cut = hooks.reduce_lead(both, SR, midi)
        print(f"lead {level:+.0f} dB: frames right {frames:.0%}, notes {len(notes)} for {len(truth)} played, "
              f"notes right {right / max(1, len(notes)):.0%}, played notes found {found / len(truth):.0%}, "
              f"play-along: lead {db(cut[0]) - db(both[0]):+.1f} dB, band {db(cut[1]) - db(both[1]):+.1f} dB")


if __name__ == "__main__":
    main()
