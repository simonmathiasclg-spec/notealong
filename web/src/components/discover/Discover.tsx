"use client";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { api, formatTime } from "@/lib/api";
import { DIFFICULTY_LABEL, cultureOf, isStandard } from "@/lib/catalog";
import { ArtTile, type TileShape, type TileSong } from "@/components/art/Art";
import type { CatalogEntry, Difficulty } from "@/lib/types";

export function Cover({ song, className = "", priority = false }: { song: CatalogEntry; className?: string; priority?: boolean }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={api.coverUrl(song.id)} alt="" className={`cover ${className}`} loading={priority ? "eager" : "lazy"} draggable={false} style={{ background: song.colors?.deep }} />;
}

const DOT: Record<Difficulty, string> = { easy: "bg-ok", medium: "bg-[#e0a63a]", hard: "bg-red" };

export function Meta({ song, className = "" }: { song: CatalogEntry; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-muted ${className}`}>
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${DOT[song.difficulty]}`} aria-hidden="true" />
      {DIFFICULTY_LABEL[song.difficulty]}<span aria-hidden="true">·</span>{formatTime(song.duration)}
    </span>
  );
}

/** "Traditional" says little on a tile: the tradition it comes from says more. */
export function whoOf(song: CatalogEntry): string {
  return song.artist === "Traditional" ? cultureOf(song) || song.artist : song.artist;
}

const KIND: Record<string, string> = {
  "Children's": "Kids", Celebration: "Party", Christmas: "Carol", "Sea shanty": "Shanty", Spiritual: "Spiritual", Hymn: "Hymn",
  Lullaby: "Lullaby", Classical: "Classical", Folk: "Folk", Patriotic: "Anthem", Parlour: "Parlour", Lied: "Art song",
};

/** The word on a card's numbered label: what kind of song it is. */
export function kindOf(song: CatalogEntry): string {
  if (song.source.kind === "cc") return "Recording";
  if (isStandard(song)) return "Standard";
  return KIND[song.genre] ?? song.genre;
}

export function toTile(song: CatalogEntry): TileSong {
  return { id: song.id, title: song.title, artist: whoOf(song), cover: api.coverUrl(song.id), colors: song.colors ?? null,
    meta: `${DIFFICULTY_LABEL[song.difficulty]} · ${formatTime(song.duration)}${song.key ? ` · ${song.key}` : ""}` };
}

/** The rhythm of shapes along a shelf: a tall one, two small, a wide one, a round one… never a uniform row. */
const RHYTHM: TileShape[] = ["tall", "square", "square", "wide", "circle", "square", "square", "tall", "circle", "square", "wide", "square", "square"];

/**
 * A shelf of songs as a strip of widgets in mixed shapes, two rows high, scrolling sideways. The first
 * tile is the biggest so each shelf has a place for the eye to land.
 */
export function Shelf({ title, subtitle, songs, action, start = 0 }: { title: string; subtitle?: string; songs: CatalogEntry[]; total?: number; action?: React.ReactNode; start?: number }) {
  return (
    <section aria-label={title}>
      <div className="mb-5 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 className="display-md truncate text-[1.6rem] sm:text-[1.9rem]">{title}</h2>
          {subtitle && <p className="mt-1 truncate text-[13px] text-muted">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="-mx-5 overflow-x-auto px-5 pb-2 [scrollbar-width:none] sm:-mx-8 sm:px-8 lg:-mx-12 lg:px-12">
        <div className="grid w-max grid-flow-col-dense grid-rows-[repeat(2,var(--cell))] gap-3 [--cell:8.75rem] sm:gap-4 sm:[--cell:10.5rem]" style={{ gridAutoColumns: "var(--cell)" }}>
          {songs.map((s, i) => {
            const shape = RHYTHM[(i + start) % RHYTHM.length];
            const span = shape === "tall" ? "row-span-2" : shape === "wide" ? "col-span-2" : "";
            return <div key={s.id} className={span}><ArtTile song={toTile(s)} shape={shape} priority={i < 4} /></div>;
          })}
        </div>
      </div>
    </section>
  );
}

/** A "see all" link in the house style: words and a small arrow, no box. */
export function SeeAll({ href, n }: { href: string; n: number }) {
  return (
    <Link href={href} className="group inline-flex shrink-0 items-center gap-1 text-[13px] font-medium text-muted transition hover:text-fg">
      See all {n} <ArrowUpRight className="h-3.5 w-3.5 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" strokeWidth={1.8} />
    </Link>
  );
}

export function TileSkeleton() {
  return <div className="skel squircle aspect-square w-full" />;
}

export function DiscoverSkeleton() {
  return (
    <div className="space-y-12" aria-busy="true" aria-label="Loading songs">
      <div className="mx-auto flex max-w-5xl items-center justify-center gap-6 pt-6">
        {[0.7, 0.85, 1, 0.85, 0.7].map((s, i) => <div key={i} className="skel shrink-0 rounded-[22px]" style={{ width: 230 * s, height: 360 * s, opacity: s }} />)}
      </div>
      <div className="flex gap-4 overflow-hidden">{Array.from({ length: 7 }).map((_, i) => <div key={i} className="skel squircle h-[10.5rem] w-[10.5rem] shrink-0" />)}</div>
    </div>
  );
}
