"use client";
import type { DisplayNote } from "@/lib/notes";

export type ChipState = "past" | "current" | "future";

export function NoteChip({ note, state, size, onClick, title }: { note: DisplayNote; state: ChipState; size: "lg" | "md" | "sm"; onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void; title?: string }) {
  const sizes = { lg: "h-[2.4em] min-w-[2.4em] px-[.45em] text-[0.46em]", md: "h-[2.3em] min-w-[2.3em] px-[.4em] text-[0.5em]", sm: "h-[2.2em] min-w-[2.2em] px-[.35em] text-[0.5em]" };
  const label = note.label;
  const accidental = label.length > 1 && (label.endsWith("#") || label.endsWith("b")) && /^[A-G]/.test(label);
  return (
    <button
      type="button"
      className={`note-chip ${sizes[size]} ${onClick ? "" : "cursor-default"}`}
      data-state={state}
      data-range={note.outOfRange ? "out" : "in"}
      title={title ?? note.outOfRangeReason ?? undefined}
      onClick={onClick}
      tabIndex={onClick ? 0 : -1}
    >
      {note.octaveMark === "down" && <span className="mr-[.05em] text-[.55em] opacity-70" aria-label="lower register">▼</span>}
      <span>{accidental ? <>{label[0]}<span className="text-[.75em] align-top">{label[1] === "#" ? "♯" : "♭"}</span></> : label}</span>
      {note.octaveMark === "up" && <span className="ml-[.05em] text-[.55em] opacity-70" aria-label="upper register">▲</span>}
    </button>
  );
}
