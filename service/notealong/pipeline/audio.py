"""Audio helpers built on ffmpeg (decode anything, encode stems, pitch shift)."""
from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
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


def probe_streams(path: Path) -> dict:
    """What is in the container: audio and video streams, duration, tags, and a cover picture if embedded."""
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,codec_name,disposition:format=duration:format_tags=title,artist,album",
                          "-of", "json", str(path)], capture_output=True, text=True)
    if out.returncode != 0:
        err = out.stderr.strip()
        raise RuntimeError(f"ffprobe could not read this file: {err[-300:]}")
    info = json.loads(out.stdout or "{}")
    streams = info.get("streams", [])
    fmt = info.get("format", {})
    tags = {k.lower(): v for k, v in (fmt.get("tags") or {}).items()}
    audio = [st for st in streams if st.get("codec_type") == "audio"]
    video = [st for st in streams if st.get("codec_type") == "video"]
    # an embedded cover is a video stream flagged as an attached picture (mjpeg/png)
    pictures = [st for st in video if (st.get("disposition") or {}).get("attached_pic") or st.get("codec_name") in ("mjpeg", "png", "bmp")]
    real_video = [st for st in video if st not in pictures]
    return {"duration": float(fmt.get("duration", 0.0) or 0.0), "title": tags.get("title"), "artist": tags.get("artist"), "album": tags.get("album"),
            "has_audio": bool(audio), "has_video": bool(real_video), "has_picture": bool(pictures),
            "audio_codec": audio[0].get("codec_name") if audio else None}


def extract_audio(src: Path, dst: Path) -> Path:
    """The soundtrack of a video (or any container) as an AAC file."""
    run(["ffmpeg", "-y", "-v", "error", "-i", str(src), "-vn", "-map", "0:a:0", "-c:a", "aac", "-b:a", "192k", str(dst)])
    return dst


def extract_picture(src: Path, dst: Path) -> Path | None:
    """The embedded cover picture, if the file has one."""
    proc = subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(src), "-map", "0:v:0", "-frames:v", "1", "-c:v", "mjpeg", "-q:v", "3", str(dst)],
                          capture_output=True, text=True)
    return dst if proc.returncode == 0 and dst.exists() and dst.stat().st_size > 0 else None


def to_wav(src: Path, dst: Path, sr: int = SAMPLE_RATE, mono: bool = False) -> Path:
    cmd = ["ffmpeg", "-y", "-v", "error", "-i", str(src), "-vn", "-ar", str(sr)]      # -vn: ignore an embedded cover picture
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


_FFMPEG_RUBBERBAND: bool | None = None


def _ffmpeg_has_rubberband() -> bool:
    global _FFMPEG_RUBBERBAND
    if _FFMPEG_RUBBERBAND is None:
        out = subprocess.run(["ffmpeg", "-hide_banner", "-filters"], capture_output=True, text=True)
        _FFMPEG_RUBBERBAND = " rubberband " in out.stdout
    return _FFMPEG_RUBBERBAND


def pitch_shift_engine() -> str:
    """Which pitch shifter this machine has: 'rubberband' (the command line tool, R2 and R3 engines),
    'ffmpeg-rubberband' (ffmpeg built with the filter) or 'ffmpeg-resample' (always available, lower quality)."""
    if shutil.which("rubberband"):
        return "rubberband"
    if _ffmpeg_has_rubberband():
        return "ffmpeg-rubberband"
    return "ffmpeg-resample"


def pitch_shift_file(src: Path, dst: Path, semitones: int, *, fine: bool = False, formant: bool = False) -> Path:
    """Shift pitch without changing speed. Output length equals input length to the sample, so notes and
    lyrics line up with every key.

    fine=True uses Rubber Band's R3 engine (better, about four times slower than R2); formant=True keeps
    the timbre of a voice when shifting it. Falls back to ffmpeg when the rubberband tool is missing."""
    ratio = 2 ** (semitones / 12)
    engine = pitch_shift_engine()
    if engine == "rubberband":
        with tempfile.TemporaryDirectory() as td:
            wav_in, wav_out = Path(td) / "in.wav", Path(td) / "out.wav"
            run(["ffmpeg", "-y", "-v", "error", "-i", str(src), "-vn", "-c:a", "pcm_s16le", str(wav_in)])
            cmd = ["rubberband", "-q", "-3" if fine else "-2", "-p", f"{semitones}"]
            if formant:
                cmd.append("-F")
            run(cmd + [str(wav_in), str(wav_out)])
            run(["ffmpeg", "-y", "-v", "error", "-i", str(wav_out), "-c:a", "libmp3lame", "-b:a", STEM_BITRATE, str(dst)])
        return dst
    if engine == "ffmpeg-rubberband":
        run(["ffmpeg", "-y", "-v", "error", "-i", str(src), "-vn",
             "-af", f"rubberband=pitch={ratio:.6f}:pitchq=quality:transients=mixed",
             "-c:a", "libmp3lame", "-b:a", STEM_BITRATE, str(dst)])
        return dst
    # Plain ffmpeg: resample to move the pitch, then stretch the tempo back. Audible artefacts on
    # big shifts, but it works everywhere; setup.sh installs rubberband so this is rarely used.
    sr = SAMPLE_RATE
    run(["ffmpeg", "-y", "-v", "error", "-i", str(src), "-vn",
         "-af", f"aresample={sr},asetrate={int(round(sr * ratio))},atempo={1 / ratio:.6f},aresample={sr}",
         "-c:a", "libmp3lame", "-b:a", STEM_BITRATE, str(dst)])
    return dst
