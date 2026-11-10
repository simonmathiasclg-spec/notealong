"""Internal accuracy testing only. Separate each sax cover into Demucs' four stems and pitch-track the
stems where a sax can land ("vocals" and "other") with CREPE (full model), keeping the cleaner one.

    scripts/heavy.sh .venv/bin/python scripts/accuracy/prepare_covers.py ../test-recordings/youtube/*.m4a

Writes, next to each recording, <id>/stems/*.wav and <id>/f0.npz (time, midi, periodicity per 10 ms).
Nothing here is shipped or committed: test-recordings/ is gitignored.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from notealong.pipeline.audio import load_mono, to_wav  # noqa: E402

HOP = 0.01


def demucs4(src: Path, out: Path) -> dict[str, Path]:
    """All four htdemucs stems as 44.1 kHz wavs."""
    import soundfile as sf
    import torch
    from demucs.apply import apply_model
    from notealong.pipeline.stems import _load_model, _pick_device
    out.mkdir(parents=True, exist_ok=True)
    paths = {k: out / f"{k}.wav" for k in ("drums", "bass", "other", "vocals")}
    if all(p.exists() for p in paths.values()):
        return paths
    tmp = out / "_in.wav"
    to_wav(src, tmp, sr=44100)
    audio, sr = sf.read(str(tmp), dtype="float32", always_2d=True)
    tmp.unlink()
    audio = audio.T[:2] if audio.shape[1] >= 2 else np.repeat(audio.T, 2, axis=0)
    model = _load_model("htdemucs")
    device = _pick_device()
    model.to(device).eval()
    mix = torch.from_numpy(audio)[None]
    ref = mix.mean(0)
    mixn = (mix - ref.mean()) / (ref.std() + 1e-8)
    with torch.no_grad():
        srcs = apply_model(model, mixn.to(device), device=device, segment=7.8, shifts=1, split=True, overlap=0.25, progress=False)[0]
    srcs = (srcs.cpu() * ref.std() + ref.mean()).numpy()
    for i, name in enumerate(model.sources):
        sf.write(str(paths[name]), srcs[i].T, sr)
    del srcs, mix, mixn
    if device == "mps":
        torch.mps.empty_cache()
    return paths


def crepe(path: Path, chunk_s: float = 30.0, model: str = "full") -> tuple[np.ndarray, np.ndarray]:
    """(midi, periodicity) per 10 ms with torchcrepe's full model, in 30-second chunks with a small batch
    so memory stays low (a whole song at once was killed for lack of memory)."""
    import gc
    import torch
    import torchcrepe
    from notealong.pipeline.stems import _pick_device
    y, sr = load_mono(path, sr=16000)
    dev = _pick_device()
    step = int(chunk_s * sr)
    mids, pers = [], []
    for i in range(0, len(y), step):
        seg = torch.from_numpy(y[i:i + step].copy())[None]
        with torch.no_grad():
            f0, per = torchcrepe.predict(seg, sr, hop_length=160, fmin=80, fmax=1400, model=model, decoder=torchcrepe.decode.viterbi,
                                         return_periodicity=True, batch_size=128, device=dev)
        per = torchcrepe.filter.median(per, 3)
        f0 = f0[0].cpu().numpy()
        n = int(np.ceil(min(step, len(y) - i) / 160))
        mids.append(69 + 12 * np.log2(np.maximum(f0[:n], 1e-6) / 440.0))
        pers.append(per[0].cpu().numpy()[:n])
        del seg, f0, per
        gc.collect()
        if dev == "mps":
            torch.mps.empty_cache()
    return np.concatenate(mids), np.concatenate(pers)


def fcpe(path: Path) -> tuple[np.ndarray, np.ndarray]:
    from notealong.pipeline.pitchnotes import track_fcpe
    return track_fcpe(path)


def main(argv: list[str]) -> int:
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--tracker", choices=("crepe", "crepetiny", "fcpe"), default="crepe")
    a = ap.parse_args(argv)
    for f in a.files:
        src = Path(f)
        out = src.with_suffix("")
        target = out / f"f0_{a.tracker}.npz"
        if target.exists():
            continue
        t0 = time.time()
        stems = demucs4(src, out / "stems")
        # pitch-track only the louder of the two stems a sax can land in
        lvl = {n: float(np.sqrt(np.mean(load_mono(stems[n], sr=16000)[0] ** 2))) for n in ("vocals", "other")}
        best = max(lvl, key=lvl.get)
        midi, per = crepe(stems[best]) if a.tracker == "crepe" else crepe(stems[best], model="tiny") if a.tracker == "crepetiny" else fcpe(stems[best])
        y, sr = load_mono(stems[best], sr=16000)
        n = len(midi)
        y = np.pad(y, (0, max(0, n * 160 - len(y))))[: n * 160]
        db = 20 * np.log10(np.sqrt(np.mean(y.reshape(n, 160) ** 2, axis=1) + 1e-12) + 1e-9)
        voiced = (per > 0.6) & (db > db.max() - 40)
        np.savez(target, time=np.arange(n) * HOP, midi=midi, periodicity=per, db=db, stem=best)
        print(f"{src.name}: lead stem '{best}' voiced {voiced.mean():.0%}, {time.time() - t0:.0f}s", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
