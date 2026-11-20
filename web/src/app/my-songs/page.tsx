"use client";
// My songs: what you added yourself. Built-in songs live on Discover.
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlertCircle, Loader2, Trash2 } from "lucide-react";
import { FavouriteButton } from "@/components/Favourite";
import { AppHeader, MobileSearch } from "@/components/AppHeader";
import { PageDropZone } from "@/components/UploadZone";
import { DropHero } from "@/components/DropHero";
import { ServiceDown } from "@/components/ServiceDown";
import { InstrumentIcon } from "@/components/InstrumentIcon";
import { ArtTile } from "@/components/art/Art";
import { SiteFooter } from "@/components/SiteFooter";
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
  const entitlements = useEntitlements();
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

  const latest = (songs ?? []).find((s) => s.status === "ready") ?? null;
  return (
    <div className="flex min-h-full flex-col">
      <AppHeader />
      <PageDropZone onFiles={onFiles} />
      <main className="mx-auto w-full max-w-[90rem] flex-1 px-5 pb-10 sm:px-8 lg:px-12">
        <MobileSearch />
        {serviceDown && <div className="mb-8"><ServiceDown what="your songs" /></div>}

        {songs === null ? (
          <div className="space-y-3 pt-6" aria-busy="true">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="skel h-16 w-full rounded-2xl" />)}</div>
        ) : songs.length === 0 ? (
          !serviceDown && <Suspense><EmptyState /></Suspense>
        ) : (
          <>
            <div className="mb-10 flex flex-wrap items-end justify-between gap-x-8 gap-y-4 pt-2 sm:mb-14">
              <div>
                <h1 className="display-hero text-[clamp(3.6rem,10vw,8.5rem)]">My songs</h1>
                <p className="mt-4 max-w-xl text-[14px] text-muted">
                  {songs.length} {songs.length === 1 ? "song" : "songs"} you added, private to you. Playing as <span className="font-medium text-fg">{getInstrument(instrument).name}</span>. Drop a file anywhere on this page to add one.{uploadsLeft ? ` ${uploadsLeft}.` : ""}
                </p>
              </div>
              {many && (
                <div className="seg">
                  <button aria-pressed={sort === "recent"} onClick={() => setSort("recent")}>Recent</button>
                  <button aria-pressed={sort === "title"} onClick={() => setSort("title")}>A to Z</button>
                </div>
              )}
            </div>
            <div className="grid gap-10 lg:grid-cols-[minmax(0,22rem)_1fr] lg:gap-16">
              {latest && (
                <div className="lg:sticky lg:top-24 lg:self-start">
                  <p className="mb-3 text-[12px] font-medium text-faint">Last added</p>
                  <div className="h-[22rem] sm:h-[26rem]"><ArtTile song={{ id: latest.id, title: latest.title, artist: latest.artist ?? "My song", cover: api.uploadCoverUrl(latest.id), meta: [formatTime(latest.duration), latest.key?.name].filter(Boolean).join(" · ") }} shape="tall" priority /></div>
                </div>
              )}
              <ol className="border-t border-border">
                {visible.map((s, i) => <SongRow key={s.id} n={i + 1} song={s} onDeleted={refresh} />)}
                {visible.length === 0 && <li className="p-8 text-center text-sm text-muted">No song matches that.</li>}
              </ol>
            </div>
            <p className="mt-10 text-[12px] text-faint">Search your songs and the built-in ones together with the search box at the top. Something to play right now? <Link href="/" className="text-muted underline decoration-border-strong underline-offset-4 hover:text-fg">Discover</Link> has built-in songs that start instantly.</p>
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

function EmptyState() {
  // after "Sign up free to convert your own song", the visitor lands here to pick the file
  const params = useSearchParams();
  return (
    <div className="py-2 sm:py-6">
      {params.get("add") === "1" && <p className="mb-6 text-[15px] text-fg">You&apos;re signed in. Choose the song you want to convert.</p>}
      <DropHero firstRun />
    </div>
  );
}


function SongRow({ song, n, onDeleted }: { song: SongSummary; n: number; onDeleted: () => void }) {
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
    <li>
      <Link href={`/songs/${song.id}`} className="group relative grid grid-cols-[1.75rem_3.25rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-border py-3 transition sm:grid-cols-[2.25rem_3.5rem_minmax(0,1fr)_auto] sm:gap-4">
        <span className="tabular text-[11px] text-faint">{String(n).padStart(2, "0")}</span>
        <span className="relative grid aspect-square w-full place-items-center overflow-hidden rounded-[0.8rem] bg-elev">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={api.uploadCoverUrl(song.id)} alt="" className={`absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105 ${status === "ready" ? "" : "opacity-35"}`} loading="lazy" draggable={false} />
          {status === "processing" ? <Loader2 className="relative h-5 w-5 animate-spin text-fg" strokeWidth={1.6} /> : status === "failed" ? <AlertCircle className="relative h-5 w-5 text-danger" strokeWidth={1.8} /> : null}
        </span>
        <span className="min-w-0 transition duration-300 group-hover:translate-x-1">
          <span className="block truncate font-display text-[1.05rem] font-bold tracking-[-0.015em]">{song.title}</span>
          <span className="mt-0.5 block truncate text-[13px] text-muted">
            {status === "ready" && <>{song.artist ?? "Unknown artist"} <span aria-hidden="true">·</span> {formatTime(song.duration)}{song.key ? <> <span aria-hidden="true">·</span> {song.key.name}</> : null}</>}
            {status === "processing" && <span className="text-fg">{runningStep ? STEP_LABEL[runningStep] : "Waiting to start"}…</span>}
            {status === "failed" && <span className="text-danger">Needs attention. Open it to try again.</span>}
          </span>
        </span>
        <span className="flex items-center gap-1">
          {status === "ready" && <span className="mr-2 hidden items-center gap-1.5 text-[12px] text-muted md:inline-flex"><InstrumentIcon icon={inst.icon} className="h-4 w-4" /> {inst.name}</span>}
          {status === "ready" && <FavouriteButton id={song.id} title={song.title} variant="icon" className="h-9 w-9" />}
          <button onClick={remove} className="grid h-9 w-9 place-items-center rounded-full text-faint opacity-0 transition hover:bg-hover hover:text-danger focus-visible:opacity-100 group-hover:opacity-100 max-md:opacity-100" aria-label={`Delete ${song.title}`}><Trash2 className="h-4 w-4" strokeWidth={1.6} /></button>
        </span>
      </Link>
    </li>
  );
}
