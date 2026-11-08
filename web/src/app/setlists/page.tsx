"use client";
// Your setlists: named running orders of songs that play straight through.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ListMusic, Play, Plus, Trash2 } from "lucide-react";
import { AppHeader, MobileSearch } from "@/components/AppHeader";
import { api, formatTime } from "@/lib/api";
import { useMe } from "@/lib/me";
import type { SearchRow } from "@/lib/search";
import { setlistSongHref } from "@/components/player/SetlistBar";

export default function SetlistsPage() {
  const { setlists, loaded, createSetlist, deleteSetlist } = useMe();
  const [rows, setRows] = useState<SearchRow[]>([]);
  const [name, setName] = useState("");
  const router = useRouter();
  useEffect(() => { api.searchIndex().then((r) => setRows(r.songs)).catch(() => undefined); }, []);
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const s = await createSetlist(name.trim() || "My setlist");
    if (s) router.push(`/setlists/${s.id}`);
  };
  return (
    <div className="flex min-h-full flex-col">
      <AppHeader />
      <MobileSearch />
      <main className="mx-auto w-full max-w-4xl flex-1 px-5 pb-20 sm:px-8">
        <h1 className="display-lg text-[2.2rem]">Setlists</h1>
        <p className="mt-1.5 max-w-xl text-sm text-muted">A running order for a practice session or a gig. A setlist plays straight through, with a short gap between songs.</p>
        <form onSubmit={create} className="mt-6 flex max-w-md gap-2">
          <input className="field min-w-0 flex-1" placeholder="Name a new setlist, e.g. Sunday gig" value={name} onChange={(e) => setName(e.target.value)} aria-label="New setlist name" />
          <button className="btn btn-primary" type="submit"><Plus className="h-4 w-4" /> Create</button>
        </form>
        <div className="mt-8">
          {!loaded ? (
            <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="skel h-20 w-full" />)}</div>
          ) : setlists.length === 0 ? (
            <div className="panel p-8 text-center">
              <ListMusic className="mx-auto h-7 w-7 text-accent" />
              <div className="mt-3 font-medium">No setlists yet</div>
              <p className="mt-1 text-sm text-muted">Create one above, or use the list button in the player to add the song you are playing.</p>
            </div>
          ) : (
            <ul className="panel divide-y divide-border">
              {setlists.map((s) => {
                const total = s.songs.reduce((t, id) => t + (byId.get(id)?.duration ?? 0), 0) + Math.max(0, s.songs.length - 1) * s.gap_seconds;
                return (
                  <li key={s.id} className="group flex items-center gap-4 px-4 py-3.5 sm:px-5">
                    <Link href={`/setlists/${s.id}`} className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{s.name}</div>
                      <div className="mt-0.5 truncate text-sm text-muted">
                        {s.songs.length === 1 ? "1 song" : `${s.songs.length} songs`}{s.songs.length ? ` · about ${formatTime(total)}` : ""}
                        {s.songs.length ? ` · ${s.songs.slice(0, 3).map((id) => byId.get(id)?.title).filter(Boolean).join(", ")}${s.songs.length > 3 ? "…" : ""}` : ""}
                      </div>
                    </Link>
                    {s.songs.length > 0 && <Link href={setlistSongHref(s.id, s.songs, 0)} className="btn btn-sm"><Play className="h-3.5 w-3.5 fill-current" /> Play</Link>}
                    <button className="rounded-full p-2 text-faint opacity-0 transition hover:bg-sunken hover:text-danger focus-visible:opacity-100 group-hover:opacity-100" onClick={() => { if (confirm(`Delete the setlist “${s.name}”? The songs stay in your library.`)) deleteSetlist(s.id); }} aria-label={`Delete ${s.name}`}><Trash2 className="h-4 w-4" /></button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}
