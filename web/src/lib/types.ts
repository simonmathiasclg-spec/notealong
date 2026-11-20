// Mirrors service/notealong/schemas.py (song.json)
/** The three colours of a cover: shadows (backdrops), body, and light (the song's "now" colour comes from it). */
export type ArtColors = { deep: string; mid: string; glow: string };

export type Word = {
  id: string;
  text: string;
  roman?: string | null;
  start: number;
  end: number;
  line: number;
  confidence?: number;
};

export type Line = { index: number; kind: "lyric" | "instrumental"; start: number; end: number; /** "Intro", "Solo" or "Outro" on a line of instrumental hook notes. */ label?: string | null };

export type Note = {
  id: string;
  start: number;
  end: number;
  midi: number; // concert pitch
  confidence?: number;
  word?: string | null;
  line: number;
  edited?: boolean;
  /** Which syllable of its word the note is sung on (sax-friendly melody). */
  syl?: number;
  /** Set on a note played by the band's lead instrument where nobody sings: "Intro", "Solo" or "Outro". */
  hook?: string | null;
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
  /** Use the backing track with the lead instrument turned down in the hooks, so the player takes them. Default on. */
  play_hooks?: boolean;
  script: "original" | "roman";
};

export type Difficulty = "easy" | "medium" | "hard";

/** One built-in song in catalog/catalog.json (public domain or Creative Commons). */
export type CatalogEntry = {
  id: string;
  title: string;
  artist: string;
  origin?: string;
  culture?: string;
  genre: string;
  language?: string;
  difficulty: Difficulty;
  duration: number;
  key?: string | null;
  tempo_bpm?: number | null;
  year?: string | number | null;
  licence: { name: string; url?: string | null };
  attribution: string;
  source: { kind: "traditional" | "cc"; url?: string | null };
  cover: string;
  cover_url: string;
  /** Hue (0-359) of the cover art; the player tints its accent with it. */
  accent_hue?: number;
  /** The cover's colours: its shadows, its body and its light (see lib/color.ts artVars). */
  colors?: ArtColors;
  tags: string[];
  featured?: boolean;
  beginner?: boolean;
  access: "free" | "paid";
  note_count?: number;
  word_count?: number;
  /** ISO date the song joined the catalog: drives "New this week". */
  added?: string;
  /** Plays, once the app reports them. Sorting by "Most played" already uses it. */
  popularity?: number;
  /** When this user last opened the song (from their saved settings). */
  last_played?: string | null;
  /** Creative Commons recordings: "annotated" (word timings made by people) or "transcribed" (heard automatically). */
  lyrics?: "annotated" | "transcribed";
};

export type Catalog = { version: number; songs: CatalogEntry[] };

/** The current plan (no accounts yet; mirrors service/notealong/entitlements.py). */
/** What this person may do. "local": this computer, no limits. Online: "guest" (not signed in: built-in songs only),
 *  "free" (one song of their own for the life of the account), "beta" (testers and the owner: a daily limit). */
export type Entitlements = { plan: "local" | "guest" | "free" | "beta"; uploads: { used: number; limit: number | null; remaining: number | null; period?: "day" | "lifetime" | null }; catalog: "free" };

/** How an upload becomes notes: "sax" is one held note per syllable (the default); "detailed" is the literal transcription. */
export type MelodyMode = "sax" | "detailed";

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
  source: { kind?: "upload" | "catalog"; origin?: "traditional" | "cc"; url?: string; filename?: string; format?: string };
  /** Present for built-in songs only. */
  catalog?: CatalogEntry | null;
  files: Record<string, string>;
  language: { detected?: string | null; override?: string | null; script: "latin" | "other" };
  key?: KeyInfo | null;
  words: Word[];
  lines: Line[];
  notes: Note[];
  settings: { detail_level: string; melody?: MelodyMode; /** Also write out the instrumental hooks (intro, solo, outro). Default on. */ hooks?: boolean; cleanup: Record<string, number | boolean>; lyrics_source: "transcribed" | "pasted"; whisper_model?: string | null };
  user: UserSession;
  steps: Record<string, StepState>;
  error?: string | null;
  /** Measurements made while processing: leftover_vocal_db is how much of the singer is still in the backing (more negative is cleaner). */
  quality?: { leftover_vocal_db?: number };
};

/** Above this, the singer can be heard faintly under the backing track and the player says so. */
export const LEFTOVER_VOICE_NOTICEABLE_DB = -28;

export type SongSummary = Omit<Song, "words" | "lines" | "notes"> & { word_count: number; note_count: number };

export type ProgressStep = { id: string; label: string; status: StepState["status"]; progress: number; error?: string | null };
export type ProgressSnapshot = {
  song_id: string;
  status: Song["status"];
  error?: string | null;
  steps: ProgressStep[];
  current: string | null;
  estimated_seconds_left: number;
  /** Online version: the upload was the same recording as this (earlier) song of the user's, which opens instead. */
  duplicate_of?: string;
};

export type Setlist = { id: string; name: string; songs: string[]; gap_seconds: number; created_at: string; updated_at: string };
/** What this user keeps (service/notealong/me.py). */
export type MyLibrary = { favourites: string[]; plays: Record<string, { count: number; last?: string }>; setlists: Setlist[] };
