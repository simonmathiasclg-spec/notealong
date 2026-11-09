"""Render "Hear it played" offline: a song's notes on one of the app's sampled instruments, like the player's
sampler does (nearest recorded note re-pitched, the steady part looped for held notes, a short release).

    .venv/bin/python scripts/accuracy/render_hear.py song.json out.mp3 --start 85 --length 30 [--instrument alto_sax]
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[3]
INSTR = ROOT / "web" / "public" / "instruments"


def render(notes: list[dict], start: float, length: float, instrument: str = "alto_sax") -> tuple[np.ndarray, int]:
    man = json.loads((INSTR / "manifest.json").read_text())
    sr = int(man["sample_rate"])
    inst = man["instruments"][instrument]
    zones = inst["zones"]
    cache = {}
    out = np.zeros(int((length + 2) * sr), dtype=np.float32)
    release = float(inst.get("release", 0.09))
    for n in notes:
        if n["end"] <= start or n["start"] >= start + length:
            continue
        z = min(zones, key=lambda z: abs(z["midi"] - n["midi"]))
        if z["file"] not in cache:
            y, zsr = sf.read(str(INSTR / instrument / z["file"]), dtype="float32", always_2d=True)
            cache[z["file"]] = y.mean(axis=1)
        src = cache[z["file"]]
        rate = 2 ** ((n["midi"] - z["midi"] - z.get("tune", 0) / 100.0) / 12)
        dur = max(0.06, n["end"] - n["start"]) + release
        m = int(dur * sr)
        # read positions in the source, looping inside the steady part for long notes
        pos = np.arange(m) * rate
        if inst.get("sustain") and z.get("loop"):
            a, b = z["loop"][0] * sr, z["loop"][1] * sr
            over = pos >= b
            pos[over] = a + (pos[over] - a) % (b - a)
        pos = np.clip(pos, 0, len(src) - 2)
        i = pos.astype(int)
        frac = pos - i
        y = src[i] * (1 - frac) + src[i + 1] * frac
        env = np.ones(m, dtype=np.float32)
        att = int(0.008 * sr)
        env[:att] = np.linspace(0, 1, att)
        rel = int(release * sr)
        env[-rel:] = np.linspace(1, 0, rel)
        off = int((n["start"] - start) * sr)
        a0, b0 = max(0, off), min(len(out), off + m)
        out[a0:b0] += (y * env)[a0 - off:b0 - off] * float(inst.get("level", 1.0)) * 0.5
    out = out[: int(length * sr)]
    peak = float(np.abs(out).max()) or 1.0
    return (out / peak * 0.8).astype(np.float32), sr


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("song_json")
    ap.add_argument("out")
    ap.add_argument("--start", type=float, default=0.0)
    ap.add_argument("--length", type=float, default=30.0)
    ap.add_argument("--instrument", default="alto_sax")
    a = ap.parse_args()
    notes = json.loads(Path(a.song_json).read_text())["notes"]
    y, sr = render(notes, a.start, a.length, a.instrument)
    with tempfile.TemporaryDirectory() as td:
        wav = Path(td) / "x.wav"
        sf.write(wav, y, sr)
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(wav), "-af", "afade=t=out:st=%.2f:d=1.5" % (a.length - 1.5),
                        "-c:a", "libmp3lame", "-b:a", "160k", a.out], check=True)
    print(f"{a.out}: {sum(1 for n in notes if a.start <= n['start'] < a.start + a.length)} notes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
