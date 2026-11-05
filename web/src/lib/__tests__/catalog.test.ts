import { describe, expect, it } from "vitest";
import { applyFacet, buildCategories, buildShelves, facetLabel, facetValues, isNew, languageName, pickFeatured, regionOf, searchCatalog, sortSongs } from "../catalog";
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
  it("searches title, artist, culture, region, tags and language, all terms must match", () => {
    expect(searchCatalog(songs, "sakura").map((s) => s.id)).toEqual(["sakura"]);
    expect(searchCatalog(songs, "japanese").map((s) => s.id)).toEqual(["sakura"]);
    expect(searchCatalog(songs, "cortez").map((s) => s.id)).toEqual(["feel"]);
    expect(searchCatalog(songs, "lullaby star").map((s) => s.id)).toEqual(["twinkle"]);
    expect(searchCatalog(songs, "asia").map((s) => s.id)).toEqual(["sakura"]);
    expect(searchCatalog(songs, "irish pop")).toEqual([]);
    expect(searchCatalog(songs, "  ")).toHaveLength(6);
  });
  it("filters by facet", () => {
    expect(applyFacet(songs, { kind: "difficulty", value: "medium" }).map((s) => s.id)).toEqual(["silent", "danny", "greensleeves"]);
    expect(applyFacet(songs, { kind: "genre", value: "Folk" })).toHaveLength(3);
    expect(applyFacet(songs, { kind: "culture", value: "English" }).map((s) => s.id)).toEqual(["twinkle", "feel", "greensleeves"]);
    expect(applyFacet(songs, { kind: "recordings" }).map((s) => s.id)).toEqual(["feel"]);
    expect(applyFacet(songs, { kind: "region", value: "Britain and Ireland" }).map((s) => s.id)).toEqual(["twinkle", "feel", "danny", "greensleeves"]);
    expect(applyFacet(songs, { kind: "language", value: "ja" }).map((s) => s.id)).toEqual(["sakura"]);
  });
  it("counts facet values, most common first", () => {
    const { genres, cultures, regions } = facetValues(songs);
    expect(genres[0]).toEqual({ value: "Folk", n: 3 });
    expect(cultures[0]).toEqual({ value: "English", n: 3 });
    expect(regions[0]).toEqual({ value: "Britain and Ireland", n: 4 });
  });
  it("places songs in a part of the world", () => {
    expect(regionOf(mk({ culture: "Mexican" }))).toBe("Latin America");
    expect(regionOf(mk({ culture: "African-American", origin: "United States" }))).toBe("North America");
    expect(regionOf(mk({ culture: "South African" }))).toBe("Africa");
    expect(regionOf(mk({ culture: "Jewish", origin: "Israel" }))).toBe("Middle East");
    expect(regionOf(mk({ culture: "Bengali", origin: "India" }))).toBe("South Asia");
    expect(regionOf(mk({ culture: "Māori", origin: "New Zealand" }))).toBe("East Asia and the Pacific");
    expect(regionOf(mk({ culture: "Ukrainian" }))).toBe("Europe");
    expect(regionOf(mk({ culture: "", origin: "" }))).toBe("");
  });
  it("names languages", () => {
    expect(languageName("fr")).toBe("French");
    expect(languageName("xx")).toBe("xx");
    expect(facetLabel({ kind: "language", value: "es" })).toBe("Sung in Spanish");
  });
  it("builds the home rows in order, leaves out thin ones and offers See all", () => {
    const shelves = buildShelves(songs, new Date(2026, 10, 5), 3);
    expect(shelves.map((s) => s.id)).toEqual(["featured", "beginners", "recordings", "celebrate", "genre:Folk"]);
    expect(shelves.find((s) => s.id === "genre:Folk")!.facet).toEqual({ kind: "genre", value: "Folk" });
    expect(shelves.find((s) => s.id === "beginners")!.total).toBe(2);
  });
  it("offers browse cards for styles, parts of the world and languages", () => {
    const cats = buildCategories(songs, 1);
    expect(cats.filter((c) => c.group === "Styles").map((c) => c.title)).toEqual(["Folk", "Children's", "Christmas", "Pop"]);
    expect(cats.find((c) => c.id === "region:Britain and Ireland")).toMatchObject({ n: 4, facet: { kind: "region", value: "Britain and Ireland" } });
    expect(cats.find((c) => c.group === "Languages")).toMatchObject({ title: "Japanese", n: 1 });
    expect(buildCategories(songs, 2).some((c) => c.title === "Pop")).toBe(false);
  });
  it("caps long rows and keeps the full count for See all", () => {
    const many = Array.from({ length: 40 }, (_, i) => mk({ id: `s${i}`, title: `Song ${String(i).padStart(2, "0")}`, genre: "Folk" }));
    const folk = buildShelves(many).find((s) => s.id === "genre:Folk")!;
    expect(folk.songs).toHaveLength(18);
    expect(folk.total).toBe(40);
  });
  it("picks an easy featured song to open first", () => {
    expect(pickFeatured(songs)?.id).toBe("twinkle");
    expect(pickFeatured([])).toBeNull();
  });
});

