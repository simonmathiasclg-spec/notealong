// The online version's implementation of `api` (lib/api.ts), with the same methods and results as the local
// one. Reads and simple changes go straight to Supabase as the signed-in user (row-level security keeps every
// query to their own rows and files); anything that needs the server or the processing service goes through
// the app's own routes under /api/cloud.
import type { Catalog, CatalogEntry, Entitlements, MyLibrary, Note, Line, ProgressSnapshot, Setlist, Song, SongSummary, UserSession, Word } from "../types";
import type { SearchRow } from "../search";
import { supabase, userId } from "./browser";
import { AUDIO_EXT, MAX_MINUTES, MAX_UPLOAD_MB, PROTECTED_EXT, SUPABASE_ANON_KEY, UPLOADS_PER_DAY, VIDEO_EXT, catalogFile } from "./config";
import { CATALOG_OVERLAY, snapshotFromSong } from "./songdata";

type Patch = Partial<{ title: string; artist: string; words: Word[]; notes: Note[]; lines: Line[]; user: UserSession; language_override: string }>;

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).detail ?? msg; } catch {}
    if (res.status === 401 && typeof window !== "undefined") window.location.assign(new URL(`/sign-in?next=${encodeURIComponent(window.location.pathname)}`, window.location.origin).href);
    throw new Error(msg || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

function check<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

// ---- the catalog (public files) ------------------------------------------------------------------
let catalogPromise: Promise<Catalog> | null = null;
function catalogIndex(): Promise<Catalog> {
  if (!catalogPromise) {
    catalogPromise = fetch(catalogFile("index.json")).then((r) => {
      if (!r.ok) throw new Error("The built-in songs could not be loaded.");
      return r.json() as Promise<Catalog>;
    }).then((c) => ({ ...c, songs: c.songs.map((s) => ({ ...s, cover_url: catalogFile(`${s.id}/cover.webp`) })) }));
    catalogPromise.catch(() => { catalogPromise = null; });
  }
  return catalogPromise;
}

async function catalogEntry(id: string): Promise<CatalogEntry | null> {
  const c = await catalogIndex();
  return c.songs.find((s) => s.id === id) ?? null;
}

// built-in songs never change while the app is open; their files are fetched once
const catalogBase = new Map<string, Promise<Song>>();
function catalogBaseSong(id: string): Promise<Song> {
  let p = catalogBase.get(id);
  if (!p) {
    p = fetch(catalogFile(`${id}/song.json`)).then((r) => {
      if (!r.ok) throw new Error("Song not found");
      return r.json() as Promise<Song>;
    });
    p.catch(() => catalogBase.delete(id));
    catalogBase.set(id, p);
  }
  return p;
}

type CatalogEdits = { data: Partial<Song>; updated_at: string };

function withEdits(base: Song, entry: CatalogEntry, edits: CatalogEdits | null): Song {
  const song: Song = { ...base, catalog: entry };
  if (edits) {
    for (const k of CATALOG_OVERLAY) if (k in edits.data) (song as Record<string, unknown>)[k] = edits.data[k];
    song.updated_at = edits.updated_at;
  }
  return song;
}

async function catalogSong(entry: CatalogEntry): Promise<Song> {
  const [base, edits] = await Promise.all([
    catalogBaseSong(entry.id),
    supabase().from("catalog_edits").select("data,updated_at").eq("song_id", entry.id).maybeSingle().then(check),
  ]);
  return withEdits(base, entry, edits as CatalogEdits | null);
}

// ---- uploads -------------------------------------------------------------------------------------
type SongRow = { id: string; status: string; data: Song; created_at: string; updated_at: string };

function fromRow(row: SongRow): Song {
  const s = row.data;
  // a file whose upload never finished (the tab was closed) is shown as failed after a while
  if (row.status === "uploading" && Date.now() - Date.parse(row.created_at) > 30 * 60 * 1000) {
    return { ...s, status: "failed", error: "The upload didn't finish. Delete this song and add the file again." };
  }
  return s;
}

async function uploadRow(id: string): Promise<SongRow | null> {
  return check(await supabase().from("songs").select("id,status,data,created_at,updated_at").eq("id", id).maybeSingle()) as SongRow | null;
}

const SUMMARY = "id,status,created_at,updated_at,title,artist,duration,search,schema_version:data->schema_version,tempo_bpm:data->tempo_bpm,source:data->source,files:data->files,language:data->language,key:data->key,settings:data->settings,user:data->user,steps:data->steps,error:data->error,quality:data->quality,dstatus:data->status";

async function sha256(file: File): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The length of an audio or video file in seconds, if the browser can read it (null if it can't). */
function mediaSeconds(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const el = document.createElement(file.type.startsWith("video/") ? "video" : "audio");
    const url = URL.createObjectURL(file);
    const done = (v: number | null) => { URL.revokeObjectURL(url); resolve(v); };
    el.preload = "metadata";
    el.onloadedmetadata = () => done(isFinite(el.duration) ? el.duration : null);
    el.onerror = () => done(null);
    setTimeout(() => done(null), 8000);
    el.src = url;
  });
}

