/** Builds the karaoke lines (words with their notes) from song.json. */
import type { Line, Note, Song, Word } from "./types";

export type DisplayItem = { word: Word | null; notes: Note[] };
export type DisplayLine = { index: number; kind: Line["kind"]; start: number; end: number; items: DisplayItem[]; text: string; /** "Intro", "Solo" or "Outro" on a line of instrumental hook notes. */ label?: string | null };

export function buildDisplayLines(song: Pick<Song, "lines" | "words" | "notes">): DisplayLine[] {
  const wordsByLine = new Map<number, Word[]>();
  for (const w of song.words) {
    const arr = wordsByLine.get(w.line) ?? [];
    arr.push(w);
    wordsByLine.set(w.line, arr);
  }
  const notesByWord = new Map<string, Note[]>();
  const looseByLine = new Map<number, Note[]>();
  for (const n of [...song.notes].sort((a, b) => a.start - b.start)) {
    if (n.word) {
      const arr = notesByWord.get(n.word) ?? [];
      arr.push(n);
      notesByWord.set(n.word, arr);
    } else {
      const arr = looseByLine.get(n.line) ?? [];
      arr.push(n);
      looseByLine.set(n.line, arr);
    }
  }
  const lines: DisplayLine[] = [];
  for (const line of [...song.lines].sort((a, b) => a.index - b.index)) {
    const items: DisplayItem[] = [];
    if (line.kind === "lyric") {
      for (const w of (wordsByLine.get(line.index) ?? []).sort((a, b) => a.start - b.start)) {
        items.push({ word: w, notes: notesByWord.get(w.id) ?? [] });
      }
    }
    const loose = looseByLine.get(line.index) ?? [];
    if (loose.length) items.push({ word: null, notes: loose });
    const text = items.map((i) => i.word?.text ?? "").filter(Boolean).join(" ");
    lines.push({ index: line.index, kind: line.kind, start: line.start, end: line.end, items, text, label: line.label ?? null });
  }
  return lines;
}

/**
 * Index of the line that should be shown as current at time t.
 * `ahead` is how early an upcoming line may take the stage once the line
 * before it is finished: long enough for its countdown to be seen.
 */
export function currentLineIndex(lines: DisplayLine[], t: number, lookahead = 0.3, ahead = 4): number {
  if (!lines.length) return 0;
  let idx = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].start - lookahead <= t) idx = i; else break;
  }
  // Between lines: stay on the finished line for a moment, then move to the next.
  const cur = lines[idx];
  if (t > cur.end + 0.4 && idx + 1 < lines.length && lines[idx + 1].start - t < ahead) return idx + 1;
  return idx;
}

/** Confidence below this means the voice was mostly off the note's pitch, or hard to hear (pitchnotes.py). */
export const UNSURE_NOTE = 0.6;

/**
 * Lines worth a check: at least `share` of their notes (and at least two) are unsure. Measured on the test
 * songs, an unsure note has the right pitch about half the time, a sure one about nine times in ten.
 */
export function unsureLines(lines: DisplayLine[], share = 0.3): Set<number> {
  const out = new Set<number>();
  for (const l of lines) {
    const notes = l.items.flatMap((i) => i.notes).filter((n) => !n.edited);
    const unsure = notes.filter((n) => (n.confidence ?? 1) < UNSURE_NOTE).length;
    if (unsure >= 2 && unsure / Math.max(1, notes.length) >= share) out.add(l.index);
  }
  return out;
}
