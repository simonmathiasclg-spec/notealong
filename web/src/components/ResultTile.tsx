"use client";
// Any song in the search index (a built-in song or one of the user's own) as a widget tile, and the grid
// they sit in: square cells with every so often a wide or a tall one, packed densely, so a page of results
// reads as a wall of artwork rather than a uniform grid.
import { api, formatTime } from "@/lib/api";
import { DIFFICULTY_LABEL } from "@/lib/catalog";
import type { SearchRow } from "@/lib/search";
import { ArtTile, type TileShape } from "./art/Art";

export function ResultTile({ row, priority = false, shape = "square" }: { row: SearchRow; priority?: boolean; shape?: TileShape }) {
  const cover = row.kind === "upload" ? api.uploadCoverUrl(row.id) : api.coverUrl(row.id);
  const who = row.kind === "upload" ? (row.artist || "My song") : row.artist === "Traditional" ? (row.culture || row.artist) : row.artist;
  const meta = [row.difficulty ? DIFFICULTY_LABEL[row.difficulty] : null, row.duration ? formatTime(row.duration) : null, row.kind === "upload" ? "My song" : null].filter(Boolean).join(" · ");
  return <ArtTile song={{ id: row.id, title: row.title, artist: who, cover, colors: row.colors ?? null, meta }} shape={shape} priority={priority} />;
}

/** Where the bigger tiles fall: often enough to break the grid, never two side by side. */
function shapeAt(i: number): TileShape {
  if (i % 11 === 0) return "wide";
  if (i % 11 === 6) return "tall";
  if (i % 11 === 3 || i % 11 === 9) return "circle";
  return "square";
}

export function ResultGrid({ rows, max = 240 }: { rows: SearchRow[]; max?: number }) {
  return (
    <div className="grid grid-flow-row-dense grid-cols-2 gap-3 [grid-auto-rows:calc((100vw-2.5rem-0.75rem)/2)] sm:grid-cols-3 sm:gap-4 sm:[grid-auto-rows:calc((100vw-4rem-2rem)/3)] md:grid-cols-4 md:[grid-auto-rows:calc((100vw-4rem-3rem)/4)] lg:grid-cols-5 lg:[grid-auto-rows:calc((min(100vw,90rem)-6rem-4rem)/5)] xl:grid-cols-6 xl:[grid-auto-rows:calc((min(100vw,90rem)-6rem-5rem)/6)]" aria-live="polite">
      {rows.slice(0, max).map((r, i) => {
        const shape = shapeAt(i);
        return <div key={r.id} className={shape === "wide" ? "col-span-2" : shape === "tall" ? "row-span-2" : ""}><ResultTile row={r} priority={i < 12} shape={shape} /></div>;
      })}
    </div>
  );
}
