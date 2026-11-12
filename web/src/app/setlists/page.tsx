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
import { artField } from "@/components/art/Art";
import { SiteFooter } from "@/components/SiteFooter";

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
      <main className="mx-auto w-full max-w-[90rem] flex-1 px-5 pb-10 sm:px-8 lg:px-12">
        <MobileSearch />
        <div className="grid gap-8 pt-2 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <h1 className="display-hero text-[clamp(3.6rem,10vw,8.5rem)]">Setlists</h1>
            <p className="mt-4 max-w-xl text-[14px] text-muted">A running order for a practice session or a gig. A setlist plays straight through, with a short gap between songs.</p>
          </div>
          <form onSubmit={create} className="flex w-full max-w-md gap-2 lg:w-[26rem]">
            <input className="field min-w-0 flex-1" placeholder="Name a new setlist, e.g. Sunday gig" value={name} onChange={(e) => setName(e.target.value)} aria-label="New setlist name" />
            <button className="btn btn-primary" type="submit"><Plus className="h-4 w-4" strokeWidth={2} /> Create</button>
          </form>
        </div>
        <div className="mt-12">
          {!loaded ? (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="skel squircle h-72 w-full" />)}</div>
          ) : setlists.length === 0 ? (
            <div className="border-y border-border py-16 text-center">
              <ListMusic className="mx-auto h-8 w-8 text-muted" strokeWidth={1.4} />
              <div className="display-lg mt-4 text-[clamp(1.8rem,4vw,2.6rem)]">No setlists yet</div>
              <p className="mx-auto mt-3 max-w-md text-[14px] text-muted">Name one above, or use the list button in the player to add the song you are playing.</p>
            </div>
          ) : (
            <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {setlists.map((s) => {
                const total = s.songs.reduce((t, id) => t + (byId.get(id)?.duration ?? 0), 0) + Math.max(0, s.songs.length - 1) * s.gap_seconds;
                const covers = s.songs.slice(0, 3).map((id) => (byId.get(id)?.kind === "upload" ? api.uploadCoverUrl(id) : api.coverUrl(id)));
                const first = s.songs[0] ? byId.get(s.songs[0]) : undefined;
                return (
                  <li key={s.id} className="group/tile relative">
                    <Link href={`/setlists/${s.id}`} className="art-surface grain squircle flex h-72 flex-col p-6" style={{ background: artField(first?.colors) }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {covers[0] && <img src={covers[0]} alt="" className="art squircle" style={{ filter: "blur(28px) saturate(1.2) brightness(.7)", transform: "scale(1.3)" }} />}
                      <span className="relative mx-auto mt-2 block h-32 w-40" aria-hidden="true">
                        {covers.map((c, i) => (
                          // a fan of the first songs, like cards in the ring on Discover
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={i} src={c} alt="" className="absolute left-1/2 top-0 h-32 w-24 rounded-[14px] object-cover shadow-[0_20px_40px_-14px_rgba(0,0,0,.8)] transition duration-500 group-hover/tile:[transform:var(--fan-open)]"
                            style={{ transform: `translateX(${-50 + (i - (covers.length - 1) / 2) * 34}%) rotate(${(i - (covers.length - 1) / 2) * 9}deg)`, zIndex: i === 1 ? 3 : 2, "--fan-open": `translateX(${-50 + (i - (covers.length - 1) / 2) * 52}%) rotate(${(i - (covers.length - 1) / 2) * 13}deg)` } as React.CSSProperties} />
                        ))}
                        {covers.length === 0 && <span className="absolute inset-0 grid place-items-center rounded-[14px] border border-white/20 text-white/60"><ListMusic className="h-7 w-7" strokeWidth={1.4} /></span>}
                      </span>
                      <span className="mt-auto block">
                        <span className="block truncate font-display text-[1.45rem] font-extrabold leading-tight tracking-[-0.02em]">{s.name}</span>
                        <span className="mt-1 block truncate text-[12px] uppercase tracking-[0.08em] text-white/65">{s.songs.length === 1 ? "1 song" : `${s.songs.length} songs`}{s.songs.length ? ` · about ${formatTime(total)}` : ""}</span>
                      </span>
                    </Link>
                    {s.songs.length > 0 && <Link href={setlistSongHref(s.id, s.songs, 0)} className="absolute bottom-6 right-6 grid h-12 w-12 place-items-center rounded-full bg-white/85 text-black/80 transition hover:scale-105" aria-label={`Play ${s.name}`}><Play className="ml-0.5 h-4 w-4 fill-current" strokeWidth={0} /></Link>}
                    <button className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full text-white/70 opacity-0 transition hover:bg-white/15 hover:text-white focus-visible:opacity-100 group-hover/tile:opacity-100 max-md:opacity-100" onClick={() => { if (confirm(`Delete the setlist “${s.name}”? The songs stay in your library.`)) deleteSetlist(s.id); }} aria-label={`Delete ${s.name}`}><Trash2 className="h-4 w-4" strokeWidth={1.6} /></button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
