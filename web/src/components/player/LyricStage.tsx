"use client";
import { useMemo } from "react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { Music } from "lucide-react";
import type { DisplayLine } from "@/lib/display";
import type { DisplayNote } from "@/lib/notes";
import { layoutCells, type Cell, type Cue } from "@/lib/timing";
import type { Word } from "@/lib/types";
import { NoteChip, type ChipState } from "./NoteChip";
import { useFitText } from "@/lib/useFitText";
import { useSweep } from "./useSweep";

export type StageProps = {
  lines: DisplayLine[];
  currentLine: number;
  currentWordId: string | null;
  currentNoteId: string | null;
  time: number;
  noteInfo: Map<string, DisplayNote>;
  script: "original" | "roman";
  editing: boolean;
  /** Timing guide: duration bars, the sweeping line, the "get ready" cue and the countdown. */
  timing: boolean;
  cue: Cue;
  beat: number;
  getTime: () => number;
  onNoteClick?: (noteId: string, el: HTMLElement) => void;
  onWordClick?: (word: Word, el: HTMLElement) => void;
  onAddNote?: (wordId: string | null, lineIndex: number) => void;
  onLineClick?: (line: DisplayLine) => void;
  /** Lines whose notes were hard to hear (uploads only): shown with a quiet mark. */
  unsure?: Set<number>;
  /** Chords above the words: the name of the chord sounding at a time, if any. */
  chordFor?: (seconds: number) => string | null;
};

/**
 * The stage: the current line large in the middle, the previous line above it,
 * the next two below. Lines glide into place as the song moves on.
 */
export function LyricStage(p: StageProps) {
  const { lines, currentLine } = p;
  const window = [currentLine - 1, currentLine, currentLine + 1, currentLine + 2].filter((i) => i >= 0 && i < lines.length);
  const counting = p.timing && p.cue.count !== null;
  return (
    <LayoutGroup>
      <div className="flex h-full flex-col items-center justify-center gap-[1.5em] px-4 py-6 sm:px-10">
        <AnimatePresence initial={false} mode="popLayout">
          {window.map((i) => {
            const line = lines[i];
            const role = i < currentLine ? "prev" : i === currentLine ? "current" : i === currentLine + 1 ? "next" : "after";
            return (
              <motion.div
                key={line.index}
                layout
                initial={{ opacity: 0, y: 36 }}
                // while counting in, the line that has been played steps further back
                animate={{ opacity: role === "current" ? 1 : role === "prev" ? (counting ? 0.18 : 0.45) : role === "next" ? 0.78 : 0.48, y: 0 }}
                exit={{ opacity: 0, y: -36 }}
                transition={{ type: "spring", stiffness: 230, damping: 30, mass: 0.9 }}
                className={`w-full max-w-6xl ${role === "current" ? "" : "cursor-pointer"}`}
                onClick={role === "current" ? undefined : () => p.onLineClick?.(line)}
                aria-current={role === "current" ? "true" : undefined}
              >
                <LineRow line={line} role={role} {...p} />
              </motion.div>
            );
          })}
        </AnimatePresence>
        {lines.length === 0 && (
          <div className="max-w-md text-center text-muted">
            <Music className="mx-auto mb-3 h-6 w-6 text-faint" />
            No notes or words were found in this song. Try the detail level in settings, or paste the lyrics.
          </div>
        )}
      </div>
    </LayoutGroup>
  );
}

/** Narrowest a note's cell can be, in em of the line's font size: the chip itself. */
const CHIP_EM = { lg: 2.15 * 0.52, md: 2.1 * 0.58 };

