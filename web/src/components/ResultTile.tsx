"use client";
// A tile for any song in the search index: a built-in song or one of the user's own.
import Link from "next/link";
import { api, formatTime } from "@/lib/api";
import { DIFFICULTY_LABEL } from "@/lib/catalog";
import type { SearchRow } from "@/lib/search";
import { FavouriteButton } from "./Favourite";

const DOT = { easy: "bg-ok", medium: "bg-[#e0a63a]", hard: "bg-accent" } as const;

export function ResultTile({ row, priority = false }: { row: SearchRow; priority?: boolean }) {
  const cover = row.kind === "upload" ? api.uploadCoverUrl(row.id) : api.coverUrl(row.id);
  const who = row.kind === "upload" ? (row.artist || "My song") : row.artist === "Traditional" ? (row.culture || row.artist) : row.artist;
  return (
    <div className="group/tile relative">
      <Link href={`/songs/${row.id}`} className="tile group" aria-label={`${row.title}${who ? `, ${who}` : ""}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={cover} alt="" className="cover" loading={priority ? "eager" : "lazy"} draggable={false} />
        <div className="mt-2.5 truncate text-[0.9rem] font-semibold leading-tight">{row.title}</div>
        <div className="mt-1 truncate text-[0.8rem] text-muted">{who}</div>
        <span className="mt-0.5 inline-flex items-center gap-1.5 text-[0.78rem] text-muted">
          {row.difficulty && <><span className={`inline-block h-1.5 w-1.5 rounded-full ${DOT[row.difficulty]}`} aria-hidden="true" />{DIFFICULTY_LABEL[row.difficulty]}<span aria-hidden="true">·</span></>}
          {row.duration ? formatTime(row.duration) : null}
          {row.kind === "upload" && <span className="rounded-full border border-border px-1.5 text-[0.68rem] text-faint">Mine</span>}
        </span>
      </Link>
      <FavouriteButton id={row.id} title={row.title} variant="overlay" />
    </div>
  );
}
