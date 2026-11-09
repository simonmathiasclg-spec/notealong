"""Internal accuracy testing: separate Despacito and the regression originals with another Demucs model,
into test-recordings/cache/<id>/sep_<model>/vocals.wav, for scripts/accuracy/evaluate.py --vocals <model>.

    scripts/heavy.sh .venv/bin/python scripts/accuracy/separate_variants.py htdemucs_ft
"""
from __future__ import annotations

import gc
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from evaluate import CACHE, DESPACITO, regression_ids  # noqa: E402
from notealong.config import LIBRARY_DIR  # noqa: E402
from notealong.pipeline.stems import separate  # noqa: E402

ORIGINALS = Path(__file__).resolve().parents[3] / "test-recordings" / "regression-originals"


def main(model: str) -> int:
    jobs = [(DESPACITO, next((LIBRARY_DIR / DESPACITO).glob("original.*")))] + [(sid, ORIGINALS / f"{sid}.mp3") for sid in regression_ids()]
    for sid, src in jobs:
        out = CACHE / sid / f"sep_{model}"
        if (out / "vocals.wav").exists():
            continue
        t0 = time.time()
        paths, dev = separate(src, out, model_name=model, report_device=True)
        (out / "backing.wav").unlink(missing_ok=True)
        gc.collect()
        print(f"{sid}: {time.time() - t0:.0f} s on {dev}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
