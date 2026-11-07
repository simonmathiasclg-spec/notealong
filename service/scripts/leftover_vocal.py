"""How much voice is left in a processed song's backing track (see bench_separation.py for the method).

    scripts/heavy.sh .venv/bin/python scripts/leftover_vocal.py <song-id> [...]
"""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402

from notealong import library  # noqa: E402
from notealong.pipeline import audio as audio_mod, stems  # noqa: E402


def energy(path: Path) -> float:
    x, _ = sf.read(str(path), dtype="float32", always_2d=True)
    return float((x ** 2).mean())


def leftover(song_id: str) -> dict:
    d = library.song_dir(song_id)
    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        v = audio_mod.to_wav(d / "vocals.mp3", td / "v.wav")
        b = audio_mod.to_wav(d / "backing.mp3", td / "b.wav")
        second = stems.separate(b, td / "second")
        db = 10 * np.log10((energy(second["vocals"]) + 1e-12) / (energy(v) + 1e-12))
    return {"id": song_id, "leftover_vocal_db": round(float(db), 1)}


if __name__ == "__main__":
    for sid in sys.argv[1:]:
        print(json.dumps(leftover(sid)), flush=True)
