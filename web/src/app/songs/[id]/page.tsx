"use client";
import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import type { Song } from "@/lib/types";
import { ProcessingView } from "@/components/ProcessingView";
import { Player } from "@/components/player/Player";
import { AppHeader } from "@/components/AppHeader";

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

  if (error) {
    const missing = /not found/i.test(error);
    return (
      <div className="flex min-h-full flex-col">
        <AppHeader />
        <div className="mx-auto max-w-md px-6 py-16 text-center">
          <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-danger-soft text-danger"><AlertCircle className="h-6 w-6" /></div>
          <h1 className="display-md text-2xl">{missing ? "That song isn't here" : "Couldn't open this song"}</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">{missing ? "It may have been deleted, or the link is wrong." : error}</p>
          <div className="mt-7 flex justify-center gap-2">
            <Link href="/" className="btn btn-primary"><ArrowLeft className="h-4 w-4" /> Discover</Link>
            <Link href="/my-songs" className="btn">My songs</Link>
          </div>
        </div>
      </div>
    );
  }
  if (!song) return <div className="flex min-h-full items-center justify-center text-muted" aria-busy="true"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (song.status !== "ready") return <ProcessingView song={song} onReady={load} />;
  return <Player key={song.updated_at + song.id} initial={song} reload={load} />;
}
