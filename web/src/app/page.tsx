"use client";
// Discover: drop in a song you love, or start one of the built-in songs. A short page of rows;
// "See all" and the Browse lists open the full search (/browse) with that filter on.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { AppHeader, MobileSearch } from "@/components/AppHeader";
import { Welcome } from "@/components/Welcome";
import { PageDropZone } from "@/components/UploadZone";
import { ServiceDown } from "@/components/ServiceDown";
import { DiscoverSkeleton, Shelf } from "@/components/discover/Discover";
import { DropHero } from "@/components/DropHero";
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

export default function DiscoverPage() {
  const [songs, setSongs] = useState<CatalogEntry[] | null>(null);
  const [ranges, setRanges] = useState<Record<string, [number, number] | null>>({});
  const [serviceDown, setServiceDown] = useState(false);
  const [welcome, setWelcome] = useState(false);
  const [instrumentId, setInstrument, loaded] = useInstrumentPref();
  const instrument = getInstrument(instrumentId);
  const { addFiles } = useUploads();
  const { favourites, plays } = useMe();

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
  const tonight = useMemo(() => pickTonight(all), [all]);
  const categories = useMemo(() => buildCategories(all), [all]);

  const shelves = useMemo(() => {
    const ranked = sortSongs(all, "popular");
    const rows: { id: string; title: string; subtitle?: string; songs: CatalogEntry[]; href?: string }[] = [];
    const push = (id: string, title: string, list: CatalogEntry[], href?: string, subtitle?: string, min = 1) => { if (list.length >= min) rows.push({ id, title, subtitle, songs: list, href }); };
    push("favourites", "Your favourites", favourites.map((id) => byId.get(id)).filter((s): s is CatalogEntry => !!s), "/browse?favourites=1");
    push("recent", "Jump back in", sortSongs(all.filter((s) => s.last_played), "recent").slice(0, 12), undefined, "Songs you played lately");
    push("new", "New this week", sortSongs(newSongs(ranked), "new"), "/browse?sort=new");
    push("standards", "Jazz and classic standards", ranked.filter(isStandard), "/browse?tag=standard", "Famous songs of the jazz age and before, all public domain", 4);
    const fits = ranked.filter((s) => s.difficulty !== "hard" && fitsInstrument(ranges[s.id], instrument));
    push("fits", `Good on the ${instrument.name.toLowerCase()}`, fits, "/browse?fits=1", "Whole melody in your range, without changing key", 6);
    push("beginners", "Great for beginners", sortSongs(all.filter((s) => s.beginner || s.difficulty === "easy"), "easy"), browseHref({ kind: "difficulty", value: "easy" }), DIFFICULTY_HINT.easy);
    push("recordings", "Real recordings", ranked.filter((s) => s.source.kind === "cc"), browseHref({ kind: "recordings" }), "Independent artists, shared under Creative Commons");
    return rows;
  }, [all, byId, favourites, ranges, instrument]);

  return (
    <div className="flex min-h-full flex-col">
      <AppHeader />
      <MobileSearch />
      <PageDropZone onFiles={addFiles} />
      <Welcome open={welcome} onDone={(id) => { setInstrument(id); setWelcome(false); }} />

      <main className="mx-auto w-full max-w-7xl flex-1 px-5 pb-20 sm:px-8">
        {serviceDown && <div className="mb-8"><ServiceDown what="the song library" /></div>}
        {songs === null ? (
          <DiscoverSkeleton />
        ) : (
          <div className="space-y-12">
            <DropHero pick={tonight} />
            {all.length > 0 && (
              <div className="space-y-10">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h2 className="display-md text-[1.45rem]">Or start with one of these</h2>
                    <span className="text-sm text-muted">{all.length} songs, free to play right now</span>
                  </div>
                  <Link href="/browse" className="btn btn-ghost btn-sm">Browse all songs <ArrowRight className="h-3.5 w-3.5" /></Link>
                </div>
                {shelves.map((sh) => (
                  <Shelf key={sh.id} title={sh.title} subtitle={sh.subtitle} songs={sh.songs.slice(0, 18)} total={sh.songs.length}
                    action={sh.href && sh.songs.length > 6 ? <Link href={sh.href} className="btn btn-ghost btn-sm shrink-0">See all {sh.songs.length} <ArrowRight className="h-3.5 w-3.5" /></Link> : undefined} />
                ))}
                <BrowseLinks categories={categories} />
              </div>
            )}
            <p className="hairline pt-6 text-xs leading-relaxed text-faint">
              Built-in songs are public domain or Creative Commons; each song&apos;s page shows where it comes from. Your own uploads stay private in <Link href="/my-songs" className="underline underline-offset-4">My songs</Link>.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

/** Styles, parts of the world and languages, each opening the search with that filter. */
function BrowseLinks({ categories }: { categories: Category[] }) {
  const groups = ["Styles", "Around the world", "Languages"] as const;
  return (
    <section aria-label="Browse">
      <h2 className="display-md mb-5 text-[1.45rem]">Browse</h2>
      <div className="grid gap-x-10 gap-y-8 lg:grid-cols-3">
        {groups.map((g) => {
          const items = categories.filter((c) => c.group === g).slice(0, 10);
          if (!items.length) return null;
          return (
            <div key={g}>
              <h3 className="label mb-3">{g}</h3>
              <ul className="divide-y divide-border border-y border-border">
                {items.map((c) => (
                  <li key={c.id}>
                    <Link href={browseHref(c.facet)} className="group flex w-full items-center justify-between gap-3 py-2.5 text-[0.95rem] transition hover:text-accent">
                      <span className="truncate font-medium">{c.title}</span>
                      <span className="flex shrink-0 items-center gap-2 text-[0.8rem] text-faint"><span className="tabular">{c.n} {c.n === 1 ? "song" : "songs"}</span><ArrowRight className="h-3.5 w-3.5 opacity-0 transition group-hover:opacity-100" /></span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
