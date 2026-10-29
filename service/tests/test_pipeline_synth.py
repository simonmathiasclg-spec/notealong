"""End-to-end check on a synthesized melody with a known note list:
synth audio -> Basic Pitch -> cleanup must recover the sequence."""
import math
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from notealong.pipeline.attach import attach_notes
from notealong.pipeline.cleanup import clean_notes
from notealong.pipeline.keydetect import detect_key

MELODY = [  # (midi, seconds) — "Twinkle twinkle" in C, concert pitch
    (60, 0.45), (60, 0.45), (67, 0.45), (67, 0.45), (69, 0.45), (69, 0.45), (67, 0.9),
    (65, 0.45), (65, 0.45), (64, 0.45), (64, 0.45), (62, 0.45), (62, 0.45), (60, 0.9),
]


def synth(path: Path, sr: int = 22050) -> None:
    out = []
    for midi, dur in MELODY:
        f = 440 * 2 ** ((midi - 69) / 12)
        t = np.arange(int(sr * dur)) / sr
        # a vocal-ish tone: fundamental plus a few harmonics with vibrato and an envelope
        vib = 1 + 0.004 * np.sin(2 * np.pi * 5.5 * t)
        tone = sum((0.6 ** k) * np.sin(2 * np.pi * f * (k + 1) * np.cumsum(vib) / sr) for k in range(5))
        env = np.minimum(1, t / 0.03) * np.minimum(1, (dur - t) / 0.06)
        out.append(0.3 * tone * env)
        out.append(np.zeros(int(sr * 0.05)))
    sf.write(str(path), np.concatenate(out).astype(np.float32), sr)


@pytest.mark.slow
def test_synth_melody_recovered(tmp_path):
    pytest.importorskip("basic_pitch")
    from notealong.pipeline.melody import detect_notes

    wav = tmp_path / "melody.wav"
    synth(wav)
    raw = detect_notes(wav)
    notes, _ = clean_notes(raw, "balanced")
    # one syllable per note, with the known timings, as the lyrics step would produce
    words, t = [], 0.0
    for i, (midi, dur) in enumerate(MELODY):
        words.append({"id": f"w{i}", "text": "la", "start": t, "end": t + dur, "line": 0})
        t += dur + 0.05
    attach_notes(notes, words, [{"index": 0, "kind": "lyric", "start": 0, "end": t}])
    got = [n["midi"] for n in notes]
    expected = [m for m, _ in MELODY]
    assert got == expected, f"got {got}"
    assert [n["word"] for n in notes] == [w["id"] for w in words]
    key = detect_key(notes)
    assert key["name"] == "C major"
    # timing within 60 ms of the synthesized onsets
    t = 0.0
    for (midi, dur), n in zip(MELODY, notes):
        assert abs(n["start"] - t) < 0.06, (t, n)
        t += dur + 0.05
