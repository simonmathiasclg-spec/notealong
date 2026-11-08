"""Find Creative Commons songs with vocals in the Internet Archive's mirror of Jamendo albums
and import them into the catalog.

    cd service && .venv/bin/python scripts/import_ia_jamendo.py --want 45 [--max-tries 160] [--dry-run]

Only albums whose Internet Archive record carries a CC BY or CC BY-SA licence URL are considered
(never NonCommercial or NoDerivatives). For each candidate album one track is picked and:
  1. downloaded from archive.org,
  2. screened: two 20-second excerpts are separated; albums without a clear singing voice are dropped,
  3. imported with notealong.catalog.import_cc (stems, notes, pYIN review, held notes, Whisper words),
  4. kept only if it has enough sung notes and the two pitch trackers agree well enough.
Every decision is appended to catalog/.cache/ia_import_log.jsonl. One song per artist; genres are
balanced. Nothing here needs an account or an API key.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unicodedata
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from notealong.config import CATALOG_DIR  # noqa: E402

CACHE = CATALOG_DIR / ".cache"
LOG = CACHE / "ia_import_log.jsonl"
DL = CACHE / "ia_downloads"

# Tags that suggest a song with singing, in the order used to name the genre.
GENRES = [
    ("soul", "Soul & R&B"), ("rnb", "Soul & R&B"), ("funk", "Soul & R&B"), ("blues", "Blues"), ("bluesrock", "Blues"),
    ("reggae", "Reggae"), ("latin", "Latin"), ("latinopop", "Latin"), ("bossanova", "Latin"), ("chansonfrancaise", "Chanson"),
    ("country", "Country"), ("folk", "Folk"), ("singersongwriter", "Acoustic"), ("acousticguitar", "Acoustic"), ("acoustic", "Acoustic"),
    ("jazz", "Jazz"), ("celtic", "World"), ("african", "World"), ("world", "World"),
    ("indie", "Indie"), ("indiepop", "Indie"), ("indierock", "Indie"), ("poprock", "Pop"), ("pop", "Pop"), ("ballad", "Pop"),
    ("rocknroll", "Rock"), ("classicrock", "Rock"), ("alternativerock", "Rock"), ("rock", "Rock"),
]
AVOID = {
    "instrumental", "ambient", "filmscore", "film", "cinematic", "soundtrack", "classical", "neoclassical", "newage", "techno", "trance",
    "house", "hiphop", "rap", "trap", "gangstarap", "metal", "heavymetal", "hardcore", "punk", "experimental", "8bit", "chillout", "lounge",
    "downtempo", "dubstep", "drumnbass", "industrial", "darkambient", "drone", "soundscape", "corporate", "meditative", "videogame",
    "edm", "synthwave", "psytrance", "improvisation", "avantgarde", "noise", "electronic", "electronica", "dance", "acidhouse", "deephouse",
    "minimal", "breakbeat", "idm", "abstract", "horror", "grindcore", "deathmetal", "blackmetal", "electrohouse", "progressivehouse",
    "eurodance", "ebm", "darkwave", "postrock", "spacerock", "chillhop", "lofi", "triphop", "orchestra", "symphonic", "piano", "computer",
}
BAD_TITLE = re.compile(r"instrumental|intro\b|outro\b|interlude|remix|\blive\b|cover|karaoke|\bversion\b|demo|\bedit\b|reprise|skit|prelude|"
                       r"\bby\b|\(.*\b(dion|beatles|sinatra|adele|jackson|elvis|madonna|beyonc|rihanna|coldplay|queen|abba|bowie|lennon|dylan|"
                       r"marley|springsteen|cohen|mercury|eagles|u2|radiohead|nirvana|oasis|sting|prince)\b.*\)|"
                       r"\b(dion|beatles|sinatra|adele|michael jackson|elvis|madonna|beyonc|rihanna|coldplay|abba|bowie|lennon|bob dylan|"
                       r"bob marley|springsteen|leonard cohen|radiohead|nirvana|oasis|whitney|mariah|shakira|ed sheeran|bruno mars|lady gaga|"
                       r"taylor swift|justin bieber|eminem|drake|metallica|pink floyd|led zeppelin|rolling stones|tributo|homenaje|versione|reprise)\b|"
                       r"playback|backing|acapella|a cappella|feat\.|\bft\.|tribute|medley|\btheme\b|\bost\b|soundtrack|mashup|bootleg|"
                       r"loops|samples|\bvol\b|karaoke|sample pack", re.I)
# Albums that carry a CC licence on Jamendo but are by well-known signed artists or are plainly other people's songs:
# the uploader may not have had the right to grant that licence, so they are never used.
BLOCKED = {"jamendo-302551", "jamendo-354187", "jamendo-408172", "jamendo-129588", "jamendo-176504", "jamendo-142086", "jamendo-231795", "jamendo-566980", "jamendo-211902", "jamendo-115079", "jamendo-489247", "jamendo-114476"}
PER_GENRE = {"Pop": 9, "Rock": 8, "Folk": 7, "Acoustic": 7, "Soul & R&B": 6, "Latin": 6, "Indie": 5, "Blues": 4, "Reggae": 4,
             "Country": 4, "Chanson": 5, "Jazz": 3, "World": 4}


def slug(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def curl_json(url: str, params: dict | None = None):
    cmd = ["curl", "-sS", "-L", "--fail", "-m", "90", "-G", url]
    for k, v in (params or {}).items():
        for item in (v if isinstance(v, list) else [v]):
            cmd += ["--data-urlencode", f"{k}={item}"]
    return json.loads(subprocess.run(cmd, capture_output=True, text=True, check=True).stdout)


def licence_from_url(url: str) -> tuple[str, str] | None:
    """('CC BY-SA 3.0', canonical url) for by / by-sa licences only."""
    m = re.search(r"creativecommons\.org/licenses/(by|by-sa)/(\d\.\d)(?:/([a-z]{2,5}))?/?", url or "")
    if not m:
        return None
    kind, version, port = m.groups()
    name = f"CC {kind.upper()} {version}" + (f" {port.upper()}" if port else "")
    canonical = f"https://creativecommons.org/licenses/{kind}/{version}/" + (f"{port}/" if port else "")
    return name, canonical


def search(licence: str, rows: int) -> list[dict]:
    q = f"collection:jamendo-albums AND licenseurl:*licenses\\/{licence}\\/*"
    res = curl_json("https://archive.org/advancedsearch.php", {
        "q": q, "fl[]": ["identifier", "title", "creator", "licenseurl", "subject", "downloads", "date"],
        "sort[]": "downloads desc", "rows": str(rows), "output": "json"})
    return res["response"]["docs"]


def genre_of(subjects: list[str]) -> str | None:
    tags = {s.lower() for s in subjects}
    if tags & AVOID:
        return None
    for tag, genre in GENRES:
        if tag in tags:
            return genre
    return None


def seconds(v) -> float:
    try:
        if isinstance(v, (int, float)):
            return float(v)
        if ":" in str(v):
            parts = [float(p) for p in str(v).split(":")]
            return sum(p * 60 ** i for i, p in enumerate(reversed(parts)))
        return float(v)
    except Exception:
        return 0.0


def pick_track(meta: dict) -> dict | None:
    files = [f for f in meta.get("files", []) if f.get("format") in ("VBR MP3", "MP3", "128Kbps MP3", "64Kbps MP3") and f.get("name", "").lower().endswith(".mp3")]
    best = None
    for f in sorted(files, key=lambda f: (seconds(f.get("track", "99").split("/")[0]) if str(f.get("track", "")).strip() else 99, f["name"])):
        title = f.get("title") or Path(f["name"]).stem
        dur = seconds(f.get("length", 0))
        if not (130 <= dur <= 290) or BAD_TITLE.search(title) or BAD_TITLE.search(f["name"]):
            continue
        best = {"name": f["name"], "title": re.sub(r"^\d+\s*[-.]\s*", "", title).strip(), "duration": dur, "artist": f.get("artist") or f.get("creator")}
        who = str(best["artist"] or meta.get("metadata", {}).get("creator") or "")
        if who:
            t = re.sub(rf"^{re.escape(who)}\s*[-:]\s*", "", best["title"], flags=re.I)
            t = re.sub(rf"\s*-\s*{re.escape(who)}$", "", t, flags=re.I)
            best["title"] = t.strip() or best["title"]
        break
    return best


def vocal_presence(mp3: Path) -> float:
    """Share of two 20-second excerpts in which the separated voice is clearly present."""
    import numpy as np
    import soundfile as sf
    from notealong.pipeline import audio as audio_mod
    from notealong.pipeline.stems import separate
    dur = audio_mod.probe(mp3)["duration"]
    shares = []
    with tempfile.TemporaryDirectory() as td:
        for k, pos in enumerate((0.36, 0.64)):
            clip = Path(td) / f"clip{k}.wav"
            audio_mod.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{dur * pos:.1f}", "-t", "20", "-i", str(mp3), "-ar", "44100", "-ac", "2", str(clip)])
            paths = separate(clip, Path(td) / f"s{k}")
            v, sr = sf.read(str(paths["vocals"]), dtype="float32", always_2d=True)
            b, _ = sf.read(str(paths["backing"]), dtype="float32", always_2d=True)
            win = int(0.5 * sr)
            n = len(v) // win
            vr = np.sqrt((v[: n * win].reshape(n, win, -1) ** 2).mean(axis=(1, 2)))
            br = np.sqrt((b[: n * win].reshape(n, win, -1) ** 2).mean(axis=(1, 2)))
            present = (vr > 0.012) & (vr > 0.25 * (br + 1e-6))
            shares.append(float(present.mean()))
    return round(sum(shares) / len(shares), 2)


def judge(meta: dict, song: dict) -> str | None:
    """None if the imported song is good enough, otherwise the reason it is dropped."""
    notes, words, dur = song["notes"], song["words"], song["duration"]
    review = meta.get("review", {})
    if len(notes) < 90 or len(words) < 50:
        return f"too little singing ({len(notes)} notes, {len(words)} words)"
    if len(words) / dur > 3.0:
        return f"spoken or rapped ({len(words) / dur:.1f} words per second)"
    pitches = sorted(n["midi"] for n in notes)
    if len(set(pitches)) < 6 or pitches[int(len(pitches) * 0.9)] - pitches[int(len(pitches) * 0.1)] < 5:
        return "almost no melodic movement (chanted or rapped)"
    checked = max(1, review.get("checked", 1))
    if review.get("dropped", 0) / checked > 0.22:
        return f"the second pitch tracker rejected {review.get('dropped', 0)} of {checked} notes (poor separation)"
    if (review.get("octave_fixed", 0) + review.get("pitch_fixed", 0)) / checked > 0.45:
        return "the two pitch trackers disagree on too many notes"
    sung = sum(n["end"] - n["start"] for n in notes)
    if sung / dur < 0.14:
        return f"only {sung / dur:.0%} of the track is sung"
    prob = meta.get("language_probability")
    if prob is not None and prob < 0.5:
        return f"language unclear (probability {prob:.2f})"
    return None


def log(entry: dict) -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--want", type=int, default=45)
    ap.add_argument("--max-tries", type=int, default=200)
    ap.add_argument("--rows", type=int, default=6000)
    ap.add_argument("--dry-run", action="store_true", help="list the candidates and stop")
    ap.add_argument("--shard", default="0/1", help="k/n: handle only the k-th of n slices of the candidates, to run several importers at once")
    ap.add_argument("--genres", default=None, help="comma-separated genres to look for (others are skipped), e.g. 'Pop,Soul & R&B,Acoustic,Latin'")
    ap.add_argument("--cap", type=int, default=None, help="with --genres: how many more songs of each of those genres may be added")
    a = ap.parse_args()

    from notealong.catalog import import_cc
    from notealong.catalog.build import write_index

    seen_ids, seen_artists, per_genre = set(), set(), {}
    done = 0
    if LOG.exists():
        for line in LOG.read_text(encoding="utf-8").splitlines():
            e = json.loads(line)
            seen_ids.add(e["identifier"])
            if e.get("decision") == "added":
                seen_artists.add(slug(e.get("artist", "")))
                per_genre[e["genre"]] = per_genre.get(e["genre"], 0) + 1
                done += 1
    for d in CATALOG_DIR.iterdir():        # artists already in the catalog
        mp = d / "catalog.json"
        if mp.exists():
            seen_artists.add(slug(json.loads(mp.read_text(encoding="utf-8")).get("artist", "")))

    docs = []
    for lic in ("by", "by-sa"):
        docs += search(lic, a.rows)
    cands = []
    for d in docs:
        subs = d.get("subject", [])
        subs = [subs] if isinstance(subs, str) else subs
        genre = genre_of(subs)
        lic = licence_from_url(d.get("licenseurl", ""))
        if genre and lic and d["identifier"] not in seen_ids and d["identifier"] not in BLOCKED and not BAD_TITLE.search(d.get("title") or ""):
            cands.append({**d, "genre": genre, "licence": lic, "subjects": subs})
    # most downloaded first, interleaved by genre so the catalog stays varied
    by_genre: dict[str, list] = {}
    for c in cands:
        by_genre.setdefault(c["genre"], []).append(c)
    order = []
    while any(by_genre.values()):
        for g in list(by_genre):
            if by_genre[g]:
                order.append(by_genre[g].pop(0))
    print(f"{len(order)} candidate albums ({ {g: sum(1 for c in order if c['genre'] == g) for g in PER_GENRE} })", flush=True)
    if a.dry_run:
        for c in order[:40]:
            print(c["identifier"], c["genre"], c["licence"][0], c.get("creator"), "|", c.get("title"))
        return 0

    import math
    import zlib
    k, n = (int(x) for x in a.shard.split("/"))
    order = [c for c in order if zlib.crc32(c["identifier"].encode()) % n == k]
    caps = {g: math.ceil(v / n) for g, v in PER_GENRE.items()}
    done = 0 if n > 1 else done                      # with shards, --want counts this process's own additions
    per_genre = {} if n > 1 else per_genre
    if a.genres:
        wanted = [g.strip() for g in a.genres.split(",") if g.strip()]
        order = [c for c in order if c["genre"] in wanted]
        caps = {g: per_genre.get(g, 0) + (a.cap or a.want) for g in wanted}
        done = 0
    tries = 0
    for c in order:
        if done >= a.want or tries >= a.max_tries:
            break
        genre = c["genre"]
        artist = c.get("creator") if isinstance(c.get("creator"), str) else (c.get("creator") or ["?"])[0]
        if per_genre.get(genre, 0) >= caps.get(genre, 2) or slug(artist) in seen_artists:
            continue
        tries += 1
        ident = c["identifier"]
        entry = {"identifier": ident, "artist": artist, "album": c.get("title"), "genre": genre, "licence": c["licence"][0], "licenseurl": c.get("licenseurl")}
        try:
            meta = curl_json(f"https://archive.org/metadata/{ident}")
            # the licence is read again from the item's own record, not just from the search result
            lic = licence_from_url(meta.get("metadata", {}).get("licenseurl", ""))
            if not lic:
                log({**entry, "decision": "skipped", "reason": "no CC BY / BY-SA licence on the item record"})
                continue
            track = pick_track(meta)
            if not track:
                log({**entry, "decision": "skipped", "reason": "no track of a usable length and title"})
                continue
            album = re.sub(r"^.*? - ", "", c.get("title") or "", count=1) or None
            DL.mkdir(parents=True, exist_ok=True)
            mp3 = DL / f"{ident}.mp3"
            if not mp3.exists():
                url = f"https://archive.org/download/{ident}/{urllib.parse.quote(track['name'])}"
                subprocess.run(["curl", "-sS", "-L", "--fail", "-m", "300", "-o", str(mp3), url], check=True)
                time.sleep(1.0)
            entry.update({"title": track["title"], "file": track["name"], "duration": track["duration"]})
            presence = vocal_presence(mp3)
            entry["vocal_presence"] = presence
            if presence < 0.2:
                log({**entry, "decision": "skipped", "reason": f"little or no singing in the excerpts ({presence:.0%})"})
                print(f"-- {ident} {artist} - {track['title']}: no clear vocals ({presence:.0%})", flush=True)
                mp3.unlink(missing_ok=True)
                continue
            sid = slug(f"{artist} {track['title']}")[:60].strip("-") or slug(ident)   # titles with no Latin letters
            source = f"https://archive.org/details/{ident}"
            args = import_cc.build_parser().parse_args([
                "--audio", str(mp3), "--id", sid, "--title", track["title"], "--artist", artist, "--source-url", source,
                "--licence", lic[0], "--licence-url", lic[1], "--genre", genre, "--language", "auto", "--tags", ",".join(["jamendo"] + [s.lower() for s in c["subjects"] if s.lower() not in ("album", "single")][:6]),
                "--no-index", *(["--album", album] if album else []),
                "--attribution", f'"{track["title"]}" by {artist}' + (f', from the album "{album}"' if album else "") + f". {lic[0]}. Published on Jamendo (album {ident.split('-')[-1]}); downloaded from the Internet Archive.",
            ])
            t0 = time.time()
            m = import_cc.run(args)
            song = json.loads((CATALOG_DIR / sid / "song.json").read_text(encoding="utf-8"))
            reason = judge(m, song)
            entry.update({"id": sid, "seconds_taken": round(time.time() - t0), "notes": len(song["notes"]), "words": len(song["words"]),
                          "language": m.get("language"), "review": m.get("review"), "difficulty": m.get("difficulty")})
            if reason:
                shutil.rmtree(CATALOG_DIR / sid, ignore_errors=True)
                log({**entry, "decision": "rejected", "reason": reason})
                print(f"-- {sid}: rejected, {reason}", flush=True)
                continue
            done += 1
            per_genre[genre] = per_genre.get(genre, 0) + 1
            seen_artists.add(slug(artist))
            log({**entry, "decision": "added"})
            print(f"++ [{done}/{a.want}] {sid}: {genre}, {m.get('language')}, {len(song['notes'])} notes, {len(song['words'])} words, {lic[0]}", flush=True)
            write_index()
        except (Exception, SystemExit) as e:   # one bad album must not stop the run
            log({**entry, "decision": "error", "reason": f"{type(e).__name__}: {str(e)[:200]}"})
            print(f"!! {ident}: {type(e).__name__}: {str(e)[:160]}", flush=True)
    write_index()
    print(f"added {done} songs after {tries} tries; by genre {per_genre}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
