"""The generated cover art (catalog/artwork.py): every scene draws, the same song always gets the same picture,
its colours come back as hex, and the service serves the picture (a built-in song's cover.webp, an upload's
generated one)."""
import io
import re

import numpy as np
from PIL import Image

from notealong.catalog import artwork
from notealong.catalog.artwork import PALETTES, SCENES, choose, cover_colors, render_cover

HEX = re.compile(r"^#[0-9a-f]{6}$")


def test_every_scene_draws_a_moody_picture():
    for scene in SCENES:
        im = render_cover("scene-test", palette="fern", scene=scene, size=160)
        a = np.asarray(im, np.float32) / 255
        assert im.size == (160, 160) and im.mode == "RGB"
        # not flat: light and shade, and not blown out or black
        assert a.std() > 0.03, scene
        assert 0.04 < a.mean() < 0.75, scene


def test_the_same_song_always_gets_the_same_cover():
    a = np.asarray(render_cover("the-water-is-wide", "Folk", size=96))
    b = np.asarray(render_cover("the-water-is-wide", "Folk", size=96))
    c = np.asarray(render_cover("danny-boy", "Folk", size=96))
    assert (a == b).all()
    assert not (a == c).all()


def test_genres_choose_their_palettes():
    for genre, names in artwork.GENRE_PALETTES.items():
        assert all(n in PALETTES for n in names), genre
    pal, scene = choose("any-song", "Christmas")
    assert pal.name in artwork.GENRE_PALETTES["Christmas"] and scene in pal.scenes


def test_colours_are_shadows_body_and_light():
    c = cover_colors(render_cover("colour-test", palette="ember", scene="beams", size=128))
    assert set(c) == {"deep", "mid", "glow"} and all(HEX.match(v) for v in c.values())
    lum = lambda h: sum(int(h[i:i + 2], 16) for i in (1, 3, 5))
    assert lum(c["deep"]) < lum(c["mid"]) < lum(c["glow"])


def test_upload_without_a_picture_gets_a_generated_cover(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from notealong import library, main
    from notealong.schemas import Song

    import notealong.config as config
    monkeypatch.setattr(config, "LIBRARY_DIR", tmp_path)
    monkeypatch.setattr(library, "LIBRARY_DIR", tmp_path)
    library.save_song(Song(id="my-song-abc123", title="My song", duration=60.0, created_at="x", updated_at="x", status="ready"))
    d = tmp_path / "my-song-abc123"
    r = TestClient(main.app).get("/api/songs/my-song-abc123/cover")
    assert r.status_code == 200 and r.headers["content-type"] == "image/webp"
    assert Image.open(io.BytesIO(r.content)).size == (960, 960)
    assert (d / "cover_gen.webp").exists()          # drawn once, then kept with the song
