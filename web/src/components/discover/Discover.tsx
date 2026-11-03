"use client";
import Link from "next/link";
import { ChevronDown, Play } from "lucide-react";
import { api, formatTime } from "@/lib/api";
import { DIFFICULTY_LABEL, cultureOf, type Facet } from "@/lib/catalog";
import { accentFor } from "@/lib/color";
import { useTheme } from "@/lib/prefs";
import type { CatalogEntry, Difficulty } from "@/lib/types";

export function Cover({ song, className = "", priority = false }: { song: CatalogEntry; className?: string; priority?: boolean }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={api.coverUrl(song.id)} alt="" className={`cover ${className}`} loading={priority ? "eager" : "lazy"} draggable={false} />;
}

const GENRE_NOUN: Record<string, string> = {
  Folk: "folk song", Hymn: "hymn", "Children's": "children's song", Christmas: "Christmas carol", Celebration: "song for celebrations",
  Spiritual: "spiritual", Classical: "classical melody", Lullaby: "lullaby", Latin: "song", Country: "country song", Jazz: "jazz standard", Pop: "pop song",
};

const DOT: Record<Difficulty, string> = { easy: "bg-ok", medium: "bg-[#e0a63a]", hard: "bg-accent" };

export function Meta({ song, className = "" }: { song: CatalogEntry; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-muted ${className}`}>
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${DOT[song.difficulty]}`} aria-hidden="true" />
      {DIFFICULTY_LABEL[song.difficulty]}<span aria-hidden="true">·</span>{formatTime(song.duration)}
    </span>
  );
}

export function SongTile({ song, priority = false }: { song: CatalogEntry; priority?: boolean }) {
  return (
    <Link href={`/songs/${song.id}`} className="tile group" aria-label={`${song.title}, ${song.artist}, ${DIFFICULTY_LABEL[song.difficulty]}`}>
      <Cover song={song} priority={priority} />
      <div className="mt-2.5 truncate text-[0.9rem] font-semibold leading-tight">{song.title}</div>
      <div className="mt-1 truncate text-[0.8rem]"><span className="text-muted">{song.artist === "Traditional" ? cultureOf(song) || song.artist : song.artist}</span></div>
      <Meta song={song} className="mt-0.5 text-[0.78rem]" />
    </Link>
  );
}

export function Shelf({ title, subtitle, songs, grid = false, action }: { title: string; subtitle?: string; songs: CatalogEntry[]; grid?: boolean; action?: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <h2 className="display-md text-[1.45rem]">{title}</h2>
          {subtitle && <span className="hidden text-sm text-muted sm:inline">{subtitle}</span>}
        </div>
        {action}
      </div>
      {grid ? (
        <div className="grid grid-cols-2 gap-x-5 gap-y-7 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">{songs.map((s) => <SongTile key={s.id} song={s} />)}</div>
      ) : (
        <div className="-mx-5 flex gap-5 overflow-x-auto px-5 pb-3 pt-1 sm:-mx-8 sm:px-8 [scrollbar-width:none]">
          {songs.map((s) => <div key={s.id} className="w-[9.5rem] shrink-0 sm:w-[10.5rem]"><SongTile song={s} /></div>)}
        </div>
      )}
    </section>
  );
}

