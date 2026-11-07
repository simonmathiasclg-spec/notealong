"""Step 1: split the song into vocals + backing with Demucs (htdemucs)."""
from __future__ import annotations

from pathlib import Path
from typing import Callable

import numpy as np

from ..config import DEMUCS_MODEL, DEMUCS_SEGMENT, DEMUCS_SHIFTS, MODELS_DIR, SAMPLE_RATE
from .audio import to_wav, write_wav

Progress = Callable[[float], None]


def _pick_device() -> str:
    import torch
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


_MODELS: dict[str, object] = {}


def _load_model(name: str | None = None):
    """The Demucs model, loaded once per process. Prefers local weights in MODELS_DIR (offline use)."""
    from demucs.pretrained import get_model
    import os
    import torch
    name = name or DEMUCS_MODEL
    if name in _MODELS:
        return _MODELS[name]
    ckpt_dir = Path(torch.hub.get_dir()) / "checkpoints"
    if MODELS_DIR.exists():
        ckpt_dir.mkdir(parents=True, exist_ok=True)
        for f in MODELS_DIR.glob("*.th"):
            target = ckpt_dir / f.name
            if not target.exists():
                try:
                    os.symlink(f, target)
                except OSError:
                    import shutil
                    shutil.copy(f, target)
    _MODELS[name] = get_model(name)
    return _MODELS[name]


def _apply(model, mix, device, cb):
    from demucs.apply import apply_model
    return apply_model(model, mix.to(device), device=device, segment=DEMUCS_SEGMENT,
                       shifts=DEMUCS_SHIFTS, split=True, overlap=0.25, progress=False, callback=cb)[0]


def separate(input_audio: Path, out_dir: Path, progress: Progress | None = None, *, model_name: str | None = None,
             device: str | None = None, report_device: bool = False):
    """Writes vocals.wav and backing.wav into out_dir and returns their paths
    (and, with report_device, the device that did the work: "mps", "cuda" or "cpu")."""
    import torch
    import soundfile as sf

    out_dir.mkdir(parents=True, exist_ok=True)
    wav_path = out_dir / "_input.wav"
    to_wav(input_audio, wav_path, sr=SAMPLE_RATE)
    audio, sr = sf.read(str(wav_path), dtype="float32", always_2d=True)  # (n, ch)
    wav_path.unlink(missing_ok=True)
    audio = audio.T  # (ch, n)
    if audio.shape[0] == 1:
        audio = np.repeat(audio, 2, axis=0)
    audio = audio[:2]

    model = _load_model(model_name)
    device = device or _pick_device()
    model.to(device)
    model.eval()

    mix = torch.from_numpy(audio)[None]
    ref = mix.mean(0)
    mix = (mix - ref.mean()) / (ref.std() + 1e-8)

    total = max(mix.shape[-1], 1)

    def cb(info):
        if progress and info.get("state") == "end":
            progress(min(0.98, (info.get("segment_offset", 0) + DEMUCS_SEGMENT * sr) / total))

    with torch.no_grad():
        try:
            sources = _apply(model, mix, device, cb)
        except RuntimeError:
            if device == "cpu":
                raise
            model.to("cpu")   # some ops are not supported on MPS; fall back
            device = "cpu"
            sources = _apply(model, mix, device, cb)
    sources = sources * (ref.std() + 1e-8) + ref.mean()
    sources = sources.cpu().numpy()
    names = list(model.sources)
    vocals = sources[names.index("vocals")]
    backing = sum(sources[i] for i, n in enumerate(names) if n != "vocals")
    vocals = np.clip(vocals, -1, 1)
    backing = np.clip(backing, -1, 1)
    paths = {"vocals": out_dir / "vocals.wav", "backing": out_dir / "backing.wav"}
    write_wav(paths["vocals"], vocals.astype(np.float32), sr)
    write_wav(paths["backing"], backing.astype(np.float32), sr)
    if progress:
        progress(1.0)
    return (paths, device) if report_device else paths


def leftover_vocal_db(vocals_wav: Path, backing_wav: Path) -> float:
    """How much of the voice is still in the backing track, in dB relative to the separated vocals
    (more negative is cleaner; about -22 dB is where it starts to be heard).

    Cheap estimate: inside the 200 Hz to 4 kHz band, during frames where the voice is active, how much
    of the backing's spectral change over time follows the vocals' change over time. Checked against a
    second separation pass on six songs and against known leaks of 10 % and 32 % of the voice."""
    import librosa
    from .audio import load_mono
    v, sr = load_mono(vocals_wav, sr=22050)
    b, _ = load_mono(backing_wav, sr=22050)
    n = min(len(v), len(b))
    if n < sr * 5:
        return -60.0
    V = np.abs(librosa.stft(v[:n], n_fft=2048, hop_length=512))
    B = np.abs(librosa.stft(b[:n], n_fft=2048, hop_length=512))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)
    band = (freqs >= 200) & (freqs <= 4000)
    V, B = V[band], B[band]
    loud = V.sum(axis=0)
    active = loud > np.percentile(loud, 60)
    if active.sum() < 20:
        return -60.0
    V, B = V[:, active], B[:, active]
    Vc = V - V.mean(axis=1, keepdims=True)
    Bc = B - B.mean(axis=1, keepdims=True)
    a = np.clip((Vc * Bc).sum(axis=1) / ((Vc ** 2).sum(axis=1) + 1e-9), 0, None)
    explained = float(((a[:, None] * Vc) ** 2).sum())
    total = float((V ** 2).sum()) + 1e-12
    return round(float(10 * np.log10(explained / total + 1e-12)), 1)
