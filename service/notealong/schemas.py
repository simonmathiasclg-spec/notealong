"""Pydantic models for song.json. Kept flat and JSON-friendly so the same
shape can move into Supabase tables later (songs, words, notes, sessions)."""
from __future__ import annotations

from typing import Literal, Optional
from pydantic import BaseModel, Field

SCHEMA_VERSION = 1


class Word(BaseModel):
    id: str
    text: str
    roman: Optional[str] = None     # romanized form for non-Latin scripts
    start: float
    end: float
    line: int
    confidence: float = 1.0


class Line(BaseModel):
    index: int
    kind: Literal["lyric", "instrumental"] = "lyric"
    start: float
    end: float


class Note(BaseModel):
    id: str
    start: float
    end: float
    midi: int                       # concert pitch
    confidence: float = 1.0
    word: Optional[str] = None      # word id, or None for a "no lyric" note
    line: int = 0
    edited: bool = False


class KeyInfo(BaseModel):
    tonic: int                      # pitch class 0..11 (C=0)
    mode: Literal["major", "minor"]
    name: str
    confidence: float


class LanguageInfo(BaseModel):
    detected: Optional[str] = None
    override: Optional[str] = None
    script: Literal["latin", "other"] = "latin"


class StepState(BaseModel):
    status: Literal["pending", "running", "done", "failed"] = "pending"
    progress: float = 0.0
    seconds: Optional[float] = None
    error: Optional[str] = None


class SongSettings(BaseModel):
    detail_level: str = "balanced"
    cleanup: dict = Field(default_factory=dict)
    lyrics_source: Literal["transcribed", "pasted"] = "transcribed"
    whisper_model: Optional[str] = None


class UserSession(BaseModel):
    """What the player remembers per song."""
    instrument: str = "alto_sax"
    key_shift: int = 0
    octave: Literal["down", "auto", "up"] = "auto"
    notation: Literal["sharps", "flats", "solfege", "sargam"] = "sharps"
    speed: float = 1.0
    loop: Optional[list[float]] = None
    position: float = 0.0
    backing_volume: float = 1.0
    guide_vocal: bool = False
    guide_volume: float = 0.35
    script: Literal["original", "roman"] = "original"


class Song(BaseModel):
    schema_version: int = SCHEMA_VERSION
    id: str
    title: str
    artist: Optional[str] = None
    duration: float = 0.0
    tempo_bpm: Optional[float] = None
    created_at: str
    updated_at: str
    status: Literal["processing", "ready", "failed"] = "processing"
    source: dict = Field(default_factory=dict)
    files: dict = Field(default_factory=dict)
    language: LanguageInfo = Field(default_factory=LanguageInfo)
    key: Optional[KeyInfo] = None
    words: list[Word] = Field(default_factory=list)
    lines: list[Line] = Field(default_factory=list)
    notes: list[Note] = Field(default_factory=list)
    settings: SongSettings = Field(default_factory=SongSettings)
    user: UserSession = Field(default_factory=UserSession)
    steps: dict[str, StepState] = Field(default_factory=dict)
    error: Optional[str] = None
