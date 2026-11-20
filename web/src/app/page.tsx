"use client";
// Discover: the house title, a ring of songs to start with, room for your own songs, then shelves of
// widgets and the ways to browse. "See all" and the browse lists open the full search (/browse).
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Play } from "lucide-react";
import { CLOUD, TRY_SONG_ID } from "@/lib/cloud/config";
import { AppHeader, MobileSearch } from "@/components/AppHeader";
import { Welcome } from "@/components/Welcome";
import { PageDropZone } from "@/components/UploadZone";
import { ServiceDown } from "@/components/ServiceDown";
import { DiscoverSkeleton, SeeAll, Shelf, kindOf, toTile } from "@/components/discover/Discover";
import { Coverflow, type FlowSong } from "@/components/discover/Coverflow";
import { DropHero } from "@/components/DropHero";
import { SiteFooter } from "@/components/SiteFooter";
import { api } from "@/lib/api";
import { DIFFICULTY_HINT, buildCategories, isStandard, newSongs, pickTonight, sortSongs, type Category, type Facet } from "@/lib/catalog";
import { getInstrument } from "@/lib/instruments";
import { useMe } from "@/lib/me";
import { hasChosenInstrument, useInstrumentPref } from "@/lib/prefs";
import { fitsInstrument } from "@/lib/search";
import { useUploads } from "@/lib/uploads";
import type { CatalogEntry } from "@/lib/types";

/** The browse URL for one of the Discover groupings. */
function browseHref(f: Facet): string {
  const p = new URLSearchParams();
  switch (f.kind) {
    case "genre": p.set("genre", f.value); break;
    case "culture": p.set("country", f.value); break;
    case "region": p.set("q", f.value); break;
    case "language": p.set("language", f.value); break;
    case "difficulty": p.set("difficulty", f.value); break;
    case "recordings": p.set("source", "cc"); break;
    case "standards": p.set("tag", "standard"); break;
    case "new": p.set("sort", "new"); break;
    default: break;
  }
  return `/browse${p.toString() ? `?${p}` : ""}`;
}

function listNames(songs: CatalogEntry[]): string {
  if (songs.length === 0) return "";
  if (songs.length === 1) return songs[0].title;
  if (songs.length === 2) return `${songs[0].title} and ${songs[1].title}`;
  return `${songs[0].title}, ${songs[1].title} and ${songs.length - 2} more`;
}

