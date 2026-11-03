// Pure helpers for the Discover screen (filtering, search, shelves). Kept out of
// the page so they can be unit-tested and reused by the redesign.
import type { CatalogEntry, Difficulty } from "./types";

export type Facet = { kind: "all" } | { kind: "genre"; value: string } | { kind: "culture"; value: string } | { kind: "difficulty"; value: Difficulty } | { kind: "recordings" };

export const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: "Easy", medium: "Medium", hard: "Hard" };
export const DIFFICULTY_HINT: Record<Difficulty, string> = {
  easy: "Few different notes, no big jumps",
  medium: "A wider range or a few quick notes",
  hard: "Fast, wide or full of jumps",
};

export function cultureOf(s: CatalogEntry): string {
  return s.culture || s.origin || "";
}

export function searchCatalog(songs: CatalogEntry[], query: string): CatalogEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return songs;
  const terms = q.split(/\s+/);
  return songs.filter((s) => {
    const hay = `${s.title} ${s.artist} ${s.genre} ${cultureOf(s)} ${s.origin ?? ""} ${s.tags.join(" ")} ${s.language ?? ""}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

export function applyFacet(songs: CatalogEntry[], facet: Facet): CatalogEntry[] {
  switch (facet.kind) {
    case "all": return songs;
    case "genre": return songs.filter((s) => s.genre === facet.value);
    case "culture": return songs.filter((s) => cultureOf(s) === facet.value);
    case "difficulty": return songs.filter((s) => s.difficulty === facet.value);
    case "recordings": return songs.filter((s) => s.source.kind === "cc");
  }
}

export function facetValues(songs: CatalogEntry[]) {
  const count = (keys: string[]) => {
    const m = new Map<string, number>();
    for (const k of keys) if (k) m.set(k, (m.get(k) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([value, n]) => ({ value, n }));
  };
  return { genres: count(songs.map((s) => s.genre)), cultures: count(songs.map(cultureOf)) };
}

export type Shelf = { id: string; title: string; subtitle?: string; songs: CatalogEntry[] };

/** The rows on the Discover home: featured, beginners, holidays, recordings, then each genre with enough songs. */
export function buildShelves(songs: CatalogEntry[], minPerGenre = 3): Shelf[] {
  const out: Shelf[] = [];
  const push = (id: string, title: string, list: CatalogEntry[], subtitle?: string) => { if (list.length) out.push({ id, title, subtitle, songs: list }); };
  push("featured", "Featured", songs.filter((s) => s.featured));
  push("beginners", "Great for beginners", songs.filter((s) => s.beginner || s.difficulty === "easy"), DIFFICULTY_HINT.easy);
  push("celebrate", "Holidays and celebrations", songs.filter((s) => s.genre === "Christmas" || s.genre === "Celebration"));
  push("recordings", "Real recordings", songs.filter((s) => s.source.kind === "cc"), "Creative Commons songs, notes checked by hand");
  const used = new Set(["Christmas", "Celebration"]);
  for (const { value, n } of facetValues(songs).genres) {
    if (used.has(value) || n < minPerGenre) continue;
    push(`genre:${value}`, value, songs.filter((s) => s.genre === value));
  }
  push("world", "Around the world", songs.filter((s) => s.source.kind === "traditional" && !["American", "English", "British"].includes(cultureOf(s))));
  return out;
}

/** Something to open first: a featured easy song, else the first easy one, else anything. */
export function pickFeatured(songs: CatalogEntry[]): CatalogEntry | null {
  return songs.find((s) => s.featured && s.difficulty !== "hard") ?? songs.find((s) => s.difficulty === "easy") ?? songs[0] ?? null;
}
