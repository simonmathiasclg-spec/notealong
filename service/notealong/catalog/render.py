"""Render an arrangement to audio: each part through FluidSynth on its own,
then a real mix: level by role, pan, EQ that leaves room for the melody, a
shared room reverb, gentle bus compression and loudness normalisation.

Soundfonts (downloaded on first use into service/models/, licences in catalog/LICENSES.md):
  gu = GeneralUser GS 2.0.3 (S. Christian Collins)
  ms = MuseScore General (MIT)
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np

from ..config import SERVICE_DIR

SR = 44100
SOUNDFONTS = {
    "ms": (Path(os.environ.get("NOTEALONG_SOUNDFONT", SERVICE_DIR / "models" / "MuseScore_General.sf3")),
           "https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General.sf3"),
    "gu": (Path(os.environ.get("NOTEALONG_SOUNDFONT_GU", SERVICE_DIR / "models" / "GeneralUser-GS.sf2")),
           "https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/main/GeneralUser-GS.sf2"),
}
SOUNDFONT = SOUNDFONTS["ms"][0]

# Loudness of each role in the mix (LUFS before the master stage; only the differences matter).
ROLE_LEVEL = {"comp": -22.0, "comp2": -26.0, "bass": -24.0, "perc": -23.5, "pad": -27.5, "color": -26.5}
# High-pass per role (Hz): keeps the low end for the bass and the kick.
ROLE_LOWCUT = {"comp": 95, "comp2": 140, "bass": 42, "perc": 36, "pad": 150, "color": 250}
# The band steps back where the player's instrument speaks most clearly (around 1 to 3 kHz).
CARVE_HZ, CARVE_Q = 1700.0, 0.8
ROLE_CARVE_DB = {"comp": -2.0, "comp2": -2.0, "pad": -3.5, "color": -1.0, "bass": 0.0, "perc": 0.0}
ROOMS = {  # reverb time (s), pre-delay (s), level of the wet signal
    "room": (0.55, 0.008, 0.9), "club": (0.85, 0.012, 0.85), "hall": (1.7, 0.02, 0.8), "chapel": (2.4, 0.025, 0.75),
}


def ensure_soundfont(which: str = "ms") -> Path:
    path, url = SOUNDFONTS[which]
    if path.exists():
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading the {'GeneralUser GS' if which == 'gu' else 'MuseScore General'} soundfont to {path} …")
    subprocess.run(["curl", "-L", "--fail", "-o", str(path), url], check=True)
    return path


def check_tools() -> None:
    for tool in ("fluidsynth", "ffmpeg"):
        if shutil.which(tool) is None:
            raise RuntimeError(f"{tool} is not installed (brew install {'fluid-synth' if tool == 'fluidsynth' else 'ffmpeg'})")


# ---- signal helpers -------------------------------------------------------------
def _biquad(kind: str, f0: float, q: float, gain_db: float = 0.0):
    from scipy.signal import iirfilter  # noqa: F401  (scipy presence check)
    a = 10 ** (gain_db / 40)
    w = 2 * np.pi * f0 / SR
    alpha = np.sin(w) / (2 * q)
    cw = np.cos(w)
    if kind == "peak":
        b = [1 + alpha * a, -2 * cw, 1 - alpha * a]
        den = [1 + alpha / a, -2 * cw, 1 - alpha / a]
    elif kind == "highpass":
        b = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2]
        den = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == "lowpass":
        b = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2]
        den = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == "highshelf":
        sq = 2 * np.sqrt(a) * alpha
        b = [a * ((a + 1) + (a - 1) * cw + sq), -2 * a * ((a - 1) + (a + 1) * cw), a * ((a + 1) + (a - 1) * cw - sq)]
        den = [(a + 1) - (a - 1) * cw + sq, 2 * ((a - 1) - (a + 1) * cw), (a + 1) - (a - 1) * cw - sq]
    else:
        raise ValueError(kind)
    b = np.array(b) / den[0]
    den = np.array(den) / den[0]
    return b, den


def _filt(x: np.ndarray, kind: str, f0: float, q: float = 0.707, gain_db: float = 0.0) -> np.ndarray:
    from scipy.signal import lfilter
    b, a = _biquad(kind, f0, q, gain_db)
    return lfilter(b, a, x, axis=0)


def lufs(x: np.ndarray, weighted: bool = True) -> float:
    """Integrated loudness (ITU-R BS.1770: K-weighting, 400 ms blocks, absolute and relative gates).
    With weighted=False the K-weighting is left out: used for the bass, whose lowest notes the
    weighting would under-count, which made low bass notes far too loud."""
    if x.ndim == 1:
        x = x[:, None]
    k = _filt(_filt(x, "highshelf", 1500.0, 0.707, 4.0), "highpass", 38.0, 0.5) if weighted else x
    block, hop = int(0.4 * SR), int(0.1 * SR)
    if len(k) < block:
        return -70.0
    sq = (k ** 2).sum(axis=1)
    c = np.concatenate([[0.0], np.cumsum(sq)])
    idx = np.arange(0, len(k) - block + 1, hop)
    z = (c[idx + block] - c[idx]) / block
    l = -0.691 + 10 * np.log10(z + 1e-12)
    keep = l > -70
    if not keep.any():
        return -70.0
    rel = -0.691 + 10 * np.log10(z[keep].mean() + 1e-12) - 10
    keep &= l > rel
    return float(-0.691 + 10 * np.log10(z[keep].mean() + 1e-12)) if keep.any() else -70.0


def room_impulse(kind: str, seed: int = 7) -> np.ndarray:
    """A synthetic room: a few early reflections, then noise that decays faster in the highs."""
    rt60, predelay, _ = ROOMS[kind]
    rng = np.random.default_rng(seed)
    n = int((rt60 * 1.3 + predelay) * SR)
    t = np.arange(n) / SR
    out = np.zeros((n, 2))
    for ch in range(2):
        noise = rng.standard_normal(n)
        low = _filt(noise, "lowpass", 2500.0, 0.6)
        mid = noise - low
        tail = low * np.exp(-6.91 * t / rt60) + 0.7 * mid * np.exp(-6.91 * t / (rt60 * 0.55))
        tail = _filt(_filt(tail, "highpass", 180.0), "lowpass", 7500.0)
        tail *= np.minimum(1.0, t / 0.012)                     # the diffuse part builds up
        for _ in range(7):                                      # early reflections
            d = int((0.004 + rng.random() * 0.045) * SR)
            if d < n:
                tail[d] += (0.9 - rng.random() * 0.5) * (1 if rng.random() > 0.5 else -1)
        pd = int(predelay * SR)
        out[pd:, ch] = tail[: n - pd]
    out /= np.sqrt((out ** 2).sum(axis=0)).max() + 1e-9
    return out


def _fluidsynth(midi: Path, wav: Path, sf: Path, gain: float = 0.5) -> None:
    subprocess.run(["fluidsynth", "-ni", "-g", str(gain), "-r", str(SR), "-R", "0", "-C", "0", "-o", "synth.polyphony=512",
                    "-F", str(wav), str(sf), str(midi)], check=True, capture_output=True)


def _write_part_midi(inst, tempo: float, bank: int, path: Path) -> None:
    """One instrument as a MIDI file. The bank select has to come before the program
    change, which pretty_midi does not guarantee, so the file is patched with mido."""
    import mido
    import pretty_midi
    pm = pretty_midi.PrettyMIDI(initial_tempo=tempo)
    pm.instruments.append(inst)
    pm.write(str(path))
    if bank:
        mf = mido.MidiFile(str(path))
        for track in mf.tracks:
            for i, msg in enumerate(track):
                if msg.type == "program_change":
                    track.insert(i, mido.Message("control_change", channel=msg.channel, control=0, value=bank, time=msg.time))
                    track.insert(i + 1, mido.Message("control_change", channel=msg.channel, control=32, value=0, time=0))
                    msg.time = 0
                    break
        mf.save(str(path))


def _read(wav: Path, n: int) -> np.ndarray:
    import soundfile as sf
    x, sr = sf.read(str(wav), dtype="float64", always_2d=True)
    if x.shape[1] == 1:
        x = np.repeat(x, 2, axis=1)
    out = np.zeros((n, 2))
    m = min(n, len(x))
    out[:m] = x[:m, :2]
    return out


def _pan(x: np.ndarray, pan: float) -> np.ndarray:
    """Balance control: turns one side down, keeps the stereo image of the part."""
    left = 1.0 if pan <= 0 else np.cos(pan * np.pi / 2) ** 1.2
    right = 1.0 if pan >= 0 else np.cos(-pan * np.pi / 2) ** 1.2
    return x * np.array([left, right])


def mix_band(arranger, duration: float, workdir: Path) -> tuple[np.ndarray, list[dict]]:
    """Renders every part and mixes them. Returns (stereo mix before mastering, per-part report)."""
    from scipy.signal import fftconvolve
    check_tools()
    n = int((duration + 0.5) * SR)
    dry = np.zeros((n, 2))
    send = np.zeros((n, 2))
    report = []
    for i, (part, inst) in enumerate(arranger.band()):
        mid = workdir / f"part{i}.mid"
        wav = workdir / f"part{i}.wav"
        _write_part_midi(inst, arranger.spec.tempo, part.sound.bank, mid)
        _fluidsynth(mid, wav, ensure_soundfont(part.sound.sf))
        x = _read(wav, n)
        x = _filt(x, "highpass", ROLE_LOWCUT.get(part.role, 80))
        carve = ROLE_CARVE_DB.get(part.role, 0.0)
        if carve:
            x = _filt(x, "peak", CARVE_HZ, CARVE_Q, carve)
        if part.role == "pad":
            x = _filt(x, "lowpass", 6500.0)
        level = lufs(x, weighted=part.role != "bass")
        target = ROLE_LEVEL.get(part.role, -25.0) + float(part.opts.get("gain", 0.0))
        gain = 10 ** ((target - level) / 20) if level > -65 else 0.0
        x = _pan(x * gain, part.pan)
        dry += x
        send += x * part.reverb
        report.append({"part": part.name, "role": part.role, "notes": len(inst.notes), "raw_lufs": round(level, 1), "mix_lufs": round(target, 1)})
    _, _, wet_level = ROOMS[arranger.style.room]
    ir = room_impulse(arranger.style.room)
    wet = np.stack([fftconvolve(send[:, ch], ir[:, ch])[:n] for ch in range(2)], axis=1)
    mix = dry + wet * wet_level
    mix = _filt(mix, "highpass", 30.0)
    mix = _filt(mix, "highshelf", 5000.0, 0.707, 2.5)     # a little air: sampled instruments are on the dull side
    return mix, report


def master(mix: np.ndarray, out_mp3: Path, duration: float, loudness: float = -16.0, bitrate: str = "128k",
           fade_out: float = 1.5, mono: bool = False, compress: bool = True) -> dict:
    """Gentle bus compression, loudness normalised in two passes (measure, then apply), fade, mp3."""
    import soundfile as sf
    peak = float(np.abs(mix).max()) or 1.0
    with tempfile.TemporaryDirectory() as td:
        wav = Path(td) / "mix.wav"
        sf.write(str(wav), (mix / peak * 0.5).astype(np.float32), SR, subtype="FLOAT")
        pre = "acompressor=threshold=0.09:ratio=2:attack=25:release=260:makeup=1.4:knee=6," if compress else ""
        norm = f"loudnorm=I={loudness}:TP=-3.0:LRA=11"     # the mp3 encoder overshoots by up to a decibel
        m = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(wav), "-t", f"{duration:.3f}", "-af", f"{pre}{norm}:print_format=json", "-f", "null", "-"],
                           capture_output=True, text=True)
        stats = json.loads(m.stderr[m.stderr.rindex("{"):m.stderr.rindex("}") + 1])
        af = (f"{pre}{norm}:measured_I={stats['input_i']}:measured_TP={stats['input_tp']}:measured_LRA={stats['input_lra']}"
              f":measured_thresh={stats['input_thresh']}:offset={stats['target_offset']}:linear=true")
        base = af
        # Lossy encoding can throw up a stray sample well above the limiter's ceiling on a sharp
        # transient. Encode, decode, look; if anything reaches full scale, lower the ceiling and try again.
        for ceiling in (0.708, 0.56, 0.45):
            af = base + f",alimiter=limit={ceiling}:attack=3:release=40:level=0"
            if fade_out:
                af += f",afade=t=out:st={max(0.0, duration - fade_out):.3f}:d={fade_out:.3f}"
            cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav), "-t", f"{duration:.3f}", "-af", af, "-ar", str(SR)]
            if mono:
                cmd += ["-ac", "1"]
            cmd += ["-codec:a", "libmp3lame", "-b:a", bitrate, str(out_mp3)]
            subprocess.run(cmd, check=True)
            raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(out_mp3), "-f", "f32le", "-"], capture_output=True, check=True).stdout
            if float(np.abs(np.frombuffer(raw, dtype=np.float32)).max()) < 0.94:
                break
        stats["ceiling"] = ceiling
    return stats


def render_backing(arranger, out_mp3: Path, duration: float, bitrate: str = "128k") -> list[dict]:
    with tempfile.TemporaryDirectory() as td:
        mix, report = mix_band(arranger, duration, Path(td))
    master(mix, out_mp3, duration, loudness=-16.0, bitrate=bitrate, fade_out=1.5)
    return report


def render_midi(midi_path: Path, out_mp3: Path, gain: float = 0.7, bitrate: str = "64k", fade_out: float = 0.5,
                duration: float | None = None, loudness: float = -18.0, mono: bool = True, soundfont: str = "ms") -> None:
    """A single MIDI file straight to mp3 (used for the quiet guide melody)."""
    check_tools()
    with tempfile.TemporaryDirectory() as td:
        wav = Path(td) / "out.wav"
        subprocess.run(["fluidsynth", "-ni", "-g", str(gain), "-r", str(SR), "-F", str(wav), str(ensure_soundfont(soundfont)), str(midi_path)],
                       check=True, capture_output=True)
        import soundfile as sf
        x, _ = sf.read(str(wav), dtype="float64", always_2d=True)
        dur = duration or len(x) / SR
        n = int((dur + 0.5) * SR)
        y = np.zeros((n, x.shape[1]))
        y[: min(n, len(x))] = x[:n]
        master(y, out_mp3, dur, loudness=loudness, bitrate=bitrate, fade_out=fade_out, mono=mono, compress=False)
