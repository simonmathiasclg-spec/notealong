"use client";
import { useEffect, useRef, useState } from "react";
import { Loader2, Repeat, X } from "lucide-react";
import { PauseGlyph, PlayGlyph, SkipBackGlyph, SkipForwardGlyph } from "../art/Glyphs";
import { AnimatePresence, motion } from "framer-motion";
import { formatTime } from "@/lib/api";
import type { DisplayLine } from "@/lib/display";
import { clampIntoLoop, loopLabel, moveLoopEdge, stepLoopEdge, type Loop } from "@/lib/loop";
import type { Instrument } from "@/lib/instruments";
import type { SamplerState } from "@/lib/sampler";
import { InstrumentIcon } from "../InstrumentIcon";

type Props = {
  playing: boolean;
  countingIn: boolean;
  loading: boolean;
  duration: number;
  getTime: () => number;
  lines: DisplayLine[];
  loop: Loop | null;
  speed: number;
  onToggle: () => void;
  /** A jump made by hand on the bar. */
  onSeek: (t: number) => void;
  onSkip: (dir: 1 | -1) => void;
  onLoop: (loop: Loop | null) => void;
  /** The loop button: loops the line being sung, or ends the loop. */
  onLoopToggle: () => void;
  onSpeed: (speed: number) => void;
  focus: boolean;
  /** The one-time tip that points at the loop button. */
  loopHint: boolean;
  onDismissLoopHint: () => void;
  /** "Hear it played": the melody on a sampled instrument along with the song. */
  hear: boolean;
  hearState: SamplerState;
  onHear: () => void;
  instrument: Instrument;
};

const SPEEDS = [1, 0.75, 0.5];

