import { describe, expect, it } from "vitest";
import { applyFacet, buildShelves, facetValues, pickFeatured, searchCatalog } from "../catalog";
import type { CatalogEntry } from "../types";

const mk = (over: Partial<CatalogEntry>): CatalogEntry => ({
  id: "x", title: "X", artist: "Traditional", genre: "Folk", difficulty: "easy", duration: 60, licence: { name: "Public domain" },
  attribution: "", source: { kind: "traditional" }, cover: "cover.svg", cover_url: "", tags: [], access: "free", culture: "English", ...over,
});
const songs: CatalogEntry[] = [
  mk({ id: "twinkle", title: "Twinkle, Twinkle, Little Star", genre: "Children's", featured: true, tags: ["lullaby"] }),
  mk({ id: "silent", title: "Silent Night", genre: "Christmas", culture: "Austrian", difficulty: "medium" }),
  mk({ id: "sakura", title: "Sakura Sakura", genre: "Folk", culture: "Japanese", language: "ja" }),
  mk({ id: "feel", title: "Feel (Stripped)", artist: "Cortez", genre: "Pop", culture: "English", difficulty: "hard", source: { kind: "cc" }, licence: { name: "CC BY 4.0" } }),
  mk({ id: "danny", title: "Danny Boy", genre: "Folk", culture: "Irish", difficulty: "medium", featured: true }),
  mk({ id: "greensleeves", title: "Greensleeves", genre: "Folk", culture: "English", difficulty: "medium" }),
];

describe("catalog helpers", () => {
  it("searches title, artist, culture, tags and language, all terms must match", () => {
    expect(searchCatalog(songs, "sakura").map((s) => s.id)).toEqual(["sakura"]);
    expect(searchCatalog(songs, "japanese").map((s) => s.id)).toEqual(["sakura"]);
    expect(searchCatalog(songs, "cortez").map((s) => s.id)).toEqual(["feel"]);
    expect(searchCatalog(songs, "lullaby star").map((s) => s.id)).toEqual(["twinkle"]);
    expect(searchCatalog(songs, "irish pop")).toEqual([]);
    expect(searchCatalog(songs, "  ")).toHaveLength(6);
  });
  it("filters by facet", () => {
    expect(applyFacet(songs, { kind: "difficulty", value: "medium" }).map((s) => s.id)).toEqual(["silent", "danny", "greensleeves"]);
    expect(applyFacet(songs, { kind: "genre", value: "Folk" })).toHaveLength(3);
    expect(applyFacet(songs, { kind: "culture", value: "English" }).map((s) => s.id)).toEqual(["twinkle", "feel", "greensleeves"]);
    expect(applyFacet(songs, { kind: "recordings" }).map((s) => s.id)).toEqual(["feel"]);
  });
  it("counts facet values, most common first", () => {
    const { genres, cultures } = facetValues(songs);
    expect(genres[0]).toEqual({ value: "Folk", n: 3 });
    expect(cultures[0]).toEqual({ value: "English", n: 3 });
  });
  it("builds the home shelves in order and leaves out thin genres", () => {
    const ids = buildShelves(songs).map((s) => s.id);
    expect(ids).toEqual(["featured", "beginners", "celebrate", "recordings", "genre:Folk", "world"]);
    const world = buildShelves(songs).find((s) => s.id === "world")!;
    expect(world.songs.map((s) => s.id)).toEqual(["silent", "sakura", "danny"]);
  });
  it("picks an easy featured song to open first", () => {
    expect(pickFeatured(songs)?.id).toBe("twinkle");
    expect(pickFeatured([])).toBeNull();
  });
});
