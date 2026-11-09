"""Trimming an upload cuts its audio and moves every note, word and line with it, keeping edits."""
import subprocess

import numpy as np
import soundfile as sf

from notealong.schemas import Line, Note, Song, Word


def make_song(tmp_path, monkeypatch):
    import notealong.config as config
    import notealong.library as library
    monkeypatch.setattr(config, "LIBRARY_DIR", tmp_path)
    monkeypatch.setattr(library, "LIBRARY_DIR", tmp_path)
    d = tmp_path / "s1"
    d.mkdir()
    sr = 22050
    y = (0.2 * np.sin(2 * np.pi * 220 * np.arange(sr * 30) / sr)).astype(np.float32)
    sf.write(d / "src.wav", y, sr)
    for name in ("original.mp3", "vocals.mp3", "backing.mp3"):
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(d / "src.wav"), "-c:a", "libmp3lame", str(d / name)], check=True)
    song = Song(id="s1", title="t", duration=30.0, created_at="x", updated_at="x", status="ready",
                files={"original": "original.mp3", "vocals": "vocals.mp3", "backing": "backing.mp3"},
                notes=[Note(id="n1", start=2.0, end=3.0, midi=60), Note(id="n2", start=12.0, end=13.0, midi=62, edited=True),
                       Note(id="n3", start=28.5, end=29.5, midi=64)],
                words=[Word(id="w1", text="intro", start=2.0, end=3.0, line=0), Word(id="w2", text="sung", start=12.0, end=13.0, line=1)],
                lines=[Line(index=0, kind="lyric", start=2.0, end=3.0), Line(index=1, kind="lyric", start=12.0, end=13.0)])
    library.save_song(song)
    return library


def test_trim_moves_everything(tmp_path, monkeypatch):
    library = make_song(tmp_path, monkeypatch)
    library.trim_song("s1", 10.0, 28.0)
    s = library.load_song("s1")
    assert abs(s.duration - 18.0) < 0.01
    assert [(n.id, n.start, n.end, n.edited) for n in s.notes] == [("n2", 2.0, 3.0, True)]
    assert [w.text for w in s.words] == ["sung"] and s.words[0].start == 2.0
    assert [l.index for l in s.lines] == [1]
    assert s.source["trim"] == {"start": 10.0, "end": 28.0}
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(tmp_path / "s1" / "backing.mp3")],
                         capture_output=True, text=True).stdout
    assert abs(float(out) - 18.0) < 0.1
