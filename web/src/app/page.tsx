"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { AlertCircle, Loader2, Music2, Search, Trash2 } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { Welcome } from "@/components/Welcome";
import { PageDropZone, UploadButton } from "@/components/UploadZone";
import { InstrumentIcon } from "@/components/InstrumentIcon";
import { api, formatTime } from "@/lib/api";
import { getInstrument } from "@/lib/instruments";
import { hasChosenInstrument, useInstrumentPref } from "@/lib/prefs";
import type { SongSummary } from "@/lib/types";

type Upload = { name: string; progress: number; error?: string };

export default function LibraryPage() {
  const [songs, setSongs] = useState<SongSummary[] | null>(null);
  const [serviceDown, setServiceDown] = useState(false);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"recent" | "title">("recent");
  const [welcome, setWelcome] = useState(false);
  const [instrument, setInstrument, loaded] = useInstrumentPref();

  const refresh = useCallback(async () => {
    try {
      setSongs(await api.listSongs());
      setServiceDown(false);
    } catch {
      setServiceDown(true);
      setSongs([]);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { if (loaded && !hasChosenInstrument()) setWelcome(true); }, [loaded]);
  // Poll while anything is processing so statuses stay fresh.
  useEffect(() => {
    if (!songs?.some((s) => s.status === "processing")) return;
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [songs, refresh]);

  const onFiles = useCallback(async (files: File[]) => {
    for (const file of files) {
      const entry: Upload = { name: file.name, progress: 0 };
      setUploads((u) => [...u, entry]);
      try {
        await api.upload(file, { instrument }, (p) => setUploads((u) => u.map((x) => (x === entry ? { ...x, progress: p } : x))));
        setUploads((u) => u.filter((x) => x !== entry));
        await refresh();
      } catch (e) {
        setUploads((u) => u.map((x) => (x === entry ? { ...x, error: (e as Error).message } : x)));
      }
    }
  }, [instrument, refresh]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = songs ?? [];
    if (q) list = list.filter((s) => `${s.title} ${s.artist ?? ""}`.toLowerCase().includes(q));
    if (sort === "title") list = [...list].sort((a, b) => a.title.localeCompare(b.title));
    return list;
  }, [songs, query, sort]);

  const many = (songs?.length ?? 0) > 5;

  return (
    <div className="flex min-h-full flex-col">
      <AppHeader right={<UploadButton onFiles={onFiles} />} />
      <PageDropZone onFiles={onFiles} />
      <Welcome open={welcome} onDone={(id) => { setInstrument(id); setWelcome(false); }} />

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 pb-16 sm:px-8">
        {serviceDown && (
          <div className="card mb-6 flex items-start gap-3 border-danger/40 p-4 text-sm">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
            <div>
              <div className="font-semibold">The processing service isn&apos;t running.</div>
              <div className="text-muted">Start it with <code className="kbd">./service/run.sh</code> and refresh this page.</div>
            </div>
          </div>
        )}

        {uploads.length > 0 && (
          <div className="mb-6 space-y-2">
            {uploads.map((u, i) => (
              <div key={i} className="card flex items-center gap-3 p-3 text-sm">
                {u.error ? <AlertCircle className="h-5 w-5 text-danger" /> : <Loader2 className="h-5 w-5 animate-spin text-accent" />}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{u.name}</div>
                  <div className="text-muted">{u.error ?? (u.progress < 1 ? `Uploading… ${Math.round(u.progress * 100)}%` : "Starting…")}</div>
                </div>
                {u.error && <button className="btn btn-ghost" onClick={() => setUploads((x) => x.filter((y) => y !== u))}>Dismiss</button>}
              </div>
            ))}
          </div>
        )}

        {songs === null ? (
          <div className="flex justify-center py-24 text-muted"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : songs.length === 0 ? (
          <EmptyState onFiles={onFiles} />
        ) : (
          <>
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="font-display text-3xl font-extrabold tracking-tight">Your songs</h1>
                <p className="text-sm text-muted">Playing as <span className="font-semibold text-fg">{getInstrument(instrument).name}</span>. Drop a file anywhere to add a song.</p>
              </div>
              {many && (
                <div className="flex items-center gap-2">
                  <label className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                    <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" className="rounded-full border border-border bg-elev py-2 pl-9 pr-4 text-sm" />
                  </label>
                  <div className="seg">
                    <button aria-pressed={sort === "recent"} onClick={() => setSort("recent")}>Recent</button>
                    <button aria-pressed={sort === "title"} onClick={() => setSort("title")}>A–Z</button>
                  </div>
                </div>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((s) => <SongCard key={s.id} song={s} onDeleted={refresh} />)}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function EmptyState({ onFiles }: { onFiles: (f: File[]) => void }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mx-auto flex max-w-xl flex-col items-center py-20 text-center">
      <div className="mb-6 grid h-20 w-20 place-items-center rounded-3xl bg-accent-soft text-accent-strong"><Music2 className="h-10 w-10" /></div>
      <h1 className="font-display text-3xl font-extrabold tracking-tight">Play the tune of any song</h1>
      <p className="mt-3 text-lg text-muted">Upload a song and NoteAlong shows you which note to play for every word, while the backing track plays.</p>
      <div className="mt-8"><UploadButton onFiles={onFiles} big label="Add a song (MP3, WAV or M4A)" /></div>
      <p className="mt-4 text-sm text-faint">or drop a file anywhere on this page</p>
    </motion.div>
  );
}

function SongCard({ song, onDeleted }: { song: SongSummary; onDeleted: () => void }) {
  const inst = getInstrument(song.user?.instrument ?? "alto_sax");
  const status = song.status;
  const runningStep = Object.entries(song.steps ?? {}).find(([, s]) => s.status === "running")?.[0];
  const stepLabel: Record<string, string> = { stems: "Separating the vocals", melody: "Finding the notes", lyrics: "Reading the lyrics", attach: "Lining it all up", cleanup: "Tidying the notes" };
  const remove = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!confirm(`Delete “${song.title}”? This cannot be undone.`)) return;
    await api.deleteSong(song.id);
    onDeleted();
  };
  return (
    <Link href={`/songs/${song.id}`} className="card group relative flex gap-4 p-4 transition hover:-translate-y-0.5">
      <div className={`grid h-14 w-14 shrink-0 place-items-center rounded-xl ${status === "ready" ? "bg-accent-soft text-accent-strong" : status === "failed" ? "bg-danger-soft text-danger" : "bg-sunken text-muted"}`}>
        {status === "processing" ? <Loader2 className="h-6 w-6 animate-spin" /> : status === "failed" ? <AlertCircle className="h-6 w-6" /> : <Music2 className="h-6 w-6" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-display text-lg font-bold leading-tight">{song.title}</div>
        <div className="truncate text-sm text-muted">{song.artist ?? "Unknown artist"} · {formatTime(song.duration)}</div>
        <div className="mt-2 flex items-center gap-2 text-xs text-muted">
          {status === "ready" && (<><InstrumentIcon icon={inst.icon} className="h-4 w-4" /> {inst.name}{song.key ? ` · ${song.key.name}` : ""}</>)}
          {status === "processing" && <span className="text-accent-strong">{runningStep ? stepLabel[runningStep] : "Waiting to start"}…</span>}
          {status === "failed" && <span className="text-danger">Needs attention</span>}
        </div>
      </div>
      <button onClick={remove} className="absolute right-2 top-2 rounded-full p-2 text-faint opacity-0 transition hover:bg-sunken hover:text-danger group-hover:opacity-100" aria-label="Delete song"><Trash2 className="h-4 w-4" /></button>
    </Link>
  );
}
