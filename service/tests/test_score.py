"""The beat grid, time signature and chords behind the sheet music view."""
import numpy as np

from notealong.config import CATALOG_DIR
from notealong.pipeline.score import authored_score, chords_from_chroma, meter_for, regular_beats


def test_regular_beats_fills_gaps_and_reaches_both_ends():
    beats = [2.0 + 0.5 * i for i in range(40)]
    del beats[10:13]                                   # the tracker lost three beats in a quiet bar
    downbeats = [2.0 + 2.0 * i for i in range(10)]
    grid, per_bar, phase = regular_beats(beats, downbeats, 30.0)
    assert per_bar == 4
    assert abs(grid[0]) < 1e-6 and grid[-1] >= 29.5
    assert np.allclose(np.diff(grid), 0.5, atol=1e-3)
    assert abs(grid[phase] % 2.0) < 1e-3               # the first bar line is on a downbeat


def test_regular_beats_keeps_one_metre_when_a_downbeat_is_missed():
    beats = [0.4 * i for i in range(60)]
    downbeats = [1.2 * i for i in range(20)]
    del downbeats[7]
    grid, per_bar, phase = regular_beats(beats, downbeats, 24.0)
    assert per_bar == 3 and phase == 0
    assert meter_for(per_bar) == (3, 4) and meter_for(6) == (6, 8) and meter_for(4) == (4, 4)


def _chroma(chords, beats_each=4, noise=0.08, seed=1):
    rng = np.random.default_rng(seed)
    cols = []
    for pcs in chords:
        for _ in range(beats_each):
            v = rng.random(12) * noise
            for pc in pcs:
                v[pc % 12] += 1.0
            cols.append(v)
    return np.asarray(cols).T


def test_chords_from_chroma_reads_triads_and_sevenths():
    # C, Am, F, G7 (one bar each in 4/4)
    chroma = _chroma([(0, 4, 7), (9, 0, 4), (5, 9, 0), (7, 11, 2, 5)])
    found = chords_from_chroma(chroma, None, 4, 0)
    assert [(a, b) for a, b, _, _ in found] == [(0, 4), (4, 8), (8, 12), (12, 16)]
    assert [(root, q) for _, _, root, q in found] == [(0, ""), (9, "m"), (5, ""), (7, "7")]


def test_a_one_beat_blip_is_not_a_chord_change():
    chroma = _chroma([(0, 4, 7)] * 2 + [(7, 11, 2)] * 2)
    chroma[:, 5] = _chroma([(2, 5, 9)], beats_each=1)[:, 0]
    found = chords_from_chroma(chroma, None, 4, 0)
    assert [(root, q) for _, _, root, q in found] == [(0, ""), (7, "")]


def test_key_settles_a_close_call():
    # an open fifth on E: major or minor cannot be told from the notes, the key of A major says E major
    chroma = _chroma([(4, 11)] * 2, noise=0.0)
    assert chords_from_chroma(chroma, None, 4, 0, key=(9, "major"))[0][2:] == (4, "")
    assert chords_from_chroma(chroma, None, 4, 0, key=(7, "major"))[0][2:] == (4, "m")


def test_authored_song_knows_its_grid_chords_and_syllables():
    s = authored_score(CATALOG_DIR / "songs" / "la-cucaracha.song", 60.0)
    assert s["source"] == "authored" and s["meter"] == [3, 4] and s["tempo"] == 126
    beat = 60 / 126
    assert abs(s["beats"][1] - beat) < 1e-3
    assert abs(s["first_bar"] / (3 * beat) - round(s["first_bar"] / (3 * beat))) < 1e-3     # whole bars of intro
    at = lambda t: next(c for c in s["chords"] if c["start"] <= t < c["end"])            # noqa: E731
    assert (at(s["first_bar"] + 0.01)["root"], at(s["first_bar"] + 0.01)["quality"]) == (5, "")       # F
    third = at(s["first_bar"] + 2 * 3 * beat + 0.01)
    assert (third["root"], third["quality"]) == (0, "7")                                              # C7
    assert [s["syllables"][f"n{i}"] for i in range(5)] == ["La", "cu-", "ca-", "ra-", "cha,"]