/** The bottom of the stage: a thin "string" of progress with line marks, and the controls under it. */
export function Transport({ playing, countingIn, loading, duration, getTime, lines, loop, speed, onToggle, onSeek, onSkip, onLoop, onLoopToggle, onSpeed, focus, loopHint, onDismissLoopHint, hear, hearState, onHear, instrument }: Props) {
  const fillRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  // Scrubbing: while a finger or the mouse is down on the bar, the playhead follows it.
  const scrub = useRef<{ t: number; sent: number } | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  // Dragging a loop handle: the loop is redrawn at once and saved when the handle is let go.
  const [draft, setDraft] = useState<Loop | null>(null);
  const handle = useRef<{ edge: "start" | "end"; offset: number } | null>(null);
  const [dragEdge, setDragEdge] = useState<"start" | "end" | null>(null);
  const shown = draft ?? loop;

  // Cheap DOM updates every frame, no React re-render.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const t = scrub.current ? scrub.current.t : getTime();
      const pct = duration ? (t / duration) * 100 : 0;
      if (fillRef.current) fillRef.current.style.width = `${pct}%`;
      if (headRef.current) headRef.current.style.left = `${pct}%`;
      if (timeRef.current) timeRef.current.textContent = formatTime(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getTime, duration]);

  const timeAt = (clientX: number) => {
    const r = barRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(duration, ((clientX - r.left) / r.width) * duration));
  };
  // The bar only ever moves the playhead: a click jumps, a drag scrubs. It never makes a loop.
  const scrubTo = (e: React.PointerEvent, force: boolean) => {
    const t = clampIntoLoop(timeAt(e.clientX), loop);
    const sent = scrub.current?.sent ?? -1e9;
    // the audio follows a few times a second, the head every frame
    const send = force || e.timeStamp - sent > 60;
    scrub.current = { t, sent: send ? e.timeStamp : sent };
    if (send) onSeek(t);
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button > 0 || !duration) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setScrubbing(true);
    scrubTo(e, true);
  };
  const onPointerMove = (e: React.PointerEvent) => { if (scrub.current) scrubTo(e, false); };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!scrub.current) return;
    scrubTo(e, true);
    scrub.current = null;
    setScrubbing(false);
  };

  // The two loop handles.
  const onHandleDown = (edge: "start" | "end") => (e: React.PointerEvent) => {
    if (e.button > 0 || !loop) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const r = barRef.current!.getBoundingClientRect();
    const edgeX = r.left + ((edge === "start" ? loop[0] : loop[1]) / duration) * r.width;
    handle.current = { edge, offset: edgeX - e.clientX };
    setDragEdge(edge);
    setDraft(loop);
  };
  const onHandleMove = (e: React.PointerEvent) => {
    const h = handle.current;
    if (!h || !loop) return;
    e.stopPropagation();
    setDraft(moveLoopEdge(lines, draft ?? loop, h.edge, timeAt(e.clientX + h.offset), e.altKey, duration));
  };
  const onHandleUp = (e: React.PointerEvent) => {
    if (!handle.current) return;
    e.stopPropagation();
    handle.current = null;
    setDragEdge(null);
    if (draft && loop && (draft[0] !== loop[0] || draft[1] !== loop[1])) {
      onLoop(draft);
      const t = getTime();
      if (t < draft[0] || t > draft[1]) onSeek(draft[0]);
    }
    setDraft(null);
  };
  const onHandleKey = (edge: "start" | "end") => (e: React.KeyboardEvent) => {
    if (!loop || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    e.preventDefault(); e.stopPropagation();
    const dir = e.key === "ArrowRight" ? 1 : -1;
    const next = e.altKey
      ? moveLoopEdge(lines, loop, edge, (edge === "start" ? loop[0] : loop[1]) + dir * 0.25, true, duration)
      : stepLoopEdge(lines, loop, edge, dir, duration);
    if (next[0] !== loop[0] || next[1] !== loop[1]) onLoop(next);
  };
  const nextSpeed = () => onSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] ?? 1);
  const label = shown ? loopLabel(lines, shown, duration) : "";
  const pct = (t: number) => `${duration ? (t / duration) * 100 : 0}%`;

  return (
    <div className={`no-print mx-auto w-full max-w-6xl px-5 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-10 ${focus ? "pt-2" : "pt-0"}`}>
      <AnimatePresence initial={false}>
        {shown && (
          <motion.div key="loop-chip" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0, transition: { duration: 0.16, ease: "easeOut" } }} transition={{ type: "spring", stiffness: 420, damping: 36 }} className="flex justify-center overflow-hidden">
            <div className="loop-chip" role="status">
              <Repeat className="h-[14px] w-[14px] shrink-0" strokeWidth={2.2} aria-hidden="true" />
              <span>Looping: <span className="tabular">{label}</span></span>
              <button onClick={() => onLoop(null)} aria-label="Stop looping" data-tip="Stop looping (Esc)"><X className="h-[15px] w-[15px]" strokeWidth={2.2} /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {!focus && (
        <div className="flex items-center gap-4">
          <span className="tabular w-11 shrink-0 text-[12px] tracking-[0.04em] text-muted" ref={timeRef}>0:00</span>
          <div
            ref={barRef}
            className="group relative h-8 flex-1 cursor-pointer touch-none select-none"
            data-scrubbing={scrubbing ? "1" : undefined}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { scrub.current = null; setScrubbing(false); }}
            role="slider" aria-label="Position in the song" aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(getTime())}
          >
            <div className="string absolute inset-x-0 top-1/2 -translate-y-1/2">
              <div ref={fillRef} className="fill" style={{ width: 0 }} />
              {duration > 0 && lines.filter((l) => l.kind === "lyric").map((l) => (
                <span key={l.index} className="tick" style={{ left: `${(l.start / duration) * 100}%` }} />
              ))}
              {shown && duration > 0 && (
                <div className="loop" style={{ left: pct(shown[0]), width: pct(shown[1] - shown[0]) }} />
              )}
              <div ref={headRef} className="head" style={{ left: 0 }} />
            </div>
            {shown && duration > 0 && (["start", "end"] as const).map((edge) => (
              <div
                key={edge}
                className="loop-handle" data-edge={edge} data-dragging={dragEdge === edge ? "1" : undefined}
                style={{ left: pct(edge === "start" ? shown[0] : shown[1]) }}
                role="slider" tabIndex={0}
                aria-label={edge === "start" ? "Start of the loop" : "End of the loop"}
                aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(edge === "start" ? shown[0] : shown[1])}
                aria-valuetext={formatTime(edge === "start" ? shown[0] : shown[1])}
                data-tip={edge === "start" ? "Drag to move where the loop starts. Hold Alt to move it freely" : "Drag to move where the loop ends. Hold Alt to move it freely"}
                onPointerDown={onHandleDown(edge)} onPointerMove={onHandleMove} onPointerUp={onHandleUp} onPointerCancel={() => { handle.current = null; setDragEdge(null); setDraft(null); }}
                onKeyDown={onHandleKey(edge)}
              />
            ))}
          </div>
          <span className="tabular w-11 shrink-0 text-right text-[12px] tracking-[0.04em] text-muted">{formatTime(duration)}</span>
        </div>
      )}
      <div className="relative mt-1 flex items-center justify-center gap-1 sm:gap-2">
        {!focus && (
          <div className="flex items-center gap-1 max-sm:mr-auto sm:absolute sm:left-0">
            <div className="relative">
              <button
                className={`btn btn-icon ${loop ? "!bg-[var(--accent)] !text-[var(--accent-fg)]" : "btn-ghost"}`}
                onClick={onLoopToggle} aria-pressed={!!loop}
                aria-label={loop ? "Stop looping" : "Loop this line"}
                data-tip={loop ? `Looping ${label}. Click to stop (L)` : "Loop the line you're on (L). Then drag the two handles on the bar to loop more"}
              >
                <Repeat className="h-[17px] w-[17px]" strokeWidth={loop ? 2.2 : 1.6} />
              </button>
              <AnimatePresence>
                {loopHint && !loop && (
                  <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} transition={{ type: "spring", stiffness: 380, damping: 30, delay: 0.6 }} className="loop-hint" role="note">
                    <span>Tip: tap <Repeat className="mx-0.5 inline h-[14px] w-[14px] align-[-2px]" strokeWidth={2.2} aria-label="the loop button" /> to loop the line you&rsquo;re on.</span>
                    <button onClick={onDismissLoopHint} aria-label="Got it, hide this tip"><X className="h-[15px] w-[15px]" strokeWidth={2} /></button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <button className={`btn btn-ghost tabular px-3 ${speed < 1 ? "!text-accent" : ""}`} onClick={nextSpeed} aria-pressed={speed < 1} aria-label={`Speed ${Math.round(speed * 100)} percent, click to change`} data-tip={speed < 1 ? "Click for the next speed" : "Slow the song down without changing the notes"}>
              {speed < 1 ? `${Math.round(speed * 100)}%` : "Slower"}
            </button>
          </div>
        )}
        {!focus && <button className="btn btn-ghost btn-icon" onClick={() => onSkip(-1)} aria-label="Previous line" data-tip="Previous line (←)"><SkipBackGlyph className="h-[18px] w-[18px]" /></button>}
        <PlayRing playing={playing} countingIn={countingIn} loading={loading} onToggle={onToggle} getTime={getTime} duration={duration} />
        {!focus && <button className="btn btn-ghost btn-icon" onClick={() => onSkip(1)} aria-label="Next line" data-tip="Next line (→)"><SkipForwardGlyph className="h-[18px] w-[18px]" /></button>}
        {!focus && (
          <button
            className={`btn max-sm:ml-auto sm:absolute sm:right-0 ${hear ? "!bg-[var(--accent)] !text-[var(--accent-fg)]" : "btn-outline"}`}
            onClick={onHear} aria-pressed={hear}
            aria-label={`Hear it played on the ${instrument.name.toLowerCase()}`}
            data-tip={hear ? (hearState === "loading" ? "Loading the sound…" : `Playing the notes on the ${instrument.name.toLowerCase()}. Click to stop (H)`) : `Hear how the notes sound on the ${instrument.name.toLowerCase()}, along with the song (H)`}
          >
            {hear && hearState === "loading" ? <Loader2 className="h-[17px] w-[17px] animate-spin" /> : <InstrumentIcon icon={instrument.icon} className="h-[17px] w-[17px]" />}
            <span className="hidden md:inline">Hear it played</span>
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The play button inside a ring that fills as the song goes on (the round widget's progress arc). The ring
 * breathes while counting in.
 */
function PlayRing({ playing, countingIn, loading, onToggle, getTime, duration }: { playing: boolean; countingIn: boolean; loading: boolean; onToggle: () => void; getTime: () => number; duration: number }) {
  const arc = useRef<SVGCircleElement>(null);
  const C = 2 * Math.PI * 37;
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const p = duration ? Math.min(1, getTime() / duration) : 0;
      if (arc.current) arc.current.style.strokeDashoffset = String(C * (1 - p));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getTime, duration, C]);
  return (
    <motion.button
      onClick={onToggle}
      disabled={loading}
      aria-label={playing ? "Pause" : "Play"}
      whileTap={{ scale: 0.93 }}
      className="relative mx-2 grid h-[5.25rem] w-[5.25rem] shrink-0 place-items-center rounded-full disabled:opacity-50"
    >
      <svg viewBox="0 0 80 80" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="40" cy="40" r="37" fill="none" stroke="var(--border-strong)" strokeWidth="1.5" />
        <circle ref={arc} cx="40" cy="40" r="37" fill="none" stroke="var(--fg)" strokeWidth="2" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C} />
      </svg>
      {countingIn && <span className="absolute inset-[7px] animate-ping rounded-full bg-[var(--accent-soft)]" aria-hidden="true" />}
      <span className="relative grid h-[4.1rem] w-[4.1rem] place-items-center rounded-full bg-fg text-bg transition-transform duration-300 ease-out hover:scale-[1.04]">
        {playing ? <PauseGlyph className="h-6 w-6" /> : <PlayGlyph className="ml-1 h-6 w-6" />}
      </span>
    </motion.button>
  );
}
