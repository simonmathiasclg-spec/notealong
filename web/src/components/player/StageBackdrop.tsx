"use client";
// Behind the player (and the processing view): the song's artwork, enlarged, softly out of focus and dimmed so
// the lyrics keep their contrast. It is the same picture as the tile that opened the song, which morphs into it.
import { ViewTransition } from "react";
import { artField, artName } from "@/components/art/Art";
import type { ArtColors } from "@/lib/types";

export function StageBackdrop({ id, src, colors }: { id: string; src: string | null; colors: ArtColors | null }) {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true" style={{ background: artField(colors) }}>
      {src && (
        <ViewTransition name={artName(id)} share="art-morph" default="none">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" className="stage-art absolute inset-[-10%] h-[120%] w-[120%] max-w-none object-cover" />
        </ViewTransition>
      )}
      {/* the house lights: dark in the middle where the words are, darker still at the edges */}
      <div className="stage-shade absolute inset-0" />
      <div className="grain absolute inset-0" />
    </div>
  );
}
