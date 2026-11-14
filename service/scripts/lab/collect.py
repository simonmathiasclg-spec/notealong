"""Melody Lab, internal testing only: find and fetch, per song, the original recording and three solo
instrument covers of the vocal melody from YouTube into the gitignored test-recordings/lab/.

    .venv/bin/python scripts/lab/collect.py [slug ...]

Nothing fetched here is ever committed, uploaded or shipped (scripts/check_no_test_material.py).
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
LAB = ROOT / "test-recordings" / "lab"
SONGS = json.loads((Path(__file__).parent / "songs.json").read_text())
INSTRUMENTS = [("saxophone", r"sax"), ("violin", r"violin|violín|fiddle"), ("flute", r"flute|flauta"),
               ("trumpet", r"trumpet|trompet"), ("clarinet", r"clarinet"), ("cello", r"cello")]
BAD = re.compile(r"karaoke|tutorial|lesson|how to|sheet music|backing track|play.?along|1 hour|hour|loop|piano|guitar|"
                 r"duet|quartet|ensemble|orchestra|band|live|reaction|medley|mashup|slowed|8d|remix|lyrics? video|easy|beginner|notes", re.I)
BAD_ORIGINAL = re.compile(r"karaoke|cover|live|remix|reaction|instrumental|slowed|sped|8d|tutorial|concert", re.I)


def search(query: str, n: int = 10) -> list[tuple[str, float, str]]:
    out = subprocess.run(["uvx", "yt-dlp", f"ytsearch{n}:{query}", "--flat-playlist", "--print", "%(id)s\t%(duration)s\t%(title)s"],
                         capture_output=True, text=True, timeout=180).stdout
    rows = []
    for line in out.splitlines():
        p = line.split("\t")
        if len(p) == 3 and p[1] not in ("NA", "None"):
            rows.append((p[0], float(p[1]), p[2]))
    return rows


def fetch(vid: str, dest: Path) -> bool:
    if dest.exists() and dest.stat().st_size > 100_000:
        return True
    dest.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["uvx", "yt-dlp", "-f", "bestaudio[ext=m4a]/bestaudio", "-x", "--audio-format", "m4a", "-o", str(dest.with_suffix("")) + ".%(ext)s",
                    f"https://www.youtube.com/watch?v={vid}"], capture_output=True, text=True, timeout=600)
    return dest.exists()


def main() -> int:
    want = set(sys.argv[1:])
    mpath = LAB / "manifest.json"
    manifest = json.loads(mpath.read_text()) if mpath.exists() else {}
    for s in SONGS:
        slug = s["slug"]
        if want and slug not in want:
            continue
        m = manifest.setdefault(slug, {"covers": {}})
        d = LAB / slug
        length = m.get("duration")
        if not s.get("upload") and not s.get("popular") and "original" not in m:
            for vid, dur, title in search(f"{s['artist']} {s['title']} official audio", 8):
                if 110 <= dur <= 400 and not BAD_ORIGINAL.search(title) and fetch(vid, d / "original.m4a"):
                    m["original"], m["duration"], length = {"id": vid, "title": title}, dur, dur
                    break
        if s.get("popular") and len(list((ROOT / "test-recordings" / "popular" / slug / "covers").glob("*.m4a"))) >= 3 and slug != "wonderwall":
            mpath.write_text(json.dumps(manifest, indent=1))
            continue
        for name, pat in INSTRUMENTS:
            if len(m["covers"]) >= 3:
                break
            if any(c["instrument"] == name for c in m["covers"].values()):
                continue
            for vid, dur, title in search(f"{s['title']} {s['artist']} {name} cover", 10):
                if vid in m["covers"] or not re.search(pat, title, re.I) or BAD.search(title):
                    continue
                if not (100 <= dur <= 420) or (length and not 0.6 * length <= dur <= 1.25 * length):
                    continue
                if fetch(vid, d / "covers" / f"{vid}.m4a"):
                    m["covers"][vid] = {"instrument": name, "title": title, "duration": dur}
                    break
        print(slug, "original" in m or bool(s.get("upload") or s.get("popular")), [c["instrument"] for c in m["covers"].values()], flush=True)
        mpath.write_text(json.dumps(manifest, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
