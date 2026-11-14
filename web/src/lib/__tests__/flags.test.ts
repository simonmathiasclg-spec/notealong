import { describe, expect, it } from "vitest";
import { toggleFlag, type NoteFlag } from "../flags";

const flag = (song_id: string, start: number): NoteFlag => ({ song_id, start, end: start + 0.4, midi: 64, line: 3, time: start + 0.1, word: "be", melody: "sax", pipeline: 7, at: "2026-01-01T00:00:00Z" });

describe("this note sounds wrong", () => {
  it("marks a note once and unmarks it on the second press", () => {
    const a = toggleFlag([], flag("song", 38.05));
    expect(a.on).toBe(true);
    expect(a.list).toHaveLength(1);
    const b = toggleFlag(a.list, flag("song", 38.05));
    expect(b.on).toBe(false);
    expect(b.list).toHaveLength(0);
  });
  it("keeps marks on other notes and other songs", () => {
    const a = toggleFlag([flag("song", 10), flag("other", 38.05)], flag("song", 38.05));
    expect(a.list).toHaveLength(3);
    expect(toggleFlag(a.list, flag("song", 10)).list.map((f) => f.song_id + f.start)).toEqual(["other38.05", "song38.05"]);
  });
});
