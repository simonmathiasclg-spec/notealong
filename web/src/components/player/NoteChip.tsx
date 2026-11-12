"use client";
import type { DisplayNote } from "@/lib/notes";
import { Accidental } from "../art/Glyphs";

export type ChipState = "past" | "current" | "future";

/** The note to play, shown above its syllable: a compact heavy letter, with a sharp or flat drawn to match. */
export function NoteChip({ note, state, size, cue, onClick, title }: { note: DisplayNote; state: ChipState; size: "lg" | "md" | "sm"; /** about to start: shows the "get ready" outline */ cue?: boolean; onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void; title?: string }) {
  const sizes = { lg: "h-[2.15em] min-w-[2.15em] px-[.38em] text-[0.52em]", md: "h-[2.1em] min-w-[2.1em] px-[.34em] text-[0.58em]", sm: "h-[2.1em] min-w-[2.1em] px-[.34em] text-[0.56em]" };
  const label = note.label;
  const accidental = label.length > 1 && (label.endsWith("#") || label.endsWith("b")) && /^[A-G]/.test(label);
  return (
    <button
      type="button"
      className={`note-chip ${sizes[size]} ${onClick ? "" : "cursor-default"}`}
      data-state={state}
      data-cue={cue ? "1" : undefined}
      data-range={note.outOfRange ? "out" : "in"}
      data-tip={title ?? note.outOfRangeReason ?? undefined}
      onClick={onClick}
      tabIndex={onClick ? 0 : -1}
      aria-label={`${label}${note.octaveMark === "up" ? " upper" : note.octaveMark === "down" ? " lower" : ""}${note.outOfRange ? ", outside your instrument's range" : ""}`}
    >
      {note.octaveMark === "down" && <span className="mr-[.06em] text-[.5em] opacity-70" aria-hidden="true">▼</span>}
      <span className="inline-flex items-start">{accidental ? <>{label[0]}<Accidental kind={label[1] === "#" ? "sharp" : "flat"} /></> : label}</span>
      {note.octaveMark === "up" && <span className="ml-[.06em] text-[.5em] opacity-70" aria-hidden="true">▲</span>}
    </button>
  );
}
