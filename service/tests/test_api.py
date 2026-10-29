"""API tests on a temporary library (no ML models involved)."""
import json

import pytest
from fastapi.testclient import TestClient

from notealong import config, library
from notealong.schemas import Song, Note, Word, Line


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "LIBRARY_DIR", tmp_path)
    monkeypatch.setattr(library, "LIBRARY_DIR", tmp_path)
    from notealong import jobs, main
    monkeypatch.setattr(jobs, "TIMINGS_FILE", tmp_path / ".timings.json")
    return TestClient(main.app)


def make_song(song_id="test-song-000001"):
    s = Song(id=song_id, title="Test", duration=10.0, created_at=library.now_iso(), updated_at=library.now_iso(), status="ready",
             files={"original": "original.mp3"})
    s.words = [Word(id="w1", text="hello", start=1.0, end=1.5, line=0), Word(id="w2", text="world", start=1.5, end=2.0, line=0)]
    s.lines = [Line(index=0, kind="lyric", start=1.0, end=2.0)]
    s.notes = [Note(id="n1", start=1.0, end=1.5, midi=60, word="w1", line=0), Note(id="n2", start=1.5, end=2.0, midi=62, word="w2", line=0)]
    library.save_song(s)
    return s


def test_health_and_list(client):
    assert client.get("/api/health").json()["ok"] is True
    make_song()
    songs = client.get("/api/songs").json()
    assert len(songs) == 1 and songs[0]["note_count"] == 2 and "notes" not in songs[0]


def test_patch_persists_edits_and_session(client):
    s = make_song()
    notes = [n.model_dump() for n in s.notes]
    notes[0]["midi"] = 64
    notes[0]["edited"] = True
    r = client.patch(f"/api/songs/{s.id}", json={"notes": notes, "user": {"instrument": "flute", "key_shift": -2}})
    assert r.status_code == 200
    on_disk = json.loads(library.song_path(s.id).read_text())
    assert on_disk["notes"][0]["midi"] == 64 and on_disk["notes"][0]["edited"] is True
    assert on_disk["user"]["instrument"] == "flute" and on_disk["user"]["key_shift"] == -2
    assert client.get(f"/api/songs/{s.id}").json()["user"]["notation"] == "sharps"  # defaults kept


def test_paste_lyrics_realigns_words(client):
    s = make_song()
    d = library.song_dir(s.id)
    d.joinpath("transcript.json").write_text(json.dumps({"words": [
        {"text": "hello", "start": 1.0, "end": 1.5, "confidence": 1}, {"text": "world", "start": 1.5, "end": 2.0, "confidence": 1}], "segments": [[1, 2]]}))
    r = client.post(f"/api/songs/{s.id}/lyrics", json={"text": "Hello big\nworld"})
    assert r.status_code == 200
    body = r.json()
    assert [w["text"] for w in body["words"]] == ["Hello", "big", "world"]
    assert body["settings"]["lyrics_source"] == "pasted"
    assert [w["line"] for w in body["words"]] == [0, 0, 1]
    assert body["notes"][0]["word"] == body["words"][0]["id"]
    body = client.post(f"/api/songs/{s.id}/lyrics", json={"text": ""}).json()
    assert [w["text"] for w in body["words"]] == ["hello", "world"]


def test_upload_rejects_bad_files(client):
    r = client.post("/api/songs", files={"file": ("notes.txt", b"hello", "text/plain")})
    assert r.status_code == 400
    r = client.post("/api/songs", files={"file": ("x.mp3", b"not really audio", "audio/mpeg")})
    assert r.status_code == 400


def test_progress_snapshot_for_ready_song(client):
    s = make_song()
    snap = client.get(f"/api/songs/{s.id}/progress/snapshot").json()
    assert snap["status"] == "ready" and [st["id"] for st in snap["steps"]] == ["stems", "melody", "lyrics", "attach"]
    assert snap["estimated_seconds_left"] == 0
