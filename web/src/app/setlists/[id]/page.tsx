"use client";
// One setlist: rename it, set the gap, put the songs in order (drag, or the arrow buttons), add and
// remove songs, and play it straight through.
import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowLeft, ArrowUp, GripVertical, Play, Plus, Search, X } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { api, formatTime } from "@/lib/api";
import { useMe } from "@/lib/me";
import { scoreRow, type SearchRow } from "@/lib/search";
import { setlistSongHref } from "@/components/player/SetlistBar";

export default function SetlistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { setlists, loaded, updateSetlist } = useMe();
  const sl = setlists.find((s) => s.id === id);
  const [rows, setRows] = useState<SearchRow[]>([]);
  const [q, setQ] = useState("");
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  useEffect(() => { api.searchIndex().then((r) => setRows(r.songs)).catch(() => undefined); }, []);
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const matches = useMemo(() => {
    if (!q.trim() || !sl) return [];
    return rows.filter((r) => !sl.songs.includes(r.id)).map((r) => ({ r, s: scoreRow(r, q) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 8).map((x) => x.r);
  }, [q, rows, sl]);

  if (!loaded) return <div className="flex min-h-full flex-col"><AppHeader /><div className="mx-auto w-full max-w-3xl px-5"><div className="skel h-40 w-full" /></div></div>;
  if (!sl) return (
    <div className="flex min-h-full flex-col"><AppHeader />
      <div className="mx-auto max-w-md px-6 py-16 text-center"><h1 className="display-md text-2xl">That setlist isn&apos;t here</h1><Link href="/setlists" className="btn mt-6">All setlists</Link></div>
    </div>
  );
  const move = (from: number, to: number) => {
    if (to < 0 || to >= sl.songs.length || from === to) return;
    const songs = [...sl.songs];
    const [x] = songs.splice(from, 1);
    songs.splice(to, 0, x);
    updateSetlist(sl.id, { songs });
  };
  const total = sl.songs.reduce((t, sid) => t + (byId.get(sid)?.duration ?? 0), 0) + Math.max(0, sl.songs.length - 1) * sl.gap_seconds;

  return (
    <div className="flex min-h-full flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 pb-20 sm:px-8">
        <Link href="/setlists" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" /> Setlists</Link>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <input className="display-lg -ml-1 min-w-0 flex-1 rounded-lg bg-transparent px-1 text-[2.1rem] outline-offset-2 hover:bg-hover focus:bg-hover" value={sl.name} onChange={(e) => updateSetlist(sl.id, { name: e.target.value })} aria-label="Setlist name" />
          {sl.songs.length > 0 && <Link href={setlistSongHref(sl.id, sl.songs, 0)} className="btn btn-primary btn-lg"><Play className="h-4 w-4 fill-current" /> Play the set</Link>}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
          <span>{sl.songs.length === 1 ? "1 song" : `${sl.songs.length} songs`}{sl.songs.length ? `, about ${formatTime(total)}` : ""}</span>
          <label className="inline-flex items-center gap-2">Gap between songs
            <select className="field h-8 py-0 pr-7 text-sm" value={sl.gap_seconds} onChange={(e) => updateSetlist(sl.id, { gap_seconds: Number(e.target.value) })}>
              {[0, 3, 5, 10, 15, 30].map((g) => <option key={g} value={g}>{g === 0 ? "none" : `${g} s`}</option>)}
            </select>
          </label>
        </div>

        <ol className="panel mt-6 divide-y divide-border" aria-label="Songs in this setlist">
          {sl.songs.length === 0 && <li className="p-6 text-center text-sm text-muted">No songs yet. Find some below.</li>}
          {sl.songs.map((sid, i) => {
            const r = byId.get(sid);
            return (
              <li key={sid} draggable
                onDragStart={(e) => { setDrag(i); e.dataTransfer.effectAllowed = "move"; }}
                onDragOver={(e) => { e.preventDefault(); setOver(i); }}
                onDragEnd={() => { setDrag(null); setOver(null); }}
                onDrop={(e) => { e.preventDefault(); if (drag !== null) move(drag, i); setDrag(null); setOver(null); }}
                className={`group flex items-center gap-3 px-3 py-2.5 sm:px-4 ${drag === i ? "opacity-40" : ""} ${over === i && drag !== null && drag !== i ? "bg-hover" : ""}`}>
                <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-faint" aria-hidden="true" />
                <span className="tabular w-6 shrink-0 text-right text-sm text-faint">{i + 1}</span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r?.kind === "upload" ? api.uploadCoverUrl(sid) : api.coverUrl(sid)} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
                <Link href={setlistSongHref(sl.id, sl.songs, i, false)} className="min-w-0 flex-1">
                  <div className="truncate font-medium">{r?.title ?? sid}</div>
                  <div className="truncate text-xs text-muted">{r?.artist ?? ""}{r?.duration ? ` · ${formatTime(r.duration)}` : ""}</div>
                </Link>
                <button className="btn btn-ghost btn-icon btn-sm" disabled={i === 0} onClick={() => move(i, i - 1)} aria-label={`Move ${r?.title ?? "song"} up`}><ArrowUp className="h-4 w-4" /></button>
                <button className="btn btn-ghost btn-icon btn-sm" disabled={i === sl.songs.length - 1} onClick={() => move(i, i + 1)} aria-label={`Move ${r?.title ?? "song"} down`}><ArrowDown className="h-4 w-4" /></button>
                <button className="btn btn-ghost btn-icon btn-sm text-faint hover:text-danger" onClick={() => updateSetlist(sl.id, { songs: sl.songs.filter((x) => x !== sid) })} aria-label={`Remove ${r?.title ?? "song"} from the setlist`}><X className="h-4 w-4" /></button>
              </li>
            );
          })}
        </ol>

        <section className="mt-8" aria-label="Add songs">
          <h2 className="display-md text-[1.3rem]">Add songs</h2>
          <label className="relative mt-3 block">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
            <input className="field w-full pl-10" placeholder="Search built-in songs and your own" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search songs to add" />
          </label>
          {matches.length > 0 && (
            <ul className="panel mt-3 divide-y divide-border">
              {matches.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1"><div className="truncate font-medium">{r.title}</div><div className="truncate text-xs text-muted">{r.artist}{r.kind === "upload" ? " · Mine" : ""}</div></div>
                  <button className="btn btn-sm" onClick={() => updateSetlist(sl.id, { songs: [...sl.songs, r.id] })}><Plus className="h-3.5 w-3.5" /> Add</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
