// Pure helpers for the Discover screen (filtering, search, sorting, shelves). Kept out of
// the page so they can be unit-tested.
import type { CatalogEntry, Difficulty } from "./types";

export type Facet =
  | { kind: "all" }
  | { kind: "genre"; value: string }
  | { kind: "culture"; value: string }
  | { kind: "region"; value: string }
  | { kind: "language"; value: string }
  | { kind: "difficulty"; value: Difficulty }
  | { kind: "recordings" }
  | { kind: "new" }
  | { kind: "recent" };

export const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: "Easy", medium: "Medium", hard: "Hard" };
export const DIFFICULTY_HINT: Record<Difficulty, string> = {
  easy: "Few different notes, no big jumps",
  medium: "A wider range or a few quick notes",
  hard: "Fast, wide or full of jumps",
};

export function cultureOf(s: CatalogEntry): string {
  return s.culture || s.origin || "";
}

/** Parts of the world, for browsing a catalog with dozens of countries. Matched on the culture and origin words. */
export const REGIONS: [string, RegExp][] = [
  ["Britain and Ireland", /english|england|scot|irish|ireland|welsh|wales|british|united kingdom/i],
  ["Latin America", /mexic|cuba|brazil|argentin|chile|peru|colombia|venezuel|puerto ric|latin america|andean|bolivia|ecuador|caribbean|jamaica/i],
  ["North America", /american|united states|canad|quebec|appalach/i],
  ["Africa", /africa|ghana|zulu|nigeri|kenya|swahili|xhosa|ndebele|zimbabw|congo|ethiopi|senegal/i],
  ["Middle East", /jewish|israel|hebrew|turk|arab|egypt|persia|iran|leban|syria|andalus|armenia/i],
  ["South Asia", /india|bengal|hindi|pakistan|sri lanka|nepal|punjab|tamil/i],
  ["East Asia and the Pacific", /japan|chin|korea|filipin|philippin|indonesia|malay|vietnam|thai|hawai|m[aā]ori|new zealand|australia|pacific|polynesia/i],
  ["Europe", /french|france|german|ital|naples|neapolitan|spanish|spain|austria|russia|ukrain|polish|poland|swed|finn|finland|norw|danish|denmark|dutch|netherlands|greek|greece|hungar|czech|portug|swiss|belgi|romania|bulgar|serbia|croatia|europe/i],
];

export function regionOf(s: CatalogEntry): string {
  const text = `${s.culture ?? ""} ${s.origin ?? ""}`;
  if (!text.trim()) return "";
  if (/african-american/i.test(text)) return "North America";
  for (const [name, re] of REGIONS) if (re.test(text)) return name;
  return "";
}

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English", fr: "French", es: "Spanish", de: "German", it: "Italian", pt: "Portuguese", ru: "Russian", uk: "Ukrainian", pl: "Polish",
  sv: "Swedish", fi: "Finnish", nl: "Dutch", ja: "Japanese", zh: "Chinese", ko: "Korean", he: "Hebrew", ar: "Arabic", tr: "Turkish",
  hi: "Hindi", bn: "Bengali", zu: "Zulu", xh: "Xhosa", af: "Afrikaans", haw: "Hawaiian", mi: "Māori", tl: "Filipino", la: "Latin", cy: "Welsh",
  ga: "Irish", gd: "Scottish Gaelic", el: "Greek", hu: "Hungarian", cs: "Czech", ro: "Romanian", sw: "Swahili", id: "Indonesian", ms: "Malay",
};
export function languageName(code: string | undefined): string {
  if (!code) return "";
  return LANGUAGE_NAMES[code.toLowerCase()] ?? code;
}

