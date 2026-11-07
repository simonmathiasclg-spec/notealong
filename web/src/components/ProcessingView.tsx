"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertCircle, ArrowLeft, Check, Compass, Loader2, RotateCcw, Square } from "lucide-react";
import { api, formatDuration } from "@/lib/api";
import type { ProgressSnapshot, Song } from "@/lib/types";
import { AppHeader } from "./AppHeader";

const PLAIN: Record<string, { label: string; detail: string }> = {
  stems: { label: "Separating the singer from the band", detail: "This is the slow part, usually two to four minutes." },
  melody: { label: "Finding the notes of the melody", detail: "Listening to the voice on its own." },
  lyrics: { label: "Reading the words", detail: "So each note can sit above the right word." },
  attach: { label: "Lining it all up", detail: "Almost there." },
};

export function ProcessingView({ song, onReady }: { song: Song; onReady: () => void }) {
  const [snap, setSnap] = useState<ProgressSnapshot | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [startedAt] = useState(() => Date.now());
  const [firstEta, setFirstEta] = useState<number | null>(null);   // the first estimate we were given, to notice when a job runs far past it
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(t); }, []);

  useEffect(() => {
    let stop = () => {};
    let cancelled = false;
    const start = () => {
      const onSnap = (p: ProgressSnapshot) => {
        if (p.estimated_seconds_left > 0) setFirstEta((v) => v ?? p.estimated_seconds_left);
        setSnap(p);
      };
      stop = api.progressStream(song.id, onSnap, async () => {
        if (cancelled) return;
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
  const elapsed = (now - startedAt) / 1000;
  const slow = status === "processing" && firstEta !== null && elapsed > Math.max(120, firstEta * 2.5);
  const steps = snap?.steps ?? [];
  const eta = snap?.estimated_seconds_left ?? 0;
  const failed = status === "failed";
  const done = steps.filter((s) => s.status === "done").length;
  const overall = steps.length ? (done + (steps.find((s) => s.status === "running")?.progress ?? 0)) / steps.length : 0;

  const retry = async () => {
    setRetrying(true);
    try { await api.rerun(song.id, "retry"); } finally { setRetrying(false); }
  };
  const stop = async () => {
    setStopping(true);
    try { await api.stopJob(song.id); } finally { setStopping(false); }
  };

  return (
    <div className="spotlight flex min-h-full flex-col">
      <AppHeader right={<Link href="/my-songs" className="btn btn-ghost"><ArrowLeft className="h-4 w-4" /> My songs</Link>} />
      <main className="mx-auto w-full max-w-xl flex-1 px-5 py-8 sm:py-12">
        <div className="label mb-2">{failed ? "Something went wrong" : "Getting your song ready"}</div>
        <h1 className="display-lg text-[2.2rem]">{song.title}</h1>
        {song.artist && <p className="mt-1 text-muted">{song.artist}</p>}

        {!failed && (
          <div className="mt-8" aria-label="Overall progress">
            <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
              <motion.div className="h-full rounded-full bg-accent" animate={{ width: `${Math.max(2, overall * 100)}%` }} transition={{ ease: "linear", duration: 0.5 }} />
            </div>
            <div className="mt-2 flex justify-between text-xs text-muted">
              <span>{status === "processing" ? (eta > 0 ? `About ${formatDuration(eta).replace("about ", "")} to go` : "Starting up…") : "Done"}</span>
              <span className="tabular">{Math.round(overall * 100)}%</span>
            </div>
          </div>
        )}

        <ol className="panel mt-6 divide-y divide-border">
          {steps.map((s) => {
            const plain = PLAIN[s.id] ?? { label: s.label, detail: "" };
            return (
              <li key={s.id} className="flex items-start gap-4 px-5 py-4">
                <div className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full ${s.status === "done" ? "bg-fg text-bg" : s.status === "running" ? "bg-accent-soft text-accent" : s.status === "failed" ? "bg-danger-soft text-danger" : "bg-sunken text-faint"}`}>
                  {s.status === "done" ? <Check className="h-3.5 w-3.5" /> : s.status === "running" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : s.status === "failed" ? <AlertCircle className="h-3.5 w-3.5" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className={`font-medium ${s.status === "pending" ? "text-muted" : ""}`}>{plain.label}</div>
                  {s.status === "running" && plain.detail && <div className="mt-0.5 text-sm text-muted">{plain.detail}</div>}
                  {s.status === "failed" && s.error && <div className="mt-1 text-sm text-danger">{s.error}</div>}
                </div>
              </li>
            );
          })}
          {steps.length === 0 && <li className="flex items-center gap-3 px-5 py-4 text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Connecting…</li>}
        </ol>

        {!failed ? (
          <div className="mt-6 space-y-3">
            {slow && (
              <p className="text-sm leading-relaxed text-muted" role="status">
                This is taking longer than expected. It usually means the computer is busy with something else. You can keep waiting, or stop and try again later.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/" className="btn"><Compass className="h-4 w-4" /> Play something from Discover while you wait</Link>
              <button className="btn btn-ghost" onClick={stop} disabled={stopping || status !== "processing"}>{stopping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />} Stop</button>
              <span className="text-sm text-muted">This keeps running in the background.</span>
            </div>
          </div>
        ) : (
          <div className="mt-6 space-y-3">
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
