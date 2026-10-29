"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertCircle, ArrowLeft, Check, Loader2, RotateCcw } from "lucide-react";
import { api, formatDuration } from "@/lib/api";
import type { ProgressSnapshot, Song } from "@/lib/types";
import { AppHeader } from "./AppHeader";

export function ProcessingView({ song, onReady }: { song: Song; onReady: () => void }) {
  const [snap, setSnap] = useState<ProgressSnapshot | null>(null);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    let stop = () => {};
    let cancelled = false;
    const start = () => {
      stop = api.progressStream(song.id, setSnap, async () => {
        if (cancelled) return;
        // stream ended: either finished or the service is unreachable; check once
        try {
          const s = await api.progressSnapshot(song.id);
          setSnap(s);
          if (s.status === "ready") onReady();
          else if (s.status === "processing") setTimeout(start, 2000);
        } catch { setTimeout(start, 3000); }
      });
    };
    start();
    return () => { cancelled = true; stop(); };
  }, [song.id, onReady]);

  const status = snap?.status ?? song.status;
  const steps = snap?.steps ?? [];
  const eta = snap?.estimated_seconds_left ?? 0;
  const failed = status === "failed";

  const retry = async () => {
    setRetrying(true);
    try { await api.rerun(song.id, "retry"); } finally { setRetrying(false); }
  };

  return (
    <div className="flex min-h-full flex-col">
      <AppHeader right={<Link href="/" className="btn btn-ghost"><ArrowLeft className="h-4 w-4" /> Your songs</Link>} />
      <main className="mx-auto w-full max-w-lg flex-1 px-5 py-10">
        <div className="label mb-2">{failed ? "Something went wrong" : "Getting your song ready"}</div>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">{song.title}</h1>
        {song.artist && <p className="text-muted">{song.artist}</p>}

        <div className="card mt-8 divide-y divide-border">
          {steps.map((s) => (
            <div key={s.id} className="flex items-center gap-4 px-5 py-4">
              <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${s.status === "done" ? "bg-accent text-accent-fg" : s.status === "running" ? "bg-accent-soft text-accent-strong" : s.status === "failed" ? "bg-danger-soft text-danger" : "bg-sunken text-faint"}`}>
                {s.status === "done" ? <Check className="h-4 w-4" /> : s.status === "running" ? <Loader2 className="h-4 w-4 animate-spin" /> : s.status === "failed" ? <AlertCircle className="h-4 w-4" /> : <span className="h-2 w-2 rounded-full bg-current" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className={`font-semibold ${s.status === "pending" ? "text-muted" : ""}`}>{s.label}</div>
                {s.status === "running" && (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunken">
                    <motion.div className="h-full rounded-full bg-accent" animate={{ width: `${Math.max(4, s.progress * 100)}%` }} transition={{ ease: "linear", duration: 0.4 }} />
                  </div>
                )}
                {s.status === "failed" && s.error && <div className="mt-1 text-sm text-danger">{s.error}</div>}
              </div>
            </div>
          ))}
          {steps.length === 0 && <div className="flex items-center gap-3 px-5 py-4 text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Connecting…</div>}
        </div>

        {!failed ? (
          <p className="mt-5 text-sm text-muted">
            {eta > 0 ? `Roughly ${formatDuration(eta)} to go. ` : ""}You can go back to your songs; this keeps running in the background.
          </p>
        ) : (
          <div className="mt-5 space-y-3">
            {snap?.error && !steps.some((s) => s.error) && <p className="text-sm text-danger">{snap.error}</p>}
            <button className="btn btn-primary" onClick={retry} disabled={retrying}>
              {retrying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Try again
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
