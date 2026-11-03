"use client";
// Discover: the built-in song library. Open a song and it plays at once.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, Search } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { Welcome } from "@/components/Welcome";
import { PageDropZone } from "@/components/UploadZone";
import { SongTile, Shelf as ShelfRow, Filters } from "@/components/discover/Discover";
import { api } from "@/lib/api";
import { applyFacet, buildShelves, facetValues, searchCatalog, type Facet } from "@/lib/catalog";
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
  const browsing = query.trim().length > 0 || facet.kind !== "all";

  return (
    <div className="flex min-h-full flex-col">
      <AppHeader />
      <PageDropZone onFiles={addFiles} />
      <Welcome open={welcome} onDone={(id) => { setInstrument(id); setWelcome(false); }} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 pb-16 sm:px-8">
        {serviceDown && (
          <div className="card mb-6 flex items-start gap-3 border-danger/40 p-4 text-sm">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
            <div><div className="font-semibold">The processing service isn&apos;t running.</div><div className="text-muted">Start it with <code className="kbd">./start.sh</code> and refresh this page.</div></div>
          </div>
        )}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl font-extrabold tracking-tight">Discover</h1>
            <p className="text-sm text-muted">Songs you can play right now. Tap one and it starts.</p>
          </div>
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search songs" aria-label="Search songs" className="rounded-full border border-border bg-elev py-2 pl-9 pr-4 text-sm" />
          </label>
        </div>
        <Filters facet={facet} setFacet={setFacet} genres={genres.map((g) => g.value)} cultures={cultures.map((c) => c.value)} />

        {songs === null ? (
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">{Array.from({ length: 10 }).map((_, i) => <div key={i} className="aspect-square animate-pulse rounded-2xl bg-sunken" />)}</div>
        ) : browsing ? (
          filtered.length === 0 ? (
            <div className="py-20 text-center text-muted">Nothing matches. Try another word, or clear the filter.</div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">{filtered.map((s) => <SongTile key={s.id} song={s} />)}</div>
          )
        ) : (
          <div className="space-y-10">
            {shelves.map((sh) => <ShelfRow key={sh.id} title={sh.title} subtitle={sh.subtitle} songs={sh.songs} />)}
            <ShelfRow title="Everything" songs={[...all].sort((a, b) => a.title.localeCompare(b.title))} grid />
            {all.length === 0 && !serviceDown && (
              <div className="py-20 text-center text-muted">No built-in songs yet. Build the catalog with <code className="kbd">python -m notealong.catalog.build</code>.</div>
            )}
          </div>
        )}
        <p className="mt-16 text-xs text-faint">Built-in songs are public domain or Creative Commons; each song page shows where it comes from. <Link href="/my-songs" className="underline">Your own uploads</Link> live in My songs.</p>
      </main>
    </div>
  );
}

