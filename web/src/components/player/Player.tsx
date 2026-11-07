"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Check, HelpCircle, Loader2, Maximize2, Minimize2, Pencil, Redo2, SlidersHorizontal, Undo2 } from "lucide-react";
import { api, isCatalogSong } from "@/lib/api";
import { AudioEngine, type EngineState } from "@/lib/audio";
import { buildDisplayLines, currentLineIndex, type DisplayLine } from "@/lib/display";
import { getInstrument } from "@/lib/instruments";
import { describeNote, keyName, resolveOctaveShift, type DisplayNote } from "@/lib/notes";
import { useCountInPref, useInstrumentPref, useTheme } from "@/lib/prefs";
import { beatSeconds, cueAt, type Cue } from "@/lib/timing";
import { Sampler, type SamplerState } from "@/lib/sampler";
import { HearEngine, type HearNote } from "@/lib/hear";
import { accentFor, accentVars } from "@/lib/color";
import { cultureOf } from "@/lib/catalog";
import { downloadText, songToMusicXml } from "@/lib/musicxml";
import type { Note, Song, UserSession, Word } from "@/lib/types";
import { InstrumentIcon } from "../InstrumentIcon";
import { ThemeToggle } from "../AppHeader";
import { LyricStage } from "./LyricStage";
import { Transport } from "./Transport";
import { SettingsPanel } from "./SettingsPanel";
import { HelpOverlay } from "./HelpOverlay";
import { FingeringHint } from "./FingeringHint";
import { usePref } from "@/lib/prefs";
import { NotePopover, WordPopover, type Anchor } from "./EditPopover";

type Snapshot = { notes: Note[]; words: Word[] };

function instrumentIsSax(id: string) { return id.endsWith("_sax"); }

