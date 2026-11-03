"use client";
import Link from "next/link";
import { api, formatTime } from "@/lib/api";
import { DIFFICULTY_LABEL, type Facet } from "@/lib/catalog";
import type { CatalogEntry, Difficulty } from "@/lib/types";

export function Cover({ song, className = "" }: { song: CatalogEntry; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={api.coverUrl(song.id)} alt="" className={`aspect-square w-full rounded-2xl object-cover ${className}`} loading="lazy" />;
}

export function SongTile({ song }: { song: CatalogEntry }) {
  return (
    <Link href={`/songs/${song.id}`} className="group block min-w-0" title={song.attribution}>
      <Cover song={song} className="transition group-hover:-translate-y-0.5" />
      <div className="mt-2 truncate font-display font-bold leading-tight">{song.title}</div>
      <div className="truncate text-sm text-muted">{song.artist} · {formatTime(song.duration)} · {DIFFICULTY_LABEL[song.difficulty]}</div>
    </Link>
  );
}

export function Shelf({ title, subtitle, songs, grid = false }: { title: string; subtitle?: string; songs: CatalogEntry[]; grid?: boolean }) {
  return (
    <section>
      <div className="mb-3 flex items-baseline gap-3">
        <h2 className="font-display text-xl font-bold">{title}</h2>
        {subtitle && <span className="text-sm text-muted">{subtitle}</span>}
      </div>
      {grid ? (
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">{songs.map((s) => <SongTile key={s.id} song={s} />)}</div>
      ) : (
        <div className="-mx-5 flex gap-4 overflow-x-auto px-5 pb-2 sm:-mx-8 sm:px-8">{songs.map((s) => <div key={s.id} className="w-40 shrink-0 sm:w-44"><SongTile song={s} /></div>)}</div>
      )}
    </section>
  );
}

export function Filters({ facet, setFacet, genres, cultures }: { facet: Facet; setFacet: (f: Facet) => void; genres: string[]; cultures: string[] }) {
  const chip = (active: boolean, label: string, onClick: () => void) => (
    <button key={label} aria-pressed={active} onClick={onClick} className={`btn text-xs ${active ? "btn-primary" : ""}`}>{label}</button>
  );
  return (
    <div className="mb-8 space-y-2">
      <div className="flex flex-wrap gap-2">
        {chip(facet.kind === "all", "All", () => setFacet({ kind: "all" }))}
        {(["easy", "medium", "hard"] as Difficulty[]).map((d) => chip(facet.kind === "difficulty" && facet.value === d, DIFFICULTY_LABEL[d], () => setFacet({ kind: "difficulty", value: d })))}
      </div>
      <div className="flex flex-wrap gap-2">{genres.map((g) => chip(facet.kind === "genre" && facet.value === g, g, () => setFacet({ kind: "genre", value: g })))}</div>
      <div className="flex flex-wrap gap-2">{cultures.map((c) => chip(facet.kind === "culture" && facet.value === c, c, () => setFacet({ kind: "culture", value: c })))}</div>
    </div>
  );
}
