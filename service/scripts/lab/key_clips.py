"""Melody Lab: spot-check answer keys by ear. Renders five keys on the alto sax engine.

    .venv/bin/python scripts/lab/key_clips.py

docs/listening-samples/melody-lab/answer-keys/<song>-answer-key.mp3    the key alone (committed)
test-recordings/lab/listening/<song>-key-and-vocal.mp3                 the key in the right ear, the original
                                                                        vocal in the left (never committed)
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from common import KEYS, LAB, ROOT, load_song, song_dir  # noqa: E402

CLIPS = [("let-it-be", 12, 39), ("hey-jude", 0, 30), ("yesterday", 0, 30), ("zombie", 60, 30), ("despacito", 85, 30)]


def main() -> int:
    out = ROOT / "docs" / "listening-samples" / "melody-lab" / "answer-keys"
    side = LAB / "listening"
    out.mkdir(parents=True, exist_ok=True)
    side.mkdir(parents=True, exist_ok=True)
    for slug, start, length in CLIPS:
        key = json.loads((KEYS / f"{slug}.json").read_text())
        song = load_song(slug)
        song["notes"] = [{"id": f"k{i}", "start": n["start"], "end": n["start"] + n["duration"], "midi": n["midi"], "word": None, "line": 0}
                         for i, n in enumerate(key["notes"])]
        f = LAB / "clips" / f"{slug}-key.json"
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(json.dumps(song))
        mp3 = out / f"{slug}-answer-key.mp3"
        subprocess.run([sys.executable, "scripts/accuracy/render_hear.py", str(f), str(mp3), "--start", str(start), "--length", str(length), "--instrument", "alto_sax"],
                       check=True, cwd=ROOT / "service", env={**os.environ, "PYTHONPATH": "."})
        vocal = next(iter(sorted(song_dir(slug).glob("vocals.*"))))
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", str(start), "-t", str(length), "-i", str(vocal), "-i", str(mp3),
                        "-filter_complex", "[0:a]pan=mono|c0=0.5*c0+0.5*c1[v];[1:a]pan=mono|c0=0.5*c0+0.5*c1[k];[v][k]join=inputs=2:channel_layout=stereo[o]",
                        "-map", "[o]", str(side / f"{slug}-key-and-vocal.mp3")], check=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
