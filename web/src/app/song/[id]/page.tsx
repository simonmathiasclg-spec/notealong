"use client";
// A song's own page: what it is, where it comes from, whether it suits your instrument, its words,
// and songs like it. Play starts the player.
import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft, Play } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { AddToSetlistButton } from "@/components/AddToSetlist";
import { FavouriteButton } from "@/components/Favourite";
import { ResultGrid } from "@/components/ResultTile";
import { ArtTile } from "@/components/art/Art";
import { SiteFooter } from "@/components/SiteFooter";
import { api, formatTime } from "@/lib/api";
import { DIFFICULTY_HINT, DIFFICULTY_LABEL, cultureOf, languageName } from "@/lib/catalog";
import { getInstrument } from "@/lib/instruments";
import { SHARP_NAMES, keyName } from "@/lib/notes";
import { useInstrumentPref } from "@/lib/prefs";
import { decadeOf, fitsInstrument, tempoBand, TEMPO_LABEL, type SearchRow } from "@/lib/search";
import type { Song } from "@/lib/types";

const noteName = (m: number) => `${SHARP_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;

export default function SongInfoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [song, setSong] = useState<Song | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<SearchRow[]>([]);
  const [instrumentId] = useInstrumentPref();
  const instrument = getInstrument(instrumentId);
  useEffect(() => {
    api.getSong(id).then(setSong).catch((e) => setError((e as Error).message));
    api.searchIndex().then((r) => setRows(r.songs)).catch(() => undefined);
  }, [id]);
  const row = rows.find((r) => r.id === id);
  const similar = useMemo(() => {
    if (!row) return [];
    const same = (r: SearchRow) => (r.genre && r.genre === row.genre ? 2 : 0) + (r.culture && r.culture === row.culture ? 1 : 0) + (r.language === row.language ? 0.5 : 0) + (decadeOf(r.year) && decadeOf(r.year) === decadeOf(row.year) ? 1 : 0);
    return rows.filter((r) => r.id !== id && r.kind === "catalog").map((r) => ({ r, s: same(r) })).filter((x) => x.s >= 2).sort((a, b) => b.s - a.s || a.r.title.localeCompare(b.r.title)).slice(0, 6).map((x) => x.r);
  }, [rows, row, id]);

  if (error) return (
    <div className="flex min-h-full flex-col"><AppHeader />
      <div className="mx-auto max-w-md px-6 py-16 text-center">
        <AlertCircle className="mx-auto mb-5 h-8 w-8 text-danger" strokeWidth={1.6} />
        <h1 className="display-xl text-[2.6rem]">That song isn&apos;t here</h1>
        <p className="mt-2 text-sm text-muted">It may have been deleted, or the link is wrong.</p>
        <Link href="/" className="btn btn-primary mt-7"><ArrowLeft className="h-4 w-4" /> Discover</Link>
      </div>
    </div>
  );
  if (!song) return <div className="flex min-h-full flex-col"><AppHeader /><div className="mx-auto grid w-full max-w-[80rem] gap-10 px-5 pt-10 sm:px-8 md:grid-cols-[24rem_1fr] lg:px-12"><div className="skel squircle aspect-square w-full" /><div className="space-y-4 self-center"><div className="skel h-16 w-3/4 rounded-xl" /><div className="skel h-5 w-1/3 rounded-lg" /></div></div></div>;

  const cat = song.catalog;
  const upload = !cat;
  const midis = song.notes.map((n) => n.midi);
  const range: [number, number] | null = midis.length ? [Math.min(...midis), Math.max(...midis)] : null;
  const fits = fitsInstrument(range, instrument);
  const lines = song.lines.filter((l) => l.kind === "lyric").map((l) => song.words.filter((w) => w.line === l.index).map((w) => w.text).join(" ")).filter((t) => t.trim());
  const difficulty = cat?.difficulty ?? row?.difficulty ?? null;
  const facts: [string, React.ReactNode][] = [];
  if (cat?.genre) facts.push(["Style", <Link key="g" className="underline-offset-4 hover:underline" href={`/browse?genre=${encodeURIComponent(cat.genre)}`}>{cat.genre}</Link>]);
  if (cat && cultureOf(cat)) facts.push(["From", cultureOf(cat)]);
  if (cat?.year) facts.push(["Published", String(cat.year)]);
  const lang = cat?.language ?? song.language.override ?? song.language.detected;
  if (lang) facts.push(["Language", languageName(lang)]);
  if (song.key) facts.push(["Key", keyName(song.key, 0)]);
  if (song.tempo_bpm) facts.push(["Tempo", `${Math.round(song.tempo_bpm)} beats a minute${tempoBand(song.tempo_bpm) ? `, ${TEMPO_LABEL[tempoBand(song.tempo_bpm)!].toLowerCase()}` : ""}`]);
  facts.push(["Length", formatTime(song.duration)]);
  if (difficulty) facts.push(["Difficulty", `${DIFFICULTY_LABEL[difficulty]}: ${DIFFICULTY_HINT[difficulty].toLowerCase()}`]);
  if (range) facts.push(["Melody range", `${noteName(range[0])} to ${noteName(range[1])} (concert pitch)`]);

  const cover = upload ? api.uploadCoverUrl(id) : api.coverUrl(id);
  return (
    <div className="relative flex min-h-full flex-col">
      {/* the song's artwork washes the top of the page */}
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-0 h-[36rem] overflow-hidden" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={cover} alt="" className="stage-art absolute inset-[-20%] h-[140%] w-[140%] max-w-none object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-bg/40 via-bg/70 to-bg" />
      </div>
      <div className="relative z-10 flex flex-1 flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-[80rem] flex-1 px-5 pb-10 sm:px-8 lg:px-12">
        <Link href={upload ? "/my-songs" : "/"} className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" strokeWidth={1.6} /> {upload ? "My songs" : "Discover"}</Link>
        <div className="mt-6 grid gap-8 md:grid-cols-[minmax(0,24rem)_1fr] md:gap-14">
          <div className="aspect-square w-full max-w-[24rem]"><ArtTile song={{ id, title: song.title, artist: song.artist ?? "", cover, colors: cat?.colors ?? null }} shape="square" priority favourite={false} /></div>
          <div className="min-w-0 self-center">
            <p className="text-[12px] font-medium text-muted">{upload ? "My song" : cat?.source.kind === "cc" ? "Recording · Creative Commons" : "Built-in · public domain"}</p>
            <h1 className="display-xl mt-3 text-[clamp(2.4rem,5.5vw,4.6rem)]">{song.title}</h1>
            <p className="mt-3 text-[15px] text-muted">{song.artist || (upload ? "Unknown artist" : "")}{song.key ? ` · ${keyName(song.key, 0)}` : ""} · {formatTime(song.duration)}</p>
            <div className="mt-7 flex flex-wrap items-center gap-2">
              <Link href={`/songs/${id}`} className="btn btn-red btn-lg"><Play className="h-4 w-4 fill-current" strokeWidth={0} /> Play along</Link>
              <FavouriteButton id={id} title={song.title} className="btn-outline btn-lg" />
              <AddToSetlistButton songId={id} title={song.title} variant="button" />
            </div>
            <p className={`mt-6 max-w-xl text-[14px] leading-relaxed ${fits ? "text-muted" : "text-fg"}`}>
              {range ? (fits ? `The whole melody fits the ${instrument.name.toLowerCase()} without a big key change.` : `Parts of the melody go outside the usual range of the ${instrument.name.toLowerCase()}; the player can move it an octave or change the key.`) : null}
            </p>
          </div>
        </div>

        <div className="mt-16 grid gap-12 lg:grid-cols-[1fr_1.1fr]">
          <section aria-label="About this song">
            <h2 className="display-md text-[1.6rem]">About</h2>
            <dl className="mt-4 border-t border-border text-[14px]">
              {facts.map(([k, v]) => <div key={k} className="flex gap-4 border-b border-border py-3"><dt className="w-32 shrink-0 text-muted">{k}</dt><dd className="min-w-0">{v}</dd></div>)}
            </dl>
            {cat ? (
              <div className="mt-5 text-[13px] leading-relaxed text-muted">
                <p>{cat.attribution}</p>
                <p className="mt-2 text-[12px] text-faint">
                  {cat.licence.url ? <a href={cat.licence.url} target="_blank" rel="noreferrer" className="underline underline-offset-4">{cat.licence.name}</a> : cat.licence.name}
                  {cat.source.url && <> · <a href={cat.source.url} target="_blank" rel="noreferrer" className="underline underline-offset-4">Source</a></>}
                </p>
              </div>
            ) : (
              <p className="mt-5 text-[13px] text-muted">Your own song, from {song.source.filename ?? "an upload"}. It and everything made from it stay private to you.</p>
            )}
          </section>
          <section aria-label="Words">
            <h2 className="display-md text-[1.6rem]">Words</h2>
            {lines.length ? (
              <div className="mt-4 max-h-[30rem] overflow-y-auto border-t border-border pt-4 font-display text-[1.15rem] font-semibold leading-[1.55] tracking-[-0.01em] [mask-image:linear-gradient(to_bottom,#000_85%,transparent)]">
                {lines.map((l, i) => <p key={i} className={i % 4 === 3 ? "mb-4" : ""}>{l}</p>)}
              </div>
            ) : <p className="mt-4 text-[14px] text-muted">This one has no words: it is played as a melody.</p>}
          </section>
        </div>

        {similar.length > 0 && (
          <section className="mt-16" aria-label="Songs like this">
            <h2 className="display-md mb-5 text-[1.6rem]">Songs like this</h2>
            <ResultGrid rows={similar} />
          </section>
        )}
      </main>
      <SiteFooter />
      </div>
    </div>
  );
}
