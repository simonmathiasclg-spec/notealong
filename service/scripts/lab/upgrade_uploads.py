"""Bring every upload in the library up to the current note pipeline (hand-fixed notes are kept), one at a
time, without restarting the service. A copy of each song.json goes to test-recordings/backup/ first.

    scripts/heavy.sh .venv/bin/python scripts/lab/upgrade_uploads.py
"""
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "service"))
from notealong import library  # noqa: E402
from notealong.pipeline import runner  # noqa: E402

backup = ROOT / "test-recordings" / "backup"
backup.mkdir(parents=True, exist_ok=True)
for s in library.list_songs():
    if s.status != "ready" or int(s.quality.get("pipeline", 1)) >= runner.PIPELINE_VERSION:
        continue
    d = library.song_dir(s.id)
    shutil.copy(d / "song.json", backup / f"{s.id}.pipeline{s.quality.get('pipeline', 1)}.song.json")
    before = (len(s.notes), sum(1 for n in s.notes if n.edited))
    runner.run_upgrade(s.id)
    library.update_song(s.id, lambda x: x.quality.__setitem__("pipeline", runner.PIPELINE_VERSION))
    t = library.load_song(s.id)
    print(f"{s.id}: notes {before[0]} -> {len(t.notes)}, hand-fixed {before[1]} -> {sum(1 for n in t.notes if n.edited)}", flush=True)