/** The big one at the top: tinted with the song's own hue. */
export function Hero({ song, count }: { song: CatalogEntry; count: number }) {
  const [theme] = useTheme();
  const a = accentFor(song.accent_hue, theme === "dark" ? "dark" : "light");
  const what = GENRE_NOUN[song.genre] ?? `${song.genre.toLowerCase()} song`;
  const place = cultureOf(song) ? `${cultureOf(song)} ${what}` : what;
  const article = /^[aeiou]/i.test(place) ? "An" : "A";
  return (
    <section
      className="panel relative isolate overflow-hidden"
      style={{ background: `linear-gradient(100deg, ${a.accentSoft}, transparent 60%), var(--bg-elev)` }}
      aria-label="Tonight's pick"
    >
      <div className="flex flex-col gap-7 p-6 sm:flex-row sm:items-center sm:p-8">
        <Link href={`/songs/${song.id}`} className="tile w-40 shrink-0 sm:w-52" aria-label={`Play ${song.title}`}>
          <Cover song={song} priority className="rounded-[1.1rem] shadow-card" />
        </Link>
        <div className="min-w-0">
          <div className="text-sm font-medium" style={{ color: a.accent }}>Tonight&apos;s pick</div>
          <h2 className="display-lg mt-2 text-[2.4rem] sm:text-[3.1rem]">{song.title}</h2>
          <p className="mt-3 max-w-xl text-[0.95rem] leading-relaxed text-muted">
            {/traditional/i.test(song.artist) ? `${article} ${place}${song.artist !== "Traditional" ? `, words by ${song.artist.replace(/\s*\/\s*Traditional/i, "")}` : ""}.` : `By ${song.artist}.`} {DIFFICULTY_LABEL[song.difficulty]} to play, {formatTime(song.duration)} long{song.key ? `, in ${song.key}` : ""}.
            {" "}One of {count} songs you can start right now.
          </p>
          <div className="mt-6 flex items-center gap-3">
            <Link href={`/songs/${song.id}`} className="btn btn-primary btn-lg" style={{ background: a.accent, borderColor: a.accent, color: a.accentFg }}><Play className="h-4 w-4 fill-current" /> Play now</Link>
            <Meta song={song} className="text-sm" />
          </div>
        </div>
      </div>
    </section>
  );
}

export function Chip({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return <button className="chip" aria-pressed={active} onClick={onClick}>{children}</button>;
}

export function Filters({ facet, setFacet, genres, cultures }: { facet: Facet; setFacet: (f: Facet) => void; genres: { value: string; n: number }[]; cultures: { value: string; n: number }[] }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Chip active={facet.kind === "all"} onClick={() => setFacet({ kind: "all" })}>All songs</Chip>
        {(["easy", "medium", "hard"] as Difficulty[]).map((d) => (
          <Chip key={d} active={facet.kind === "difficulty" && facet.value === d} onClick={() => setFacet({ kind: "difficulty", value: d })}>{DIFFICULTY_LABEL[d]}</Chip>
        ))}
        <Chip active={facet.kind === "recordings"} onClick={() => setFacet({ kind: "recordings" })}>Real recordings</Chip>
      </div>
      <details className="group" open={facet.kind === "genre" || facet.kind === "culture"}>
        <summary className="chip cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden">Browse by style or country <ChevronDown className="h-3.5 w-3.5 text-faint transition group-open:rotate-180" /></summary>
        <div className="mt-3 space-y-2.5 pl-1">
          <div className="flex flex-wrap items-center gap-2"><span className="label w-16">Style</span>{genres.map((g) => <Chip key={g.value} active={facet.kind === "genre" && facet.value === g.value} onClick={() => setFacet({ kind: "genre", value: g.value })}>{g.value}</Chip>)}</div>
          <div className="flex flex-wrap items-center gap-2"><span className="label w-16">From</span>{cultures.map((c) => <Chip key={c.value} active={facet.kind === "culture" && facet.value === c.value} onClick={() => setFacet({ kind: "culture", value: c.value })}>{c.value}</Chip>)}</div>
        </div>
      </details>
    </div>
  );
}

export function TileSkeleton() {
  return (
    <div className="min-w-0">
      <div className="skel aspect-square w-full" />
      <div className="skel mt-3 h-3.5 w-4/5 rounded-md" />
      <div className="skel mt-2 h-3 w-1/2 rounded-md" />
    </div>
  );
}

export function DiscoverSkeleton() {
  return (
    <div className="space-y-10" aria-busy="true" aria-label="Loading songs">
      <div className="skel h-64 w-full rounded-[1.25rem]" />
      <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">{Array.from({ length: 6 }).map((_, i) => <TileSkeleton key={i} />)}</div>
      <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">{Array.from({ length: 6 }).map((_, i) => <TileSkeleton key={i} />)}</div>
    </div>
  );
}
