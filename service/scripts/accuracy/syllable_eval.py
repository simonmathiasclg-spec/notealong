"""Score a song's notes against human-written letter notes: does every sung syllable get the right note?

Human letter-note transcriptions (the kind found on letter-note sites) are what NoteAlong wants to produce:
one note per syllable, in the song's key. They live only in the gitignored test-recordings/human/ folder
and are never committed or shipped. This script reads them, lines their words up with ours, undoes the
transposition and octave they were written in, and reports:

  syll        per-syllable accuracy: of the human's notes, the share we show on the same word (or, where the
              page does not group notes by word, in the same line) with the right note name, counting each of
              our extra notes against us: sum(LCS) / sum(max(human, ours))
  recall      the same without the penalty for extra notes: sum(LCS) / sum(human)
  word_exact  share of words whose notes are exactly the human's (pages that group notes by word)
  notes_ratio our notes per human note on the compared words (1.0 = as simple as the human)
  key         the detected key against the song's real key
  onset       median start error in ms against the sax-cover answer key, where there is one

    .venv/bin/python scripts/accuracy/syllable_eval.py [--method current|sax|detailed] [--json out.json] [--song slug]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

TEST = ROOT.parent / "test-recordings"
HUMAN = TEST / "human"
LIB = ROOT.parent / "library"
PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]

# slug -> where the song is, and its real key as (tonic pitch class, mode); a second entry is also accepted
SONGS: dict[str, dict] = {
    "let-it-be": {"dir": LIB / "the-beatles-128k-cc6e35", "key": [(0, "major")]},
    "just-give-me-a-reason": {"dir": LIB / "just-give-me-a-reason-official-video-ft--da3c42", "key": [(7, "major")]},
    "despacito": {"dir": LIB / "despacito-ft-daddy-yankee-luisfonsivevo-dec768", "key": [(11, "minor")],
                  "cover": TEST / "despacito-ft-daddy-yankee-luisfonsivevo-dec768-answer-key.json"},
    "someone-like-you": {"key": [(9, "major")]},
    "perfect": {"key": [(8, "major")]},
    "halo": {"key": [(9, "major")]},
    "shape-of-you": {"key": [(1, "minor")]},
    "blinding-lights": {"key": [(5, "minor")]},
    "wonderwall": {"key": [(6, "minor")]},
    "dynamite": {"key": [(4, "major"), (1, "minor")]},
    "tum-hi-ho": {"key": [(6, "minor"), (9, "major"), (5, "minor"), (8, "major")]},
    "vivir-mi-vida": {"key": [(0, "minor")]},
}
for _slug, _s in SONGS.items():
    _s.setdefault("dir", TEST / "library" / _slug)
    _s.setdefault("cover", TEST / "popular" / _slug / "answer-key.json")

PARAMS = None        # SaxParams to try instead of the defaults (set by the experiment scripts)

_NOTE = re.compile(r"([_.^*]*)([A-G])([#b]?)(\d?)([#b]?)(\*?)")


def _parse_token(tok: str) -> list[int] | None:
    """Notes in one token of a note line (a token may hold several, joined by '-' or run together)."""
    t = re.sub(r"[()~|,]", "", tok)
    if not t:
        return []
    out = []
    for part in t.split("-"):
        if not part:
            continue
        pos = 0
        for m in _NOTE.finditer(part):
            if m.start() != pos:
                return None
            pos = m.end()
            pre, letter, acc1, digit, acc2, post = m.groups()
            acc = acc1 or acc2
            octave = 4 + pre.count("^") + 2 * pre.count("*") - pre.count(".") - 2 * pre.count("_")
            octave += (int(digit) - 1) if digit else 0
            octave += 1 if post else 0
            out.append(12 * (octave + 1) + PC[letter] + (1 if acc == "#" else -1 if acc == "b" else 0))
        if pos != len(part):
            return None
    return out


def _note_line(line: str) -> list[list[int]] | None:
    """The note groups of a line, or None when it is not a line of notes."""
    line = re.sub(r"\s*-\s*", "-", line.strip())
    toks = line.split()
    if not toks:
        return None
    groups = []
    for t in toks:
        g = _parse_token(t)
        if g is None:
            return None
        if g:
            groups.append(g)
    return groups or None


def norm(word: str) -> str:
    w = unicodedata.normalize("NFKD", word.lower())
    w = "".join(c for c in w if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]", "", w.replace("’", "'").replace("'", ""))


def parse_human(path: Path) -> list[dict]:
    """[{words: [..], groups: [[midi..]..], by_word: bool}] for each line of lyrics that has notes."""
    text = path.read_text()
    head = "\n".join(l for l in text.splitlines() if l.startswith("# "))
    lyric_first = "REVERSED" in head
    body = [l for l in text.splitlines() if not l.startswith("#") and l.strip() and not re.fullmatch(r"\s*\[.*\]\s*", l)]
    out = []
    i = 0
    while i < len(body) - 1:
        a, b = body[i], body[i + 1]
        notes, lyric = (_note_line(b), a) if lyric_first else (_note_line(a), b)
        if notes is None or _note_line(lyric) is not None:
            i += 1
            continue
        words = [w for w in (norm(x) for x in re.split(r"[\s_]+", lyric)) if w]
        if words:
            out.append({"words": words, "groups": notes, "by_word": len(notes) == len(words)})
        i += 2
    return out


def _lcs(a: list[int], b: list[int]) -> int:
    if not a or not b:
        return 0
    prev = [0] * (len(b) + 1)
    for x in a:
        cur = [0]
        for j, y in enumerate(b):
            cur.append(prev[j] + 1 if x == y else max(prev[j + 1], cur[j]))
        prev = cur
    return prev[-1]


def compare(human: list[dict], song: dict) -> dict:
    words = song.get("words", [])
    ours = [norm(w.get("roman") or w["text"]) or norm(w["text"]) for w in words]
    by_word: dict[str, list[dict]] = {}
    for n in sorted(song.get("notes", []), key=lambda n: n["start"]):
        if n.get("word"):
            by_word.setdefault(n["word"], []).append(n)
    flat = [(li, wi, w) for li, l in enumerate(human) for wi, w in enumerate(l["words"])]
    sm = SequenceMatcher(a=[f[2] for f in flat], b=ours, autojunk=False)
    match: dict[tuple[int, int], int] = {}
    for blk in sm.get_matching_blocks():
        if blk.size < 2:                       # single matching words are too easily the wrong place
            continue
        for k in range(blk.size):
            li, wi, _ = flat[blk.a + k]
            match[(li, wi)] = blk.b + k
    # units to compare: a word (pages that group by word) or a whole line
    units: list[tuple[list[int], list[int], bool]] = []
    for li, l in enumerate(human):
        hit = [match.get((li, wi)) for wi in range(len(l["words"]))]
        if l["by_word"]:
            for wi, j in enumerate(hit):
                if j is not None:
                    units.append((l["groups"][wi], [n["midi"] for n in by_word.get(words[j]["id"], [])], True))
        else:
            found = [j for j in hit if j is not None]
            if len(found) < max(2, 0.6 * len(hit)) or found[-1] - found[0] > 2 * len(hit):
                continue
            t0, t1 = words[found[0]]["start"], words[found[-1]]["end"]
            ids = {words[j]["id"] for j in range(found[0], found[-1] + 1)}
            mine = [n["midi"] for n in sorted(song.get("notes", []), key=lambda n: n["start"])
                    if n.get("word") in ids or (not n.get("word") and t0 <= n["start"] < t1)]
            units.append(([m for g in l["groups"] for m in g], mine, False))
    best = None
    for shift in range(12):
        lcs = sum(_lcs([(m + shift) % 12 for m in h], [m % 12 for m in o]) for h, o, _ in units)
        if best is None or lcs > best[0]:
            best = (lcs, shift)
    lcs, shift = best or (0, 0)
    n_h = sum(len(h) for h, _, _ in units)
    n_o = sum(len(o) for _, o, _ in units)
    denom = sum(max(len(h), len(o)) for h, o, _ in units)
    wordy = [(h, o) for h, o, w in units if w]
    exact = sum(1 for h, o in wordy if [(m + shift) % 12 for m in h] == [m % 12 for m in o])
    return {
        "human_notes": n_h, "our_notes": n_o, "units": len(units), "words_matched": len(match), "human_words": len(flat),
        "shift": shift, "syll": lcs / max(1, denom), "recall": lcs / max(1, n_h),
        "word_exact": exact / len(wordy) if wordy else None, "notes_ratio": n_o / max(1, n_h),
    }


def key_check(song: dict, accepted: list[tuple[int, str]]) -> dict:
    k = song.get("key") or {}
    got = (k.get("tonic"), k.get("mode"))
    ok = got in [tuple(a) for a in accepted]
    rel = any((a[0] + (9 if a[1] == "major" else 3)) % 12 == got[0] and a[1] != got[1] for a in accepted[:1])
    want = f"{NAMES[accepted[0][0]]} {accepted[0][1]}"
    return {"detected": k.get("name"), "expected": want, "ok": ok, "relative": bool(rel and not ok)}


def onset_check(song: dict, cover: Path) -> dict | None:
    if not cover.exists():
        return None
    from evaluate import metrics
    key = json.loads(cover.read_text())
    ref = key.get("notes") or []
    if not ref:
        return None
    m = metrics(ref, song.get("notes", []))
    return {"onset_med": m["onset_med"], "onset_bias": m["onset_bias"], "f1_pc": m["f1_pc"], "frames_pc": m["frames_pc"], "held_one": m["held_one"]}


def load_song(slug: str, method: str) -> dict | None:
    d = SONGS[slug]["dir"]
    f = d / "song.json"
    if not f.exists():
        return None
    song = json.loads(f.read_text())
    if method == "current":
        return song
    if method.startswith("file:"):                 # a saved copy, e.g. the baseline
        g = Path(method[5:]) / f"{slug}.json"
        return json.loads(g.read_text()) if g.exists() else None
    from notealong.pipeline.saxmelody import sax_song
    return sax_song(d, song, detailed=(method == "detailed"), p=PARAMS)


def evaluate(slug: str, method: str = "current") -> dict | None:
    song = load_song(slug, method)
    if song is None:
        return None
    out: dict = {"slug": slug, "notes": len(song.get("notes", [])), "words": len(song.get("words", []))}
    hf = HUMAN / f"{slug}.txt"
    human = parse_human(hf) if hf.exists() else []
    if human:
        out.update(compare(human, song))
    out["key"] = key_check(song, SONGS[slug]["key"])
    out["cover"] = onset_check(song, SONGS[slug]["cover"])
    return out


def table(rows: list[dict]) -> str:
    lines = ["| Song | Syllables right | Without extra-note penalty | Words exactly right | Notes per human note | Key detected | Start error (ms) |",
             "|---|---|---|---|---|---|---|"]
    pct = lambda v: "n/a" if v is None else f"{100 * v:.0f}%"   # noqa: E731
    for r in rows:
        k = r["key"]
        key = f"{k['detected']} ({'right' if k['ok'] else 'relative of ' + k['expected'] if k['relative'] else 'wrong, is ' + k['expected']})"
        c = r.get("cover")
        onset = f"{c['onset_med']:.0f}" if c else "n/a"
        if r.get("units", 0) > 0 and r.get("human_notes", 0) >= 20:
            lines.append(f"| {r['slug']} | {pct(r['syll'])} | {pct(r['recall'])} | {pct(r.get('word_exact'))} | {r['notes_ratio']:.2f} | {key} | {onset} |")
        else:
            lines.append(f"| {r['slug']} | n/a | n/a | n/a | n/a | {key} | {onset} |")
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--method", default="current")
    ap.add_argument("--song", action="append")
    ap.add_argument("--json")
    a = ap.parse_args()
    rows = []
    for slug in a.song or list(SONGS):
        r = evaluate(slug, a.method)
        if r is None:
            print(f"{slug}: not processed here", file=sys.stderr)
            continue
        rows.append(r)
        print(json.dumps(r), file=sys.stderr)
    print(table(rows))
    if a.json:
        Path(a.json).parent.mkdir(parents=True, exist_ok=True)
        Path(a.json).write_text(json.dumps(rows, indent=1))


if __name__ == "__main__":
    main()
