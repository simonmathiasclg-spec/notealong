"use client";
import { Suspense, use, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Printer } from "lucide-react";
import { api } from "@/lib/api";
import { buildDisplayLines } from "@/lib/display";
import { getInstrument } from "@/lib/instruments";
import { describeNote, keyName, resolveOctaveShift } from "@/lib/notes";
import type { Notation, OctaveMode, Song } from "@/lib/types";

/** Printable lyric sheet. Use the browser's print dialog to save as PDF. */
export default function PrintPage({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<div className="p-8 text-muted">Loading…</div>}><PrintSheet params={params} /></Suspense>;
}

function PrintSheet({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useSearchParams();
  const [song, setSong] = useState<Song | null>(null);
  useEffect(() => { api.getSong(id).then(setSong); }, [id]);

  const instrumentId = q.get("instrument") ?? song?.user.instrument ?? "alto_sax";
  const keyShift = Number(q.get("key") ?? song?.user.key_shift ?? 0);
  const octave = (q.get("octave") ?? song?.user.octave ?? "auto") as OctaveMode;
  const notation = (q.get("notation") ?? song?.user.notation ?? "sharps") as Notation;
  const script = (q.get("script") ?? "original") as "original" | "roman";

  const view = useMemo(() => {
    if (!song) return null;
    const instrument = getInstrument(instrumentId);
    const octaveShift = resolveOctaveShift(octave, song.notes.map((n) => n.midi), instrument, keyShift);
    const info = new Map(song.notes.map((n) => [n.id, describeNote(n, { instrument: instrumentId, keyShift, octave, notation }, song.key, octaveShift)]));
    return { instrument, lines: buildDisplayLines(song), info };
  }, [song, instrumentId, keyShift, octave, notation]);

  useEffect(() => { document.documentElement.dataset.theme = "light"; }, []);

  if (!song || !view) return <div className="p-8 text-muted">Loading…</div>;
  return (
    <div className="mx-auto max-w-4xl bg-white px-8 py-10 text-black print:px-0 print:py-0">
      <div className="no-print mb-8 flex items-center justify-between rounded-full bg-neutral-100 py-2 pl-5 pr-2 text-sm text-neutral-700">
        <span>Use <b>Print, then Save as PDF</b> in your browser to keep a PDF.</span>
        <button className="btn !border-black !bg-black !text-white" onClick={() => window.print()}><Printer className="h-4 w-4" strokeWidth={1.7} /> Print or save as PDF</button>
      </div>
      <header className="mb-10 border-b border-black pb-5">
        <h1 className="display-xl text-[3rem]">{song.title}</h1>
        <div className="mt-1 text-lg text-neutral-600">{song.artist ?? ""}</div>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm text-neutral-700">
          <span><b>For</b> {view.instrument.name}</span>
          {song.key && <span><b>Key</b> {keyName(song.key, keyShift)}{keyShift ? ` (${keyShift > 0 ? "+" : ""}${keyShift})` : ""}</span>}
          <span><b>Notes</b> {notation === "sharps" ? "letters, sharps" : notation === "flats" ? "letters, flats" : notation === "solfege" ? "Do Re Mi" : "Sa Re Ga"}</span>
          <span>▲ higher version of the note, ▼ lower</span>
        </div>
      </header>
      <div className="space-y-8">
        {view.lines.map((line) => (
          <div key={line.index} className="flex flex-wrap items-end gap-x-4 gap-y-5 break-inside-avoid font-display text-[1.55rem] font-semibold leading-none tracking-[-0.015em]">
            {line.items.map((it, i) => (
              <div key={it.word?.id ?? i} className="flex flex-col items-center gap-2">
                <div className="flex gap-1 font-display text-[0.9rem] font-extrabold [font-stretch:82%]">
                  {it.notes.map((n) => {
                    const d = view.info.get(n.id)!;
                    return (
                      <span key={n.id} className={`inline-flex h-7 min-w-7 items-center justify-center rounded-md border px-1 ${d.outOfRange ? "border-dashed border-red-600 text-red-600" : "border-neutral-800"}`}>
                        {d.octaveMark === "down" && <span className="text-[0.6em] opacity-70">▼</span>}{d.label}{d.octaveMark === "up" && <span className="text-[0.6em] opacity-70">▲</span>}
                      </span>
                    );
                  })}
                  {it.notes.length === 0 && <span className="h-7" />}
                </div>
                <span className={it.word ? "" : "font-sans text-sm text-neutral-400"}>{it.word ? (script === "roman" && it.word.roman ? it.word.roman : it.word.text) : "no words"}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <footer className="mt-12 flex items-center justify-between border-t border-neutral-300 pt-3 text-xs text-neutral-500">
        <span>Made with NoteAlong</span>
        {song.catalog && <span className="max-w-xl text-right">{song.catalog.attribution}</span>}
      </footer>
    </div>
  );
}
