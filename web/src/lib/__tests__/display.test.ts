import { describe, expect, it } from "vitest";
import { buildDisplayLines, currentLineIndex } from "../display";

const song = {
  lines: [
    { index: 0, kind: "instrumental" as const, start: 0, end: 1 },
    { index: 1, kind: "lyric" as const, start: 2, end: 4 },
  ],
  words: [
    { id: "w1", text: "la", start: 2, end: 3, line: 1 },
    { id: "w2", text: "di", start: 3, end: 4, line: 1 },
  ],
  notes: [
    { id: "n0", start: 0, end: 1, midi: 60, word: null, line: 0 },
    { id: "n1", start: 2, end: 2.5, midi: 62, word: "w1", line: 1 },
    { id: "n2", start: 2.5, end: 3, midi: 64, word: "w1", line: 1 },
    { id: "n3", start: 3, end: 4, midi: 65, word: "w2", line: 1 },
  ],
};

describe("display lines", () => {
  it("groups notes under words and keeps instrumental blocks", () => {
    const lines = buildDisplayLines(song);
    expect(lines).toHaveLength(2);
    expect(lines[0].items[0].word).toBeNull();
    expect(lines[0].items[0].notes.map((n) => n.id)).toEqual(["n0"]);
    expect(lines[1].items.map((i) => i.notes.length)).toEqual([2, 1]);
    expect(lines[1].text).toBe("la di");
  });
  it("tracks the current line with a small lookahead", () => {
    const lines = buildDisplayLines(song);
    expect(currentLineIndex(lines, 0.5)).toBe(0);
    expect(currentLineIndex(lines, 1.8)).toBe(1);
    expect(currentLineIndex(lines, 3)).toBe(1);
  });
});


describe("unsure lines", () => {
  it("marks a line when a third of its notes are unsure", async () => {
    const { unsureLines } = await import("../display");
    const note = (id: string, c: number) => ({ id, start: 0, end: 1, midi: 60, confidence: c, word: null, line: 0, edited: false });
    const line = (index: number, cs: number[]) => ({ index, kind: "lyric" as const, start: 0, end: 1, text: "", items: [{ word: null, notes: cs.map((c, i) => note(`${index}-${i}`, c)) }] });
    const out = unsureLines([line(0, [0.9, 0.95, 0.3, 0.4]), line(1, [0.9, 0.9, 0.9, 0.5]), line(2, [0.2])]);
    expect([...out]).toEqual([0]);
  });
});
