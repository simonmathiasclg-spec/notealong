"use client";
// Discover: the built-in song library. Open a song and it plays at once.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search, X } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { Welcome } from "@/components/Welcome";
import { PageDropZone } from "@/components/UploadZone";
import { ServiceDown } from "@/components/ServiceDown";
import { DiscoverSkeleton, Filters, Hero, Shelf, SongTile } from "@/components/discover/Discover";
import { api } from "@/lib/api";
import { applyFacet, buildShelves, facetValues, pickTonight, searchCatalog, type Facet } from "@/lib/catalog";
import { hasChosenInstrument, useInstrumentPref } from "@/lib/prefs";
import { useUploads } from "@/lib/uploads";
import type { CatalogEntry } from "@/lib/types";

export default function DiscoverPage() {
  const [songs, setSongs] = useState<CatalogEntry[] | null>(null);
  const [serviceDown, setServiceDown] = useState(false);
  const [query, setQuery] = useState("");
  const [facet, setFacet] = useState<Facet>({ kind: "all" });
  const [welcome, setWelcome] = useState(false);
  const [, setInstrument, loaded] = useInstrumentPref();
  const { addFiles } = useUploads();

  useEffect(() => {
    api.catalog().then((c) => { setSongs(c.songs); setServiceDown(false); }).catch(() => { setSongs([]); setServiceDown(true); });
  }, []);
  useEffect(() => { if (loaded && !hasChosenInstrument()) queueMicrotask(() => setWelcome(true)); }, [loaded]);

  const all = useMemo(() => songs ?? [], [songs]);
  const { genres, cultures } = useMemo(() => facetValues(all), [all]);
  const filtered = useMemo(() => applyFacet(searchCatalog(all, query), facet), [all, query, facet]);
  const shelves = useMemo(() => buildShelves(all), [all]);
  const tonight = useMemo(() => pickTonight(all), [all]);
  const browsing = query.trim().length > 0 || facet.kind !== "all";
  const facetLabel = facet.kind === "all" ? "" : facet.kind === "recordings" ? "Real recordings" : facet.kind === "difficulty" ? `${facet.value[0].toUpperCase()}${facet.value.slice(1)} songs` : facet.value;

  return (
    <div className="flex min-h-full flex-col">
      <AppHeader>
        <label className="relative hidden lg:block">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search songs, styles, countries" aria-label="Search songs" className="field w-72 pl-10 pr-9" />
          {query && <button className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-faint hover:text-fg" onClick={() => setQuery("")} aria-label="Clear search"><X className="h-4 w-4" /></button>}
        </label>
      </AppHeader>
      <PageDropZone onFiles={addFiles} />
      <Welcome open={welcome} onDone={(id) => { setInstrument(id); setWelcome(false); }} />

      <main className="mx-auto w-full max-w-7xl flex-1 px-5 pb-20 sm:px-8">
        <label className="relative mb-6 block lg:hidden">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search songs" aria-label="Search songs" className="field w-full pl-10" />
        </label>

        {serviceDown && <div className="mb-8"><ServiceDown what="the song library" /></div>}

        {songs === null ? (
          <DiscoverSkeleton />
        ) : all.length === 0 ? (
          !serviceDown && (
            <div className="panel mx-auto max-w-lg p-8 text-center">
              <h1 className="display-md text-2xl">No built-in songs yet</h1>
              <p className="mt-2 text-sm text-muted">Build the catalog with <code className="kbd">python -m notealong.catalog.build</code> in the service folder, or add your own song.</p>
            </div>
          )
        ) : (
          <div className="space-y-12">
            {!browsing && tonight && <Hero song={tonight} count={all.length} />}
            <div className="space-y-5">
              <Filters facet={facet} setFacet={setFacet} genres={genres} cultures={cultures} />
            </div>
            {browsing ? (
              <section aria-live="polite">
                <div className="mb-5 flex items-baseline justify-between gap-4">
                  <h2 className="display-md text-[1.45rem]">
                    {query.trim() ? `“${query.trim()}”` : facetLabel}
                    <span className="ml-3 text-base font-normal text-muted">{filtered.length === 1 ? "1 song" : `${filtered.length} songs`}</span>
                  </h2>
                  <button className="btn btn-ghost btn-sm" onClick={() => { setQuery(""); setFacet({ kind: "all" }); }}><X className="h-3.5 w-3.5" /> Clear</button>
                </div>
                {filtered.length === 0 ? (
                  <div className="panel p-8 text-center">
                    <div className="font-medium">Nothing matches that.</div>
                    <p className="mt-1 text-sm text-muted">Try another word, pick a different style, or <Link href="/my-songs" className="underline underline-offset-4">add the song yourself</Link>.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-x-5 gap-y-7 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">{filtered.map((s) => <SongTile key={s.id} song={s} />)}</div>
                )}
              </section>
            ) : (
              <>
                {shelves.map((sh) => <Shelf key={sh.id} title={sh.title} subtitle={sh.subtitle} songs={sh.songs} />)}
                <Shelf title="Every song" subtitle="A to Z" songs={[...all].sort((a, b) => a.title.localeCompare(b.title))} grid />
              </>
            )}
            <p className="hairline pt-6 text-xs leading-relaxed text-faint">
              Built-in songs are public domain or Creative Commons; each song shows where it comes from in its settings. Your own uploads live in <Link href="/my-songs" className="underline underline-offset-4">My songs</Link>.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
