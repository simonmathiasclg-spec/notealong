import type { Catalog, Entitlements, MyLibrary, ProgressSnapshot, Setlist, Song, SongSummary, UserSession, Word, Note, Line } from "./types";
import type { SearchRow } from "./search";

export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const body = await res.json();
      msg = body.detail ?? msg;
    } catch {}
    throw new Error(msg || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => fetch(`${API}/api/health`).then(j<{ ok: boolean }>),
  listSongs: () => fetch(`${API}/api/songs`, { cache: "no-store" }).then(j<SongSummary[]>),
  catalog: () => fetch(`${API}/api/catalog`, { cache: "no-store" }).then(j<Catalog>),
  me: () => fetch(`${API}/api/me`, { cache: "no-store" }).then(j<Entitlements>),
  coverUrl: (id: string) => `${API}/api/catalog/${id}/cover`,
  /** An upload's cover (chosen, embedded in the file, or generated); `v` busts the cache after a change. */
  uploadCoverUrl: (id: string, v?: number) => `${API}/api/songs/${id}/cover${v ? `?v=${v}` : ""}`,
  putCover: (id: string, file: File) => { const fd = new FormData(); fd.append("file", file); return fetch(`${API}/api/songs/${id}/cover`, { method: "PUT", body: fd }).then(j<{ ok: boolean }>); },
  deleteCover: (id: string) => fetch(`${API}/api/songs/${id}/cover`, { method: "DELETE" }).then(j<{ ok: boolean }>),
  getSong: (id: string) => fetch(`${API}/api/songs/${id}`, { cache: "no-store" }).then(j<Song>),
  upload: (file: File, opts: { instrument?: string; detail_level?: string } = {}, onProgress?: (p: number) => void) =>
    new Promise<Song & { duplicate_of?: string }>((resolve, reject) => {
      const fd = new FormData();
      fd.append("file", file);
      if (opts.instrument) fd.append("instrument", opts.instrument);
      if (opts.detail_level) fd.append("detail_level", opts.detail_level);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API}/api/songs`);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
        else {
          let msg = "Upload failed";
          try { msg = JSON.parse(xhr.responseText).detail ?? msg; } catch {}
          reject(new Error(msg));
        }
      };
      xhr.onerror = () => reject(new Error("Could not reach the processing service. Is it running?"));
      xhr.send(fd);
    }),
  patchSong: (id: string, patch: Partial<{ title: string; artist: string; words: Word[]; notes: Note[]; lines: Line[]; user: UserSession; language_override: string }>) =>
    fetch(`${API}/api/songs/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }).then(j<Song>),
  deleteSong: (id: string) => fetch(`${API}/api/songs/${id}`, { method: "DELETE" }).then(j<{ ok: boolean }>),
  rerun: (id: string, step: string, params: { detail_level?: string; language?: string; hold_across_words?: boolean } = {}) =>
    fetch(`${API}/api/songs/${id}/steps/${step}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params) }).then(j<ProgressSnapshot>),
  pasteLyrics: (id: string, text: string) =>
    fetch(`${API}/api/songs/${id}/lyrics`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) }).then(j<Song>),
  getPastedLyrics: (id: string) => fetch(`${API}/api/songs/${id}/lyrics`).then(j<{ text: string }>),
  stopJob: (id: string) => fetch(`${API}/api/songs/${id}/stop`, { method: "POST" }).then(j<{ stopped: boolean }>),
  trimSong: (id: string, start: number, end: number | null) =>
    fetch(`${API}/api/songs/${id}/trim`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ start, end }) }).then(j<Song>),
  searchIndex: () => fetch(`${API}/api/search-index`, { cache: "no-store" }).then(j<{ songs: SearchRow[] }>),
  myLibrary: () => fetch(`${API}/api/me/library`, { cache: "no-store" }).then(j<MyLibrary>),
  setFavourite: (id: string, on: boolean) => fetch(`${API}/api/me/favourites/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on }) }).then(j<{ favourites: string[] }>),
  played: (id: string) => fetch(`${API}/api/songs/${id}/played`, { method: "POST" }).then(j<{ count: number; last: string }>),
  createSetlist: (body: Partial<Pick<Setlist, "name" | "songs" | "gap_seconds">>) => fetch(`${API}/api/me/setlists`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(j<Setlist>),
  updateSetlist: (id: string, body: Partial<Pick<Setlist, "name" | "songs" | "gap_seconds">>) => fetch(`${API}/api/me/setlists/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(j<Setlist>),
  deleteSetlist: (id: string) => fetch(`${API}/api/me/setlists/${id}`, { method: "DELETE" }).then(j<{ ok: boolean }>),
  /** Ask the service to render the keys one step up and down from `shift` now, so the next key change is instant. */
  prepareKeys: (id: string, shift: number) => fetch(`${API}/api/songs/${id}/prepare?shift=${shift}`, { method: "POST" }).then(j<{ queued: number }>),
  progressSnapshot: (id: string) => fetch(`${API}/api/songs/${id}/progress/snapshot`, { cache: "no-store" }).then(j<ProgressSnapshot>),
  audioUrl: (id: string, stem: "backing" | "vocals" | "original", shift = 0) => `${API}/api/songs/${id}/audio/${stem}${shift ? `?shift=${shift}` : ""}`,
  progressStream: (id: string, onSnapshot: (s: ProgressSnapshot) => void, onEnd: () => void) => {
    const es = new EventSource(`${API}/api/songs/${id}/progress`);
    es.onmessage = (e) => onSnapshot(JSON.parse(e.data));
    es.addEventListener("end", () => { es.close(); onEnd(); });
    es.onerror = () => { es.close(); onEnd(); };
    return () => es.close();
  },
};

export function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function isCatalogSong(song: Pick<Song, "source" | "catalog"> | null | undefined): boolean {
  return !!song && (song.source?.kind === "catalog" || !!song.catalog);
}

export function formatDuration(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.round(s / 60);
  return `about ${m} min`;
}
