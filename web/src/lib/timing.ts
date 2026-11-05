/**
 * The timing guide: everything that answers "when do I start this note, and
 * how long do I hold it?". Pure functions; the drawing lives in LyricStage.
 */
import type { Note } from "./types";

/** Rests longer than this get a 3-2-1 countdown before the next note. */
export const LONG_REST = 2.0;
export const COUNT_BEATS = 3;

/**
 * One beat in seconds, kept in the range a person can count along with
 * (very fast tempos are counted in half time, very slow ones in double time).
 */
export function beatSeconds(tempoBpm: number | null | undefined): number {
  let beat = 60 / (tempoBpm && tempoBpm > 0 ? tempoBpm : 100);
  while (beat < 0.4) beat *= 2;
  while (beat > 1.05) beat /= 2;
  return beat;
}

export type Cue = {
  /** The note about to start (within one beat): it gets the "get ready" outline. */
  cue: string | null;
  /** After a long rest: which note we are counting down to, and the beat number to show (3, 2, 1). */
  countNote: string | null;
  count: number | null;
};

const NO_CUE: Cue = { cue: null, countNote: null, count: null };

/** `notes` must be sorted by start time. */
export function cueAt(notes: Pick<Note, "id" | "start" | "end">[], t: number, beat: number): Cue {
  // first note that has not started yet
  let lo = 0, hi = notes.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (notes[mid].start > t) hi = mid; else lo = mid + 1; }
  const next = notes[lo];
  if (!next) return NO_CUE;
  const until = next.start - t;
  const prevEnd = lo > 0 ? notes[lo - 1].end : 0;
  const rest = next.start - Math.max(0, prevEnd);
  let countNote: string | null = null;
  let count: number | null = null;
  if (rest > LONG_REST && t >= prevEnd) {
    const beats = Math.ceil(until / beat - 1e-6);
    if (beats >= 1 && beats <= COUNT_BEATS) { countNote = next.id; count = beats; }
  }
  return { cue: until <= beat ? next.id : null, countNote, count };
}

export type Cell = {
  id: string;
  start: number;
  end: number;
  /** Seconds this note "owns" on screen: up to the next note of the line, or its own length. */
  span: number;
  /** Share of the cell the duration bar covers (the rest is the silence before the next note). */
  fill: number;
  /** Width of the cell in em of the line's font size. */
  width: number;
};

/** Longest stretch one cell may represent, so a very long note cannot push the line off screen. */
const MAX_SPAN = 3.2;
/** A gap this long between two notes is drawn as its own space, not as part of the cell. */
const MAX_GAP = 1.2;

/**
 * Lays out one line: how wide each note's cell is and how much of it the
 * duration bar fills. `emPerSecond` is chosen per line so long lines still fit.
 */
export function layoutCells(notes: Pick<Note, "id" | "start" | "end">[], minWidth = 0): { cells: Cell[]; emPerSecond: number } {
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  const spans = sorted.map((n, i) => {
    const dur = Math.max(0.05, n.end - n.start);
    const next = sorted[i + 1];
    const toNext = next ? next.start - n.start : dur;
    const gap = toNext - dur;
    return { dur, span: Math.max(dur, gap > MAX_GAP ? dur + MAX_GAP * 0.5 : toNext) };
  });
  const total = spans.reduce((a, s) => a + Math.min(MAX_SPAN, s.span), 0);
  const emPerSecond = Math.max(0.55, Math.min(1.45, 9 / Math.max(total, 0.001)));
  const cells = sorted.map((n, i) => {
    const { dur, span } = spans[i];
    const shown = Math.min(MAX_SPAN, span);
    return {
      id: n.id, start: n.start, end: n.end, span,
      fill: Math.max(0.12, Math.min(1, dur / span)),
      width: Math.max(minWidth, shown * emPerSecond),
    };
  });
  return { cells, emPerSecond };
}

export type Knot = { t: number; x: number };

/**
 * Where the sweeping line is at time `t`. `knots` are (time, x) pairs: the
 * left edge of every note at its start, plus the right edge of the last bar
 * at its end. Before the first note the line glides in over one beat.
 */
export function sweepAt(knots: Knot[], t: number, beat: number, lead: number): { x: number; opacity: number } | null {
  if (knots.length === 0) return null;
  const first = knots[0];
  const last = knots[knots.length - 1];
  if (t < first.t) {
    const until = first.t - t;
    if (until > beat) return null;
    const k = until / beat; // 1 → 0
    return { x: first.x - lead * k, opacity: Math.min(1, (1 - k) / 0.35) };
  }
  if (t >= last.t) {
    const after = t - last.t;
    if (after > 0.35) return null;
    return { x: last.x, opacity: 1 - after / 0.35 };
  }
  let lo = 0, hi = knots.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (knots[mid].t <= t) lo = mid; else hi = mid; }
  const a = knots[lo], b = knots[hi];
  const k = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
  return { x: a.x + (b.x - a.x) * k, opacity: 1 };
}
