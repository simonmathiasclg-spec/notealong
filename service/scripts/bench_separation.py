"""Time and judge vocal separation on one song.

    scripts/heavy.sh .venv/bin/python scripts/bench_separation.py song.mp3 [--models htdemucs,htdemucs_ft] [--devices mps,cpu]

For every (model, device): seconds taken, and how much voice is left in the backing track. The leftover is
measured by separating the backing track a second time and comparing the energy of what that pass still
hears as voice with the energy of the first pass's vocals (in dB; more negative is cleaner).
"""
from __future__ import annotations

import argparse
import json
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402

from notealong.pipeline import stems  # noqa: E402


def energy(path: Path) -> float:
    x, _ = sf.read(str(path), dtype="float32", always_2d=True)
    return float((x ** 2).mean())


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("audio", type=Path)
    ap.add_argument("--models", default="htdemucs,htdemucs_ft")
    ap.add_argument("--devices", default="mps,cpu")
    ap.add_argument("--no-leftover", action="store_true")
    ap.add_argument("--json", type=Path)
    a = ap.parse_args()
    from notealong.pipeline import audio as audio_mod
    dur = audio_mod.probe(a.audio)["duration"]
    rows = []
    for model in a.models.split(","):
        for device in a.devices.split(","):
            with tempfile.TemporaryDirectory() as td:
                t0 = time.time()
                paths, used = stems.separate(a.audio, Path(td), model_name=model, device=device, report_device=True)
                took = time.time() - t0
                row = {"model": model, "device": device, "device_used": used, "seconds": round(took, 1), "x_realtime": round(dur / took, 2)}
                if not a.no_leftover:
                    v1 = energy(paths["vocals"])
                    paths2, _ = stems.separate(paths["backing"], Path(td) / "second", model_name="htdemucs", device=device, report_device=True)
                    v2 = energy(paths2["vocals"])
                    row["leftover_vocal_db"] = round(10 * np.log10((v2 + 1e-12) / (v1 + 1e-12)), 1)
                rows.append(row)
                print(json.dumps(row), flush=True)
    if a.json:
        a.json.write_text(json.dumps({"audio": str(a.audio), "duration": dur, "rows": rows}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
