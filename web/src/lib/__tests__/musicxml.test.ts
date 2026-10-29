import { describe, expect, it } from "vitest";
import { songToMusicXml } from "../musicxml";
import type { Song } from "../types";

const song: Song = {
  schema_version: 1, id: "t", title: "Test & Song", artist: "Me", duration: 10, tempo_bpm: 120, created_at: "", updated_at: "", status: "ready",
  source: {}, files: {}, language: { script: "latin" }, key: { tonic: 7, mode: "major", name: "G major", confidence: 1 },
  words: [{ id: "w1", text: "la", start: 0, end: 0.5, line: 0 }, { id: "w2", text: "<di>", start: 0.5, end: 1.0, line: 0 }],
  lines: [{ index: 0, kind: "lyric", start: 0, end: 1 }],
  notes: [
    { id: "n1", start: 0, end: 0.5, midi: 67, word: "w1", line: 0 },
    { id: "n2", start: 0.5, end: 1.0, midi: 69, word: "w2", line: 0 },
    { id: "n3", start: 1.5, end: 4.5, midi: 71, word: null, line: 0 }, // crosses a bar line -> tied
  ],
  settings: { detail_level: "balanced", cleanup: {}, lyrics_source: "transcribed" },
  user: { instrument: "alto_sax", key_shift: 0, octave: "auto", notation: "sharps", speed: 1, loop: null, position: 0, backing_volume: 1, guide_vocal: false, guide_volume: 0.3, script: "original" },
  steps: {},
};

describe("musicxml", () => {
  it("writes transposed pitches, lyrics, ties and escapes text", () => {
    const xml = songToMusicXml(song, "alto_sax", 0, 0);
    expect(xml).toContain("<work-title>Test &amp; Song</work-title>");
    expect(xml).toContain("<text>&lt;di&gt;</text>");
    // concert G4 (67) on alto sax is written E5
    expect(xml).toMatch(/<step>E<\/step><octave>5<\/octave>/);
    expect(xml).toContain('<chromatic>-9</chromatic>');
    expect((xml.match(/<measure /g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(xml).toContain('<tie type="start"/>');
    expect((xml.match(/<note>/g) ?? []).length).toBe((xml.match(/<\/note>/g) ?? []).length);
  });
});
