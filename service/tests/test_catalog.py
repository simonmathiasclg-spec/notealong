"""Catalog: the song text format, the arranger timeline, the read-only overlay and the API."""
import json

import pytest
from fastapi.testclient import TestClient

from notealong import config, library
from notealong.catalog.dsl import SongFormatError, parse_song
from notealong.catalog.arrange import Arranger
from notealong.catalog.difficulty import rate_difficulty
from notealong.catalog.cover import cover_svg

SONG = """title: Test Tune
artist: Traditional
genre: Folk
key: G major
tempo: 120
meter: 4/4
pickup: 1
intro: 1

chords:
| G | D7 | G C | G |

melody:
Hel-lo there my friend
D4 G4 G4 A4(2) ~B4(2) G4(2) ~A4(4)
"""


def test_parse_song_counts_syllables_and_bars():
    spec = parse_song(SONG, "test-tune")
    assert [w.text for w in spec.words] == ["Hello", "there", "my", "friend"]
    assert len(spec.melody) == 7 and spec.melody[0].syllable == "Hel" and spec.melody[-1].syllable is None
    assert spec.words[2].notes == [3, 4]              # "my" has the slurred second note
    assert spec.melody_beats == 13 and spec.pickup == 1
    assert not [w for w in spec.warnings if "whole number" in w]
    assert spec.chords[2].root == 7 and spec.chords[2].beats == 2   # "G C" splits the bar


def test_parse_song_rejects_mismatch():
    with pytest.raises(SongFormatError):
        parse_song(SONG.replace("G4(2) ~A4(4)", ""), "x")      # fewer notes than syllables
    with pytest.raises(SongFormatError):
        parse_song(SONG.replace("| G | D7 | G C | G |", "| G | D7 | G C D | G |"), "x")   # 3 chords in 4/4


def test_original_script_line():
    text = SONG.replace("Hel-lo there my friend\n", "Hel-lo there my friend\n= 你好 那里 我的 朋友\n")
    spec = parse_song(text, "x")
    assert spec.words[0].original == "你好" and spec.words[0].text == "Hello"


def test_arranger_timeline_and_melody_times():
    spec = parse_song(SONG, "test-tune")
    arr = Arranger(spec)
    beat = 0.5
    # every song gets an instrumental intro: two bars when a bar is 2 seconds long
    assert arr.intro_bars == 2
    assert arr.bar1 == pytest.approx(2 * 4 * beat)
    assert arr.melody_start == pytest.approx(arr.bar1 - beat)   # pickup one beat before bar 1
    times = arr.melody_times()
    assert times[0][0] == pytest.approx(arr.melody_start) and times[0][2] == 62
    # intro 2 bars + 3 melody bars (13 beats - 1 pickup = 12) + 1 outro bar
    assert arr.total_seconds() == pytest.approx((2 + 3 + 1) * 4 * beat)
    # the chord timeline covers the whole track without gaps
    tl = arr.chord_timeline()
    assert tl[0][0] == 0 and tl[-1][1] == pytest.approx(arr.total_seconds())
    assert all(abs(a[1] - b[0]) < 1e-6 for a, b in zip(tl, tl[1:]))


def _band(style: str, meter: str = "4/4"):
    text = SONG.replace("genre: Folk", f"genre: Folk\nstyle: {style}")
    arr = Arranger(parse_song(text, "test-tune"))
    assert arr.style_name == style
    return arr


def test_every_style_is_a_full_band_that_never_plays_outside_the_track():
    from notealong.catalog.arrange import STYLES
    for name in STYLES:
        arr = _band(name)
        band = arr.band()
        roles = {part.role for part, _ in band}
        assert len(band) >= 3, name
        assert "bass" in roles and ("comp" in roles), name
        for part, inst in band:
            assert inst.notes, (name, part.name)
            assert all(0 <= n.start < n.end for n in inst.notes), (name, part.name)
            assert max(n.end for n in inst.notes) <= arr.total_seconds() + 0.5, (name, part.name)
            assert all(1 <= n.velocity <= 127 for n in inst.notes)


