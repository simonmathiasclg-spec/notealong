"""Step 2: detect melody notes from the vocals stem with Spotify's Basic Pitch.

Returns *raw* notes (permissive thresholds) in concert pitch. Cleanup is a
separate step so it can be re-run with different settings.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np

from ..config import (BASIC_PITCH_FRAME_THRESHOLD, BASIC_PITCH_MIN_NOTE_MS,
                      BASIC_PITCH_ONSET_THRESHOLD, VOCAL_MAX_HZ, VOCAL_MIN_HZ)


def detect_notes(vocals_path: Path) -> list[dict]:
    from basic_pitch import ICASSP_2022_MODEL_PATH
    from basic_pitch.inference import predict

    _, _, note_events = predict(
        str(vocals_path),
        ICASSP_2022_MODEL_PATH,
        onset_threshold=BASIC_PITCH_ONSET_THRESHOLD,
        frame_threshold=BASIC_PITCH_FRAME_THRESHOLD,
        minimum_note_length=BASIC_PITCH_MIN_NOTE_MS,
        minimum_frequency=VOCAL_MIN_HZ,
        maximum_frequency=VOCAL_MAX_HZ,
        melodia_trick=True,
    )
    notes = []
    for ev in note_events:
        start, end, midi, amp = ev[0], ev[1], int(ev[2]), float(ev[3])
        notes.append({"start": round(float(start), 4), "end": round(float(end), 4),
                      "midi": midi, "amp": round(amp, 4)})
    notes.sort(key=lambda n: (n["start"], -n["amp"]))
    add_levels(notes, vocals_path)
    return notes


def add_levels(notes: list[dict], audio_path: Path, hop: int = 512, sr: int = 22050) -> None:
    """Adds `level_db`: how loud the vocals stem is during the note, relative to
    its loud parts (95th percentile frame level). Basic Pitch is insensitive to
    level, so without this, instrument bleed in near-silent parts of the stem
    shows up as confident notes."""
    from .audio import load_mono
    y, sr = load_mono(audio_path, sr=sr)
    n_frames = max(1, len(y) // hop)
    frames = y[: n_frames * hop].reshape(n_frames, hop)
    rms = np.sqrt((frames ** 2).mean(axis=1) + 1e-12)
    db = 20 * np.log10(rms + 1e-9)
    ref = float(np.percentile(db, 95))
    for n in notes:
        a = int(n["start"] * sr / hop)
        b = max(int(n["end"] * sr / hop), a + 1)
        seg = db[a:b] if a < len(db) else db[-1:]
        n["level_db"] = round(float(np.percentile(seg, 75)) - ref, 1)


def estimate_tempo(audio_path: Path) -> float | None:
    try:
        import librosa
        from .audio import load_mono
        y, sr = load_mono(audio_path, sr=22050)
        if len(y) < sr * 5:
            return None
        tempo = librosa.feature.tempo(y=y, sr=sr, aggregate=np.median)
        t = float(np.atleast_1d(tempo)[0])
        return round(t, 1) if 40 < t < 240 else None
    except Exception:
        return None
