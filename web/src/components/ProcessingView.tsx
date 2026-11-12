"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
  const [round, setRound] = useState(0);     // a retry starts following the progress again
  const router = useRouter();
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
        // online version: the same recording was already in this user's songs, so that one opens instead
        if (p.duplicate_of) { router.replace(`/songs/${p.duplicate_of}`); return; }
        if (p.estimated_seconds_left > 0) setFirstEta((v) => v ?? p.estimated_seconds_left);
        setSnap(p);
      };
      stop = api.progressStream(song.id, onSnap, async () => {
        if (cancelled) return;
        try {
          const s = await api.progressSnapshot(song.id);
          if (s.duplicate_of) { router.replace(`/songs/${s.duplicate_of}`); return; }
          setSnap(s);
          if (s.status === "ready") onReady();
          else if (s.status === "processing") setTimeout(start, 2000);
        } catch { setTimeout(start, 3000); }
      });
    };
    start();
    return () => { cancelled = true; stop(); };
  }, [song.id, onReady, router, round]);

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
    try {
      setSnap(await api.rerun(song.id, "retry"));
      setRound((r) => r + 1);
    } catch (e) {
      setSnap((s) => (s ? { ...s, error: (e as Error).message } : s));
    } finally { setRetrying(false); }
  };
  const stop = async () => {
    setStopping(true);
    try { await api.stopJob(song.id); } finally { setStopping(false); }
  };

  const C = 2 * Math.PI * 47;
  return (
    <div className="flex min-h-full flex-col">
      <AppHeader right={<Link href="/my-songs" className="btn btn-ghost"><ArrowLeft className="h-4 w-4" strokeWidth={1.6} /> My songs</Link>} />
      <main className="mx-auto grid w-full max-w-5xl flex-1 items-center gap-10 px-5 py-8 sm:px-8 md:grid-cols-[18rem_1fr] md:gap-16 md:py-12">
        {/* the round widget: the song's artwork in a ring that fills as the work gets done */}
        <div className="relative mx-auto aspect-square w-56 md:w-full" aria-label="Overall progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(overall * 100)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={api.uploadCoverUrl(song.id)} alt="" className={`absolute inset-[9%] h-[82%] w-[82%] rounded-full object-cover ${failed ? "grayscale" : status === "processing" ? "animate-[spin_24s_linear_infinite]" : ""}`} />
          <span className="grain absolute inset-[9%] rounded-full" aria-hidden="true" />
          <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden="true">
            <circle cx="50" cy="50" r="47" fill="none" stroke="var(--border-strong)" strokeWidth="0.8" />
            {!failed && <motion.circle cx="50" cy="50" r="47" fill="none" stroke="var(--fg)" strokeWidth="1.4" strokeLinecap="round" strokeDasharray={C}
              animate={{ strokeDashoffset: C * (1 - Math.max(0.02, overall)) }} transition={{ ease: [0.22, 1, 0.36, 1], duration: 0.8 }} />}
          </svg>
          <span className="tabular absolute inset-x-0 -bottom-8 text-center text-[13px] text-muted">{failed ? "Stopped" : `${Math.round(overall * 100)}%`}</span>
        </div>

        <div className="min-w-0">
          <p className="text-[13px] font-medium text-muted">{failed ? "Something went wrong" : "Getting your song ready"}</p>
          <h1 className="display-xl mt-2 text-[clamp(2.4rem,5vw,4rem)]">{song.title}</h1>
          {song.artist && <p className="mt-2 text-[15px] text-muted">{song.artist}</p>}
          {!failed && <p className="mt-4 text-[14px] text-fg">{status === "processing" ? (eta > 0 ? `About ${formatDuration(eta).replace("about ", "")} to go.` : "Starting up…") : "Done."} <span className="text-muted">It keeps going if you leave this page.</span></p>}

          <ol className="mt-8 border-t border-border">
            {steps.map((s, i) => {
              const plain = PLAIN[s.id] ?? { label: s.label, detail: "" };
              return (
                <li key={s.id} className="grid grid-cols-[2rem_1fr_auto] items-start gap-3 border-b border-border py-3.5">
                  <span className={`tabular pt-0.5 text-[11px] ${s.status === "pending" ? "text-faint" : "text-muted"}`}>{String(i + 1).padStart(2, "0")}</span>
                  <span className="min-w-0">
                    <span className={`block font-medium ${s.status === "pending" ? "text-faint" : ""}`}>{plain.label}</span>
                    {s.status === "running" && plain.detail && <span className="mt-0.5 block text-[13px] text-muted">{plain.detail}</span>}
                    {s.status === "failed" && s.error && <span className="mt-1 block text-[13px] text-danger">{s.error}</span>}
                  </span>
                  <span className={`pt-0.5 ${s.status === "done" ? "text-fg" : s.status === "running" ? "text-fg" : s.status === "failed" ? "text-danger" : "text-faint"}`}>
                    {s.status === "done" ? <Check className="h-4 w-4" strokeWidth={2} /> : s.status === "running" ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} /> : s.status === "failed" ? <AlertCircle className="h-4 w-4" strokeWidth={1.8} /> : null}
                  </span>
                </li>
              );
            })}
            {steps.length === 0 && <li className="flex items-center gap-3 border-b border-border py-4 text-muted"><Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} /> Connecting…</li>}
          </ol>

          {!failed ? (
            <div className="mt-7 space-y-3">
              {slow && (
                <p className="text-[14px] leading-relaxed text-muted" role="status">
                  This is taking longer than expected. It usually means the computer is busy with something else. You can keep waiting, or stop and try again later.
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Link href="/" className="btn btn-primary"><Compass className="h-4 w-4" strokeWidth={1.7} /> Play something while you wait</Link>
                <button className="btn btn-ghost" onClick={stop} disabled={stopping || status !== "processing"}>{stopping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-3.5 w-3.5" strokeWidth={2} />} Stop</button>
              </div>
            </div>
          ) : (
            <div className="mt-7 space-y-3">
              {snap?.error && !steps.some((s) => s.error) && <p className="text-[14px] text-danger">{snap.error}</p>}
              <button className="btn btn-primary btn-lg" onClick={retry} disabled={retrying}>
                {retrying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" strokeWidth={1.8} />} Try again
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
