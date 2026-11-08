import { describe, expect, it } from "vitest";
import { applyFilters, decadeOf, editDistance, filtersToParams, fitsInstrument, paramsToFilters, scoreRow, searchSongs, tempoBand, type SearchRow } from "../search";
import { getInstrument } from "../instruments";

const rows: SearchRow[] = [
  { id: "amazing-grace", kind: "catalog", title: "Amazing Grace", artist: "John Newton / Traditional", genre: "Hymn", culture: "American", language: "en", year: 1835, tempo_bpm: 80, difficulty: "easy", duration: 78, source: "traditional", range: [62, 74], lyrics: "Amazing grace how sweet the sound that saved a wretch like me" },
  { id: "sweet-georgia-brown", kind: "catalog", title: "Sweet Georgia Brown", artist: "Ben Bernie and Maceo Pinkard / Kenneth Casey", genre: "Jazz", culture: "American", language: "en", year: 1925, tempo_bpm: 184, difficulty: "hard", duration: 89, source: "traditional", range: [62, 76], lyrics: "No gal made has got a shade on Sweet Georgia Brown", tags: ["standard", "1920s"] },
  { id: "o-sole-mio", kind: "catalog", title: "'O sole mio", artist: "Eduardo di Capua", genre: "Classical", culture: "Italian", language: "it", year: 1898, tempo_bpm: 100, difficulty: "medium", duration: 120, source: "traditional", range: [55, 79], lyrics: "Che bella cosa na jurnata e sole" },
  { id: "time-flies", kind: "catalog", title: "Time flies", artist: "Ehma", genre: "Acoustic", language: "en", tempo_bpm: 120, difficulty: "medium", source: "cc", range: [57, 72], lyrics: "This morning I was playing with dolls climbing trees" },
  { id: "my-upload", kind: "upload", title: "Tonight", artist: "Josh Bonanno", tempo_bpm: 95, difficulty: "medium", source: "upload", range: [40, 90], lyrics: "tonight tonight" },
];

describe("search", () => {
  it("finds by title, artist, style, country and lyrics", () => {
    expect(searchSongs(rows, "grace", {}, "relevance")[0].id).toBe("amazing-grace");
    expect(searchSongs(rows, "pinkard", {}, "relevance").map((r) => r.id)).toEqual(["sweet-georgia-brown"]);
    expect(searchSongs(rows, "jazz", {}, "relevance").map((r) => r.id)).toEqual(["sweet-georgia-brown"]);
    expect(searchSongs(rows, "italian", {}, "relevance").map((r) => r.id)).toEqual(["o-sole-mio"]);
    expect(searchSongs(rows, "wretch", {}, "relevance").map((r) => r.id)).toEqual(["amazing-grace"]);
    expect(searchSongs(rows, "1920s", {}, "relevance").map((r) => r.id)).toEqual(["sweet-georgia-brown"]);
  });
  it("forgives typos and accents", () => {
    expect(searchSongs(rows, "amazng grase", {}, "relevance")[0].id).toBe("amazing-grace");
    expect(searchSongs(rows, "georgai", {}, "relevance")[0].id).toBe("sweet-georgia-brown");
    expect(searchSongs(rows, "o sole mio", {}, "relevance")[0].id).toBe("o-sole-mio");
    expect(editDistance("georgai", "georgia")).toBe(1);
  });
  it("ranks a title match above a lyrics match", () => {
    const r = [{ ...rows[0], id: "a", title: "Brown Eyes", lyrics: "" }, { ...rows[1], id: "b", title: "Other", lyrics: "brown" }];
    expect(searchSongs(r, "brown", {}, "relevance")[0].id).toBe("a");
    expect(scoreRow(rows[0], "nothing like this")).toBe(0);
  });
  it("filters", () => {
    expect(applyFilters(rows, { difficulty: "easy" }).map((r) => r.id)).toEqual(["amazing-grace"]);
    expect(applyFilters(rows, { decade: "1920s" }).map((r) => r.id)).toEqual(["sweet-georgia-brown"]);
    expect(applyFilters(rows, { tempo: "fast" }).map((r) => r.id)).toEqual(["sweet-georgia-brown"]);
    expect(applyFilters(rows, { source: "upload" }).map((r) => r.id)).toEqual(["my-upload"]);
    expect(applyFilters(rows, { source: "cc" }).map((r) => r.id)).toEqual(["time-flies"]);
    expect(applyFilters(rows, { language: "it" }).map((r) => r.id)).toEqual(["o-sole-mio"]);
    expect(applyFilters(rows, { favourites: true }, { favourites: new Set(["o-sole-mio"]) }).map((r) => r.id)).toEqual(["o-sole-mio"]);
    const trumpet = getInstrument("trumpet");
    expect(applyFilters(rows, { fits: true }, { instrument: trumpet }).map((r) => r.id)).not.toContain("my-upload");
  });
  it("sorts by plays, newest, A to Z, easiest", () => {
    const plays = { "o-sole-mio": { count: 5 }, "time-flies": { count: 2 } };
    expect(searchSongs(rows, "", {}, "popular", { plays }).slice(0, 2).map((r) => r.id)).toEqual(["o-sole-mio", "time-flies"]);
    expect(searchSongs(rows, "", {}, "az")[0].id).toBe("o-sole-mio");
    expect(searchSongs(rows, "", {}, "easy")[0].id).toBe("amazing-grace");
  });
  it("helpers", () => {
    expect(tempoBand(80)).toBe("slow");
    expect(tempoBand(100)).toBe("medium");
    expect(tempoBand(150)).toBe("fast");
    expect(decadeOf("1925")).toBe("1920s");
    expect(decadeOf(null)).toBeNull();
    expect(fitsInstrument([62, 74], getInstrument("alto_sax"))).toBe(true);
    expect(fitsInstrument([40, 90], getInstrument("flute"))).toBe(false);
    const p = filtersToParams("grace", { difficulty: "easy", fits: true }, "az");
    expect(paramsToFilters(p)).toEqual({ q: "grace", filters: { difficulty: "easy", fits: true }, sort: "az" });
  });
});
