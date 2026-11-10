"""Internal accuracy testing: run an original recording through the full upload pipeline into a separate
test library (test-recordings/library, gitignored), so test songs never appear in anyone's My songs.

    scripts/heavy.sh .venv/bin/python scripts/accuracy/process_test_song.py ../test-recordings/popular/<song>/original.m4a <song-id> [--title ..]

Steps run one after another in this process: separation, notes, lyrics, attach. Re-running a song only
repeats the steps that have not finished.
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
TEST_LIBRARY = ROOT / "test-recordings" / "library"
os.environ["NOTEALONG_LIBRARY"] = str(TEST_LIBRARY)          # before notealong is imported
sys.path.insert(0, str(ROOT / "service"))

from notealong import library  # noqa: E402
from notealong.pipeline import audio as audio_mod  # noqa: E402
from notealong.pipeline import runner  # noqa: E402
from notealong.schemas import Song, StepState  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("audio")
    ap.add_argument("song_id")
    ap.add_argument("--title", default=None)
    a = ap.parse_args()
    TEST_LIBRARY.mkdir(parents=True, exist_ok=True)
    d = TEST_LIBRARY / a.song_id
    if not (d / "song.json").exists():
        d.mkdir(parents=True, exist_ok=True)
        src = Path(a.audio)
        dst = d / f"original{src.suffix.lower()}"
        shutil.copy(src, dst)
        info = audio_mod.probe_streams(dst)
        song = Song(id=a.song_id, title=a.title or a.song_id, duration=round(info["duration"], 3),
                    created_at=library.now_iso(), updated_at=library.now_iso(), status="processing",
                    source={"kind": "upload", "filename": src.name, "format": dst.suffix.lstrip(".")},
                    files={"original": dst.name})
        library.save_song(song)
    for step in runner.STEP_ORDER:
        s = library.load_song(a.song_id)
        if s.steps.get(step) and s.steps[step].status == "done":
            continue
        t0 = time.time()
        runner.run_step(a.song_id, step)

        def done(x: Song, step=step):
            x.steps[step] = StepState(status="done", progress=1.0)
        library.update_song(a.song_id, done)
        print(f"{a.song_id}: {step} {time.time() - t0:.0f} s", flush=True)
    library.update_song(a.song_id, lambda x: setattr(x, "status", "ready"))
    s = library.load_song(a.song_id)
    print(f"{a.song_id}: ready, {len(s.notes)} notes, {len(s.words)} words, key {s.key.name if s.key else '-'}, tempo {s.tempo_bpm}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
