/** Looping a part of the song: whole lines by default, any stretch when the handles are dragged freely. */
import type { DisplayLine } from "./display";

export type Loop = [number, number];

/** A looped line starts a breath early and rings out a little, so the first note isn't clipped. */
export const LOOP_LEAD = 0.15;
export const LOOP_TAIL = 0.2;
export const MIN_LOOP = 0.5;

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const startEdge = (l: DisplayLine) => Math.max(0, l.start - LOOP_LEAD);
const endEdge = (l: DisplayLine, duration: number) => (duration > 0 ? Math.min(duration, l.end + LOOP_TAIL) : l.end + LOOP_TAIL);

/** The loop that covers lines[first..last] (positions in the list, in any order). */
export function loopForLines(lines: DisplayLine[], first: number, last: number, duration = 0): Loop | null {
  const a = lines[Math.min(first, last)], b = lines[Math.max(first, last)];
  if (!a || !b) return null;
  return [startEdge(a), endEdge(b, duration)];
}

/** Which lines a loop plays: those whose middle lies inside it. Null when it holds no whole line. */
export function linesInLoop(lines: DisplayLine[], loop: Loop): { first: number; last: number } | null {
  let first = -1, last = -1;
  lines.forEach((l, i) => {
    const mid = (l.start + l.end) / 2;
    if (mid >= loop[0] && mid <= loop[1]) { if (first < 0) first = i; last = i; }
  });
  return first < 0 ? null : { first, last };
}

/** True when both ends of the loop sit on line boundaries (it was made by the button or by snapping). */
export function isLineLoop(lines: DisplayLine[], loop: Loop, duration = 0): boolean {
  const r = linesInLoop(lines, loop);
  if (!r) return false;
  return Math.abs(startEdge(lines[r.first]) - loop[0]) < 0.02 && Math.abs(endEdge(lines[r.last], duration) - loop[1]) < 0.02;
}

/** Moves one end of the loop to the nearest line boundary. */
export function snapLoopEdge(lines: DisplayLine[], t: number, edge: "start" | "end", duration = 0): number {
  let best = t, dist = Infinity;
  for (const l of lines) {
    const c = edge === "start" ? startEdge(l) : endEdge(l, duration);
    const d = Math.abs(c - t);
    if (d < dist) { dist = d; best = c; }
  }
  return best;
}

/**
 * A loop with one end moved to time t. Snaps to line boundaries unless `free`. The two ends never cross:
 * the moved end stops one line (or MIN_LOOP when free) short of the other.
 */
export function moveLoopEdge(lines: DisplayLine[], loop: Loop, edge: "start" | "end", t: number, free: boolean, duration = 0): Loop {
  const max = duration > 0 ? duration : Infinity;
  if (free || !lines.length) {
    return edge === "start" ? [Math.max(0, Math.min(t, loop[1] - MIN_LOOP)), loop[1]] : [loop[0], Math.min(max, Math.max(t, loop[0] + MIN_LOOP))];
  }
  if (edge === "start") {
    const ok = lines.map(startEdge).filter((c) => c <= loop[1] - MIN_LOOP);
    if (!ok.length) return loop;
    return [ok.reduce((b, c) => (Math.abs(c - t) < Math.abs(b - t) ? c : b)), loop[1]];
  }
  const ok = lines.map((l) => endEdge(l, duration)).filter((c) => c >= loop[0] + MIN_LOOP);
  if (!ok.length) return loop;
  return [loop[0], ok.reduce((b, c) => (Math.abs(c - t) < Math.abs(b - t) ? c : b))];
}

/** The loop grown (never shrunk) so that it also covers the given line. */
export function extendLoopToLine(lines: DisplayLine[], loop: Loop, index: number, duration = 0): Loop {
  const l = lines[index];
  if (!l) return loop;
  return [Math.min(loop[0], startEdge(l)), Math.max(loop[1], endEdge(l, duration))];
}

/** One step of the keyboard on a handle: to the next line boundary in that direction. */
export function stepLoopEdge(lines: DisplayLine[], loop: Loop, edge: "start" | "end", dir: 1 | -1, duration = 0): Loop {
  const cur = edge === "start" ? loop[0] : loop[1];
  const all = lines.map((l) => (edge === "start" ? startEdge(l) : endEdge(l, duration))).sort((a, b) => a - b);
  const next = dir > 0 ? all.find((c) => c > cur + 0.02) : [...all].reverse().find((c) => c < cur - 0.02);
  if (next === undefined) return loop;
  if (edge === "start") return next <= loop[1] - MIN_LOOP ? [next, loop[1]] : loop;
  return next >= loop[0] + MIN_LOOP ? [loop[0], next] : loop;
}

/** "line 4", "lines 4–5" (counting the lines with words), or the times when it isn't made of whole lines. */
export function loopLabel(lines: DisplayLine[], loop: Loop, duration = 0): string {
  const times = `${fmt(loop[0])}–${fmt(loop[1])}`;
  if (!isLineLoop(lines, loop, duration)) return times;
  const r = linesInLoop(lines, loop)!;
  const numbers: number[] = [];
  let n = 0;
  lines.forEach((l, i) => { if (l.kind === "lyric") { n++; if (i >= r.first && i <= r.last) numbers.push(n); } });
  if (!numbers.length) return times;
  const a = numbers[0], b = numbers[numbers.length - 1];
  return a === b ? `line ${a}` : `lines ${a}–${b}`;
}

/** Keeps a jump inside the loop, so the playhead never lands where the loop would at once pull it back. */
export function clampIntoLoop(t: number, loop: Loop | null): number {
  if (!loop) return t;
  return Math.max(loop[0], Math.min(loop[1] - 0.1, t));
}
