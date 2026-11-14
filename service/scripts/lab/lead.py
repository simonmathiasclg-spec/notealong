"""Melody Lab, internal testing only: the lead line of a solo-instrument cover, every 10 ms.

    .venv/bin/python scripts/lab/lead.py [slug ...]      -> <cover>/f0_lead.npz

A one-voice pitch tracker follows whichever is louder, the soloist or the accompaniment, and Let It Be's
covers showed it following the piano. So the notes sounding are found with Basic Pitch (Apache-2.0, already
used by the app) and the top voice through them from G3 up is taken as the lead (the same finder the app
uses for instrumental hooks). Basic Pitch's onset output at the lead's pitch marks a note struck again. The raw cover gives the same line as its separated stems (90 to 99 % of
frames on three covers), so covers are not separated: three seconds each instead of fifty.
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from common import SONGS, cover_files  # noqa: E402

HOP = 0.01


def track(cov: Path) -> bool:
    import soundfile as sf
    from notealong.pipeline import hooks
    from notealong.pipeline.audio import load_mono
    out = cov.with_suffix("") / "f0_lead.npz"
    if out.exists() and "onset" in np.load(out):
        return True
    import contextlib
    import io
    from basic_pitch import ICASSP_2022_MODEL_PATH
    from basic_pitch.inference import predict
    y, _ = load_mono(cov, sr=16000)
    fd, tmp = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    try:
        sf.write(tmp, y, 16000)
        with contextlib.redirect_stdout(io.StringIO()):
            res, _, _ = predict(tmp, ICASSP_2022_MODEL_PATH, onset_threshold=0.5, frame_threshold=0.3, minimum_note_length=80, melodia_trick=False)
    finally:
        os.unlink(tmp)
    act, ons = np.asarray(res["note"], np.float32), np.asarray(res["onset"], np.float32)
    if len(act) < 50:
        return False
    lead, strength = hooks.lead_path(act)
    # how strongly a note is struck at the lead's pitch in each frame: this is what separates a note
    # played twice from a note held (the level of the whole mix cannot)
    k = np.clip(np.nan_to_num(lead, nan=21).astype(int) - 21, 1, ons.shape[1] - 2)
    t = np.arange(len(lead))
    struck = np.where(np.isnan(lead), 0.0, np.maximum(ons[t, k], np.maximum(ons[t, k - 1], ons[t, k + 1])))
    n = int(np.ceil(len(y) / 160))
    ix = np.minimum((np.arange(n) * HOP * len(act) / (len(y) / 16000)).astype(int), len(lead) - 1)
    midi = np.nan_to_num(lead[ix], nan=0.0)
    per = np.where(midi > 0, np.clip(0.5 + strength[ix], 0.0, 1.0), 0.0)
    onset = struck[ix]
    y = np.pad(y, (0, max(0, n * 160 - len(y))))[: n * 160]
    db = 20 * np.log10(np.sqrt(np.mean(y.reshape(n, 160) ** 2, axis=1) + 1e-12) + 1e-9)
    out.parent.mkdir(parents=True, exist_ok=True)
    np.savez(out, time=np.arange(n) * HOP, midi=midi, periodicity=per, db=db, onset=onset.astype(np.float32), stem="mix", version=2)
    return True


def main() -> int:
    for slug in sys.argv[1:] or [s["slug"] for s in SONGS]:
        done = [track(c) for c in cover_files(slug)]
        print(slug, f"{sum(done)}/{len(done)} covers tracked", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
