"""The duplicate check must recognise the same recording after re-encoding, and not two different songs."""
import numpy as np
import pytest
import soundfile as sf

from notealong.pipeline import fingerprint as F
from notealong.pipeline.audio import run


def _song(path, seed, sr=22050, secs=30):
    rng = np.random.default_rng(seed)
    t = np.arange(int(sr * secs)) / sr
    y = np.zeros_like(t)
    for k in range(secs * 2):                      # a new chord every half second
        f = 110 * 2 ** (rng.integers(0, 24) / 12)
        on = (t >= k / 2) & (t < k / 2 + 0.5)
        y += on * sum(0.4 * np.sin(2 * np.pi * f * m * t) for m in (1, 1.5, 2))
    y += 0.02 * rng.standard_normal(len(t))
    sf.write(str(path), (0.3 * y).astype(np.float32), sr)


@pytest.mark.parametrize("method", ["chroma", "chromaprint"])
def test_same_recording_is_found_and_others_are_not(tmp_path, method, monkeypatch):
    if method == "chromaprint" and not F.shutil.which("fpcalc"):
        pytest.skip("fpcalc not installed")
    if method == "chroma":
        monkeypatch.setattr(F.shutil, "which", lambda name: None)
    a, b = tmp_path / "a.wav", tmp_path / "b.wav"
    _song(a, 1)
    _song(b, 2)
    a_mp3 = tmp_path / "a.mp3"
    run(["ffmpeg", "-y", "-v", "error", "-i", str(a), "-ar", "32000", "-c:a", "libmp3lame", "-b:a", "64k", str(a_mp3)])
    fa, fb, fa2 = F.fingerprint(a), F.fingerprint(b), F.fingerprint(a_mp3)
    assert fa["method"] == method
    assert F.same_recording(fa, fa2), F.similarity(fa, fa2)
    assert not F.same_recording(fa, fb), F.similarity(fa, fb)
    assert F.similarity(fa, fa2) > F.similarity(fa, fb) + 0.2
