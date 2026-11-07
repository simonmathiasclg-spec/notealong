"""Audio fingerprints, to notice when a file that is being uploaded is a song that is already here
(the same recording exported again, at another bitrate, in another format, from a video).

Chromaprint (the `fpcalc` tool, installed by setup.sh) is used when present. Without it a smaller
chroma-based print is made here; it is less sharp but still tells the same recording from another.
Both compare by trying a few alignments and counting how many bits differ."""
from __future__ import annotations

import base64
import json
import shutil
import subprocess
import zlib
from pathlib import Path

import numpy as np

FP_SECONDS = 120          # fingerprint the first two minutes; enough to tell recordings apart
CHROMAPRINT_MAX_ERROR = 0.30   # bit error rate below which two chromaprints are the same recording
CHROMA_MAX_ERROR = 0.22        # same for the built-in print (its bits are more alike by nature)


def fingerprint(path: Path) -> dict | None:
    """{"method", "duration", "data"} or None when the audio could not be read."""
    try:
        if shutil.which("fpcalc"):
            return _chromaprint(path)
        return _chroma_print(path)
    except Exception:
        return None


def _chromaprint(path: Path) -> dict:
    out = subprocess.run(["fpcalc", "-raw", "-json", "-length", str(FP_SECONDS), str(path)], capture_output=True, text=True, timeout=120)
    if out.returncode != 0:
        raise RuntimeError(out.stderr[-300:])
    info = json.loads(out.stdout)
    ints = np.array(info["fingerprint"], dtype=np.uint32)
    return {"method": "chromaprint", "duration": float(info.get("duration", 0.0)), "data": _pack(ints)}


def _chroma_print(path: Path) -> dict:
    import librosa
    from .audio import load_mono
    y, sr = load_mono(path, sr=11025)
    y = y[: sr * FP_SECONDS]
    hop = 2048   # about 5 frames a second
    c = librosa.feature.chroma_stft(y=y, sr=sr, hop_length=hop, n_fft=4096, tuning=0.0)
    # 12 bits per frame: which pitch classes are above the frame's mean (robust to level and encoding)
    bits = (c > c.mean(axis=0, keepdims=True)).T
    ints = np.zeros(len(bits), dtype=np.uint32)
    for k in range(12):
        ints |= bits[:, k].astype(np.uint32) << k
    return {"method": "chroma", "duration": float(len(y) / sr), "data": _pack(ints)}


def _pack(ints: np.ndarray) -> str:
    return base64.b64encode(zlib.compress(ints.astype("<u4").tobytes())).decode("ascii")


def _unpack(data: str) -> np.ndarray:
    return np.frombuffer(zlib.decompress(base64.b64decode(data)), dtype="<u4").astype(np.uint32)


def _bit_error(a: np.ndarray, b: np.ndarray, bits: int) -> float:
    n = min(len(a), len(b))
    x = np.bitwise_xor(a[:n], b[:n])
    return float(np.unpackbits(x.view(np.uint8)).sum()) / (n * bits)


def similarity(fp_a: dict, fp_b: dict) -> float:
    """1.0 = identical, 0.0 = unrelated. Tries offsets of up to about five seconds either way."""
    if not fp_a or not fp_b or fp_a.get("method") != fp_b.get("method"):
        return 0.0
    a, b = _unpack(fp_a["data"]), _unpack(fp_b["data"])
    if len(a) < 20 or len(b) < 20:
        return 0.0
    bits = 32 if fp_a["method"] == "chromaprint" else 12
    rate = 8 if fp_a["method"] == "chromaprint" else 5     # frames per second
    max_shift = 5 * rate
    best = 1.0
    for shift in range(-max_shift, max_shift + 1):
        if shift >= 0:
            err = _bit_error(a[shift:], b, bits)
        else:
            err = _bit_error(a, b[-shift:], bits)
        best = min(best, err)
    return 1.0 - best


def same_recording(fp_a: dict, fp_b: dict) -> bool:
    if not fp_a or not fp_b or fp_a.get("method") != fp_b.get("method"):
        return False
    limit = CHROMAPRINT_MAX_ERROR if fp_a["method"] == "chromaprint" else CHROMA_MAX_ERROR
    return (1.0 - similarity(fp_a, fp_b)) <= limit