function putFile(url: string, file: File, onProgress?: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("apikey", SUPABASE_ANON_KEY);
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.setRequestHeader("x-upsert", "true");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("The upload was interrupted. Try again.")));
    xhr.onerror = () => reject(new Error("The upload was interrupted. Check your connection and try again."));
    xhr.send(file);
  });
}

async function myFavourites(): Promise<string[]> {
  const rows = check(await supabase().from("favourites").select("song_id").order("created_at")) as { song_id: string }[];
  return rows.map((r) => r.song_id);
}

function setlistOut(r: Setlist): Setlist {
  return { id: r.id, name: r.name, songs: r.songs ?? [], gap_seconds: r.gap_seconds, created_at: r.created_at, updated_at: r.updated_at };
}

export const cloudApi = {
  health: async () => ({ ok: true }),

  listSongs: async (): Promise<SongSummary[]> => {
    const rows = check(await supabase().from("songs").select(SUMMARY).order("created_at", { ascending: false })) as unknown as (Record<string, unknown> & { search: { word_count?: number; note_count?: number } | null })[];
    return rows.map((r) => {
      const { search, dstatus, ...rest } = r;
      const row = { ...rest, status: dstatus ?? r.status } as unknown as SongSummary;
      const out = fromRow({ id: row.id, status: r.status as string, data: row as unknown as Song, created_at: row.created_at, updated_at: row.updated_at });
      return { ...(out as unknown as SongSummary), word_count: search?.word_count ?? 0, note_count: search?.note_count ?? 0 };
    });
  },

  catalog: async (): Promise<Catalog> => {
    const [c, plays] = await Promise.all([catalogIndex(), supabase().from("plays").select("song_id,last")]);
    const last = new Map(((plays.data ?? []) as { song_id: string; last: string }[]).map((p) => [p.song_id, p.last]));
    return { ...c, songs: c.songs.map((s) => ({ ...s, last_played: last.get(s.id) ?? null })) };
  },

  me: async (): Promise<Entitlements> => {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const r = await supabase().from("jobs").select("id", { count: "exact", head: true }).eq("kind", "process").eq("params->>new", "true").gte("created_at", since);
    const used = r.count ?? 0;
    return { plan: "beta", uploads: { used, limit: UPLOADS_PER_DAY, remaining: Math.max(0, UPLOADS_PER_DAY - used) }, catalog: "free" };
  },

  coverUrl: (id: string) => catalogFile(`${id}/cover.webp`),
  uploadCoverUrl: (id: string, v?: number) => `/api/cloud/songs/${id}/cover${v ? `?v=${v}` : ""}`,

  putCover: async (id: string, file: File) => {
    if (file.size > 10 * 1024 * 1024) throw new Error("That picture is bigger than 10 MB.");
    const ext = file.type === "image/png" ? "png" : file.type === "image/jpeg" ? "jpg" : null;
    if (!ext) throw new Error("Use a JPEG or PNG picture for the cover.");
    const uid = await userId();
    const bucket = supabase().storage.from("uploads");
    await bucket.remove([`${uid}/${id}/cover_user.jpg`, `${uid}/${id}/cover_user.png`]);
    check(await bucket.upload(`${uid}/${id}/cover_user.${ext}`, file, { upsert: true, contentType: file.type, cacheControl: "60" }));
    return { ok: true };
  },

  deleteCover: async (id: string) => {
    const uid = await userId();
    await supabase().storage.from("uploads").remove([`${uid}/${id}/cover_user.jpg`, `${uid}/${id}/cover_user.png`]);
    return { ok: true };
  },

  getSong: async (id: string): Promise<Song> => {
    const entry = await catalogEntry(id).catch(() => null);
    if (entry) return catalogSong(entry);
    const row = await uploadRow(id);
    if (!row) throw new Error("Song not found");
    return fromRow(row);
  },

  upload: async (file: File, opts: { instrument?: string; detail_level?: string } = {}, onProgress?: (p: number) => void): Promise<Song & { duplicate_of?: string }> => {
    const ext = (file.name.split(".").pop() ?? "").toLowerCase();
    if (PROTECTED_EXT.includes(ext)) throw new Error("That is a copy-protected file (Apple Music or an audiobook). It can only play in its own app. Use a song you own as an MP3, M4A, WAV or FLAC, or a recording.");
    if (!AUDIO_EXT.includes(ext) && !VIDEO_EXT.includes(ext)) throw new Error("That kind of file isn't supported. Use an audio file (MP3, M4A, WAV, FLAC, OGG) or a video (MP4, MOV, WEBM, MKV).");
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) throw new Error(`That file is bigger than ${MAX_UPLOAD_MB} MB. Export the song as an MP3 or M4A, or trim a video to the song.`);
    const secs = await mediaSeconds(file);
    if (secs !== null && secs > MAX_MINUTES * 60 + 5) throw new Error(`That file is longer than ${MAX_MINUTES} minutes. Please upload a single song.`);
    const hash = await sha256(file);
    const start = await call<{ song: Song; duplicate_of?: string; upload?: { url: string } }>("/api/cloud/uploads", {
      method: "POST", body: JSON.stringify({ filename: file.name, size: file.size, hash, instrument: opts.instrument, detail_level: opts.detail_level }),
    });
    if (start.duplicate_of) return { ...start.song, duplicate_of: start.duplicate_of };
    await putFile(start.upload!.url, file, onProgress);
    const out = await call<{ song: Song }>(`/api/cloud/songs/${start.song.id}/jobs`, { method: "POST", body: JSON.stringify({ kind: "process", new: true }) });
    return out.song;
  },

  patchSong: async (id: string, patch: Patch): Promise<Song> => {
    const entry = await catalogEntry(id).catch(() => null);
    if (entry) {
      const [base, prev] = await Promise.all([
        catalogBaseSong(id),
        supabase().from("catalog_edits").select("data").eq("song_id", id).maybeSingle().then(check) as Promise<{ data: Partial<Song> } | null>,
      ]);
      const data: Partial<Song> = { ...(prev?.data ?? {}) };
      if (patch.user !== undefined) data.user = patch.user;
      for (const k of ["notes", "words", "lines"] as const) if (patch[k] !== undefined) (data as Record<string, unknown>)[k] = patch[k];
      const updated_at = new Date().toISOString();
      check(await supabase().from("catalog_edits").upsert({ user_id: await userId(), song_id: id, data, updated_at }));
      return withEdits(base, entry, { data, updated_at });
    }
    const row = await uploadRow(id);
    if (!row) throw new Error("Song not found");
    const s: Song = { ...row.data };
    if (patch.title !== undefined) s.title = patch.title;
    if (patch.artist !== undefined) s.artist = patch.artist;
    if (patch.words !== undefined) s.words = patch.words;
    if (patch.notes !== undefined) s.notes = patch.notes;
    if (patch.lines !== undefined) s.lines = patch.lines;
    if (patch.user !== undefined) s.user = patch.user;
    if (patch.language_override !== undefined) s.language = { ...s.language, override: patch.language_override || null };
    s.updated_at = new Date().toISOString();
    check(await supabase().from("songs").update({ data: s, title: s.title, artist: s.artist ?? null, updated_at: s.updated_at }).eq("id", id));
    return s;
  },

  deleteSong: async (id: string) => {
    const entry = await catalogEntry(id).catch(() => null);
    if (entry) {
      check(await supabase().from("catalog_edits").delete().eq("song_id", id));
      return { ok: true };
    }
    return call<{ ok: boolean }>(`/api/cloud/songs/${id}`, { method: "DELETE" });
  },

  rerun: (id: string, step: string, params: { detail_level?: string; language?: string; hold_across_words?: boolean } = {}) =>
    call<{ snapshot: ProgressSnapshot }>(`/api/cloud/songs/${id}/jobs`, { method: "POST", body: JSON.stringify({ kind: "process", step, ...params }) }).then((r) => r.snapshot),

  pasteLyrics: (id: string, text: string) =>
    call<{ song: Song }>(`/api/cloud/songs/${id}/jobs`, { method: "POST", body: JSON.stringify({ kind: "lyrics", text }) }).then((r) => r.song),

  getPastedLyrics: async (id: string) => {
    const row = check(await supabase().from("songs").select("pasted_lyrics").eq("id", id).maybeSingle()) as { pasted_lyrics: string | null } | null;
    return { text: row?.pasted_lyrics ?? "" };
  },

  stopJob: (id: string) => call<{ stopped: boolean }>(`/api/cloud/songs/${id}/stop`, { method: "POST" }),

  trimSong: (id: string, start: number, end: number | null) =>
    call<{ song: Song }>(`/api/cloud/songs/${id}/jobs`, { method: "POST", body: JSON.stringify({ kind: "trim", start, end }) }).then((r) => r.song),

  searchIndex: async (): Promise<{ songs: SearchRow[] }> => {
    const [cat, rows] = await Promise.all([
      fetch(catalogFile("search-index.json")).then((r) => (r.ok ? (r.json() as Promise<{ songs: SearchRow[] }>) : { songs: [] })),
      supabase().from("songs").select("id,title,artist,duration,created_at,search,status").eq("status", "ready"),
    ]);
    const mine = ((rows.data ?? []) as { id: string; title: string; artist: string | null; duration: number; created_at: string; search: Record<string, unknown> | null }[]).map((r): SearchRow => ({
      id: r.id, kind: "upload", title: r.title, artist: r.artist, genre: null, culture: null, origin: null,
      language: (r.search?.language as string) ?? null, year: null, tempo_bpm: (r.search?.tempo_bpm as number) ?? null,
      duration: r.duration, source: "upload", tags: [], added: r.created_at.slice(0, 10), featured: false, accent_hue: null,
      range: (r.search?.range as [number, number]) ?? null, lyrics: (r.search?.lyrics as string) ?? "", note_count: (r.search?.note_count as number) ?? 0,
      difficulty: (r.search?.difficulty as SearchRow["difficulty"]) ?? null,
    }));
    return { songs: [...cat.songs, ...mine] };
  },

  myLibrary: async (): Promise<MyLibrary> => {
    const [favs, plays, sets] = await Promise.all([
      myFavourites(),
      supabase().from("plays").select("song_id,count,last"),
      supabase().from("setlists").select("*").order("created_at"),
    ]);
    const p: MyLibrary["plays"] = {};
    for (const r of (plays.data ?? []) as { song_id: string; count: number; last: string }[]) p[r.song_id] = { count: r.count, last: r.last };
    return { favourites: favs, plays: p, setlists: ((sets.data ?? []) as Setlist[]).map(setlistOut) };
  },

  setFavourite: async (id: string, on: boolean) => {
    if (on) check(await supabase().from("favourites").upsert({ user_id: await userId(), song_id: id }, { ignoreDuplicates: true }));
    else check(await supabase().from("favourites").delete().eq("song_id", id));
    return { favourites: await myFavourites() };
  },

  played: async (id: string) => {
    const r = check(await supabase().rpc("record_play", { p_song_id: id })) as { count: number; last: string };
    return { count: r.count, last: r.last };
  },

  createSetlist: async (body: Partial<Pick<Setlist, "name" | "songs" | "gap_seconds">>) => {
    const row = check(await supabase().from("setlists").insert({ user_id: await userId(), name: body.name ?? "New setlist", songs: body.songs ?? [], gap_seconds: body.gap_seconds ?? 8 }).select("*").single()) as Setlist;
    return setlistOut(row);
  },
  updateSetlist: async (id: string, body: Partial<Pick<Setlist, "name" | "songs" | "gap_seconds">>) => {
    const row = check(await supabase().from("setlists").update({ ...body, updated_at: new Date().toISOString() }).eq("id", id).select("*").single()) as Setlist;
    return setlistOut(row);
  },
  deleteSetlist: async (id: string) => {
    check(await supabase().from("setlists").delete().eq("id", id));
    return { ok: true };
  },

  prepareKeys: (id: string, shift: number) => call<{ queued: number }>(`/api/cloud/songs/${id}/prepare?shift=${shift}`, { method: "POST" }),

  progressSnapshot: async (id: string): Promise<ProgressSnapshot> => {
    const [row, job] = await Promise.all([
      uploadRow(id),
      supabase().from("jobs").select("status,snapshot,error,kind,created_at,started_at").eq("song_id", id).eq("kind", "process").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const j = job.data as { status: string; snapshot: ProgressSnapshot | null; error: string | null; created_at: string; started_at: string | null } | null;
    // a job that never started, or ran far longer than any song takes, is shown as stopped so it can be retried
    const age = (s: string | null | undefined) => (s ? (Date.now() - Date.parse(s)) / 60000 : 0);
    if (j && ((j.status === "queued" && age(j.created_at) > 15) || (j.status === "running" && age(j.started_at) > 45))) {
      const r = row ? fromRow(row) : null;
      if (r) return { ...snapshotFromSong(r), status: "failed", error: "Processing didn't finish. Press retry to continue from where it left off." };
    }
    // the same recording was already in this user's songs: the new copy is gone and the snapshot names the old one
    if (j?.snapshot?.duplicate_of) return j.snapshot;
    if (!row) throw new Error("Song not found");
    const song = fromRow(row);
    if (j?.snapshot && j.status === "running") return j.snapshot;
    if (j && j.status === "queued") return { ...snapshotFromSong({ ...song, status: "processing" }, true), current: null };
    return snapshotFromSong(song);
  },

  audioUrl: (id: string, stem: "backing" | "vocals" | "original", shift = 0) => `/api/cloud/songs/${id}/audio/${stem}${shift ? `?shift=${shift}` : ""}`,

  progressStream: (id: string, onSnapshot: (s: ProgressSnapshot) => void, onEnd: () => void) => {
    let stopped = false;
    let last = "";
    const tick = async () => {
      if (stopped) return;
      try {
        const snap = await cloudApi.progressSnapshot(id);
        const key = JSON.stringify(snap);
        if (key !== last) { last = key; onSnapshot(snap); }
        if (snap.status !== "processing") { stopped = true; onEnd(); return; }
      } catch { /* a dropped request: try again on the next tick */ }
      if (!stopped) setTimeout(tick, 1500);
    };
    tick();
    return () => { stopped = true; };
  },
};
