"""Melody Lab: "Hear it played" clips (the notes on the alto sax engine, no original audio) for listening.

    .venv/bin/python scripts/lab/clips.py before|after

Six songs, fixed stretches. "before" renders the notes each song has stored now; "after" renders what the
current Sax-friendly rules write. Output: docs/listening-samples/melody-lab/<song>-before|after.mp3
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from common import LAB, ROOT, load_song, song_dir  # noqa: E402

CLIPS = [("let-it-be", 37, 14, "chorus"), ("just-give-me-a-reason", 60, 20, ""), ("despacito", 85, 20, ""),
         ("zombie", 60, 20, "held-out"), ("stay-with-me", 30, 20, "held-out"), ("thinking-out-loud", 30, 20, "held-out")]
OUT = ROOT / "docs" / "listening-samples" / "melody-lab"


def main() -> int:
    which = sys.argv[1]
    OUT.mkdir(parents=True, exist_ok=True)
    tmp = LAB / "clips"
    tmp.mkdir(parents=True, exist_ok=True)
    for slug, start, length, tag in CLIPS:
        song = load_song(slug)
        if which == "after":
            from notealong.pipeline import saxmelody as sm
            song = sm.sax_song(song_dir(slug), song)
        else:
            song["notes"] = [n for n in song["notes"] if not n.get("hook")]
        f = tmp / f"{slug}-{which}.json"
        f.write_text(json.dumps(song))
        name = f"{slug}{'-' + tag if tag else ''}-alto-sax-{which}.mp3"
        subprocess.run([sys.executable, str(ROOT / "service/scripts/accuracy/render_hear.py"), str(f), str(OUT / name), "--start", str(start), "--length", str(length),
                        "--instrument", "alto_sax"], check=True, cwd=ROOT / "service", env={**__import__("os").environ, "PYTHONPATH": "."})
    return 0


if __name__ == "__main__":
    sys.path.insert(0, str(ROOT / "service"))
    raise SystemExit(main())
