from notealong.pipeline.cleanup import clean_notes, reduce_monophonic, absorb_short_notes, params_for
from notealong.pipeline.keydetect import detect_key


def n(start, end, midi, amp=0.8):
    return {"start": start, "end": end, "midi": midi, "amp": amp}


def test_overlapping_harmony_is_removed():
    raw = [n(0, 1, 60, 0.9), n(0, 1, 64, 0.5)]  # lead C with quieter E harmony
    out, _ = clean_notes(raw, "balanced")
    assert [x["midi"] for x in out] == [60]


def test_octave_harmonic_prefers_lower_note():
    raw = [n(0, 1, 60, 0.6), n(0, 1, 72, 0.7)]
    out, _ = clean_notes(raw, "balanced")
    assert [x["midi"] for x in out] == [60]


def test_same_pitch_fragment_merged():
    raw = [n(0, 0.5, 62), n(0.55, 0.6, 62)]  # a fragment after a tiny dip
    out, _ = clean_notes(raw, "balanced")
    assert len(out) == 1 and out[0]["start"] == 0 and out[0]["end"] == 0.6


def test_repeated_full_notes_stay_separate():
    raw = [n(0, 0.45, 60), n(0.5, 0.95, 60)]  # "twin-kle" on the same pitch
    out, _ = clean_notes(raw, "balanced")
    assert [x["midi"] for x in out] == [60, 60]


def test_short_slide_absorbed_into_following_note():
    raw = [n(0, 0.5, 60), n(0.5, 0.56, 61), n(0.56, 1.0, 62)]
    out, _ = clean_notes(raw, "balanced")
    assert [x["midi"] for x in out] == [60, 62]
    assert abs(out[1]["start"] - 0.5) < 1e-6


def test_isolated_blip_dropped():
    raw = [n(0, 0.5, 60), n(2.0, 2.05, 70), n(3, 3.5, 64)]
    out, _ = clean_notes(raw, "balanced")
    assert [x["midi"] for x in out] == [60, 64]


def test_detail_levels_keep_more_notes():
    raw = [n(i * 0.1, i * 0.1 + 0.09, 60 + i) for i in range(6)] + [n(1, 2, 67)]
    simple, _ = clean_notes(raw, "simple")
    detailed, _ = clean_notes(raw, "detailed")
    assert len(detailed) >= len(simple)


def test_lead_note_continues_through_overlap():
    raw = [n(0, 2, 60, 0.6), n(0.5, 1.0, 67, 0.65)]  # slightly louder blip over a sustained note
    out = reduce_monophonic(raw, params_for("balanced"))
    # continuity bonus should keep the sustained note unbroken
    assert [x["midi"] for x in out] == [60]


def test_key_detection_c_major():
    melody = [60, 62, 64, 65, 67, 69, 71, 72, 67, 64, 60]
    notes = [n(i * 0.5, i * 0.5 + 0.45, m) for i, m in enumerate(melody)]
    key = detect_key(notes)
    assert key["tonic"] == 0 and key["mode"] == "major" and key["name"] == "C major"


def test_key_detection_a_minor():
    melody = [69, 71, 72, 74, 76, 77, 80, 81, 76, 72, 69, 69]
    notes = [n(i * 0.5, i * 0.5 + 0.45, m) for i, m in enumerate(melody)]
    key = detect_key(notes)
    assert key["tonic"] == 9 and key["mode"] == "minor"


def test_quiet_bleed_notes_dropped():
    raw = [dict(n(0, 1, 60), level_db=-60.0), dict(n(2, 3, 64), level_db=-3.0)]
    out, _ = clean_notes(raw, "balanced")
    assert [x["midi"] for x in out] == [64]
