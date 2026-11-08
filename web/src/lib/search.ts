// One search over the built-in songs and the user's own songs: typo-tolerant matching on title,
// artist, style, country and lyrics; removable filters; sorting. Pure functions, unit-tested.
import { cultureOf, languageName, regionOf } from "./catalog";
import type { Instrument } from "./instruments";
import type { CatalogEntry, Difficulty } from "./types";

/** One row of /api/search-index. */
export type SearchRow = {
  id: string;
  kind: "catalog" | "upload";
  title: string;
  artist?: string | null;
  genre?: string | null;
  culture?: string | null;
  origin?: string | null;
  language?: string | null;
  year?: string | number | null;
  tempo_bpm?: number | null;
  difficulty?: Difficulty | null;
  duration?: number | null;
  source?: "traditional" | "cc" | "upload" | null;
  tags?: string[];
  added?: string | null;
  featured?: boolean;
  accent_hue?: number | null;
  /** Lowest and highest melody note (concert MIDI). */
  range?: [number, number] | null;
  lyrics?: string;
  note_count?: number;
};

export type TempoBand = "slow" | "medium" | "fast";
export type SourceKind = "traditional" | "cc" | "upload";
export type Filters = {
  difficulty?: Difficulty;
  genre?: string;
  decade?: string;          // "1920s"
  language?: string;        // ISO code
  country?: string;         // culture word, e.g. "American"
  tempo?: TempoBand;
  source?: SourceKind;
  fits?: boolean;           // fits the player's instrument
  favourites?: boolean;
  tag?: string;             // e.g. "standard"
};
export type SearchSort = "relevance" | "popular" | "new" | "az" | "easy";
export const SEARCH_SORT_LABEL: Record<SearchSort, string> = { relevance: "Best match", popular: "Most played", new: "Newest", az: "A to Z", easy: "Easiest first" };
export const TEMPO_LABEL: Record<TempoBand, string> = { slow: "Slow", medium: "Medium tempo", fast: "Fast" };
export const TAG_LABEL: Record<string, string> = { standard: "Jazz and classic standards" };
export const SOURCE_LABEL: Record<SourceKind, string> = { traditional: "Public domain", cc: "Real recordings", upload: "My songs" };

/** Slow below 90 beats a minute, fast from 130. */
export function tempoBand(bpm: number | null | undefined): TempoBand | null {
  if (!bpm) return null;
  return bpm < 90 ? "slow" : bpm < 130 ? "medium" : "fast";
}

export function decadeOf(year: string | number | null | undefined): string | null {
  const y = typeof year === "number" ? year : parseInt(String(year ?? "").match(/\d{4}/)?.[0] ?? "", 10);
  if (!Number.isFinite(y) || y < 1000) return null;
  return `${Math.floor(y / 10) * 10}s`;
}

/** Can the instrument play the whole melody at some octave and a key shift of at most a few semitones? */
export function fitsInstrument(range: [number, number] | null | undefined, inst: Instrument, maxKeyShift = 3): boolean {
  if (!range) return true;
  const [lo, hi] = range;
  const [rlo, rhi] = inst.range;
  if (hi - lo > rhi - rlo) return false;
  for (let oct = -2; oct <= 2; oct++) {
    for (let k = -maxKeyShift; k <= maxKeyShift; k++) {
      const wlo = lo + inst.transpose + 12 * oct + k;
      const whi = hi + inst.transpose + 12 * oct + k;
      if (wlo >= rlo && whi <= rhi) return true;
    }
  }
  return false;
}

// ---- matching ------------------------------------------------------------------
export function fold(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9\u0080-￿]+/g, " ").trim();
}

/** Edit distance with transpositions, stopping early once it exceeds `max`. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2 = new Array(b.length + 1).fill(0);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      rowMin = Math.min(rowMin, v);
    }
    for (let j = 0; j <= b.length; j++) prev2[j] = prev[j];
    prev = cur;
    if (rowMin > max) return max + 1;
  }
  return prev[b.length];
}

/** How well one query word matches a list of words: 1 exact or prefix, 0.7 inside a word, 0.55 one typo away, 0 no match. */
function wordScore(term: string, words: string[]): number {
  let best = 0;
  const allowed = term.length >= 7 ? 2 : term.length >= 4 ? 1 : 0;
  for (const w of words) {
    if (w === term || w.startsWith(term)) return 1;
    if (term.length >= 3 && w.includes(term)) best = Math.max(best, 0.7);
    else if (allowed && best < 0.55) {
      const cut = w.slice(0, Math.max(term.length, Math.min(w.length, term.length + 1)));
      if (editDistance(term, cut, allowed) <= allowed || editDistance(term, w, allowed) <= allowed) best = 0.55;
    }
  }
  return best;
}

type Prepared = { row: SearchRow; title: string[]; artist: string[]; meta: string[]; lyrics: string[]; titleFull: string };
const cache = new WeakMap<SearchRow, Prepared>();
function prepare(row: SearchRow): Prepared {
  let p = cache.get(row);
  if (!p) {
    const split = (s: string) => fold(s).split(" ").filter(Boolean);
    const lang = row.language ? `${row.language} ${languageName(row.language)}` : "";
    const entryLike = { culture: row.culture ?? "", origin: row.origin ?? "" } as CatalogEntry;
    p = {
      row,
      title: split(row.title),
      titleFull: fold(row.title),
      artist: split(row.artist ?? ""),
      meta: split(`${row.genre ?? ""} ${cultureOf(entryLike)} ${regionOf(entryLike)} ${lang} ${(row.tags ?? []).join(" ")} ${decadeOf(row.year) ?? ""} ${row.kind === "upload" ? "my songs mine upload" : ""}`),
      lyrics: Array.from(new Set(split(row.lyrics ?? ""))),
    };
    cache.set(row, p);
  }
  return p;
}