describe("new and recent", () => {
  const now = new Date("2026-11-05T08:00:00Z");
  const list = [
    mk({ id: "old", title: "Old", added: "2026-10-01" }),
    mk({ id: "new1", title: "New one", added: "2026-11-04" }),
    mk({ id: "new2", title: "Another new", added: "2026-11-05", last_played: "2026-11-05T07:00:00Z" }),
    mk({ id: "played", title: "Played", added: "2026-09-01", last_played: "2026-11-05T07:30:00Z" }),
  ];
  it("knows what joined in the last week", () => {
    expect(list.filter((s) => isNew(s, now)).map((s) => s.id)).toEqual(["new1", "new2"]);
    expect(isNew(mk({}), now)).toBe(false);
  });
  it("shows New this week and Jump back in rows", () => {
    const shelves = buildShelves(list, now);
    expect(shelves[0]).toMatchObject({ id: "recent", title: "Jump back in" });
    expect(shelves[0].songs.map((s) => s.id)).toEqual(["played", "new2"]);
    expect(shelves[1]).toMatchObject({ id: "new", title: "New this week", total: 2 });
    expect(shelves[1].songs.map((s) => s.id)).toEqual(["new2", "new1"]);     // newest first
  });
  it("does not call everything new on a fresh install", () => {
    const allNew = list.map((s) => ({ ...s, added: "2026-11-05", last_played: null }));
    expect(buildShelves(allNew, now).some((s) => s.id === "new")).toBe(false);
  });
  it("when everything joined this week, New means the latest arrivals", () => {
    const week = [mk({ id: "mon", added: "2026-11-02" }), mk({ id: "mon2", added: "2026-11-02" }), mk({ id: "thu", added: "2026-11-05" })];
    expect(buildShelves(week, now).find((s) => s.id === "new")!.songs.map((s) => s.id)).toEqual(["thu"]);
  });
});

describe("sorting", () => {
  const list = [
    mk({ id: "b", title: "Bravo", difficulty: "hard", duration: 50, added: "2026-11-01", popularity: 5 }),
    mk({ id: "a", title: "Alpha", difficulty: "easy", duration: 90, added: "2026-10-01", featured: true }),
    mk({ id: "c", title: "Charlie", difficulty: "easy", duration: 40, added: "2026-11-03", popularity: 9 }),
  ];
  const ids = (m: Parameters<typeof sortSongs>[1]) => sortSongs(list, m).map((s) => s.id);
  it("sorts by title, date, difficulty and length", () => {
    expect(ids("az")).toEqual(["a", "b", "c"]);
    expect(ids("new")).toEqual(["c", "b", "a"]);
    expect(ids("easy")).toEqual(["c", "a", "b"]);
    expect(ids("short")).toEqual(["c", "b", "a"]);
  });
  it("is ready for play counts: most played first, then featured, then by title", () => {
    expect(ids("popular")).toEqual(["c", "b", "a"]);
    const none = list.map((s) => ({ ...s, popularity: 0 }));
    expect(sortSongs(none, "popular").map((s) => s.id)).toEqual(["a", "b", "c"]);
  });
});

describe("tonight's pick", () => {
  it("rotates daily through featured songs and never picks a hard one", async () => {
    const { pickTonight } = await import("../catalog");
    const a = pickTonight(songs, new Date(2026, 0, 1));
    const b = pickTonight(songs, new Date(2026, 0, 2));
    expect(a && b && a.id !== b.id).toBe(true);
    expect([a?.id, b?.id].sort()).toEqual(["danny", "twinkle"]);
  });
});