export function Player({ initial, reload }: { initial: Song; reload: () => Promise<void> }) {
  const [song, setSong] = useState<Song>(initial);
  const [session, setSession] = useState<UserSession>(initial.user);
  const [, setInstrumentPref] = useInstrumentPref();
  const [countIn, setCountIn] = useCountInPref();
  const [engineState, setEngineState] = useState<EngineState>({ playing: false, loading: true, countingIn: null, ready: false, error: null, shift: initial.user.key_shift });
  const [time, setTime] = useState(initial.user.position || 0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [focus, setFocus] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [keyLoading, setKeyLoading] = useState(false);
  const [fingeringPref, setFingeringPref] = usePref("na.fingering", "0");
  const showFingering = fingeringPref === "1" && instrumentIsSax(session.instrument);
  const [timingPref, setTimingPref] = usePref("na.timing", "1");
  const timing = timingPref !== "0";
  const [hearPref, setHearPref] = usePref("na.hear", "0");
  const [hearVolumePref, setHearVolumePref] = usePref("na.hearVolume", "0.8");
  const hear = hearPref === "1";
  const hearVolume = Number.isFinite(Number(hearVolumePref)) ? Number(hearVolumePref) : 0.8;
  // which instrument's recordings are loaded (or failed to load); "loading" is everything in between
  const [hearLoaded, setHearLoaded] = useState<{ instrument: string; ok: boolean } | null>(null);
  const samplerRef = useRef<Sampler | null>(null);
  const hearRef = useRef<HearEngine | null>(null);
  const engineRef = useRef<AudioEngine | null>(null);

  // ---- audio engine -------------------------------------------------------
  useEffect(() => {
    const engine = new AudioEngine((stem, shift) => api.audioUrl(song.id, stem, shift));
    engineRef.current = engine;
    const unsub = engine.subscribe(setEngineState);
    engine.setBackingVolume(session.backing_volume);
    engine.setGuideVolume(session.guide_vocal ? session.guide_volume : 0);
    engine.setSpeed(session.speed);
    engine.loop = session.loop;
    engine.load(session.key_shift).then(() => { if (session.position > 0 && session.position < song.duration - 5) engine.seek(session.position); });
    return () => { hearRef.current?.destroy(); hearRef.current = null; samplerRef.current = null; unsub(); engine.destroy(); engineRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song.id]);

  // keep engine in sync with session changes
  useEffect(() => { engineRef.current?.setSpeed(session.speed); }, [session.speed]);
  useEffect(() => { engineRef.current?.setBackingVolume(session.backing_volume); }, [session.backing_volume]);
  useEffect(() => { engineRef.current?.setGuideVolume(session.guide_vocal ? session.guide_volume : 0); }, [session.guide_vocal, session.guide_volume]);
  useEffect(() => { if (engineRef.current) engineRef.current.loop = session.loop; }, [session.loop]);
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !engineState.ready) return;
    const t = setTimeout(async () => {
      setKeyLoading(true);
      await engine.setKeyShift(session.key_shift);
      setKeyLoading(false);
      // the keys one step either way are rendered in the background now, so the next step is instant
      api.prepareKeys(song.id, session.key_shift).catch(() => undefined);
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.key_shift, engineState.ready]);

  // ---- persist the session (debounced) ---------------------------------
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const update = useCallback((patch: Partial<UserSession>) => {
    setSession((s) => {
      const next = { ...s, ...patch };
      if (patch.instrument) setInstrumentPref(patch.instrument);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => api.patchSong(song.id, { user: next }).catch(() => undefined), 600);
      return next;
    });
  }, [song.id, setInstrumentPref]);
  // remember the position every few seconds while playing
  useEffect(() => {
    if (!engineState.playing) return;
    const t = setInterval(() => update({ position: Math.floor(engineRef.current?.currentTime ?? 0) }), 5000);
    return () => clearInterval(t);
  }, [engineState.playing, update]);

  // ---- derived display data ------------------------------------------
  const lines = useMemo(() => buildDisplayLines(song), [song]);
  const instrument = getInstrument(session.instrument);
  const concertMidis = useMemo(() => song.notes.map((n) => n.midi), [song.notes]);
  const octaveShift = useMemo(() => resolveOctaveShift(session.octave, concertMidis, instrument, session.key_shift), [session.octave, concertMidis, instrument, session.key_shift]);
  const noteInfo = useMemo(() => {
    const m = new Map<string, DisplayNote>();
    const settings = { instrument: session.instrument, keyShift: session.key_shift, octave: session.octave, notation: session.notation };
    for (const n of song.notes) m.set(n.id, describeNote(n, settings, song.key, octaveShift));
    return m;
  }, [song.notes, song.key, session.instrument, session.key_shift, session.octave, session.notation, octaveShift]);
  // ---- hear it played: the melody on a sampled instrument, at sounding pitch ----
  // What the player's instrument will actually sound: concert pitch, moved with the key
  // (the key of the audio that is loaded) and the octave. The written transposition is for reading only.
  const hearNotes = useMemo<HearNote[]>(() => [...song.notes].sort((a, b) => a.start - b.start)
    .map((n) => ({ id: n.id, start: n.start, end: n.end, pitch: n.midi + engineState.shift + 12 * octaveShift })),
  [song.notes, engineState.shift, octaveShift]);
  const hearNotesRef = useRef(hearNotes);
  useEffect(() => { hearNotesRef.current = hearNotes; hearRef.current?.setNotes(hearNotes); }, [hearNotes]);
  useEffect(() => { samplerRef.current?.setVolume(hearVolume); }, [hearVolume]);
  useEffect(() => {
    const engine = engineRef.current;
    if (!hear || !engine) { hearRef.current?.setEnabled(false); return; }
    let cancelled = false;
    const instrumentId = session.instrument;
    (async () => {
      try {
        samplerRef.current ??= new Sampler(engine.audioContext());
        hearRef.current ??= new HearEngine(engine, samplerRef.current);
        const sampler = samplerRef.current, player = hearRef.current;
        sampler.setVolume(hearVolume);
        await sampler.use(instrumentId);
        if (cancelled) return;
        player.setNotes(hearNotesRef.current);
        player.setEnabled(true);
        setHearLoaded({ instrument: instrumentId, ok: true });
      } catch {
        if (cancelled) return;
        setHearLoaded({ instrument: instrumentId, ok: false });
        setToast("Could not load the instrument sound. Check your connection and try again.");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hear, session.instrument, song.id]);
  const hearState: SamplerState = !hear ? "idle" : hearLoaded?.instrument === session.instrument ? (hearLoaded.ok ? "ready" : "error") : "loading";
  const toggleHear = useCallback(() => {
    // browsers only let sound start from a click or a key press, so wake the audio here
    void engineRef.current?.audioContext().resume();
    setHearPref(hear ? "0" : "1");
  }, [hear, setHearPref]);

  const outOfRangeCount = useMemo(() => [...noteInfo.values()].filter((n) => n.outOfRange).length, [noteInfo]);
  // the note coming up next (shown in the fingering hint between notes)
  const nextNoteInfo = useMemo(() => {
    const next = song.notes.filter((n) => n.start >= time).sort((a, b) => a.start - b.start)[0];
    return next ? noteInfo.get(next.id) ?? null : null;
  }, [song.notes, time, noteInfo]);

  // ---- time tracking (only re-render when something visible changes) ----
  const [cursor, setCursor] = useState<{ line: number; word: string | null; note: string | null } & Cue>({ line: 0, word: null, note: null, cue: null, countNote: null, count: null });
  const beat = useMemo(() => beatSeconds(song.tempo_bpm), [song.tempo_bpm]);
  const sortedNotes = useMemo(() => [...song.notes].sort((a, b) => a.start - b.start), [song.notes]);
  const getSmoothTime = useCallback(() => engineRef.current?.smoothTime ?? 0, []);
  const manualLine = useRef<number | null>(null);
  useEffect(() => {
    let raf = 0;
    let lastT = -1;
    const tick = () => {
      const engine = engineRef.current;
      if (engine) {
        const t = engine.currentTime;
        if (Math.abs(t - lastT) > 0.03) {
          lastT = t;
          setTime(t);
          let line = currentLineIndex(lines, t, 0.3, Math.max(4, beat * 3 + 0.6));
          if (manualLine.current !== null) {
            const ml = lines[manualLine.current];
            if (ml && t >= ml.start - 0.3 && t <= ml.end + 1) line = manualLine.current; else manualLine.current = null;
          }
          const cur = lines[line];
          let word: string | null = null;
          let note: string | null = null;
          if (cur) {
            for (const it of cur.items) {
              if (it.word && t >= it.word.start && t < it.word.end) word = it.word.id;
              for (const n of it.notes) if (t >= n.start && t < n.end) note = n.id;
            }
          }
          const q = cueAt(sortedNotes, t, beat);
          setCursor((c) => (c.line === line && c.word === word && c.note === note && c.cue === q.cue && c.countNote === q.countNote && c.count === q.count ? c : { line, word, note, ...q }));
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [lines, sortedNotes, beat]);

  // ---- transport actions -------------------------------------------------
  const seekToLine = useCallback((line: DisplayLine) => {
    engineRef.current?.seek(Math.max(0, line.start - 0.15));
    manualLine.current = line.index;
    setCursor((c) => ({ ...c, line: line.index }));
  }, []);
  const togglePlay = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (engine.getState().playing || engine.getState().countingIn !== null) engine.pause();
    else engine.play(countIn ? { beats: 4, bpm: Math.min(140, Math.max(60, song.tempo_bpm ?? 100)) } : undefined);
  }, [countIn, song.tempo_bpm]);
  const skipLine = useCallback((dir: 1 | -1) => {
    const lyricLines = lines;
    if (!lyricLines.length) return;
    const idx = Math.max(0, Math.min(lyricLines.length - 1, cursor.line + dir));
    seekToLine(lyricLines[idx]);
  }, [lines, cursor.line, seekToLine]);
  const loopCurrentLine = useCallback(() => {
    const cur = lines[cursor.line];
    if (!cur) return;
    if (session.loop && Math.abs(session.loop[0] - (cur.start - 0.15)) < 0.01) { update({ loop: null }); return; }
    update({ loop: [Math.max(0, cur.start - 0.15), cur.end + 0.2] });
    engineRef.current?.seek(Math.max(0, cur.start - 0.15));
  }, [lines, cursor.line, session.loop, update]);

  // ---- keyboard shortcuts ---------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      if (noteAnchor) return; // the note popover owns the arrow keys
      switch (e.key) {
        case " ": e.preventDefault(); togglePlay(); break;
        case "ArrowLeft": e.preventDefault(); skipLine(-1); break;
        case "ArrowRight": e.preventDefault(); skipLine(1); break;
        case "ArrowUp": e.preventDefault(); update({ key_shift: Math.min(6, session.key_shift + 1) }); break;
        case "ArrowDown": e.preventDefault(); update({ key_shift: Math.max(-6, session.key_shift - 1) }); break;
        case "l": case "L": loopCurrentLine(); break;
        case "f": case "F": setFocus((f) => !f); break;
        case "h": case "H": toggleHear(); break;
        case "e": case "E": setEditing((v) => !v); break;
        case "?": setHelpOpen((v) => !v); break;
        case "Escape": setHelpOpen(false); setSettingsOpen(false); setFocus(false); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [togglePlay, skipLine, loopCurrentLine, update, session.key_shift, toggleHear]);

  // ---- editing -------------------------------------------------------
  const [noteAnchor, setNoteAnchor] = useState<(Anchor & { id: string }) | null>(null);
  const [wordAnchor, setWordAnchor] = useState<(Anchor & { word: Word }) | null>(null);
  const undoStack = useRef<Snapshot[]>([]);
  const redoStack = useRef<Snapshot[]>([]);
  const [, bump] = useState(0);
  const editTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");

  const commit = useCallback((fn: (s: Snapshot) => Snapshot) => {
    setSong((s) => {
      undoStack.current.push({ notes: s.notes, words: s.words });
      if (undoStack.current.length > 100) undoStack.current.shift();
      redoStack.current = [];
      const next = fn({ notes: s.notes, words: s.words });
      const updated = { ...s, notes: next.notes, words: next.words };
      if (editTimer.current) clearTimeout(editTimer.current);
      setSaveState("saving");
      editTimer.current = setTimeout(() => api.patchSong(s.id, { notes: next.notes, words: next.words }).then(() => setSaveState("saved")).catch(() => setToast("Could not save your edit. Is the service running?")), 700);
      bump((x) => x + 1);
      return updated;
    });
  }, []);
  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    setSong((s) => {
      redoStack.current.push({ notes: s.notes, words: s.words });
      api.patchSong(s.id, prev).catch(() => undefined);
      return { ...s, ...prev };
    });
    bump((x) => x + 1);
  }, []);
  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (!next) return;
    setSong((s) => {
      undoStack.current.push({ notes: s.notes, words: s.words });
      api.patchSong(s.id, next).catch(() => undefined);
      return { ...s, ...next };
    });
    bump((x) => x + 1);
  }, []);
  const moveNote = (id: string, delta: number) => commit((s) => ({ ...s, notes: s.notes.map((n) => (n.id === id ? { ...n, midi: n.midi + delta, edited: true } : n)) }));
  const deleteNote = (id: string) => { commit((s) => ({ ...s, notes: s.notes.filter((n) => n.id !== id) })); setNoteAnchor(null); };
  const addNote = (wordId: string | null, lineIndex: number) => commit((s) => {
    const word = wordId ? s.words.find((w) => w.id === wordId) : null;
    const siblings = s.notes.filter((n) => (wordId ? n.word === wordId : n.line === lineIndex && !n.word)).sort((a, b) => a.start - b.start);
    const last = siblings[siblings.length - 1];
    const ref = last ?? [...s.notes].reverse().find((n) => n.start <= (word?.start ?? time)) ?? s.notes[0];
    const start = last ? last.end : word ? word.start : time;
    const end = word ? Math.max(start + 0.1, word.end) : start + 0.3;
    // give the new note half of the last note's time if it would otherwise be empty
    let notes = s.notes;
    if (last && end - start < 0.1) {
      const mid = (last.start + last.end) / 2;
      notes = notes.map((n) => (n.id === last.id ? { ...n, end: mid } : n));
      return { ...s, notes: [...notes, { id: `n_${Date.now()}`, start: mid, end: last.end, midi: ref?.midi ?? 60, confidence: 1, word: wordId, line: lineIndex, edited: true }] };
    }
    return { ...s, notes: [...notes, { id: `n_${Date.now()}`, start, end, midi: ref?.midi ?? 60, confidence: 1, word: wordId, line: lineIndex, edited: true }] };
  });
  const editWord = (id: string, text: string) => commit((s) => ({ ...s, words: s.words.map((w) => (w.id === id ? { ...w, text } : w)) }));

  // ---- processing actions ----------------------------------------------
  const refreshSong = useCallback(async () => {
    const s = await api.getSong(song.id);
    setSong(s);
  }, [song.id]);
  const waitForReady = useCallback(async () => {
    for (let i = 0; i < 600; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const snap = await api.progressSnapshot(song.id);
      if (snap.status === "ready") return true;
      if (snap.status === "failed") throw new Error(snap.error ?? "Processing failed");
    }
    return false;
  }, [song.id]);
  const runStep = async (label: string, step: string, params: { detail_level?: string; language?: string }) => {
    setBusy(label);
    try {
      await api.rerun(song.id, step, params);
      await waitForReady();
      await refreshSong();
    } catch (e) { setToast((e as Error).message); }
    finally { setBusy(null); }
  };

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t); }, [toast]);
  useEffect(() => { if (saveState !== "saved") return; const t = setTimeout(() => setSaveState("idle"), 2000); return () => clearTimeout(t); }, [saveState]);

  const exportPdf = () => {
    const q = new URLSearchParams({ instrument: session.instrument, key: String(session.key_shift), octave: session.octave, notation: session.notation, script: session.script });
    window.open(`/songs/${song.id}/print?${q}`, "_blank");
  };
  const exportMusicXml = () => downloadText(`${song.title}.musicxml`, songToMusicXml(song, session.instrument, session.key_shift, octaveShift), "application/vnd.recordare.musicxml+xml");

  const editingNote = noteAnchor ? noteInfo.get(noteAnchor.id) : null;
  const catalog = isCatalogSong(song);
  const backHref = catalog ? "/" : "/my-songs";
  // The accent takes the song's own hue (from its cover art); uploads keep the default.
  const [theme] = useTheme();
  const accent = useMemo(() => accentFor(song.catalog?.accent_hue ?? null, theme === "light" ? "light" : "dark"), [song.catalog?.accent_hue, theme]);
  const subtitle = [
    song.catalog ? (song.artist === "Traditional" ? `Traditional${cultureOf(song.catalog) ? `, ${cultureOf(song.catalog)}` : ""}` : song.artist) : song.artist,
    song.key ? `${keyName(song.key, session.key_shift)}${session.key_shift !== 0 ? ` (${session.key_shift > 0 ? "+" : ""}${session.key_shift})` : ""}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="spotlight flex h-dvh flex-col overflow-hidden bg-bg" style={{ ...accentVars(accent), "--beat": `${(beat / session.speed).toFixed(3)}s` } as React.CSSProperties}>
      {/* Top bar */}
      <AnimatePresence initial={false}>
        {!focus && (
          <motion.header initial={{ y: -16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -16, opacity: 0 }} className="no-print flex items-center gap-3 px-3 py-3 sm:px-5">
            <Link href={backHref} className="btn btn-ghost btn-icon" aria-label={catalog ? "Back to Discover" : "Back to my songs"} data-tip={catalog ? "Discover" : "My songs"}><ArrowLeft className="h-5 w-5" /></Link>
            <div className="min-w-0 flex-1">
              <h1 className="display-md truncate text-[1.1rem] sm:text-[1.25rem]">{song.title}</h1>
              <div className="truncate text-[13px] text-muted">{subtitle}</div>
            </div>
            {editing ? (
              <div className="flex items-center gap-1">
                <span className="mr-2 hidden text-[13px] text-muted sm:inline" aria-live="polite">{saveState === "saving" ? "Saving…" : saveState === "saved" ? <span className="inline-flex items-center gap-1"><Check className="h-3.5 w-3.5" /> Saved</span> : "Click a note to move it, or a word to fix it"}</span>
                <button className="btn btn-ghost btn-icon" onClick={undo} disabled={undoStack.current.length === 0} aria-label="Undo" data-tip="Undo"><Undo2 className="h-5 w-5" /></button>
                <button className="btn btn-ghost btn-icon" onClick={redo} disabled={redoStack.current.length === 0} aria-label="Redo" data-tip="Redo"><Redo2 className="h-5 w-5" /></button>
                <button className="btn btn-primary" onClick={() => { setEditing(false); setNoteAnchor(null); setWordAnchor(null); }}><Check className="h-4 w-4" /> Done</button>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <button className="btn hidden sm:inline-flex" onClick={() => setSettingsOpen(true)} data-tip="Change instrument">
                  <span className="text-accent"><InstrumentIcon icon={instrument.icon} className="h-[18px] w-[18px]" /></span> {instrument.name}
                </button>
                <button className="btn btn-ghost btn-icon" onClick={() => setEditing(true)} data-tip="Fix notes or words (E)" aria-label="Fix notes or words"><Pencil className="h-[18px] w-[18px]" /></button>
                <button className="btn btn-ghost btn-icon" onClick={() => setFocus(true)} data-tip="Focus mode (F)" aria-label="Focus mode"><Maximize2 className="h-[18px] w-[18px]" /></button>
                <button className="btn btn-ghost btn-icon" onClick={() => setHelpOpen(true)} data-tip="How to read the screen (?)" aria-label="Help"><HelpCircle className="h-[18px] w-[18px]" /></button>
                <ThemeToggle />
                <button className={`btn btn-icon ${settingsOpen ? "bg-hover" : ""}`} onClick={() => setSettingsOpen((v) => !v)} data-tip="Settings" aria-label="Settings" aria-expanded={settingsOpen}><SlidersHorizontal className="h-[18px] w-[18px]" /></button>
              </div>
            )}
          </motion.header>
        )}
      </AnimatePresence>

      {/* Stage */}
      <main className={`relative min-h-0 flex-1 transition-[margin] duration-300 ${settingsOpen && !focus ? "lg:mr-[22.5rem]" : ""}`}>
        <LyricStage
          lines={lines} currentLine={cursor.line} currentWordId={cursor.word} currentNoteId={cursor.note} time={time}
          noteInfo={noteInfo} script={session.script} editing={editing}
          timing={timing} cue={cursor} beat={beat} getTime={getSmoothTime}
          onNoteClick={(id, el) => { setWordAnchor(null); setNoteAnchor({ id, el }); }}
          onWordClick={(word, el) => { setNoteAnchor(null); setWordAnchor({ word, el }); }}
          onAddNote={addNote}
          onLineClick={seekToLine}
        />
        {/* overlays */}
        <AnimatePresence>
          {engineState.countingIn !== null && (
            <motion.div key={engineState.countingIn} initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 1.25, opacity: 0 }} transition={{ type: "spring", stiffness: 500, damping: 30 }} className="pointer-events-none absolute inset-x-0 top-[6%] flex justify-center" aria-live="assertive">
              <div className="display-xl grid h-28 w-28 place-items-center rounded-full bg-accent text-[4rem] text-accent-fg shadow-[0_0_0_10px_var(--ring),0_20px_60px_rgba(0,0,0,.45)]">{engineState.countingIn}</div>
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {(((engineState.loading || keyLoading) && engineState.countingIn === null) || busy) && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="floating pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 px-4 py-2 text-sm" role="status">
              <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin text-accent" /> {busy ?? (keyLoading ? "Preparing the new key…" : "Loading…")}</span>
            </motion.div>
          )}
        </AnimatePresence>
        {engineState.error && <div className="floating absolute left-1/2 top-4 -translate-x-1/2 border-danger/40 px-4 py-2 text-sm text-danger" role="alert">{engineState.error}</div>}
        <AnimatePresence>
          {toast && <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className="floating absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 text-sm" role="status">{toast}</motion.div>}
        </AnimatePresence>
        {focus && (
          <button className="btn btn-ghost btn-icon absolute right-4 top-4 opacity-40 hover:opacity-100 focus-visible:opacity-100" onClick={() => setFocus(false)} data-tip="Leave focus mode (F)" aria-label="Leave focus mode"><Minimize2 className="h-5 w-5" /></button>
        )}
        {showFingering && !editing && (
          <div className="absolute bottom-3 left-3 hidden sm:block">
            <FingeringHint note={(cursor.note ? noteInfo.get(cursor.note) : nextNoteInfo) ?? null} />
          </div>
        )}
        {!focus && outOfRangeCount > 0 && !editing && (
          <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs text-muted">
            <span className="text-danger">{outOfRangeCount}</span> {outOfRangeCount === 1 ? "note is" : "notes are"} too high or low for the {instrument.name.toLowerCase()}. Try the octave or key settings.
          </div>
        )}
      </main>

      {/* Transport */}
      <div className={`transition-[margin] duration-300 ${settingsOpen && !focus ? "lg:mr-[22.5rem]" : ""}`}>
        <Transport
          playing={engineState.playing}
          countingIn={engineState.countingIn !== null}
          loading={!engineState.ready}
          duration={song.duration}
          getTime={() => engineRef.current?.currentTime ?? 0}
          lines={lines}
          loop={session.loop}
          speed={session.speed}
          onToggle={togglePlay}
          onSeek={(t) => { engineRef.current?.seek(t); manualLine.current = null; }}
          onSkip={skipLine}
          onLoop={(loop) => update({ loop })}
          onLoopLine={loopCurrentLine}
          onSpeed={(speed) => update({ speed })}
          focus={focus}
          hear={hear} hearState={hearState} onHear={toggleHear} instrument={instrument}
        />
      </div>

      <SettingsPanel
        open={settingsOpen && !focus} onClose={() => setSettingsOpen(false)} song={song} session={session} update={update}
        countIn={countIn} setCountIn={setCountIn} busy={busy} keyLoading={keyLoading}
        fingering={fingeringPref === "1"} setFingering={(v) => setFingeringPref(v ? "1" : "0")}
        timing={timing} setTiming={(v) => setTimingPref(v ? "1" : "0")}
        hear={hear} hearState={hearState} onHear={toggleHear} hearVolume={hearVolume} setHearVolume={(v) => setHearVolumePref(String(v))}
        onDetailLevel={(level) => runStep("Updating the notes…", "cleanup", { detail_level: level })}
        onLanguage={(lang) => runStep("Reading the words again…", "lyrics", { language: lang })}
        onPasteLyrics={async (text) => { setBusy("Lining up your words…"); try { setSong(await api.pasteLyrics(song.id, text)); } finally { setBusy(null); } }}
        onReprocess={async () => { await api.rerun(song.id, "all"); await reload(); }}
        onExportPdf={exportPdf} onExportMusicXml={exportMusicXml}
        catalog={song.catalog ?? null}
      />
      <HelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />

      <NotePopover anchor={noteAnchor} label={editingNote ? `${editingNote.label}${editingNote.octaveMark === "up" ? "▲" : editingNote.octaveMark === "down" ? "▼" : ""}` : ""}
        onUp={() => noteAnchor && moveNote(noteAnchor.id, 1)} onDown={() => noteAnchor && moveNote(noteAnchor.id, -1)}
        onDelete={() => noteAnchor && deleteNote(noteAnchor.id)} onClose={() => setNoteAnchor(null)} />
      <WordPopover anchor={wordAnchor} value={wordAnchor?.word.text ?? ""} onSave={(t) => wordAnchor && editWord(wordAnchor.word.id, t)}
        onAddNote={() => wordAnchor && addNote(wordAnchor.word.id, wordAnchor.word.line)} onClose={() => setWordAnchor(null)} />
    </div>
  );
}
