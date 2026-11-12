import { describe, expect, it } from "vitest";
import type { DisplayLine } from "../display";
import { clampIntoLoop, extendLoopToLine, isLineLoop, linesInLoop, loopForLines, loopLabel, moveLoopEdge, stepLoopEdge } from "../loop";

const line = (index: number, start: number, end: number, kind: "lyric" | "instrumental" = "lyric"): DisplayLine => ({ index, kind, start, end, items: [], text: "" });
// an intro without words, then four sung lines
const lines = [line(0, 0, 8, "instrumental"), line(1, 10, 14), line(2, 15, 19), line(3, 20, 24), line(4, 25, 29)];

describe("loop", () => {
  it("loops one line with a short lead-in and tail", () => {
    expect(loopForLines(lines, 2, 2, 30)).toEqual([14.85, 19.2]);
    expect(loopForLines(lines, 4, 4, 29.1)).toEqual([24.85, 29.1]); // never past the end of the song
    expect(loopForLines(lines, 0, 0, 30)![0]).toBe(0);
  });
  it("names whole-line loops by line number, counting only lines with words", () => {
    expect(loopLabel(lines, loopForLines(lines, 2, 2, 30)!, 30)).toBe("line 2");
    expect(loopLabel(lines, loopForLines(lines, 3, 1, 30)!, 30)).toBe("lines 1–3");
    expect(loopLabel(lines, [12, 17.5], 30)).toBe("0:12–0:17");
    expect(loopLabel(lines, loopForLines(lines, 0, 0, 30)!, 30)).toBe("0:00–0:08");
  });
  it("knows which lines a loop holds", () => {
    expect(linesInLoop(lines, [14.85, 24.2])).toEqual({ first: 2, last: 3 });
    expect(linesInLoop(lines, [8.5, 9.5])).toBeNull();
    expect(isLineLoop(lines, [14.85, 24.2], 30)).toBe(true);
    expect(isLineLoop(lines, [14.85, 23], 30)).toBe(false);
  });
  it("snaps a dragged handle to line boundaries and never lets the ends cross", () => {
    const loop = loopForLines(lines, 2, 2, 30)!;
    expect(moveLoopEdge(lines, loop, "end", 23.1, false, 30)).toEqual([14.85, 24.2]);
    expect(moveLoopEdge(lines, loop, "start", 10.9, false, 30)).toEqual([9.85, 19.2]);
    expect(moveLoopEdge(lines, loop, "end", 3, false, 30)).toEqual([14.85, 19.2]);   // dragged past the start: stays one line long
    expect(moveLoopEdge(lines, loop, "start", 28, false, 30)).toEqual([14.85, 19.2]);
  });
  it("moves freely with Alt held", () => {
    const loop = loopForLines(lines, 2, 2, 30)!;
    expect(moveLoopEdge(lines, loop, "end", 21.37, true, 30)).toEqual([14.85, 21.37]);
    expect(moveLoopEdge(lines, loop, "start", 19.1, true, 30)).toEqual([18.7, 19.2]);
    expect(moveLoopEdge(lines, loop, "end", 99, true, 30)).toEqual([14.85, 30]);
  });
  it("grows to take in a clicked line and steps by line from the keyboard", () => {
    const loop = loopForLines(lines, 2, 2, 30)!;
    expect(extendLoopToLine(lines, loop, 4, 30)).toEqual([14.85, 29.2]);
    expect(extendLoopToLine(lines, loop, 1, 30)).toEqual([9.85, 19.2]);
    expect(extendLoopToLine(lines, loop, 2, 30)).toEqual(loop);
    expect(stepLoopEdge(lines, loop, "end", 1, 30)).toEqual([14.85, 24.2]);
    expect(stepLoopEdge(lines, loop, "end", -1, 30)).toEqual(loop);
    expect(stepLoopEdge(lines, loop, "start", -1, 30)).toEqual([9.85, 19.2]);
  });
  it("keeps jumps inside the loop", () => {
    expect(clampIntoLoop(3, [10, 20])).toBe(10);
    expect(clampIntoLoop(25, [10, 20])).toBe(19.9);
    expect(clampIntoLoop(12, [10, 20])).toBe(12);
    expect(clampIntoLoop(3, null)).toBe(3);
  });
});
