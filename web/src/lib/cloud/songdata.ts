// Song records for the online version, shaped exactly like the local service's song.json
// (service/notealong/schemas.py), so every screen works the same with either back end.
import type { ProgressSnapshot, Song, UserSession } from "../types";

export const DEFAULT_SESSION: UserSession = {
  instrument: "alto_sax", key_shift: 0, octave: "auto", notation: "sharps", speed: 1, loop: null, position: 0,
  backing_volume: 1, guide_vocal: false, guide_volume: 0.35, script: "original",
};

export const STEPS = [
  { id: "stems", label: "Separating the vocals" },
  { id: "melody", label: "Finding the notes" },
  { id: "lyrics", label: "Reading the lyrics" },
  { id: "attach", label: "Lining it all up" },
] as const;

/** Fields of a built-in song a user can change; they are kept per user, apart from the shared catalog. */
export const CATALOG_OVERLAY = ["user", "notes", "words", "lines"] as const;

export function guessTitle(filename: string): { title: string; artist: string | null } {
  const stem = filename.replace(/\.[^.]+$/, "").replace(/_+/g, " ").trim();
  const i = stem.indexOf(" - ");
  if (i > 0) return { title: stem.slice(i + 3).trim() || "Untitled", artist: stem.slice(0, i).trim() || null };
  return { title: stem || "Untitled", artist: null };
}

/** An id like the local service's: the title as a slug plus a random part (never a catalog id). */
export function newSongId(title: string): string {
  const slug = title.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "song";
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, "0")).join("");
  return `${slug}-u${rand}`;
}

export function newSongData(p: { id: string; title: string; artist: string | null; filename: string; ext: string; instrument?: string; detail_level?: string; titleFromName: boolean }): Song {
  const now = new Date().toISOString();
  return {
    schema_version: 1, id: p.id, title: p.title, artist: p.artist, duration: 0, tempo_bpm: null, created_at: now, updated_at: now,
    status: "processing",
    source: { kind: "upload", filename: p.filename, format: p.ext, ...(p.titleFromName ? { title_from_name: true } : {}) } as Song["source"],
    files: { original: `original.${p.ext}` },
    language: { detected: null, override: null, script: "latin" }, key: null, words: [], lines: [], notes: [],
    settings: { detail_level: ["simple", "balanced", "detailed"].includes(p.detail_level ?? "") ? p.detail_level! : "balanced", cleanup: {}, lyrics_source: "transcribed", whisper_model: null },
    user: { ...DEFAULT_SESSION, ...(p.instrument ? { instrument: p.instrument } : {}) },
    steps: {}, error: null, quality: {},
  };
}

/** Which steps a re-run of `step` runs (the same rules as the local service's /steps/{step}). */
export function stepsFor(step: string, song: Pick<Song, "steps">): string[] | null {
  switch (step) {
    case "all": return STEPS.map((s) => s.id);
    case "stems": return ["stems", "melody", "lyrics", "attach"];
    case "melody": return ["melody", "attach"];
    case "cleanup": return ["cleanup"];
    case "lyrics": return ["lyrics", "attach"];
    case "attach": return ["attach"];
    case "retry": {
      const left = STEPS.map((s) => s.id).filter((id) => song.steps?.[id]?.status !== "done");
      return left.length ? left : ["attach"];
    }
    default: return null;
  }
}

/** The progress view's data before the worker has written its own (a job waiting for a machine). */
export function snapshotFromSong(song: Pick<Song, "id" | "status" | "error" | "steps">, waiting = false): ProgressSnapshot {
  return {
    song_id: song.id, status: song.status, error: song.error ?? null, current: null, estimated_seconds_left: 0,
    steps: STEPS.map((s) => {
      const st = song.steps?.[s.id];
      const status = waiting && (!st || st.status !== "done") ? "pending" : st?.status ?? "pending";
      return { id: s.id, label: s.label, status, progress: status === "done" ? 1 : 0, error: st?.error ?? null };
    }),
  };
}

export const SIGNED_URL_SECONDS = 6 * 3600;
