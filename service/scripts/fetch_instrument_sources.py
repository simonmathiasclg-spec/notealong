"""Download the source recordings for the "Hear it played" instruments into
service/models/instrument_sources/ (about 300 MB, not committed).

Sources (see catalog/LICENSES.md for the licence of each):
  - University of Iowa Musical Instrument Samples: alto and soprano sax, clarinet, flute, oboe, trumpet, horn
  - Versilian Community Sample Library (VCSL, CC0): tenor sax, soprano recorder, Steinway B piano
  - VSCO 2 Community Edition (CC0): solo violin
  - Karoryfer Weresax (CC0): the layered alto sax, cloned whole into models/instrument_sources_raw/weresax (about 200 MB)

    cd service && .venv/bin/python scripts/fetch_instrument_sources.py
"""
from __future__ import annotations

import json
import re
import subprocess
import time
import urllib.parse
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "models" / "instrument_sources"
PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def midi(name: str) -> int:
    m = re.fullmatch(r"([A-G])([b#]?)(-?\d)", name)
    return PC[m.group(1)] + (1 if m.group(2) == "#" else -1 if m.group(2) == "b" else 0) + 12 * (int(m.group(3)) + 1)


def curl(url: str) -> str:
    return subprocess.run(["curl", "-sS", "-L", "--fail", "-m", "60", url], capture_output=True, text=True, check=True).stdout


def get(url: str, dest: Path) -> None:
    if dest.exists() and dest.stat().st_size > 10000:
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    for _ in range(3):
        r = subprocess.run(["curl", "-sS", "-L", "--fail", "-m", "180", "-o", str(dest), url], capture_output=True, text=True)
        if r.returncode == 0 and dest.exists() and dest.stat().st_size > 10000:
            print("ok", dest.parent.name, dest.name, dest.stat().st_size // 1000, "KB", flush=True)
            time.sleep(0.3)   # be polite to the university server
            return
        time.sleep(3)
    print("FAILED", url, flush=True)


IOWA_BASE = "https://theremin.music.uiowa.edu/MIS-Pitches-2012/"
IOWA = {  # instrument: (page, file pattern with the note name in group 1, spacing in semitones, highest note kept)
    "alto_sax": ("MISEbAltoSaxophone2012", r"AltoSax\.NoVib\.ff\.([A-G]b?\d)\.stereo", 2, 127),
    "soprano_sax": ("MISBbSopranoSaxophone2012", r"SopSax\.nonvib\.ff\.([A-G]b?\d)\.stereo", 2, 127),
    "flute": ("MISFlute2012", r"Flute\.nonvib\.ff\.([A-G]b?\d)\.stereo", 3, 98),
    "clarinet": ("MISBbClarinet2012", r"BbClarinet\.ff\.([A-G]b?\d)\.stereo", 3, 91),
    "trumpet": ("MISBbTrumpet2012", r"Trumpet\.novib\.ff\.([A-G]b?\d)\.stereo", 2, 127),
    "french_horn": ("MISHorn2012", r"Horn\.ff\.([A-G]b?\d)\.stereo", 3, 127),
    "oboe": ("MISOboe2012", r"Oboe\.ff\.([A-G]b?\d)\.stereo", 3, 93),
}


def iowa() -> None:
    for inst, (page, rx, step, top) in IOWA.items():
        html = curl(f"{IOWA_BASE}{page}.html")
        cands: dict[int, str] = {}
        for link in re.findall(r'href="([^"]+\.aiff?)"', html, flags=re.I):
            m = re.search(rx, link.split("/")[-1])
            if m:
                cands[midi(m.group(1))] = link
        notes = sorted(n for n in cands if n <= top and (inst != "french_horn" or n >= 40))
        pick = {n for n in notes if (n - notes[0]) % step == 0} | {notes[-1]}
        for n in sorted(pick):
            get(urllib.parse.urljoin(IOWA_BASE, urllib.parse.quote(cands[n])), OUT / inst / f"{n}.aif")


def github_tree(repo: str) -> list[str]:
    return [x["path"] for x in json.loads(curl(f"https://api.github.com/repos/{repo}/git/trees/master?recursive=1"))["tree"]]


def github(repo: str, tree: list[str], inst: str, folder: str, rx: str, keep=lambda m: True) -> None:
    """File names carry the note name; the real pitch is measured again when the samples are built."""
    done: set[int] = set()
    for path in tree:
        if not path.startswith(folder):
            continue
        m = re.search(rx, path.split("/")[-1])
        if not m:
            continue
        n = midi(m.group(1))
        if n in done or not keep(n):
            continue
        done.add(n)
        get(f"https://raw.githubusercontent.com/{repo}/master/" + urllib.parse.quote(path), OUT / inst / f"{n}.wav")


if __name__ == "__main__":
    iowa()
    vcsl = github_tree("sgossner/VCSL")
    github("sgossner/VCSL", vcsl, "tenor_sax", "Aerophones/Reed Aerophones/Tenor Saxophone/Non-Vibrato/", r"BrettTenor_NV_Main_([A-G]#?\d)_vl3_rr1")
    github("sgossner/VCSL", vcsl, "recorder", "Aerophones/Edge-blown Aerophones/Baroque Soprano Recorder/Sustain/", r"SopRecorder_Sus_([A-G]#?\d)_rr1_Main")
    github("sgossner/VCSL", vcsl, "piano", "Chordophones/Zithers/Grand Piano, Steinway B/NoSus/", r"JHPiano_NoSus_Close_([A-G]#?\d)_vl3_rr1", keep=lambda n: 33 <= n <= 100)
    vsco = github_tree("sgossner/VSCO-2-CE")
    github("sgossner/VSCO-2-CE", vsco, "violin", "Strings/Solo Violin/Arco Vib/", r"LLVln_ArcoVib_([A-G]#?\d)_f\.wav")
    weresax = OUT.parent / "instrument_sources_raw" / "weresax"
    if not (weresax / "Samples" / "alto").is_dir():
        weresax.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "clone", "--depth", "1", "https://github.com/sfzinstruments/karoryfer.weresax", str(weresax)], check=True)
    print("done:", OUT)
