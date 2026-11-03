"""Render MIDI to mp3 with FluidSynth + ffmpeg."""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from ..config import SERVICE_DIR

SOUNDFONT_URL = "https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General.sf3"
SOUNDFONT = Path(os.environ.get("NOTEALONG_SOUNDFONT", SERVICE_DIR / "models" / "MuseScore_General.sf3"))


def ensure_soundfont() -> Path:
    if SOUNDFONT.exists():
        return SOUNDFONT
    SOUNDFONT.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading the MuseScore General soundfont (MIT licence, ~40 MB) to {SOUNDFONT} …")
    subprocess.run(["curl", "-L", "--fail", "-o", str(SOUNDFONT), SOUNDFONT_URL], check=True)
    return SOUNDFONT


def check_tools() -> None:
    for tool in ("fluidsynth", "ffmpeg"):
        if shutil.which(tool) is None:
            raise RuntimeError(f"{tool} is not installed (brew install {'fluid-synth' if tool == 'fluidsynth' else 'ffmpeg'})")


def render_midi(midi_path: Path, out_mp3: Path, gain: float = 0.7, bitrate: str = "96k",
                fade_out: float = 0.0, duration: float | None = None, loudness: float = -16.0, mono: bool = False) -> None:
    """MIDI -> wav (FluidSynth) -> mp3 (ffmpeg), trimmed to `duration` with an optional fade."""
    check_tools()
    sf = ensure_soundfont()
    with tempfile.TemporaryDirectory() as td:
        wav = Path(td) / "out.wav"
        subprocess.run(["fluidsynth", "-ni", "-g", str(gain), "-r", "44100", "-F", str(wav), str(sf), str(midi_path)],
                       check=True, capture_output=True)
        # normalise loudness so every catalog song plays at the same level, then fade
        af = [f"loudnorm=I={loudness}:TP=-1.5:LRA=11"]
        if duration and fade_out:
            af.append(f"afade=t=out:st={max(0.0, duration - fade_out):.3f}:d={fade_out:.3f}")
        cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav)]
        if duration:
            cmd += ["-t", f"{duration:.3f}"]
        if af:
            cmd += ["-af", ",".join(af)]
        if mono:
            cmd += ["-ac", "1"]
        cmd += ["-codec:a", "libmp3lame", "-b:a", bitrate, str(out_mp3)]
        subprocess.run(cmd, check=True)