function LineRow({ line, role, ...p }: StageProps & { line: DisplayLine; role: "prev" | "current" | "next" | "after" }) {
  const sizeClass = role === "current"
    ? "text-[calc(var(--fit,1)*clamp(2.1rem,5.2vw,4.6rem))]"
    : "text-[calc(var(--fit,1)*clamp(1.2rem,2.6vw,2rem))]";
  const chipSize = role === "current" ? "lg" : "md";
  const fit = useFitText<HTMLDivElement>([line, role, p.editing, p.script, p.timing, !!p.chordFor]);
  const chordFor = p.chordFor;
  // a chord is named where it starts: on the first word of the line and wherever it changes
  const chordTags = useMemo(() => {
    if (!chordFor) return null;
    let last: string | null = null;
    return line.items.map((it) => {
      const t = it.notes[0]?.start ?? it.word?.start;
      const name = t === undefined ? null : chordFor(t + 0.04);
      if (!name || name === last) return null;
      last = name;
      return name;
    });
  }, [chordFor, line]);
  const reduced = useReducedMotion();
  const cells = useMemo(() => {
    const m = new Map<string, Cell>();
    if (!p.timing) return m;
    for (const c of layoutCells(line.items.flatMap((i) => i.notes), CHIP_EM[chipSize]).cells) m.set(c.id, c);
    return m;
  }, [p.timing, line, chipSize]);
  const sweeping = p.timing && role === "current" && !reduced;
  useSweep(fit.ref, sweeping, p.getTime, p.beat, [line, fit.scale, p.editing, p.script]);

  return (
    <div className="flex w-full justify-center [overflow-x:clip]">
      <div ref={fit.ref} data-line={line.index} style={{ "--fit": fit.scale } as React.CSSProperties}
        className={`stage-line ${role === "current" ? "" : "is-far"} relative flex w-max max-w-none flex-nowrap items-end justify-center gap-x-[.42em] text-center leading-none ${sizeClass}`}>
        {sweeping && <div id={`sweep-${line.index}`} className="sweep" aria-hidden="true" />}
        {p.unsure?.has(line.index) && (
          <span className="absolute -left-[.9em] top-1/2 h-[.32em] w-[.32em] -translate-y-1/2 rounded-full bg-[#e0a63a]"
            role="img" aria-label="The notes in this line were hard to hear: worth a check" data-tip="The notes in this line were hard to hear: worth a check" data-tip-tap="" />
        )}
        {line.items.map((item, idx) => {
          const word = item.word;
          const wordState: ChipState = !word ? "future" : word.id === p.currentWordId ? "current" : p.time >= word.end ? "past" : "future";
          return (
            <div key={word?.id ?? `loose-${line.index}-${idx}`} className={`flex flex-col gap-[.32em] ${p.timing ? "items-start" : "items-center"}`}>
              {chordTags && <span className="chord-row" aria-hidden={!chordTags[idx]}>{chordTags[idx] && <span className="chord-tag">{chordTags[idx]}</span>}</span>}
              <div className="flex min-h-[1.1em] items-end gap-[.16em]">
                {item.notes.map((n) => {
                  const info = p.noteInfo.get(n.id);
                  if (!info) return null;
                  const st: ChipState = n.id === p.currentNoteId ? "current" : p.time >= n.end ? "past" : "future";
                  const chip = (
                    <NoteChip key={n.id} note={info} state={st} size={chipSize}
                      cue={p.timing && role === "current" && p.cue.cue === n.id && st === "future"}
                      onClick={p.editing ? (e) => p.onNoteClick?.(n.id, e.currentTarget) : undefined}
                      title={p.editing ? "Click to change this note" : undefined}
                    />
                  );
                  const cell = cells.get(n.id);
                  if (!cell) return chip;
                  const count = p.cue.countNote === n.id ? p.cue.count : null;
                  return (
                    <span key={n.id} className="note-cell" data-state={st} style={{ minWidth: `${cell.width.toFixed(3)}em` }}>
                      <AnimatePresence>
                        {count !== null && (
                          <motion.span key={count} className="count-badge" aria-hidden="true"
                            initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.15 }}
                            transition={{ duration: 0.16 }}>{count}</motion.span>
                        )}
                      </AnimatePresence>
                      {chip}
                      <span className="dur" data-bar data-start={n.start} data-end={n.end} style={{ width: `${(cell.fill * 100).toFixed(1)}%` }}><i /></span>
                    </span>
                  );
                })}
                {p.editing && (!word || item.notes.length === 0) && (
                  <button type="button" onClick={() => p.onAddNote?.(word?.id ?? null, line.index)} data-tip="Add a note here" aria-label="Add a note here"
                    className={`note-chip h-[2.2em] min-w-[2.2em] border-dashed text-[0.5em] text-faint hover:text-accent ${p.timing ? "mb-[.5em]" : ""}`}>+</button>
                )}
              </div>
              {word ? (
                <span
                  className={`word ${p.editing ? "cursor-text rounded-md underline decoration-dotted decoration-faint/60 decoration-[0.04em] underline-offset-[0.2em] hover:bg-hover" : ""}`}
                  data-state={wordState}
                  onClick={p.editing ? (e) => p.onWordClick?.(word, e.currentTarget as HTMLElement) : undefined}
                >
                  {p.script === "roman" && word.roman ? word.roman : word.text}
                </span>
              ) : (
                <span className="word inline-flex items-center gap-[.25em] font-sans text-[.42em] font-medium text-faint" data-state="future"><Music className="h-[1em] w-[1em]" /> no words</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