def test_intro_plays_before_the_melody_and_the_band_never_doubles_it():
    arr = _band("swing")
    first_note = arr.melody_start
    assert first_note >= 2.0                       # room to hear the groove first
    band = arr.band()
    for part, inst in band:
        if part.role in ("bass", "perc", "comp"):
            assert min(n.start for n in inst.notes) < 0.2, part.name    # the rhythm section is there from the top
    # the accompaniment stays under the melody: chord parts are voiced below the top of the tune
    top = max(m for (_, _, m) in arr.melody_times())
    for part, inst in band:
        if part.role in ("comp", "pad", "bass"):
            assert max(n.pitch for n in inst.notes) <= top + 2, part.name


def test_bass_walks_and_arrangement_is_humanised_but_repeatable():
    a, b = _band("swing"), _band("swing")
    bass_a = next(inst for part, inst in a.band() if part.role == "bass")
    bass_b = next(inst for part, inst in b.band() if part.role == "bass")
    assert [(n.pitch, n.start) for n in bass_a.notes] == [(n.pitch, n.start) for n in bass_b.notes]   # same seed, same track
    assert len({n.pitch for n in bass_a.notes}) >= 4                       # it moves, it does not sit on the root
    grid = [round((n.start - a.bar1) / a.pulse_len) * a.pulse_len + a.bar1 for n in bass_a.notes]
    offs = [abs(n.start - g) for n, g in zip(bass_a.notes, grid)]
    assert 0 < max(offs) < 0.03                                            # loose, but never sloppy


def test_fills_mark_the_sections():
    arr = _band("gospel")
    assert arr.is_fill(-1) and arr.is_fill(arr.song_bars - 1)
    drums = next(inst for part, inst in arr.band() if part.role == "perc")
    from notealong.catalog.arrange import CRASH
    crashes = [n.start for n in drums.notes if n.pitch == CRASH]
    assert any(abs(t - arr.bar_start(0)) < 0.05 for t in crashes)          # a crash where the tune comes in
    assert any(abs(t - arr.bar_start(arr.song_bars)) < 0.05 for t in crashes)   # and on the final chord


def test_compound_and_triple_metre_patterns():
    waltz = """title: Three
genre: Folk
style: waltz
key: C major
tempo: 120
meter: 3/4
pickup: 0

chords:
| C | G7 | C | C |

melody:
One two three and four
C4 D4 E4 F4(3) G4(6)
"""
    arr = Arranger(parse_song(waltz, "three"))
    assert arr.pulses == 3 and not arr.compound and len(arr.band()) >= 3
    jig = waltz.replace("meter: 3/4", "meter: 6/8").replace("tempo: 120", "tempo: 240").replace("style: waltz", "style: celtic")
    arr = Arranger(parse_song(jig, "six"))
    assert arr.compound and arr.pulses == 2 and arr.pulse_len == pytest.approx(0.75)
    assert arr.off == pytest.approx(2 / 3)
    assert len(arr.band()) >= 3


def test_difficulty_and_cover():
    easy = [{"midi": 60 + d, "start": i * 0.6, "end": i * 0.6 + 0.5} for i, d in enumerate([0, 0, 7, 7, 9, 9, 7])]
    assert rate_difficulty(easy)[0] == "easy"
    hard = [{"midi": 55 + (i * 7) % 19, "start": i * 0.15, "end": i * 0.15 + 0.1} for i in range(40)]
    assert rate_difficulty(hard)[0] == "hard"
    svg = cover_svg("a-song", "Folk", "A song")
    assert svg.startswith("<svg") and "radialGradient" in svg and cover_svg("a-song", "Folk", "A song") == svg
    assert cover_svg("other-song", "Folk") != svg


