"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Check, HelpCircle, Loader2, Maximize2, Minimize2, Pencil, Redo2, Settings2, Undo2 } from "lucide-react";
import { api, isCatalogSong } from "@/lib/api";
import { AudioEngine, type EngineState } from "@/lib/audio";
import { buildDisplayLines, currentLineIndex, type DisplayLine } from "@/lib/display";
import { getInstrument } from "@/lib/instruments";
import { describeNote, keyName, resolveOctaveShift, type DisplayNote } from "@/lib/notes";
import { useCountInPref, useInstrumentPref } from "@/lib/prefs";
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
  const [engineState, setEngineState] = useState<EngineState>({ playing: false, loading: true, countingIn: null, ready: false, error: null });
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
    return () => { unsub(); engine.destroy(); engineRef.current = null; };
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
    const t = setTimeout(async () => { setKeyLoading(true); await engine.setKeyShift(session.key_shift); setKeyLoading(false); }, 350);
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
  const outOfRangeCount = useMemo(() => [...noteInfo.values()].filter((n) => n.outOfRange).length, [noteInfo]);
  // the note coming up next (shown in the fingering hint between notes)
  const nextNoteInfo = useMemo(() => {
    const next = song.notes.filter((n) => n.start >= time).sort((a, b) => a.start - b.start)[0];
    return next ? noteInfo.get(next.id) ?? null : null;
  }, [song.notes, time, noteInfo]);

  // ---- time tracking (only re-render when something visible changes) ----
  const [cursor, setCursor] = useState<{ line: number; word: string | null; note: string | null }>({ line: 0, word: null, note: null });
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
          let line = currentLineIndex(lines, t);
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
          setCursor((c) => (c.line === line && c.word === word && c.note === note ? c : { line, word, note }));
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [lines]);

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
        case "e": case "E": setEditing((v) => !v); break;
        case "?": setHelpOpen((v) => !v); break;
        case "Escape": setHelpOpen(false); setSettingsOpen(false); setFocus(false); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [togglePlay, skipLine, loopCurrentLine, update, session.key_shift]);

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

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg">
      {/* Top bar */}
      <AnimatePresence initial={false}>
        {!focus && (
          <motion.header initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -20, opacity: 0 }} className="no-print flex items-center gap-2 px-3 py-2 sm:px-5">
            <Link href={backHref} className="btn btn-ghost btn-icon" aria-label={catalog ? "Back to Discover" : "Back to my songs"}><ArrowLeft className="h-5 w-5" /></Link>
            <div className="min-w-0 flex-1">
              <div className="truncate font-display text-base font-bold leading-tight sm:text-lg">{song.title}</div>
              <div className="truncate text-xs text-muted">{song.artist ?? ""}{song.artist && song.key ? " · " : ""}{song.key ? keyName(song.key, session.key_shift) : ""}{session.key_shift !== 0 ? ` (${session.key_shift > 0 ? "+" : ""}${session.key_shift})` : ""}</div>
            </div>
            {editing ? (
              <div className="flex items-center gap-1">
                <span className="mr-2 hidden text-xs text-muted sm:inline">{saveState === "saving" ? "Saving…" : saveState === "saved" ? <span className="inline-flex items-center gap-1"><Check className="h-3 w-3" /> Saved</span> : "Click a note to move it, a word to fix it or add a note"}</span>
                <button className="btn btn-ghost btn-icon" onClick={undo} disabled={undoStack.current.length === 0} title="Undo"><Undo2 className="h-5 w-5" /></button>
                <button className="btn btn-ghost btn-icon" onClick={redo} disabled={redoStack.current.length === 0} title="Redo"><Redo2 className="h-5 w-5" /></button>
                <button className="btn btn-primary" onClick={() => { setEditing(false); setNoteAnchor(null); setWordAnchor(null); }}><Check className="h-4 w-4" /> Done</button>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <button className="btn hidden sm:inline-flex" onClick={() => setSettingsOpen(true)} title="Change instrument">
                  <span className="text-accent-strong"><InstrumentIcon icon={instrument.icon} className="h-5 w-5" /></span> {instrument.name}
                </button>
                <button className="btn btn-ghost btn-icon" onClick={() => setEditing(true)} title="Fix notes or words (E)" aria-label="Edit"><Pencil className="h-5 w-5" /></button>
                <button className="btn btn-ghost btn-icon" onClick={() => setFocus(true)} title="Focus mode (F)" aria-label="Focus mode"><Maximize2 className="h-5 w-5" /></button>
                <button className="btn btn-ghost btn-icon" onClick={() => setHelpOpen(true)} title="Help (?)" aria-label="Help"><HelpCircle className="h-5 w-5" /></button>
                <ThemeToggle />
                <button className={`btn btn-icon ${settingsOpen ? "bg-sunken" : ""}`} onClick={() => setSettingsOpen((v) => !v)} title="Settings" aria-label="Settings"><Settings2 className="h-5 w-5" /></button>
              </div>
            )}
          </motion.header>
        )}
      </AnimatePresence>

      {/* Stage */}
      <main className={`relative min-h-0 flex-1 transition-[margin] ${settingsOpen && !focus ? "lg:mr-[22rem]" : ""}`}>
        <LyricStage
          lines={lines} currentLine={cursor.line} currentWordId={cursor.word} currentNoteId={cursor.note} time={time}
          noteInfo={noteInfo} script={session.script} editing={editing}
          onNoteClick={(id, el) => { setWordAnchor(null); setNoteAnchor({ id, el }); }}
          onWordClick={(word, el) => { setNoteAnchor(null); setWordAnchor({ word, el }); }}
          onAddNote={addNote}
          onLineClick={seekToLine}
        />
        {/* overlays */}
        <AnimatePresence>
          {engineState.countingIn !== null && (
            <motion.div key={engineState.countingIn} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 1.3, opacity: 0 }} className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="grid h-40 w-40 place-items-center rounded-full bg-accent font-display text-7xl font-extrabold text-accent-fg shadow-card">{engineState.countingIn}</div>
            </motion.div>
          )}
        </AnimatePresence>
        {(engineState.loading || keyLoading) && engineState.countingIn === null && (
          <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-elev px-4 py-2 text-sm shadow-card"><span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin text-accent" /> {keyLoading ? "Preparing the new key…" : "Loading…"}</span></div>
        )}
        {busy && (
          <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-elev px-4 py-2 text-sm shadow-card"><span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin text-accent" /> {busy}</span></div>
        )}
        {engineState.error && <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-danger-soft px-4 py-2 text-sm text-danger">{engineState.error}</div>}
        {toast && <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-elev px-4 py-2 text-sm shadow-card">{toast}</div>}
        {focus && (
          <button className="absolute right-4 top-4 btn btn-ghost btn-icon opacity-40 hover:opacity-100" onClick={() => setFocus(false)} title="Leave focus mode (F)" aria-label="Leave focus mode"><Minimize2 className="h-5 w-5" /></button>
        )}
        {showFingering && !editing && (
          <div className="absolute bottom-3 left-3 hidden sm:block">
            <FingeringHint note={(cursor.note ? noteInfo.get(cursor.note) : nextNoteInfo) ?? null} />
          </div>
        )}
        {!focus && outOfRangeCount > 0 && !editing && (
          <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 text-xs text-muted">
            <span className="text-danger">{outOfRangeCount}</span> {outOfRangeCount === 1 ? "note is" : "notes are"} outside your instrument&apos;s range · ▲ upper register · ▼ lower register
          </div>
        )}
      </main>

      {/* Transport */}
      <div className={`transition-[margin] ${settingsOpen && !focus ? "lg:mr-[22rem]" : ""}`}>
        <Transport
          playing={engineState.playing || engineState.countingIn !== null}
          loading={!engineState.ready}
          duration={song.duration}
          getTime={() => engineRef.current?.currentTime ?? 0}
          lines={lines}
          loop={session.loop}
          onToggle={togglePlay}
          onSeek={(t) => { engineRef.current?.seek(t); manualLine.current = null; }}
          onLoop={(loop) => update({ loop })}
          focus={focus}
        />
      </div>

      <SettingsPanel
        open={settingsOpen && !focus} onClose={() => setSettingsOpen(false)} song={song} session={session} update={update}
        countIn={countIn} setCountIn={setCountIn} busy={busy} keyLoading={keyLoading}
        fingering={fingeringPref === "1"} setFingering={(v) => setFingeringPref(v ? "1" : "0")}
        onDetailLevel={(level) => runStep("Updating the notes…", "cleanup", { detail_level: level })}
        onLanguage={(lang) => runStep("Reading the lyrics again…", "lyrics", { language: lang })}
        onPasteLyrics={async (text) => { setBusy("Lining up your lyrics…"); try { setSong(await api.pasteLyrics(song.id, text)); } finally { setBusy(null); } }}
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