export default function DiscoverPage() {
  const [songs, setSongs] = useState<CatalogEntry[] | null>(null);
  const [ranges, setRanges] = useState<Record<string, [number, number] | null>>({});
  const [serviceDown, setServiceDown] = useState(false);
  const [welcome, setWelcome] = useState(false);
  const [instrumentId, setInstrument, loaded] = useInstrumentPref();
  const instrument = getInstrument(instrumentId);
  const { addFiles } = useUploads();
  const { favourites, plays, signedIn } = useMe();

  useEffect(() => {
    api.catalog().then((c) => { setSongs(c.songs); setServiceDown(false); }).catch(() => { setSongs([]); setServiceDown(true); });
    api.searchIndex().then((r) => setRanges(Object.fromEntries(r.songs.map((s) => [s.id, s.range ?? null])))).catch(() => undefined);
  }, []);
  useEffect(() => { if (loaded && !hasChosenInstrument()) queueMicrotask(() => setWelcome(true)); }, [loaded]);

  // plays recorded by the player give "Most played" and "Jump back in" their order
  const all = useMemo((): CatalogEntry[] => (songs ?? []).map((s) => {
    const p = plays[s.id];
    const last = [s.last_played, p?.last].filter(Boolean).sort().pop() ?? null;
    return { ...s, popularity: p?.count ?? s.popularity ?? 0, last_played: last };
  }), [songs, plays]);
  const byId = useMemo(() => new Map<string, CatalogEntry>(all.map((s) => [s.id, s])), [all]);
  const fresh = useMemo(() => sortSongs(newSongs(sortSongs(all, "popular")), "new"), [all]);
  const categories = useMemo(() => buildCategories(all), [all]);

  // the ring: tonight's pick in the middle of a dozen featured, new and well-liked songs
  const ring = useMemo((): FlowSong[] => {
    const tonight = pickTonight(all);
    const seen = new Set<string>();
    const out: CatalogEntry[] = [];
    const add = (s: CatalogEntry | null | undefined) => { if (s && !seen.has(s.id) && out.length < 12) { seen.add(s.id); out.push(s); } };
    add(tonight);
    all.filter((s) => s.featured).forEach(add);
    fresh.forEach(add);
    sortSongs(all, "popular").forEach(add);
    return out.map((s) => ({ ...toTile(s), kind: kindOf(s) }));
  }, [all, fresh]);

  const shelves = useMemo(() => {
    const ranked = sortSongs(all, "popular");
    const rows: { id: string; title: string; subtitle?: string; songs: CatalogEntry[]; href?: string }[] = [];
    const push = (id: string, title: string, list: CatalogEntry[], href?: string, subtitle?: string, min = 1) => { if (list.length >= min) rows.push({ id, title, subtitle, songs: list, href }); };
    push("favourites", "Your favourites", favourites.map((id) => byId.get(id)).filter((s): s is CatalogEntry => !!s), "/browse?favourites=1");
    push("recent", "Jump back in", sortSongs(all.filter((s) => s.last_played), "recent").slice(0, 12), undefined, "Songs you played lately");
    push("new", "New this week", fresh, "/browse?sort=new");
    push("standards", "Jazz and classic standards", ranked.filter(isStandard), "/browse?tag=standard", "Famous songs of the jazz age and before, all public domain", 4);
    const fits = ranked.filter((s) => s.difficulty !== "hard" && fitsInstrument(ranges[s.id], instrument));
    push("fits", `Good on the ${instrument.name.toLowerCase()}`, fits, "/browse?fits=1", "Whole melody in your range, without changing key", 6);
    push("beginners", "Great for beginners", sortSongs(all.filter((s) => s.beginner || s.difficulty === "easy"), "easy"), browseHref({ kind: "difficulty", value: "easy" }), DIFFICULTY_HINT.easy);
    push("recordings", "Real recordings", ranked.filter((s) => s.source.kind === "cc"), browseHref({ kind: "recordings" }), "Independent artists, shared under Creative Commons");
    return rows;
  }, [all, byId, favourites, ranges, instrument, fresh]);

  return (
    <div className="flex min-h-full flex-col">
      <AppHeader />
      <PageDropZone onFiles={addFiles} />
      <Welcome open={welcome} onDone={(id) => { setInstrument(id); setWelcome(false); }} />

      <main className="mx-auto w-full max-w-[90rem] flex-1 px-5 pb-10 sm:px-8 lg:px-12">
        {/* the house title */}
        <div className="pb-8 pt-4 text-center sm:pb-12 sm:pt-6">
          <h1 className="display-hero text-red text-[clamp(4.6rem,15.5vw,12.5rem)] max-sm:leading-[0.86]">Play<span className="max-sm:hidden"> </span><br className="sm:hidden" />along</h1>
          <p className="display-wide mt-4 text-[clamp(0.85rem,1.6vw,1.25rem)]">The note for every word</p>
          <p className="mt-4 text-[13px] tracking-[0.02em] text-muted">
            <span className="mr-2 inline-block h-[7px] w-[7px] translate-y-[-1px] rounded-full bg-red shadow-[0_0_0_5px_color-mix(in_srgb,var(--red)_20%,transparent)]" aria-hidden="true" />
            {fresh.length > 0
              ? <Link href="/browse?sort=new" className="hover:text-fg"><b className="font-semibold text-fg">New this week</b> · {listNames(fresh)}</Link>
              : <><b className="font-semibold text-fg">{all.length || 208} songs</b> · free to play right now</>}
          </p>
        </div>
        {CLOUD && signedIn === false && (
          <div className="-mt-2 mb-10 flex flex-col items-center gap-2 text-center sm:mb-12">
            <Link href={`/songs/${TRY_SONG_ID}`} className="btn btn-red btn-lg">Try it: no sign-in needed <Play className="h-4 w-4 fill-current" strokeWidth={0} /></Link>
            <p className="text-[13px] text-muted">Opens a song in the player with the notes above the words. Every built-in song is free to play.</p>
          </div>
        )}
        <MobileSearch />

        {serviceDown && <div className="mb-8"><ServiceDown what="the song library" /></div>}
        {songs === null ? (
          <DiscoverSkeleton />
        ) : (
          <div className="space-y-16 sm:space-y-20">
            {ring.length > 0 && <Coverflow songs={ring} hint={`Drag to browse. Click the song in the middle to play along on your ${instrument.name.toLowerCase()}.`} />}
            <DropHero />
            {all.length > 0 && (
              <div className="space-y-14 sm:space-y-16">
                {shelves.map((sh, i) => (
                  <Shelf key={sh.id} title={sh.title} subtitle={sh.subtitle} songs={sh.songs.slice(0, 18)} start={i * 3}
                    action={sh.href && sh.songs.length > 6 ? <SeeAll href={sh.href} n={sh.songs.length} /> : undefined} />
                ))}
                <BrowseLinks categories={categories} total={all.length} />
              </div>
            )}
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

/** Styles, parts of the world and languages as numbered track lists, each opening the search with that filter. */
function BrowseLinks({ categories, total }: { categories: Category[]; total: number }) {
  const groups = ["Styles", "Around the world", "Languages"] as const;
  return (
    <section aria-label="Browse">
      <div className="mb-8 flex items-end justify-between gap-4">
        <h2 className="display-xl text-[clamp(2.2rem,4.6vw,3.6rem)]">Browse all {total}</h2>
        <SeeAll href="/browse" n={total} />
      </div>
      <div className="grid gap-x-12 gap-y-10 lg:grid-cols-3">
        {groups.map((g) => {
          const items = categories.filter((c) => c.group === g).slice(0, 10);
          if (!items.length) return null;
          return (
            <div key={g}>
              <h3 className="mb-2 text-[13px] font-medium text-muted">{g}</h3>
              <ol className="border-t border-border">
                {items.map((c, i) => (
                  <li key={c.id}>
                    <Link href={browseHref(c.facet)} className="group grid grid-cols-[2rem_1fr_auto] items-center gap-2 border-b border-border py-3 text-[0.95rem] transition">
                      <span className="tabular text-[11px] text-faint">{String(i + 1).padStart(2, "0")}</span>
                      <span className="truncate font-medium transition group-hover:translate-x-1">{c.title}</span>
                      <span className="tabular text-[12px] text-faint transition group-hover:text-fg">{c.n} {c.n === 1 ? "song" : "songs"} ▸</span>
                    </Link>
                  </li>
                ))}
              </ol>
            </div>
          );
        })}
      </div>
    </section>
  );
}
