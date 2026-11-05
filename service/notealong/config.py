"""Central configuration for the processing service.

Everything tunable lives here so the thresholds can be changed in one place.
Paths can be overridden with environment variables so the service can later
move to a GPU host without code changes.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, asdict
from pathlib import Path

SERVICE_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = SERVICE_DIR.parent

# Where songs are stored: library/<song-id>/...
LIBRARY_DIR = Path(os.environ.get("NOTEALONG_LIBRARY", REPO_DIR / "library")).resolve()
# Built-in songs (public domain + Creative Commons): catalog/<song-id>/... and catalog/catalog.json
CATALOG_DIR = Path(os.environ.get("NOTEALONG_CATALOG", REPO_DIR / "catalog")).resolve()
# Local model weights (optional; otherwise the libraries download them on first use)
MODELS_DIR = Path(os.environ.get("NOTEALONG_MODELS", SERVICE_DIR / "models")).resolve()

# --- Stems -----------------------------------------------------------------
DEMUCS_MODEL = os.environ.get("NOTEALONG_DEMUCS_MODEL", "htdemucs")
# Demucs splits the song into chunks of this many seconds to limit memory.
DEMUCS_SEGMENT = float(os.environ.get("NOTEALONG_DEMUCS_SEGMENT", "7.8"))
# Extra random shifts average out artefacts but multiply the time taken; 0 is fastest.
DEMUCS_SHIFTS = int(os.environ.get("NOTEALONG_DEMUCS_SHIFTS", "0"))

# --- Melody (Basic Pitch) ----------------------------------------------------
# These are deliberately permissive: the raw note list keeps more than we show,
# so cleanup can be re-run at a different detail level without re-running the model.
BASIC_PITCH_ONSET_THRESHOLD = 0.4
BASIC_PITCH_FRAME_THRESHOLD = 0.25
BASIC_PITCH_MIN_NOTE_MS = 40.0
VOCAL_MIN_HZ = 65.0     # C2
VOCAL_MAX_HZ = 1400.0   # ~F6

# --- Lyrics (Whisper) --------------------------------------------------------
# "faster-whisper" (default, fastest on a Mac) or "openai-whisper".
WHISPER_BACKEND = os.environ.get("NOTEALONG_WHISPER_BACKEND", "faster-whisper")
WHISPER_MODEL = os.environ.get("NOTEALONG_WHISPER_MODEL", "small")
# Optional path to a local checkpoint (used by the openai-whisper backend).
WHISPER_MODEL_PATH = os.environ.get("NOTEALONG_WHISPER_MODEL_PATH", "")
WHISPER_DEVICE = os.environ.get("NOTEALONG_WHISPER_DEVICE", "auto")

# --- Audio output ------------------------------------------------------------
STEM_FORMAT = "mp3"       # web-friendly; the wav is kept only while processing
STEM_BITRATE = "192k"
SAMPLE_RATE = 44100


@dataclass(frozen=True)
class CleanupParams:
    """Thresholds for the melody cleanup step (all times in seconds)."""
    min_note_len: float        # notes shorter than this are merged into a neighbour or dropped
    merge_gap: float           # same-pitch notes closer than this are joined
    min_confidence: float      # absolute confidence (Basic Pitch amplitude 0..1)
    min_relative_amp: float    # relative to the local median amplitude
    neighbour_semitones: int   # short notes within this many semitones of a neighbour are absorbed
    octave_bias: float         # prefer the lower of two simultaneous notes an octave apart (0..1)
    continuity_bonus: float    # extra score for keeping the note that is already sounding
    leap_penalty: float        # score penalty per semitone of distance from the previous note
    min_level_db: float = -35  # drop notes where the vocals stem is this much quieter than its loud parts
    pitch_min: int = 40        # E2
    pitch_max: int = 86        # D6
    # --- held notes (pipeline/held.py): joining the fragments of one sustained sound ---
    held_gap: float = 0.15     # same-pitch notes further apart than this are always two notes
    onset_min: float = 0.6     # an onset this strong at the junction (1.0 = a typical strong onset) is a new start
    dip_min_db: float = 6.0    # ... and so is a dip in level this deep (a closure: p, t, k, b, d, or a breath)
    wobble_len: float = 0.16   # vibrato: a neighbour-semitone note this short between two equal notes is absorbed
    bend_len: float = 0.20     # a scoop or tail a semitone off, this short, is absorbed into the note it belongs to

    def to_dict(self) -> dict:
        return asdict(self)


DETAIL_LEVELS: dict[str, CleanupParams] = {
    "simple": CleanupParams(
        min_note_len=0.18, merge_gap=0.10, min_confidence=0.45, min_relative_amp=0.40,
        neighbour_semitones=2, octave_bias=0.6, continuity_bonus=0.25, leap_penalty=0.02, min_level_db=-28,
        held_gap=0.20, onset_min=0.75, dip_min_db=8.0, wobble_len=0.20, bend_len=0.25,
    ),
    "balanced": CleanupParams(
        min_note_len=0.12, merge_gap=0.08, min_confidence=0.35, min_relative_amp=0.30,
        neighbour_semitones=2, octave_bias=0.5, continuity_bonus=0.2, leap_penalty=0.015, min_level_db=-32,
    ),
    "detailed": CleanupParams(
        min_note_len=0.07, merge_gap=0.05, min_confidence=0.25, min_relative_amp=0.20,
        neighbour_semitones=1, octave_bias=0.4, continuity_bonus=0.15, leap_penalty=0.01, min_level_db=-38,
        held_gap=0.10, onset_min=0.45, dip_min_db=5.0, wobble_len=0.10, bend_len=0.0,
    ),
}
DEFAULT_DETAIL_LEVEL = "balanced"

# --- Tempo-aware thresholds (cleanup.tempo_scaled) -----------------------------------
TEMPO_REFERENCE_BPM = 100.0      # the tempo the time thresholds above were chosen for
TEMPO_SCALE_FLOOR = 0.6          # never shrink a threshold below this share of its normal value
TEMPO_SCALED = ("min_note_len", "merge_gap", "held_gap", "wobble_len", "bend_len")

# --- Attaching notes to words --------------------------------------------------
# A note that overlaps no word is attached to a word that starts/ends within this window.
ATTACH_TOLERANCE = 0.15
# Unattached notes further apart than this start a new "no lyric" block.
INSTRUMENTAL_BLOCK_GAP = 1.0

# Words sung where the vocals stem is this much quieter than its loud parts are
# almost always transcription hallucinations in silence; drop them.
WORD_MIN_LEVEL_DB = -40.0

# --- Lines ---------------------------------------------------------------------
LINE_MAX_CHARS = 36
LINE_BREAK_GAP = 0.6      # a pause longer than this always starts a new line
LINE_SOFT_GAP = 0.2       # a pause this long is a good place to break a long line


def processing_steps() -> list[dict]:
    """Ordered steps with user-facing labels and rough cost per second of audio (CPU)."""
    return [
        {"id": "stems", "label": "Separating the vocals", "cost": 0.9},
        {"id": "melody", "label": "Finding the notes", "cost": 0.08},
        {"id": "lyrics", "label": "Reading the lyrics", "cost": 0.35},
        {"id": "attach", "label": "Lining it all up", "cost": 0.005},
    ]
