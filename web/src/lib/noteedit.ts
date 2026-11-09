// Pure note-editing operations for edit mode (timing, split, join, shifting a line). Every changed note is
// marked `edited`, which the service treats as the user's own and never overwrites when it re-processes.
import type { Note } from "./types";

const MIN = 0.05;   // shortest note an edit may leave behind, in seconds
const r3 = (x: number) => Math.round(x * 1000) / 1000;

function byStart(notes: Note[]) {
  return [...notes].sort((a, b) => a.start - b.start);
}

/** Move a note's start and/or end; it never crosses its neighbours and never gets shorter than 50 ms. */
export function retime(notes: Note[], id: string, start: number, end: number): Note[] {
  const sorted = byStart(notes);
  const i = sorted.findIndex((n) => n.id === id);
  if (i < 0) return notes;
  const prev = sorted[i - 1];
  const next = sorted[i + 1];
  let s = Math.max(prev ? prev.start + MIN : 0, start);
  let e = Math.min(next ? next.end - MIN : Infinity, end);
  if (e - s < MIN) {
    if (start !== sorted[i].start) s = e - MIN;
    else e = s + MIN;
  }
  return notes.map((n) => {
    if (n.id === id) return { ...n, start: r3(s), end: r3(e), edited: true };
    if (prev && n.id === prev.id && prev.end > s) return { ...n, end: r3(s), edited: true };
    if (next && n.id === next.id && next.start < e) return { ...n, start: r3(e), edited: true };
    return n;
  });
}

/** Move the whole note earlier (negative) or later, keeping its length. */
export function nudge(notes: Note[], id: string, delta: number): Note[] {
  const n = notes.find((x) => x.id === id);
  return n ? retime(notes, id, n.start + delta, n.end + delta) : notes;
}

/** Cut a note in two at `at` (its middle by default); both halves keep the pitch and the word. */
export function split(notes: Note[], id: string, at?: number, newId = `n_${Date.now()}`): Note[] {
  const n = notes.find((x) => x.id === id);
  if (!n) return notes;
  const t = at ?? (n.start + n.end) / 2;
  if (t - n.start < MIN || n.end - t < MIN) return notes;
  return [...notes.filter((x) => x.id !== id), { ...n, end: r3(t), edited: true }, { ...n, id: newId, start: r3(t), edited: true }];
}

/** Join a note with the one after it: one note from the first start to the second end, at the first pitch. */
export function joinNext(notes: Note[], id: string): Note[] {
  const sorted = byStart(notes);
  const i = sorted.findIndex((n) => n.id === id);
  const next = sorted[i + 1];
  if (i < 0 || !next) return notes;
  return notes.filter((n) => n.id !== next.id).map((n) => (n.id === id ? { ...n, end: Math.max(n.end, next.end), edited: true } : n));
}

/** Shift every note of a line earlier or later by `delta` seconds (the line keeps its shape). */
export function shiftLine(notes: Note[], line: number, delta: number): Note[] {
  const mine = notes.filter((n) => n.line === line);
  if (!mine.length) return notes;
  const others = notes.filter((n) => n.line !== line);
  const first = Math.min(...mine.map((n) => n.start));
  const last = Math.max(...mine.map((n) => n.end));
  // never over the notes of the lines around it
  const before = Math.max(0, ...others.filter((n) => n.end <= first + 1e-6).map((n) => n.end));
  const after = Math.min(Infinity, ...others.filter((n) => n.start >= last - 1e-6).map((n) => n.start));
  const d = Math.max(before - first, Math.min(after - last, delta));
  if (Math.abs(d) < 1e-6) return notes;
  return notes.map((n) => (n.line === line ? { ...n, start: r3(n.start + d), end: r3(n.end + d), edited: true } : n));
}
