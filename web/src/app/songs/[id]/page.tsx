"use client";
import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import type { Song } from "@/lib/types";
import { ProcessingView } from "@/components/ProcessingView";
import { Player } from "@/components/player/Player";
import { AppHeader } from "@/components/AppHeader";
import { StageBackdrop } from "@/components/player/StageBackdrop";
import { artHint, useArtColors } from "@/components/art/Art";

export default function SongPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [song, setSong] = useState<Song | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSong(await api.getSong(id));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // the artwork is known before the song is: the tile that opened it left a note (so the picture can morph)
  const [hint] = useState(() => artHint.get(id) ?? null);
  const src = song ? (song.catalog ? api.coverUrl(id) : hint?.src ?? api.uploadCoverUrl(id)) : hint?.src ?? null;
  const colors = useArtColors(src, song?.catalog?.colors ?? hint?.colors ?? null);
  const backdrop = <StageBackdrop id={id} src={src} colors={colors} />;

  if (error) {
    const missing = /not found/i.test(error);
    return (
      <div className="flex min-h-full flex-col">
        <AppHeader />
        <div className="mx-auto w-full max-w-3xl px-5 py-16 sm:px-8 sm:py-24">
          <p className="flex items-center gap-3 text-[13px] font-medium text-[var(--red-text)]"><AlertCircle className="h-4 w-4" strokeWidth={1.8} /> {missing ? "Not found" : "Something went wrong"}</p>
          <h1 className="display-hero mt-4 text-[clamp(3rem,9vw,6.5rem)]">{missing ? "That song isn't here" : "Couldn't open this song"}</h1>
          <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-muted">{missing ? "It may have been deleted, or the link is wrong." : error}</p>
          <div className="mt-8 flex gap-2">
            <Link href="/" className="btn btn-primary btn-lg"><ArrowLeft className="h-4 w-4" strokeWidth={1.8} /> Discover</Link>
            <Link href="/my-songs" className="btn btn-outline btn-lg">My songs</Link>
          </div>
        </div>
      </div>
    );
  }
  if (!song) return <>{backdrop}<div className="relative z-10 flex min-h-dvh items-center justify-center text-muted" aria-busy="true"><Loader2 className="h-6 w-6 animate-spin" strokeWidth={1.6} /></div></>;
  if (song.status !== "ready") return <>{backdrop}<div className="relative z-10 flex min-h-dvh flex-col"><ProcessingView song={song} onReady={load} /></div></>;
  return <>{backdrop}<div className="relative z-10"><Player key={song.updated_at + song.id} initial={song} reload={load} colors={colors} /></div></>;
}