/** A score above 0 means the row matches every word of the query. Title hits weigh most, then artist, style or place, then lyrics. */
export function scoreRow(row: SearchRow, query: string): number {
  const terms = fold(query).split(" ").filter(Boolean);
  if (!terms.length) return 1;
  const p = prepare(row);
  let total = 0;
  for (const t of terms) {
    const s = Math.max(wordScore(t, p.title) * 3, wordScore(t, p.artist) * 2, wordScore(t, p.meta) * 1.6, wordScore(t, p.lyrics) * 1);
    if (s === 0) return 0;
    total += s;
  }
  const q = fold(query);
  if (p.titleFull === q) total += 4;
  else if (p.titleFull.startsWith(q)) total += 2;
  return total;
}

export function applyFilters(rows: SearchRow[], f: Filters, ctx: { instrument?: Instrument; favourites?: Set<string> } = {}): SearchRow[] {
  return rows.filter((r) => {
    if (f.difficulty && r.difficulty !== f.difficulty) return false;
    if (f.genre && r.genre !== f.genre) return false;
    if (f.decade && decadeOf(r.year) !== f.decade) return false;
    if (f.language && (r.language ?? "") !== f.language) return false;
    if (f.country && (r.culture ?? r.origin ?? "") !== f.country) return false;
    if (f.tempo && tempoBand(r.tempo_bpm) !== f.tempo) return false;
    if (f.source && (r.kind === "upload" ? "upload" : r.source) !== f.source) return false;
    if (f.fits && ctx.instrument && !fitsInstrument(r.range, ctx.instrument)) return false;
    if (f.favourites && !ctx.favourites?.has(r.id)) return false;
    if (f.tag && !(r.tags ?? []).includes(f.tag)) return false;
    return true;
  });
}

const RANK: Record<Difficulty, number> = { easy: 0, medium: 1, hard: 2 };

export function searchSongs(rows: SearchRow[], query: string, filters: Filters, sort: SearchSort, ctx: { instrument?: Instrument; favourites?: Set<string>; plays?: Record<string, { count: number; last?: string }> } = {}): SearchRow[] {
  const scored = applyFilters(rows, filters, ctx).map((r) => ({ r, s: scoreRow(r, query) })).filter((x) => x.s > 0);
  const plays = (id: string) => ctx.plays?.[id]?.count ?? 0;
  const byTitle = (a: SearchRow, b: SearchRow) => a.title.localeCompare(b.title);
  const mode: SearchSort = sort === "relevance" && !query.trim() ? "popular" : sort;
  scored.sort((a, b) => {
    switch (mode) {
      case "relevance": return b.s - a.s || plays(b.r.id) - plays(a.r.id) || byTitle(a.r, b.r);
      case "popular": return plays(b.r.id) - plays(a.r.id) || Number(!!b.r.featured) - Number(!!a.r.featured) || byTitle(a.r, b.r);
      case "new": return (Date.parse(b.r.added ?? "") || 0) - (Date.parse(a.r.added ?? "") || 0) || byTitle(a.r, b.r);
      case "az": return byTitle(a.r, b.r);
      case "easy": return RANK[a.r.difficulty ?? "medium"] - RANK[b.r.difficulty ?? "medium"] || (a.r.duration ?? 0) - (b.r.duration ?? 0) || byTitle(a.r, b.r);
    }
  });
  return scored.map((x) => x.r);
}

/** The values each filter can take in this list, most common first. */
export function filterOptions(rows: SearchRow[]) {
  const count = (keys: (string | null | undefined)[]) => {
    const m = new Map<string, number>();
    for (const k of keys) if (k) m.set(k, (m.get(k) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([value, n]) => ({ value, n }));
  };
  return {
    genres: count(rows.map((r) => r.genre)),
    decades: count(rows.map((r) => decadeOf(r.year))).sort((a, b) => a.value.localeCompare(b.value)),
    languages: count(rows.map((r) => r.language)),
    countries: count(rows.map((r) => r.culture ?? r.origin)),
  };
}

/** The filters as the URL query string keeps them, so a search can be bookmarked or shared within the app. */
export function filtersToParams(q: string, f: Filters, sort: SearchSort): URLSearchParams {
  const p = new URLSearchParams();
  if (q.trim()) p.set("q", q.trim());
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== false && v !== "") p.set(k, v === true ? "1" : String(v));
  if (sort !== "relevance") p.set("sort", sort);
  return p;
}

export function paramsToFilters(p: URLSearchParams): { q: string; filters: Filters; sort: SearchSort } {
  const f: Filters = {};
  const d = p.get("difficulty");
  if (d === "easy" || d === "medium" || d === "hard") f.difficulty = d;
  for (const k of ["genre", "decade", "language", "country", "tag"] as const) { const v = p.get(k); if (v) f[k] = v; }
  const t = p.get("tempo");
  if (t === "slow" || t === "medium" || t === "fast") f.tempo = t;
  const s = p.get("source");
  if (s === "traditional" || s === "cc" || s === "upload") f.source = s;
  if (p.get("fits") === "1") f.fits = true;
  if (p.get("favourites") === "1") f.favourites = true;
  const so = p.get("sort");
  const sort: SearchSort = so && so in SEARCH_SORT_LABEL ? (so as SearchSort) : "relevance";
  return { q: p.get("q") ?? "", filters: f, sort };
}
