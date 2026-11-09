import { describe, expect, it } from "vitest";
import { joinNext, nudge, retime, shiftLine, split } from "../noteedit";
import type { Note } from "../types";

const n = (id: string, start: number, end: number, midi = 60, line = 0): Note => ({ id, start, end, midi, confidence: 1, word: null, line, edited: false });
const notes = [n("a", 1, 2), n("b", 2, 2.5, 62), n("c", 3, 3.4, 64, 1)];

describe("note editing", () => {
  it("retimes without crossing neighbours and marks the note edited", () => {
    const out = retime(notes, "b", 1.8, 2.7);
    const a = out.find((x) => x.id === "a")!, b = out.find((x) => x.id === "b")!;
    expect(b.start).toBe(1.8); expect(b.end).toBe(2.7); expect(b.edited).toBe(true);
    expect(a.end).toBe(1.8);
    expect(retime(notes, "b", 0.5, 2.5).find((x) => x.id === "b")!.start).toBe(1.05);   // not past the previous note's start
  });
  it("nudges a whole note", () => {
    const b = nudge(notes, "b", 0.1).find((x) => x.id === "b")!;
    expect([b.start, b.end]).toEqual([2.1, 2.6]);
  });
  it("splits and joins", () => {
    const s = split(notes, "a", undefined, "a2");
    expect(s.filter((x) => x.midi === 60 && x.line === 0).map((x) => [x.start, x.end])).toEqual([[1, 1.5], [1.5, 2]]);
    const j = joinNext(notes, "a");
    expect(j.map((x) => x.id)).toEqual(["a", "c"]);
    expect(j[0].end).toBe(2.5);
  });
  it("shifts a line but not into its neighbours", () => {
    const later = shiftLine(notes, 1, 0.2);
    expect(later.find((x) => x.id === "c")!.start).toBe(3.2);
    const early = shiftLine(notes, 1, -1);
    expect(early.find((x) => x.id === "c")!.start).toBe(2.5);   // stops at the end of the line before
  });
});
