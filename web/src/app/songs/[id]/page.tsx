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
    return (
      <div className="flex min-h-full flex-col">
        <AppHeader />
        <div className="mx-auto max-w-md p-8 text-center">
          <AlertCircle className="mx-auto mb-3 h-8 w-8 text-danger" />
          <div className="font-semibold">Couldn&apos;t open this song</div>
          <div className="mt-1 text-sm text-muted">{error}</div>
          <Link href="/" className="btn mt-6"><ArrowLeft className="h-4 w-4" /> Back to Discover</Link>
        </div>
      </div>
    );
  }
  if (!song) return <div className="flex min-h-full items-center justify-center text-muted"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (song.status !== "ready") return <ProcessingView song={song} onReady={load} />;
  return <Player key={song.updated_at + song.id} initial={song} reload={load} />;
}
