"use client";
// Every song in one place, built-in and your own: search as you type, narrow with filters, sort.
// The header search box on every page leads here; the URL keeps the search and the filters.
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SlidersHorizontal, X } from "lucide-react";
import { AppHeader, MobileSearch } from "@/components/AppHeader";
import { ResultTile } from "@/components/ResultTile";
import { ServiceDown } from "@/components/ServiceDown";
import { TileSkeleton } from "@/components/discover/Discover";
import { api } from "@/lib/api";
import { DIFFICULTY_LABEL, languageName } from "@/lib/catalog";
import { getInstrument } from "@/lib/instruments";
import { useMe } from "@/lib/me";
import { useInstrumentPref } from "@/lib/prefs";
import { SEARCH_SORT_LABEL, SOURCE_LABEL, TAG_LABEL, TEMPO_LABEL, filterOptions, filtersToParams, paramsToFilters, searchSongs, type Filters, type SearchRow, type SearchSort } from "@/lib/search";
import type { Difficulty } from "@/lib/types";

export default function BrowsePage() {
  return <Suspense><Browse /></Suspense>;
}

function Browse() {
  const params = useSearchParams();
  const router = useRouter();
  const initial = useMemo(() => paramsToFilters(new URLSearchParams(params.toString())), [params]);
  const [rows, setRows] = useState<SearchRow[] | null>(null);
  const [down, setDown] = useState(false);
  const [openFilters, setOpenFilters] = useState(false);
  const [instrumentId] = useInstrumentPref();
  const instrument = getInstrument(instrumentId);
  const { favourites, plays } = useMe();
  const favSet = useMemo(() => new Set(favourites), [favourites]);
  const { q, filters, sort } = initial;

  useEffect(() => { api.searchIndex().then((r) => { setRows(r.songs); setDown(false); }).catch(() => { setRows([]); setDown(true); }); }, []);

  const go = (nq: string, f: Filters, s: SearchSort) => router.replace(`/browse?${filtersToParams(nq, f, s).toString()}`, { scroll: false });
  const setFilter = <K extends keyof Filters>(k: K, v: Filters[K] | undefined) => go(q, { ...filters, [k]: v }, sort);
  const results = useMemo(() => searchSongs(rows ?? [], q, filters, sort, { instrument, favourites: favSet, plays }), [rows, q, filters, sort, instrument, favSet, plays]);
  const opts = useMemo(() => filterOptions(rows ?? []), [rows]);

  // the filters that are on, as chips that remove themselves
  const active: { key: keyof Filters; label: string }[] = [];
  if (filters.favourites) active.push({ key: "favourites", label: "Favourites" });
  if (filters.difficulty) active.push({ key: "difficulty", label: DIFFICULTY_LABEL[filters.difficulty] });
  if (filters.genre) active.push({ key: "genre", label: filters.genre });
  if (filters.decade) active.push({ key: "decade", label: filters.decade });
  if (filters.language) active.push({ key: "language", label: languageName(filters.language) });
  if (filters.country) active.push({ key: "country", label: filters.country });
  if (filters.tempo) active.push({ key: "tempo", label: TEMPO_LABEL[filters.tempo] });
  if (filters.source) active.push({ key: "source", label: SOURCE_LABEL[filters.source] });
  if (filters.tag) active.push({ key: "tag", label: TAG_LABEL[filters.tag] ?? filters.tag });
  if (filters.fits) active.push({ key: "fits", label: `Fits my ${instrument.name.toLowerCase()}` });

  const title = q.trim() ? `“${q.trim()}”` : active.length ? "Songs" : "Every song";
  return (
    <div className="flex min-h-full flex-col">
      <AppHeader />
      <MobileSearch />
      <main className="mx-auto w-full max-w-7xl flex-1 px-5 pb-20 sm:px-8">
        {down && <div className="mb-8"><ServiceDown what="the songs" /></div>}
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <h1 className="display-lg text-[2.1rem]">
            {title}
            {rows && <span className="ml-3 align-middle text-base font-normal text-muted">{results.length === 1 ? "1 song" : `${results.length} songs`}</span>}
          </h1>
          <div className="flex items-center gap-2">
            <button className={`btn btn-sm ${openFilters ? "btn-primary" : ""}`} onClick={() => setOpenFilters((o) => !o)} aria-expanded={openFilters}><SlidersHorizontal className="h-3.5 w-3.5" /> Filters</button>
            <label className="inline-flex items-center gap-2 text-sm text-muted">
              <span className="hidden sm:inline">Sort</span>
              <select className="field h-9 py-0 pr-8 text-sm" value={sort} onChange={(e) => go(q, filters, e.target.value as SearchSort)} aria-label="Sort songs">
                {(Object.keys(SEARCH_SORT_LABEL) as SearchSort[]).map((k) => <option key={k} value={k}>{SEARCH_SORT_LABEL[k]}</option>)}
              </select>
            </label>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button className="chip" aria-pressed={!!filters.fits} onClick={() => setFilter("fits", filters.fits ? undefined : true)}>Fits my {instrument.name.toLowerCase()}</button>
          <button className="chip" aria-pressed={!!filters.favourites} onClick={() => setFilter("favourites", filters.favourites ? undefined : true)}>Favourites</button>
          {(["easy", "medium", "hard"] as Difficulty[]).map((d) => <button key={d} className="chip" aria-pressed={filters.difficulty === d} onClick={() => setFilter("difficulty", filters.difficulty === d ? undefined : d)}>{DIFFICULTY_LABEL[d]}</button>)}
          {(["traditional", "cc", "upload"] as const).map((s) => <button key={s} className="chip" aria-pressed={filters.source === s} onClick={() => setFilter("source", filters.source === s ? undefined : s)}>{SOURCE_LABEL[s]}</button>)}
        </div>

        {openFilters && (
          <div className="panel mb-6 grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-5">
            <Select label="Style" value={filters.genre} onChange={(v) => setFilter("genre", v)} options={opts.genres.map((g) => [g.value, `${g.value} (${g.n})`])} />
            <Select label="Decade" value={filters.decade} onChange={(v) => setFilter("decade", v)} options={opts.decades.map((g) => [g.value, `${g.value} (${g.n})`])} />
            <Select label="Language" value={filters.language} onChange={(v) => setFilter("language", v)} options={opts.languages.map((g) => [g.value, `${languageName(g.value)} (${g.n})`])} />
            <Select label="Country" value={filters.country} onChange={(v) => setFilter("country", v)} options={opts.countries.map((g) => [g.value, `${g.value} (${g.n})`])} />
            <Select label="Tempo" value={filters.tempo} onChange={(v) => setFilter("tempo", v as Filters["tempo"])} options={(["slow", "medium", "fast"] as const).map((t) => [t, TEMPO_LABEL[t]])} />
          </div>
        )}

        {active.length > 0 && (
          <div className="mb-6 flex flex-wrap items-center gap-2" aria-label="Filters in use">
            {active.map((a) => (
              <button key={a.key} className="chip" aria-pressed="true" onClick={() => setFilter(a.key, undefined)} aria-label={`Remove the filter ${a.label}`}>
                {a.label} <X className="h-3.5 w-3.5" />
              </button>
            ))}
            <button className="text-sm text-muted underline-offset-4 hover:text-fg hover:underline" onClick={() => go(q, {}, sort)}>Clear all</button>
          </div>
        )}

        {rows === null ? (
          <div className="grid grid-cols-2 gap-x-5 gap-y-7 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">{Array.from({ length: 12 }).map((_, i) => <TileSkeleton key={i} />)}</div>
        ) : results.length === 0 ? (
          <div className="panel mx-auto max-w-lg p-8 text-center">
            <div className="font-medium">Nothing matches that.</div>
            <p className="mt-1 text-sm text-muted">Try fewer words or remove a filter. A song that isn&apos;t here can be added from your own file with “Add a song”.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-5 gap-y-7 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6" aria-live="polite">
            {results.slice(0, 240).map((r, i) => <ResultTile key={r.id} row={r} priority={i < 12} />)}
          </div>
        )}
      </main>
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value?: string; onChange: (v: string | undefined) => void; options: [string, string][] }) {
  return (
    <label className="block text-sm">
      <div className="mb-1.5 text-muted">{label}</div>
      <select className="field w-full" value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">Any</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}
