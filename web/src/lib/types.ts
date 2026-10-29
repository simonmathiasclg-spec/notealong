// Mirrors service/notealong/schemas.py (song.json)
export type Word = {
  id: string;
  text: string;
  roman?: string | null;
  start: number;
  end: number;
  line: number;
  confidence?: number;
};

export type Line = { index: number; kind: "lyric" | "instrumental"; start: number; end: number };

export type Note = {
  id: string;
  start: number;
  end: number;
  midi: number; // concert pitch
  confidence?: number;
  word?: string | null;
  line: number;
  edited?: boolean;
};

export type KeyInfo = { tonic: number; mode: "major" | "minor"; name: string; confidence: number };

export type StepState = { status: "pending" | "running" | "done" | "failed"; progress?: number; seconds?: number | null; error?: string | null };

export type Notation = "sharps" | "flats" | "solfege" | "sargam";
export type OctaveMode = "down" | "auto" | "up";

export type UserSession = {
  instrument: string;
  key_shift: number;
  octave: OctaveMode;
  notation: Notation;
  speed: number;
  loop: [number, number] | null;
  position: number;
  backing_volume: number;
  guide_vocal: boolean;
  guide_volume: number;
  script: "original" | "roman";
};

export type Song = {
  schema_version: number;
  id: string;
  title: string;
  artist?: string | null;
  duration: number;
  tempo_bpm?: number | null;
  created_at: string;
  updated_at: string;
  status: "processing" | "ready" | "failed";
  source: { filename?: string; format?: string };
  files: Record<string, string>;
  language: { detected?: string | null; override?: string | null; script: "latin" | "other" };
  key?: KeyInfo | null;
  words: Word[];
  lines: Line[];
  notes: Note[];
  settings: { detail_level: string; cleanup: Record<string, number>; lyrics_source: "transcribed" | "pasted"; whisper_model?: string | null };
  user: UserSession;
  steps: Record<string, StepState>;
  error?: string | null;
};

export type SongSummary = Omit<Song, "words" | "lines" | "notes"> & { word_count: number; note_count: number };

export type ProgressStep = { id: string; label: string; status: StepState["status"]; progress: number; error?: string | null };
export type ProgressSnapshot = {
  song_id: string;
  status: Song["status"];
  error?: string | null;
  steps: ProgressStep[];
  current: string | null;
  estimated_seconds_left: number;
};
