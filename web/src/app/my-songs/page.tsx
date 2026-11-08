"use client";
// My songs: what you added yourself. Built-in songs live on Discover.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, Loader2, Trash2 } from "lucide-react";
import { FavouriteButton } from "@/components/Favourite";
import { AppHeader, MobileSearch } from "@/components/AppHeader";
import { PageDropZone } from "@/components/UploadZone";
import { DropHero } from "@/components/DropHero";
import { ServiceDown } from "@/components/ServiceDown";
import { InstrumentIcon } from "@/components/InstrumentIcon";
import { api, formatTime } from "@/lib/api";
import { getInstrument } from "@/lib/instruments";
import { useInstrumentPref } from "@/lib/prefs";
import { useUploads } from "@/lib/uploads";
import { uploadsLeftText, useEntitlements } from "@/lib/entitlements";
import type { SongSummary } from "@/lib/types";

const STEP_LABEL: Record<string, string> = { stems: "Separating the singer from the band", melody: "Finding the notes", lyrics: "Reading the words", attach: "Lining it all up", cleanup: "Tidying the notes" };

export default function LibraryPage() {
  const [songs, setSongs] = useState<SongSummary[] | null>(null);
  const [serviceDown, setServiceDown] = useState(false);
  const { uploads, addFiles: onFiles } = useUploads();
  const [sort, setSort] = useState<"recent" | "title">("recent");
  const [instrument] = useInstrumentPref();
  const entitlements = useEntitlements([songs?.length]);
  const uploadsLeft = uploadsLeftText(entitlements);

  const refresh = useCallback(async () => {
    try { setSongs(await api.listSongs()); setServiceDown(false); }
    catch { setServiceDown(true); setSongs([]); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  // a new upload, or one that finished, changes the list
  const uploadsKey = uploads.map((u) => `${u.id}:${u.status}`).join(",");
  useEffect(() => { refresh(); }, [uploadsKey, refresh]);
  useEffect(() => {
    if (!songs?.some((s) => s.status === "processing")) return;
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [songs, refresh]);

  const visible = useMemo(() => {
    let list = songs ?? [];
    if (sort === "title") list = [...list].sort((a, b) => a.title.localeCompare(b.title));
    return list;
  }, [songs, sort]);
  const many = (songs?.length ?? 0) > 4;

  return (
    <div className="flex min-h-full flex-col">
      <AppHeader />
      <MobileSearch />
      <PageDropZone onFiles={onFiles} />
      <main className="mx-auto w-full max-w-4xl flex-1 px-5 pb-20 sm:px-8">
        {serviceDown && <div className="mb-8"><ServiceDown what="your songs" /></div>}

        {songs === null ? (
          <div className="space-y-3" aria-busy="true">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="skel h-20 w-full" />)}</div>
        ) : songs.length === 0 ? (
          !serviceDown && <EmptyState />
        ) : (
          <>
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="display-lg text-[2.2rem]">My songs</h1>
                <p className="mt-1.5 text-sm text-muted">
                  Playing as <span className="font-medium text-fg">{getInstrument(instrument).name}</span>. Drop a file anywhere on this page to add one.{uploadsLeft ? ` ${uploadsLeft}.` : ""}
                </p>
              </div>
              {many && (
                <div className="flex items-center gap-2">
                  <div className="seg">
                    <button aria-pressed={sort === "recent"} onClick={() => setSort("recent")}>Recent</button>
                    <button aria-pressed={sort === "title"} onClick={() => setSort("title")}>A to Z</button>
                  </div>
                </div>
              )}
            </div>
            <div className="panel divide-y divide-border">
              {visible.map((s) => <SongRow key={s.id} song={s} onDeleted={refresh} />)}
              {visible.length === 0 && <div className="p-8 text-center text-sm text-muted">No song matches that.</div>}
            </div>
            <p className="mt-6 text-xs text-faint">Search all your songs and the built-in ones with the search box at the top. Looking for something to play right now? <Link href="/" className="underline underline-offset-4">Discover</Link> has {"built-in"} songs that start instantly.</p>
          </>
        )}
      </main>
    </div>
  );
}

function EmptyState() {
  return <div className="py-2 sm:py-6"><DropHero firstRun /></div>;
}


function SongRow({ song, onDeleted }: { song: SongSummary; onDeleted: () => void }) {
  const inst = getInstrument(song.user?.instrument ?? "alto_sax");
  const status = song.status;
  const runningStep = Object.entries(song.steps ?? {}).find(([, s]) => s.status === "running")?.[0];
  const remove = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!confirm(`Delete “${song.title}”? This cannot be undone.`)) return;
    await api.deleteSong(song.id);
    onDeleted();
  };
  return (
    <Link href={`/songs/${song.id}`} className="group relative flex items-center gap-4 px-4 py-3.5 transition hover:bg-hover first:rounded-t-[1.25rem] last:rounded-b-[1.25rem] sm:px-5">
      <div className={`relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl ${status === "failed" ? "bg-danger-soft text-danger" : "bg-sunken text-muted"}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={api.uploadCoverUrl(song.id)} alt="" className={`absolute inset-0 h-full w-full object-cover ${status === "ready" ? "" : "opacity-40"}`} loading="lazy" draggable={false} />
        {status === "processing" ? <Loader2 className="relative h-5 w-5 animate-spin text-accent" /> : status === "failed" ? <AlertCircle className="relative h-5 w-5" /> : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold leading-tight">{song.title}</div>
        <div className="mt-0.5 truncate text-sm text-muted">
          {status === "ready" && <>{song.artist ?? "Unknown artist"} <span aria-hidden="true">·</span> {formatTime(song.duration)}{song.key ? <> <span aria-hidden="true">·</span> {song.key.name}</> : null}</>}
          {status === "processing" && <span className="text-fg">{runningStep ? STEP_LABEL[runningStep] : "Waiting to start"}…</span>}
          {status === "failed" && <span className="text-danger">Needs attention. Open it to try again.</span>}
        </div>
      </div>
      {status === "ready" && <span className="hidden items-center gap-1.5 text-xs text-muted sm:inline-flex"><InstrumentIcon icon={inst.icon} className="h-4 w-4" /> {inst.name}</span>}
      {status === "ready" && <FavouriteButton id={song.id} title={song.title} variant="icon" className="h-8 w-8" />}
      <button onClick={remove} className="rounded-full p-2 text-faint opacity-0 transition hover:bg-sunken hover:text-danger focus-visible:opacity-100 group-hover:opacity-100" aria-label={`Delete ${song.title}`}><Trash2 className="h-4 w-4" /></button>
    </Link>
  );
}