@pytest.fixture
def catalog_client(tmp_path, monkeypatch):
    lib = tmp_path / "library"
    cat = tmp_path / "catalog"
    lib.mkdir(); cat.mkdir()
    monkeypatch.setattr(config, "LIBRARY_DIR", lib)
    monkeypatch.setattr(library, "LIBRARY_DIR", lib)
    monkeypatch.setattr(config, "CATALOG_DIR", cat)
    monkeypatch.setattr(library, "CATALOG_DIR", cat)
    from notealong import jobs, main
    monkeypatch.setattr(jobs, "TIMINGS_FILE", lib / ".timings.json")
    from notealong.schemas import Song, Word, Note, Line
    s = Song(id="test-tune", title="Test Tune", artist="Traditional", duration=10.0, created_at=library.now_iso(),
             updated_at=library.now_iso(), status="ready", source={"kind": "catalog"},
             files={"original": "backing.mp3", "backing": "backing.mp3", "vocals": "vocals.mp3"})
    s.words = [Word(id="w1", text="hello", start=1.0, end=1.5, line=0)]
    s.lines = [Line(index=0, kind="lyric", start=1.0, end=1.5)]
    s.notes = [Note(id="n1", start=1.0, end=1.5, midi=60, word="w1", line=0)]
    (cat / "test-tune").mkdir()
    (cat / "test-tune" / "song.json").write_text(s.model_dump_json())
    (cat / "test-tune" / "cover.svg").write_text(cover_svg("test-tune"))
    (cat / "catalog.json").write_text(json.dumps({"version": 1, "songs": [
        {"id": "test-tune", "title": "Test Tune", "artist": "Traditional", "genre": "Folk", "difficulty": "easy", "duration": 10.0,
         "licence": {"name": "Public domain", "url": None}, "attribution": "Traditional.", "cover": "cover.svg", "access": "free"}]}))
    return TestClient(main.app)


def test_catalog_index_and_song(catalog_client):
    c = catalog_client
    idx = c.get("/api/catalog").json()
    assert [s["id"] for s in idx["songs"]] == ["test-tune"] and idx["songs"][0]["cover_url"].endswith("/cover")
    assert c.get("/api/catalog/test-tune/cover").headers["content-type"].startswith("image/svg+xml")
    body = c.get("/api/songs/test-tune").json()
    assert body["catalog"]["attribution"] == "Traditional." and body["notes"][0]["midi"] == 60
    assert c.get("/api/songs").json() == []                # catalog songs are not "my songs"
    assert c.get("/api/me").json()["uploads"]["limit"] is None


def test_catalog_edits_are_an_overlay(catalog_client):
    c = catalog_client
    notes = c.get("/api/songs/test-tune").json()["notes"]
    notes[0]["midi"] = 62
    r = c.patch("/api/songs/test-tune", json={"notes": notes, "user": {"instrument": "flute"}})
    assert r.status_code == 200 and r.json()["notes"][0]["midi"] == 62 and r.json()["user"]["instrument"] == "flute"
    shipped = json.loads((config.CATALOG_DIR / "test-tune" / "song.json").read_text())
    assert shipped["notes"][0]["midi"] == 60
    overlay = json.loads(library.overlay_path("test-tune").read_text())
    assert overlay["notes"][0]["midi"] == 62 and overlay["user"]["instrument"] == "flute" and "words" not in overlay
    assert c.get("/api/songs/test-tune").json()["notes"][0]["midi"] == 62
    assert c.post("/api/songs/test-tune/steps/cleanup", json={}).status_code == 400
    assert c.post("/api/songs/test-tune/lyrics", json={"text": "x"}).status_code == 400
    assert c.delete("/api/songs/test-tune").json()["ok"] is True
    assert c.get("/api/songs/test-tune").json()["notes"][0]["midi"] == 60


def test_upload_limit(catalog_client, monkeypatch):
    from notealong import entitlements
    monkeypatch.setattr(entitlements, "FREE_UPLOAD_LIMIT", 0)
    r = catalog_client.post("/api/songs", files={"file": ("x.mp3", b"abc", "audio/mpeg")})
    assert r.status_code == 402