export function searchCatalog(songs: CatalogEntry[], query: string): CatalogEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return songs;
  const terms = q.split(/\s+/);
  return songs.filter((s) => {
    const hay = `${s.title} ${s.artist} ${s.genre} ${cultureOf(s)} ${s.origin ?? ""} ${regionOf(s)} ${s.tags.join(" ")} ${s.language ?? ""} ${languageName(s.language)}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

/** Added in the last `days` days. */
export function isNew(s: CatalogEntry, now = new Date(), days = 7): boolean {
  if (!s.added) return false;
  const t = Date.parse(s.added);
  return Number.isFinite(t) && now.getTime() - t < days * 86_400_000 && now.getTime() - t > -86_400_000;
}

export function applyFacet(songs: CatalogEntry[], facet: Facet, now = new Date()): CatalogEntry[] {
  switch (facet.kind) {
    case "all": return songs;
    case "genre": return songs.filter((s) => s.genre === facet.value);
    case "culture": return songs.filter((s) => cultureOf(s) === facet.value);
    case "region": return songs.filter((s) => regionOf(s) === facet.value);
    case "language": return songs.filter((s) => (s.language ?? "") === facet.value);
    case "difficulty": return songs.filter((s) => s.difficulty === facet.value);
    case "recordings": return songs.filter((s) => s.source.kind === "cc");
    case "new": return newSongs(songs, now);
    case "recent": return sortSongs(songs.filter((s) => s.last_played), "recent");
  }
}

export function facetLabel(facet: Facet): string {
  switch (facet.kind) {
    case "all": return "";
    case "recordings": return "Real recordings";
    case "new": return "New this week";
    case "recent": return "Jump back in";
    case "difficulty": return `${DIFFICULTY_LABEL[facet.value]} songs`;
    case "language": return `Sung in ${languageName(facet.value)}`;
    default: return facet.value;
  }
}

export type SortMode = "az" | "new" | "easy" | "short" | "popular" | "recent";
export const SORT_LABEL: Record<Exclude<SortMode, "recent">, string> = { az: "A to Z", new: "Newest", easy: "Easiest first", short: "Shortest first", popular: "Most played" };
const RANK: Record<Difficulty, number> = { easy: 0, medium: 1, hard: 2 };

/**
 * Sorting for the grids. "popular" uses each song's `popularity` number (plays, once the app
 * reports them; 0 for now), then featured songs, then the title, so it already gives a sensible order.
 */
export function sortSongs(songs: CatalogEntry[], mode: SortMode): CatalogEntry[] {
  const byTitle = (a: CatalogEntry, b: CatalogEntry) => a.title.localeCompare(b.title);
  const out = [...songs];
  switch (mode) {
    case "az": return out.sort(byTitle);
    case "new": return out.sort((a, b) => (Date.parse(b.added ?? "") || 0) - (Date.parse(a.added ?? "") || 0) || byTitle(a, b));
    case "easy": return out.sort((a, b) => RANK[a.difficulty] - RANK[b.difficulty] || a.duration - b.duration || byTitle(a, b));
    case "short": return out.sort((a, b) => a.duration - b.duration || byTitle(a, b));
    case "recent": return out.sort((a, b) => (Date.parse(b.last_played ?? "") || 0) - (Date.parse(a.last_played ?? "") || 0));
    case "popular": return out.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0) || Number(!!b.featured) - Number(!!a.featured) || byTitle(a, b));
  }
}

export function facetValues(songs: CatalogEntry[]) {
  const count = (keys: string[]) => {
    const m = new Map<string, number>();
    for (const k of keys) if (k) m.set(k, (m.get(k) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([value, n]) => ({ value, n }));
  };
  return {
    genres: count(songs.map((s) => s.genre)),
    cultures: count(songs.map(cultureOf)),
    regions: count(songs.map(regionOf)),
    languages: count(songs.map((s) => s.language ?? "")),
  };
}

export type Shelf = { id: string; title: string; subtitle?: string; songs: CatalogEntry[]; total: number; facet?: Facet };

/** How many tiles a row shows before "See all". */
export const SHELF_SIZE = 18;
/** At most this many style rows on the home page; the rest are reached from the Browse cards. */
export const MAX_GENRE_ROWS = 5;

/** Songs that joined in the last week; if that is every song, only the latest arrivals (two days). */
export function newSongs(songs: CatalogEntry[], now = new Date()): CatalogEntry[] {
  const week = songs.filter((s) => isNew(s, now));
  if (week.length < songs.length) return week;
  const latest = songs.filter((s) => isNew(s, now, 2));
  return latest.length < songs.length ? latest : [];
}

/**
 * The rows on the Discover home, for a catalog of a hundred songs or more: what you played last,
 * what is new, featured, beginners, real recordings, holidays, then the biggest styles. Rows are
 * capped; "See all" opens the full list. Everything else is reached from the Browse cards.
 */
export function buildShelves(songs: CatalogEntry[], now = new Date(), minPerRow = 6): Shelf[] {
  const out: Shelf[] = [];
  const push = (id: string, title: string, list: CatalogEntry[], facet?: Facet, subtitle?: string, min = 1) => {
    if (list.length >= min) out.push({ id, title, subtitle, songs: list.slice(0, SHELF_SIZE), total: list.length, facet });
  };
  const ranked = sortSongs(songs, "popular");
  push("recent", "Jump back in", applyFacet(songs, { kind: "recent" }).slice(0, 10), undefined, "Songs you played lately");
  push("new", "New this week", sortSongs(newSongs(ranked, now), "new"), { kind: "new" });
  push("featured", "Featured", ranked.filter((s) => s.featured));
  push("beginners", "Great for beginners", sortSongs(songs.filter((s) => s.beginner || s.difficulty === "easy"), "easy"), { kind: "difficulty", value: "easy" }, DIFFICULTY_HINT.easy);
  push("recordings", "Real recordings", ranked.filter((s) => s.source.kind === "cc"), { kind: "recordings" }, "Songs by independent artists, shared under Creative Commons");
  push("celebrate", "Holidays and celebrations", ranked.filter((s) => s.genre === "Christmas" || s.genre === "Celebration"));
  let rows = 0;
  for (const { value, n } of facetValues(songs).genres) {
    if (value === "Christmas" || value === "Celebration" || n < minPerRow || rows >= MAX_GENRE_ROWS) continue;
    rows++;
    push(`genre:${value}`, value, ranked.filter((s) => s.genre === value), { kind: "genre", value });
  }
  return out;
}

export type Category = { id: string; group: "Styles" | "Around the world" | "Languages"; title: string; n: number; facet: Facet };

/** The Browse cards: every style, part of the world and language with at least `min` songs. */
export function buildCategories(songs: CatalogEntry[], min = 2): Category[] {
  const { genres, regions, languages } = facetValues(songs);
  const out: Category[] = [];
  for (const { value, n } of genres) if (n >= min) out.push({ id: `genre:${value}`, group: "Styles", title: value, n, facet: { kind: "genre", value } });
  for (const { value, n } of regions) if (n >= min) out.push({ id: `region:${value}`, group: "Around the world", title: value, n, facet: { kind: "region", value } });
  for (const { value, n } of languages) if (n >= min && value) out.push({ id: `language:${value}`, group: "Languages", title: languageName(value), n, facet: { kind: "language", value } });
  return out;
}

/** Something to open first: a featured easy song, else the first easy one, else anything. */
export function pickFeatured(songs: CatalogEntry[]): CatalogEntry | null {
  return songs.find((s) => s.featured && s.difficulty !== "hard") ?? songs.find((s) => s.difficulty === "easy") ?? songs[0] ?? null;
}

/** "Tonight's pick": a featured song that changes every day, never a hard one. */
export function pickTonight(songs: CatalogEntry[], date = new Date()): CatalogEntry | null {
  const pool = songs.filter((s) => s.featured && s.difficulty !== "hard");
  if (pool.length === 0) return pickFeatured(songs);
  const day = Math.floor(date.getTime() / 86_400_000);
  return pool[day % pool.length];
}
