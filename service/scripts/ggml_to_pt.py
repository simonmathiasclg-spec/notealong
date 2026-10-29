"""Convert a whisper.cpp ggml model file back into an openai-whisper .pt checkpoint.

Useful when only the ggml mirror is reachable. Usage:
    python scripts/ggml_to_pt.py ggml-base.bin base.pt
"""
from __future__ import annotations

import struct
import sys

import numpy as np
import torch

HPARAM_KEYS = ["n_vocab", "n_audio_ctx", "n_audio_state", "n_audio_head", "n_audio_layer",
               "n_text_ctx", "n_text_state", "n_text_head", "n_text_layer", "n_mels", "ftype"]


def read_i32(f):
    return struct.unpack("<i", f.read(4))[0]


def convert(src: str, dst: str) -> None:
    with open(src, "rb") as f:
        magic = f.read(4)
        assert magic == b"lmgg"[::-1] or magic == b"ggml"[::-1] or struct.unpack("<I", magic)[0] == 0x67676d6c, magic
        hp = {k: read_i32(f) for k in HPARAM_KEYS}
        n_mel, n_fft = read_i32(f), read_i32(f)
        f.read(4 * n_mel * n_fft)  # mel filters (recomputed by whisper)
        n_vocab = read_i32(f)
        for _ in range(n_vocab):
            ln = read_i32(f)
            f.read(ln)
        sd = {}
        while True:
            head = f.read(4)
            if not head:
                break
            n_dims = struct.unpack("<i", head)[0]
            name_len = read_i32(f)
            ftype = read_i32(f)
            dims = [read_i32(f) for _ in range(n_dims)][::-1]
            name = f.read(name_len).decode()
            count = int(np.prod(dims))
            if ftype == 1:
                arr = np.frombuffer(f.read(count * 2), dtype=np.float16).astype(np.float32)
            else:
                arr = np.frombuffer(f.read(count * 4), dtype=np.float32)
            arr = arr.reshape(dims)
            if name in ("encoder.conv1.bias", "encoder.conv2.bias"):
                arr = arr.reshape(-1)
            sd[name] = torch.from_numpy(arr.copy())
    dims = {k: hp[k] for k in HPARAM_KEYS if k != "ftype"}
    torch.save({"dims": dims, "model_state_dict": sd}, dst)
    print(f"wrote {dst}: {len(sd)} tensors, dims={dims}")


if __name__ == "__main__":
    convert(sys.argv[1], sys.argv[2])
