from types import SimpleNamespace

import numpy as np

from notealong.pipeline.dynamics import HIGH, LOW, MIDDLE, note_levels
from notealong.pipeline.onsets import Articulation


def _art(level):
    return Articulation({"hop": 0.01, "onset": [0.0] * len(level), "level": list(level)})


def _note(i, start, end):
    return SimpleNamespace(id=f"n{i}", start=start, end=end)


def test_louder_notes_get_higher_levels():
    level = np.full(600, -40.0)
    level[100:150] = -12.0     # quiet
    level[200:250] = -6.0      # typical
    level[300:350] = 0.0       # loud
    notes = [_note(0, 1.0, 1.5), _note(1, 2.0, 2.5), _note(2, 3.0, 3.5)]
    lv = note_levels(notes, _art(level))
    assert lv["n0"] < lv["n1"] < lv["n2"]
    assert abs(lv["n1"] - MIDDLE) < 0.02
    assert all(LOW <= v <= HIGH for v in lv.values())


def test_quiet_edges_of_a_note_do_not_count():
    level = np.full(400, -40.0)
    level[100:200] = -6.0
    level[100:120] = -30.0     # a soft consonant at the front
    level[250:350] = -6.0
    lv = note_levels([_note(0, 1.0, 2.0), _note(1, 2.5, 3.5)], _art(level))
    assert abs(lv["n0"] - lv["n1"]) < 0.02


def test_notes_past_the_end_are_typical():
    lv = note_levels([_note(0, 0.1, 0.4), _note(1, 99.0, 99.5)], _art(np.full(100, -6.0)))
    assert lv["n1"] == lv["n0"] or abs(lv["n1"] - MIDDLE) < 0.05
