"use client";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { Music } from "lucide-react";
import type { DisplayLine } from "@/lib/display";
import type { DisplayNote } from "@/lib/notes";
import type { Word } from "@/lib/types";
import { NoteChip, type ChipState } from "./NoteChip";
import { useFitText } from "@/lib/useFitText";

export type StageProps = {
  lines: DisplayLine[];
  currentLine: number;
  currentWordId: string | null;
  currentNoteId: string | null;
  time: number;
  noteInfo: Map<string, DisplayNote>;
  script: "original" | "roman";
  editing: boolean;
  onNoteClick?: (noteId: string, el: HTMLElement) => void;
  onWordClick?: (word: Word, el: HTMLElement) => void;
  onAddNote?: (wordId: string | null, lineIndex: number) => void;
  onLineClick?: (line: DisplayLine) => void;
};

export function LyricStage(p: StageProps) {
  const { lines, currentLine } = p;
  const window = [currentLine - 1, currentLine, currentLine + 1, currentLine + 2].filter((i) => i >= 0 && i < lines.length);
  return (
    <LayoutGroup>
      <div className="flex h-full flex-col items-center justify-center gap-[1.2em] px-4 py-6 sm:px-10">
        <AnimatePresence initial={false} mode="popLayout">
          {window.map((i) => {
            const line = lines[i];
            const role = i < currentLine ? "prev" : i === currentLine ? "current" : i === currentLine + 1 ? "next" : "after";
            return (
              <motion.div
                key={line.index}
                layout
                initial={{ opacity: 0, y: 40 }}
                animate={{ opacity: role === "current" ? 1 : role === "prev" ? 0.35 : role === "next" ? 0.75 : 0.45, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -40 }}
                transition={{ type: "spring", stiffness: 260, damping: 30 }}
                className={`w-full max-w-6xl ${role === "current" ? "" : "cursor-pointer"}`}
                onClick={role === "current" ? undefined : () => p.onLineClick?.(line)}
              >
                <LineRow line={line} role={role} {...p} />
              </motion.div>
            );
          })}
        </AnimatePresence>
        {lines.length === 0 && <div className="text-muted">No notes or lyrics were found in this song.</div>}
      </div>
    </LayoutGroup>
  );
}

function LineRow({ line, role, ...p }: StageProps & { line: DisplayLine; role: "prev" | "current" | "next" | "after" }) {
  const sizeClass = role === "current"
    ? "text-[calc(var(--fit,1)*clamp(1.9rem,4.6vw,3.8rem))]"
    : "text-[calc(var(--fit,1)*clamp(1.15rem,2.5vw,1.9rem))]";
  const chipSize = role === "current" ? "lg" : "md";
  const fit = useFitText<HTMLDivElement>([line, role, p.editing, p.script]);
  return (
    <div className="flex w-full justify-center overflow-hidden">
    <div ref={fit.ref} style={{ "--fit": fit.scale } as React.CSSProperties}
      className={`stage-line flex w-max max-w-none flex-nowrap items-end justify-center gap-x-[.45em] text-center leading-none ${sizeClass}`}>
      {line.items.map((item, idx) => {
        const word = item.word;
        const wordState: ChipState = !word ? "future" : word.id === p.currentWordId ? "current" : p.time >= word.end ? "past" : "future";
        return (
          <div key={word?.id ?? `loose-${line.index}-${idx}`} className="flex flex-col items-center gap-[.3em]">
            <div className="flex min-h-[1.15em] items-end gap-[.18em]">
              {item.notes.map((n) => {
                const info = p.noteInfo.get(n.id);
                if (!info) return null;
                const st: ChipState = n.id === p.currentNoteId ? "current" : p.time >= n.end ? "past" : "future";
                return (
                  <NoteChip key={n.id} note={info} state={st} size={chipSize}
                    onClick={p.editing ? (e) => p.onNoteClick?.(n.id, e.currentTarget) : undefined}
                    title={p.editing ? "Click to change this note" : undefined}
                  />
                );
              })}
              {p.editing && (!word || item.notes.length === 0) && (
                <button type="button" onClick={() => p.onAddNote?.(word?.id ?? null, line.index)} title="Add a note here"
                  className="note-chip h-[2.3em] min-w-[2.3em] text-[0.5em] border-dashed text-faint hover:text-accent">+</button>
              )}
            </div>
            {word ? (
              <span
                className={`word ${p.editing ? "cursor-text underline decoration-dotted decoration-faint underline-offset-8" : ""}`}
                data-state={wordState}
                onClick={p.editing ? (e) => p.onWordClick?.(word, e.currentTarget as HTMLElement) : undefined}
              >
                {p.script === "roman" && word.roman ? word.roman : word.text}
              </span>
            ) : (
              <span className="word inline-flex items-center gap-[.2em] text-[.55em] text-faint" data-state="future"><Music className="h-[1em] w-[1em]" /> no lyrics</span>
            )}
          </div>
        );
      })}
    </div>
    </div>
  );
}
