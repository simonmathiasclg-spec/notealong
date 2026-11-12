"use client";
// Artwork as the surface: tiles in several shapes with small white type over the picture (the widget look),
// the picture developing from its own colours while it loads, and the shared-element morph from a tile into
// the player (React <ViewTransition>, named only on the tile that was clicked).
import Link from "next/link";
import { ViewTransition, useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { FavouriteButton } from "@/components/Favourite";
import { colorsFromImage, HOUSE_COLORS } from "@/lib/color";
import type { ArtColors } from "@/lib/types";
import { PlayGlyph, WaveGlyph } from "./Glyphs";

/** What the tile that opened a song showed, so the player can show the same picture in its first frame. */
export const artHint = new Map<string, { src: string; colors: ArtColors | null }>();

export function artName(id: string): string { return `art-${id.replace(/[^a-zA-Z0-9_-]/g, "")}`; }

/** A cover's colours: known for built-in songs, read from the picture for uploads. */
export function useArtColors(src: string | null, known?: ArtColors | null): ArtColors | null {
  const [read, setRead] = useState<{ src: string; colors: ArtColors | null } | null>(null);
  useEffect(() => {
    if (known || !src) return;
    let live = true;
    colorsFromImage(src).then((c) => { if (live) setRead({ src, colors: c }); });
    return () => { live = false; };
  }, [src, known]);
  return known ?? (read && read.src === src ? read.colors : null);
}

/** The colour field a cover develops from (shown while it loads, and behind it). */
export function artField(c: ArtColors | null | undefined): string {
  const k = c ?? HOUSE_COLORS;
  return `radial-gradient(120% 90% at 35% 30%, ${k.mid}, ${k.deep} 70%)`;
}

/** An artwork picture that starts as its colour field and develops into the picture, like a print in the tray. */
export function ArtImage({ src, className = "", eager = false, sizes }: { src: string; className?: string; eager?: boolean; sizes?: string }) {
  const ref = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { if (ref.current?.complete && ref.current.naturalWidth) setLoaded(true); }, [src]);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img ref={ref} src={src} alt="" sizes={sizes} draggable={false} loading={eager ? "eager" : "lazy"} decoding="async"
      onLoad={() => setLoaded(true)}
      className={`art ${className}`}
      style={{ opacity: loaded ? 1 : 0, filter: loaded ? undefined : "blur(14px) saturate(1.2)", transition: "opacity .6s cubic-bezier(.22,1,.36,1), filter .9s cubic-bezier(.22,1,.36,1)" }} />
  );
}

export type TileShape = "square" | "tall" | "wide" | "circle";

export type TileSong = { id: string; title: string; artist?: string | null; cover: string; colors?: ArtColors | null; meta?: string; label?: string };

/**
 * A song as a widget: the cover fills the whole shape, a waveform mark in the corner, the title (it scrolls
 * like a marquee when it doesn't fit and you point at it), the artist small underneath, and a round play
 * button. Opens the player, morphing the picture into the player's backdrop.
 */
export function ArtTile({ song, shape = "square", priority = false, favourite = true, className = "" }: { song: TileSong; shape?: TileShape; priority?: boolean; favourite?: boolean; className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [morph, setMorph] = useState(false);
  const colors = useArtColors(song.cover, song.colors);
  const titleRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    const check = () => setOverflow(el.scrollWidth > el.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [song.title]);
  const round = shape === "circle";
  const tall = shape === "tall";
  const centred = round || tall;
  const radius = round ? "rounded-full" : "squircle";
  const big = shape === "wide" || shape === "tall";
  return (
    <div className={`group/tile relative h-full w-full ${className}`}>
      <Link
        href={`/songs/${song.id}`}
        onClick={() => { artHint.set(song.id, { src: song.cover, colors: colors ?? null }); flushSync(() => setMorph(true)); }}
        aria-label={`${song.title}${song.artist ? `, ${song.artist}` : ""}${song.meta ? `, ${song.meta}` : ""}`}
        className={`art-surface grain flex h-full w-full flex-col ${radius} outline-offset-4 ${centred ? "items-center text-center" : ""}`}
        style={{ background: artField(colors) }}
      >
        <ViewTransition name={morph ? artName(song.id) : `tile-${uid}`} share="art-morph" default="none">
          <ArtImage src={song.cover} eager={priority} className={radius} />
        </ViewTransition>
        <div className={`flex ${round ? "justify-center pt-[13%]" : tall ? "justify-center p-6" : big ? "p-6" : "p-4 sm:p-5"}`}>
          <WaveGlyph className={big ? "text-[15px]" : "text-[12px]"} />
          {song.label && !round && <span className="numeral ml-auto pr-8 text-white/80">{song.label}</span>}
        </div>
        <div className={`min-w-0 ${round ? "mt-auto w-[72%] pb-[18%]" : tall ? "my-auto w-full px-5" : big ? "mt-auto p-6 pt-0" : "mt-auto p-4 pt-0 sm:p-5 sm:pt-0"}`}>
          <span ref={titleRef} className={`marquee block font-medium leading-tight ${shape === "wide" ? "text-[1.35rem]" : shape === "tall" ? "text-[1.15rem]" : "text-[0.95rem]"}`} data-run={overflow ? undefined : "0"}>
            <span className={overflow ? "group-hover/tile:[animation:marquee_9s_linear_infinite]" : ""}>{song.title}{overflow && <span aria-hidden="true" className="pl-[2.5em]">{song.title}</span>}</span>
          </span>
          {song.artist && <span className={`mt-1 block truncate uppercase tracking-[0.08em] text-white/65 ${big ? "text-[12px]" : "text-[10.5px]"}`}>{song.artist}</span>}
          {song.meta && big && <span className="mt-3 block text-[12px] text-white/60">{song.meta}</span>}
        </div>
        <span className={`absolute grid place-items-center rounded-full bg-white/85 text-black/80 transition duration-300 ease-out group-hover/tile:scale-105 group-focus-visible/tile:opacity-100 ${tall ? "bottom-[9%] left-1/2 h-12 w-12 -translate-x-1/2" : big ? "bottom-6 right-6 h-14 w-14" : round ? "left-1/2 top-[52%] h-11 w-11 -translate-x-1/2 opacity-0 group-hover/tile:opacity-100" : "bottom-4 right-4 h-10 w-10 opacity-0 group-hover/tile:opacity-100 sm:bottom-5 sm:right-5"}`}
          style={{ color: colors?.deep }} aria-hidden="true">
          <PlayGlyph className={big ? "ml-0.5 h-5 w-5" : "ml-0.5 h-4 w-4"} />
        </span>
      </Link>
      {favourite && <FavouriteButton id={song.id} title={song.title} variant="overlay" className={round ? "!right-[14%] !top-[14%]" : ""} />}
    </div>
  );
}
