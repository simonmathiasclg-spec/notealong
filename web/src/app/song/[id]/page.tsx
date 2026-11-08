"use client";
// A song's own page: what it is, where it comes from, whether it suits your instrument, its words,
// and songs like it. Play starts the player.
import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft, Play } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { AddToSetlistButton } from "@/components/AddToSetlist";
import { FavouriteButton } from "@/components/Favourite";
import { ResultTile } from "@/components/ResultTile";
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
        <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-danger-soft text-danger"><AlertCircle className="h-6 w-6" /></div>
        <h1 className="display-md text-2xl">That song isn&apos;t here</h1>
        <p className="mt-2 text-sm text-muted">It may have been deleted, or the link is wrong.</p>
        <Link href="/" className="btn btn-primary mt-7"><ArrowLeft className="h-4 w-4" /> Discover</Link>
      </div>
    </div>
  );
  if (!song) return <div className="flex min-h-full flex-col"><AppHeader /><div className="mx-auto w-full max-w-5xl px-5 sm:px-8"><div className="skel h-64 w-full" /></div></div>;

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

  return (
    <div className="flex min-h-full flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 pb-20 sm:px-8">
        <Link href={upload ? "/my-songs" : "/"} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" /> {upload ? "My songs" : "Discover"}</Link>
        <div className="mt-5 flex flex-col gap-8 sm:flex-row">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={upload ? api.uploadCoverUrl(id) : api.coverUrl(id)} alt="" className="cover w-48 shrink-0 shadow-card sm:w-60" />
          <div className="min-w-0 flex-1">
            <h1 className="display-lg text-[2.4rem] leading-[1.05] sm:text-[3rem]">{song.title}</h1>
            <p className="mt-2 text-lg text-muted">{song.artist || (upload ? "Unknown artist" : "")}</p>
            <div className="mt-6 flex flex-wrap items-center gap-2">
              <Link href={`/songs/${id}`} className="btn btn-primary btn-lg"><Play className="h-4 w-4 fill-current" /> Play</Link>
              <FavouriteButton id={id} title={song.title} />
              <AddToSetlistButton songId={id} title={song.title} variant="button" />
            </div>
            <p className={`mt-5 text-sm ${fits ? "text-muted" : "text-fg"}`}>
              {range ? (fits ? `The whole melody fits the ${instrument.name.toLowerCase()} without a big key change.` : `Parts of the melody go outside the usual range of the ${instrument.name.toLowerCase()}; the player can move it an octave or change the key.`) : null}
            </p>
          </div>
        </div>

        <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_1.1fr]">
          <section aria-label="About this song">
            <h2 className="display-md text-[1.3rem]">About</h2>
            <dl className="mt-3 divide-y divide-border border-y border-border text-sm">
              {facts.map(([k, v]) => <div key={k} className="flex gap-4 py-2.5"><dt className="w-32 shrink-0 text-muted">{k}</dt><dd className="min-w-0">{v}</dd></div>)}
            </dl>
            {cat ? (
              <div className="mt-5 text-sm leading-relaxed text-muted">
                <p>{cat.attribution}</p>
                <p className="mt-2 text-xs text-faint">
                  {cat.licence.url ? <a href={cat.licence.url} target="_blank" rel="noreferrer" className="underline underline-offset-4">{cat.licence.name}</a> : cat.licence.name}
                  {cat.source.url && <> · <a href={cat.source.url} target="_blank" rel="noreferrer" className="underline underline-offset-4">Source</a></>}
                </p>
              </div>
            ) : (
              <p className="mt-5 text-sm text-muted">Your own song, from {song.source.filename ?? "an upload"}. It and everything made from it stay private to you.</p>
            )}
          </section>
          <section aria-label="Words">
            <h2 className="display-md text-[1.3rem]">Words</h2>
            {lines.length ? (
              <div className="mt-3 max-h-[28rem] overflow-y-auto rounded-xl border border-border p-4 text-[0.95rem] leading-relaxed">
                {lines.map((l, i) => <p key={i}>{l}</p>)}
              </div>
            ) : <p className="mt-3 text-sm text-muted">This one has no words: it is played as a melody.</p>}
          </section>
        </div>

        {similar.length > 0 && (
          <section className="mt-12" aria-label="Songs like this">
            <h2 className="display-md mb-4 text-[1.3rem]">Songs like this</h2>
            <div className="grid grid-cols-2 gap-x-5 gap-y-7 sm:grid-cols-3 lg:grid-cols-6">{similar.map((r) => <ResultTile key={r.id} row={r} />)}</div>
          </section>
        )}
      </main>
    </div>
  );
}
