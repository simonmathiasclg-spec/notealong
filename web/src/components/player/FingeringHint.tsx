"use client";
import { saxFingering } from "@/lib/fingering";
import type { DisplayNote } from "@/lib/notes";

/** Small saxophone fingering diagram for the current (or next) note. */
export function FingeringHint({ note }: { note: DisplayNote | null }) {
  const f = note ? saxFingering(note.written) : null;
  const key = (on: boolean, i: number) => (
    <circle key={i} cx="20" cy={16 + i * 16} r="6" className={on ? "fill-fg stroke-fg" : "fill-none stroke-fg/35"} strokeWidth="1.5" />
  );
  return (
    <div className="floating flex items-center gap-3 px-3 py-2" aria-label="Fingering hint">
      <svg viewBox="0 0 40 120" className="h-24 w-8">
        <ellipse cx="9" cy="8" rx="4" ry="2.5" className={f?.oct ? "fill-fg stroke-fg" : "fill-none stroke-fg/35"} strokeWidth="1.2" />
        {(f?.l ?? [false, false, false]).map(key)}
        <line x1="12" y1="62" x2="28" y2="62" className="stroke-fg/25" strokeWidth="1" />
        {(f?.r ?? [false, false, false]).map((on, i) => key(on, i + 3.3))}
      </svg>
      <div className="min-w-[5.5rem] text-xs leading-tight">
        <div className="text-lg font-bold">{note ? note.label : "–"}</div>
        {f ? (
          <>
            <div className="text-muted">{f.oct ? "octave key" : "no octave key"}</div>
            {f.extra.map((e) => <div key={e} className="text-muted">+ {e}</div>)}
          </>
        ) : (
          <div className="text-muted">{note ? "outside the chart" : "sax fingering"}</div>
        )}
      </div>
    </div>
  );
}
