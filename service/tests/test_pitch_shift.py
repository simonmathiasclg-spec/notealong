"""A key change must move the pitch by exactly the asked semitones and leave timing untouched."""
import numpy as np
import pytest
import soundfile as sf

from notealong.pipeline.audio import load_mono, pitch_shift_file, pitch_shift_engine


def _tone_with_clicks(path, sr=44100, secs=6.0, f=220.0):
    t = np.arange(int(sr * secs)) / sr
    y = 0.3 * sum(0.5 ** h * np.sin(2 * np.pi * f * (h + 1) * t) for h in range(4))
    for k in range(1, 6):          # a click every second: the beat that must not move
        i = int(k * sr)
        y[i:i + 200] += 0.6 * np.hanning(200)
    sf.write(str(path), np.stack([y, y], axis=1).astype(np.float32), sr)


def _f0(y, sr):
    import librosa
    f, v, _ = librosa.pyin(y, fmin=100, fmax=800, sr=sr)
    return float(np.median(f[v]))


def _click_times(y, sr):
    import librosa
    return list(librosa.onset.onset_detect(y=y, sr=sr, units="time", delta=0.3))


@pytest.mark.parametrize("semis", [-3, 2, 5])
@pytest.mark.parametrize("engine", ["fast", "fine", "ffmpeg-resample"])
def test_pitch_moves_tempo_stays(tmp_path, semis, engine, monkeypatch):
    fine = engine == "fine"
    if engine in ("fast", "fine") and pitch_shift_engine() != "rubberband":
        pytest.skip("needs the rubberband tool")
    if engine == "ffmpeg-resample":   # the fallback for machines without rubberband
        from notealong.pipeline import audio
        monkeypatch.setattr(audio, "pitch_shift_engine", lambda: "ffmpeg-resample")
    src = tmp_path / "tone.wav"
    _tone_with_clicks(src)
    dst = pitch_shift_file(src, tmp_path / "shifted.mp3", semis, fine=fine)
    a, sr = load_mono(src, sr=22050)
    b, _ = load_mono(dst, sr=22050)
    assert abs(len(b) - len(a)) / sr < 0.06, "length changed"
    measured = 12 * np.log2(_f0(b, sr) / _f0(a, sr))
    assert abs(measured - semis) < 0.1, measured
    ta, tb = _click_times(a, sr), _click_times(b, sr)
    assert len(ta) >= 5, ta
    # every click in the original has one in the shifted file within 30 ms
    assert all(min(abs(x - y) for y in tb) < 0.03 for x in ta), (ta, tb)
