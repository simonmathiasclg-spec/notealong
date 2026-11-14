"""Favourites, plays, setlists and the search index through the API."""
import json

from fastapi.testclient import TestClient


def client(tmp_path, monkeypatch):
    import notealong.config as config
    import notealong.library as library
    import notealong.me as me
    monkeypatch.setattr(config, "LIBRARY_DIR", tmp_path)
    monkeypatch.setattr(library, "LIBRARY_DIR", tmp_path)
    monkeypatch.setattr(me, "LIBRARY_DIR", tmp_path)
    from notealong.main import app
    return TestClient(app)


def test_favourites_plays_and_setlists(tmp_path, monkeypatch):
    c = client(tmp_path, monkeypatch)
    assert c.put("/api/me/favourites/amazing-grace", json={"on": True}).json()["favourites"] == ["amazing-grace"]
    c.put("/api/me/favourites/danny-boy", json={"on": True})
    assert c.put("/api/me/favourites/amazing-grace", json={"on": False}).json()["favourites"] == ["danny-boy"]
    assert c.post("/api/songs/danny-boy/played").json()["count"] == 1
    assert c.post("/api/songs/danny-boy/played").json()["count"] == 2
    sl = c.post("/api/me/setlists", json={"name": "Sunday", "songs": ["danny-boy", "amazing-grace"]}).json()
    assert sl["gap_seconds"] == 5 and sl["songs"] == ["danny-boy", "amazing-grace"]
    up = c.put(f"/api/me/setlists/{sl['id']}", json={"songs": ["amazing-grace", "danny-boy"], "gap_seconds": 99}).json()
    assert up["songs"] == ["amazing-grace", "danny-boy"] and up["gap_seconds"] == 60 and up["name"] == "Sunday"
    lib = c.get("/api/me/library").json()
    assert lib["favourites"] == ["danny-boy"] and lib["plays"]["danny-boy"]["count"] == 2 and len(lib["setlists"]) == 1
    assert c.put("/api/me/favourites/..%2Fetc", json={"on": True}).status_code in (400, 404)
    c.delete(f"/api/me/setlists/{sl['id']}")
    assert c.get("/api/me/library").json()["setlists"] == []


def test_search_index_has_lyrics_and_ranges(tmp_path, monkeypatch):
    c = client(tmp_path, monkeypatch)
    rows = c.get("/api/search-index").json()["songs"]
    assert len(rows) > 100
    grace = next(r for r in rows if r["id"] == "amazing-grace")
    assert "wretch" in grace["lyrics"].lower()
    lo, hi = grace["range"]
    assert 50 < lo < hi < 85
    assert all(r["kind"] in ("catalog", "upload") for r in rows)


def test_a_note_marked_as_sounding_wrong_is_kept_once_and_can_be_unmarked(tmp_path, monkeypatch):
    c = client(tmp_path, monkeypatch)
    flag = {"song_id": "my-song", "start": 38.05, "end": 38.4, "midi": 64, "line": 7, "time": 38.2, "word": "be", "melody": "sax", "pipeline": 7}
    assert c.post("/api/me/flags", json=flag).json()["count"] == 1
    assert c.post("/api/me/flags", json=flag).json()["count"] == 1                     # the same note again: still one mark
    assert c.post("/api/me/flags", json={**flag, "start": 40.0}).json()["count"] == 2
    got = c.get("/api/me/flags").json()["flags"]
    assert [(f["song_id"], f["start"], f["midi"], f["line"], f["word"]) for f in got] == [("my-song", 38.05, 64, 7, "be"), ("my-song", 40.0, 64, 7, "be")]
    assert c.post("/api/me/flags", json={**flag, "on": False}).json()["count"] == 1
    assert c.post("/api/me/flags", json={**flag, "song_id": "../x"}).status_code == 400
