"""Audio helpers built on ffmpeg (decode anything, encode stems, pitch shift)."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

import numpy as np
import soundfile as sf

from ..config import SAMPLE_RATE, STEM_BITRATE


def run(cmd: list[str]) -> None:
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"{cmd[0]} failed: {proc.stderr.strip()[-800:]}")


def probe(path: Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration:format_tags=title,artist",
         "-of", "json", str(path)], capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError("Could not read this audio file. Is it a valid MP3, WAV or M4A?")
    info = json.loads(out.stdout).get("format", {})
    tags = {k.lower(): v for k, v in (info.get("tags") or {}).items()}
    return {"duration": float(info.get("duration", 0.0)), "title": tags.get("title"), "artist": tags.get("artist")}


def to_wav(src: Path, dst: Path, sr: int = SAMPLE_RATE, mono: bool = False) -> Path:
    cmd = ["ffmpeg", "-y", "-v", "error", "-i", str(src), "-ar", str(sr)]
    if mono:
        cmd += ["-ac", "1"]
    cmd += ["-c:a", "pcm_s16le", str(dst)]
    run(cmd)
    return dst


def encode_stem(src_wav: Path, dst: Path) -> Path:
    run(["ffmpeg", "-y", "-v", "error", "-i", str(src_wav), "-c:a", "libmp3lame", "-b:a", STEM_BITRATE, str(dst)])
    return dst


def load_mono(path: Path, sr: int = 22050) -> tuple[np.ndarray, int]:
    """Decode to float32 mono at the requested rate via ffmpeg (handles mp3/m4a/wav)."""
    cmd = ["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "1", "-ar", str(sr), "-"]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.decode(errors="ignore")[-500:])
    return np.frombuffer(proc.stdout, dtype=np.float32).copy(), sr


def write_wav(path: Path, audio: np.ndarray, sr: int) -> None:
    sf.write(str(path), audio.T if audio.ndim == 2 and audio.shape[0] <= 2 else audio, sr)


def pitch_shift_file(src: Path, dst: Path, semitones: int) -> Path:
    """Shift pitch without changing speed using ffmpeg's rubberband filter."""
    ratio = 2 ** (semitones / 12)
    run(["ffmpeg", "-y", "-v", "error", "-i", str(src),
         "-af", f"rubberband=pitch={ratio:.6f}:pitchq=quality:transients=mixed",
         "-c:a", "libmp3lame", "-b:a", STEM_BITRATE, str(dst)])
    return dst
