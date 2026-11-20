"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Check, HelpCircle, Info, Loader2, Maximize2, Minimize2, Music2, Pencil, Redo2, SlidersHorizontal, Type, Undo2 } from "lucide-react";
import { Suspense } from "react";
import { api, formatTime, isCatalogSong } from "@/lib/api";
import { AudioEngine, type EngineState } from "@/lib/audio";
import { buildDisplayLines, currentLineIndex, unsureLines, type DisplayLine } from "@/lib/display";
import { extendLoopToLine, linesInLoop, loopForLines, LOOP_LEAD } from "@/lib/loop";
import { getInstrument } from "@/lib/instruments";
import { describeNote, keyName, resolveOctaveShift, type DisplayNote } from "@/lib/notes";
import { useCountInPref, useInstrumentPref, useTheme } from "@/lib/prefs";
import { beatSeconds, cueAt, type Cue } from "@/lib/timing";
import { Sampler, type SamplerState } from "@/lib/sampler";
import { HearEngine, phrase, type HearNote } from "@/lib/hear";
import { API } from "@/lib/api";
import { CLOUD } from "@/lib/cloud/config";
import { accentFromArt, accentVars, artVars } from "@/lib/color";
import { cultureOf } from "@/lib/catalog";
import { downloadText, sheetToMusicXml, songToMusicXml, writtenSpelling } from "@/lib/musicxml";
import { buildSheet, chordAt, chordName, fallbackScore, type ScoreData } from "@/lib/score";
import { LEFTOVER_VOICE_NOTICEABLE_DB, type ArtColors, type MelodyMode, type Note, type Song, type UserSession, type Word } from "@/lib/types";
import { InstrumentIcon } from "../InstrumentIcon";
import { ThemeToggle } from "../AppHeader";
import { LyricStage } from "./LyricStage";
import { clampZoom, SheetStage } from "./SheetStage";
import { Transport } from "./Transport";
import { SettingsPanel } from "./SettingsPanel";
import { HelpOverlay } from "./HelpOverlay";
import { FingeringHint } from "./FingeringHint";
import { usePref } from "@/lib/prefs";
import { FlagPopover, NotePopover, WordPopover, type Anchor } from "./EditPopover";
import { flagNote, readFlags } from "@/lib/flags";
import * as noteEdit from "@/lib/noteedit";
import { SetlistBar } from "./SetlistBar";
import { FavouriteButton } from "../Favourite";
import { AddToSetlistButton } from "../AddToSetlist";
import { useMe } from "@/lib/me";
import { nowPlaying } from "@/lib/nowPlaying";

type Snapshot = { notes: Note[]; words: Word[] };

function instrumentIsSax(id: string) { return id.endsWith("_sax"); }

function readPref(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } }

export function Player({ initial, reload, colors = null }: { initial: Song; reload: () => Promise<void>; colors?: ArtColors | null }) {
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
  const [ended, setEnded] = useState(0);
  const { recordPlay, signedIn, nudge } = useMe();
  const guestRef = useRef(false);
  useEffect(() => { guestRef.current = signedIn === false; }, [signedIn]);
  // a guest fixing notes: it works, but nothing is kept
  useEffect(() => { if (editing && signedIn === false) nudge("Your fixes last until you leave this page. Sign in to keep them."); }, [editing, signedIn, nudge]);
  const playRecorded = useRef(false);
  const [keyLoading, setKeyLoading] = useState(false);
  const [fingeringPref, setFingeringPref] = usePref("na.fingering", "0");
  const showFingering = fingeringPref === "1" && instrumentIsSax(session.instrument);
  const [timingPref, setTimingPref] = usePref("na.timing", "1");
  // The loop tip is shown once ever: it is marked as seen the moment it appears, and stays up until it is closed or used.
  const [loopHintPref, setLoopHintPref, loopHintLoaded] = usePref("na.loopHint", "0");
  const loopHintOn = loopHintLoaded && loopHintPref === "0";
  useEffect(() => { if (loopHintOn) { try { localStorage.setItem("na.loopHint", "1"); } catch {} } }, [loopHintOn]);
  const dismissLoopHint = useCallback(() => setLoopHintPref("1"), [setLoopHintPref]);
  const timing = timingPref !== "0";
  // Letters (the words with note names) or Sheet music (the same notes on a staff)
  const [viewPref, setViewPref] = usePref("na.view", "letters");
  const view: "letters" | "sheet" = viewPref === "sheet" ? "sheet" : "letters";
  const [sheetZoomPref, setSheetZoomPref] = usePref("na.sheetZoom", "1");
  const sheetZoom = clampZoom(Number(sheetZoomPref));
  const [sheetPaperPref, setSheetPaperPref] = usePref("na.sheetPaper", "0");
  const [sheetLettersPref, setSheetLettersPref] = usePref("na.sheetLetters", "0");
  const [chordsPref, setChordsPref] = usePref("na.chords", "0");
  const chords = chordsPref === "1";
  const [hearPref, setHearPref] = usePref("na.hear", "0");
  const [hearVolumePref, setHearVolumePref] = usePref("na.hearVolume", "0.8");
  const hear = hearPref === "1";
  const hearVolume = Number.isFinite(Number(hearVolumePref)) ? Number(hearVolumePref) : 0.8;
  // which instrument's recordings are loaded (or failed to load); "loading" is everything in between
  const [hearLoaded, setHearLoaded] = useState<{ instrument: string; ok: boolean } | null>(null);
  const samplerRef = useRef<Sampler | null>(null);
  const hearRef = useRef<HearEngine | null>(null);
  /** Set by the transport: makes the button's sound waves pulse once. */
  const hearListeners = useRef(new Set<() => void>());
  const onHearNote = useCallback((fn: () => void) => { hearListeners.current.add(fn); return () => { hearListeners.current.delete(fn); }; }, []);
  const engineRef = useRef<AudioEngine | null>(null);

  // ---- audio engine -------------------------------------------------------
  // Leaving while the song plays hands the engine to the mini player (lib/nowPlaying.ts); coming back takes it
  // back, so the music carries on without a gap. Opening a different song stops the one that was carrying on.
  const sessionRef = useRef(session);
  // "Play the hooks yourself": the backing track with the lead instrument turned down where nobody sings
  const hooksTrack = session.play_hooks !== false && song.settings.hooks !== false && !!song.files.backing_hooks;
  const hooksTrackRef = useRef(hooksTrack);
  useEffect(() => {
    if (hooksTrackRef.current === hooksTrack) return;
    hooksTrackRef.current = hooksTrack;
    engineRef.current?.reloadBacking();
  }, [hooksTrack]);
  useEffect(() => { sessionRef.current = session; }, [session]);
  const colorsRef = useRef(colors);
  useEffect(() => { colorsRef.current = colors; }, [colors]);
  useEffect(() => {
    const back = nowPlaying.take(song.id);
    if (!back) nowPlaying.stop();
    const urlFor = (stem: "backing" | "vocals", shift: number) => api.audioUrl(song.id, stem === "backing" && hooksTrackRef.current ? "backing_hooks" : stem, shift);
    const engine = back?.engine ?? new AudioEngine(urlFor);
    engine.urlFor = urlFor;
    if (back) { hearRef.current = back.hear; samplerRef.current = back.sampler; }
    engineRef.current = engine;
    const unsub = engine.subscribe(setEngineState);
    engine.onEnded = () => setEnded((n) => n + 1);
    engine.setBackingVolume(session.backing_volume);
    engine.setGuideVolume(session.guide_vocal ? session.guide_volume : 0);
    engine.setSpeed(session.speed);
    engine.loop = session.loop;
    if (!back) engine.load(session.key_shift).then(() => { if (session.position > 0 && session.position < song.duration - 5) engine.seek(session.position); });
    return () => {
      unsub();
      const st = engine.getState();
      if (st.playing || st.countingIn !== null) {
        engine.onEnded = null;
        nowPlaying.park({
          id: song.id, title: song.title, artist: song.artist ?? "", duration: song.duration, colors: colorsRef.current,
          cover: song.catalog ? api.coverUrl(song.id) : api.uploadCoverUrl(song.id),
          engine, hear: hearRef.current, sampler: samplerRef.current,
          session: { ...sessionRef.current, position: Math.floor(engine.currentTime) },
        });
      } else {
        hearRef.current?.destroy();
        engine.destroy();
      }
      hearRef.current = null; samplerRef.current = null; engineRef.current = null;
    };
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
  const apply = useCallback((patch: Partial<UserSession>) => {
    setSession((s) => {
      const next = { ...s, ...patch };
      if (patch.instrument) setInstrumentPref(patch.instrument);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => api.patchSong(song.id, { user: next }).catch(() => undefined), 600);
      return next;
    });
  }, [song.id, setInstrumentPref]);
  const update = useCallback((patch: Partial<UserSession>) => {
    // a guest can use a built-in song's keys that are already made; making a new one needs an account
    if (guestRef.current && patch.key_shift !== undefined && patch.key_shift !== 0) {
      const { key_shift: want, ...rest } = patch;
      if (Object.keys(rest).length) apply(rest);
      api.keyReady(song.id, want).then((ok) => {
        if (ok) apply({ key_shift: want });
        else nudge("Sign in to change key. A new key is made for you on our servers.");
      });
      return;
    }
    apply(patch);
  }, [song.id, apply, nudge]);
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
  // ---- sheet music: beats, bars and chords come from the service the first time they are needed ----
  const [scoreState, setScoreState] = useState<{ song: string; data: ScoreData | null } | null>(null);
  const needScore = view === "sheet" || chords;
  useEffect(() => {
    if (!needScore || CLOUD) return;
    let cancelled = false;
    fetch(`${API}/api/songs/${song.id}/score`).then((r) => (r.ok ? r.json() : null))
      .then((d: ScoreData | null) => { if (!cancelled) setScoreState({ song: song.id, data: d && Array.isArray(d.beats) && d.beats.length > 1 ? d : null }); })
      .catch(() => { if (!cancelled) setScoreState({ song: song.id, data: null }); });
    return () => { cancelled = true; };
  }, [needScore, song.id]);
  const scoreLoaded = CLOUD || scoreState?.song === song.id;
  const score = useMemo(() => (scoreState?.song === song.id && scoreState.data) || fallbackScore(song.tempo_bpm, song.duration), [scoreState, song.id, song.tempo_bpm, song.duration]);
  const script = session.script;
  const wordText = useCallback((w: Word) => (script === "roman" && w.roman ? w.roman : w.text), [script]);
  const sheet = useMemo(() => (view === "sheet" ? buildSheet(song, score, wordText) : null), [view, song, score, wordText]);
  const sheetXml = useMemo(() => (sheet ? sheetToMusicXml(sheet, { title: song.title, instrumentId: session.instrument, keyShift: session.key_shift, octaveShift, key: song.key, bare: true }) : ""),
    [sheet, song.title, song.key, session.instrument, session.key_shift, octaveShift]);
  // chords above the lines of the Letters view, written for the instrument like the notes are
  const chordFor = useMemo(() => {
    if (!chords || !score.chords.length) return undefined;
    const sp = writtenSpelling(song.key, session.instrument, session.key_shift), shift = session.key_shift + instrument.transpose;
    return (t: number) => { const c = chordAt(score, t); return c ? chordName(c, sp, shift, true) : null; };
  }, [chords, score, song.key, session.instrument, session.key_shift, instrument.transpose]);

  // ---- hear it played: the melody on a sampled instrument, at sounding pitch ----
  // What the player's instrument will actually sound: concert pitch, moved with the key
  // (the key of the audio that is loaded) and the octave. The written transposition is for reading only.
  // how loudly each note was sung (uploaded songs with a singer); without it the phrasing follows the melody
  const [sung, setSung] = useState<{ song: string; levels: Record<string, number> } | null>(null);
  useEffect(() => {
    if (!hear || CLOUD) return;
    let cancelled = false;
    fetch(`${API}/api/songs/${song.id}/dynamics`).then((r) => (r.ok ? r.json() : null))
      .then((d: { levels?: Record<string, number> } | null) => { if (!cancelled && d?.levels && Object.keys(d.levels).length) setSung({ song: song.id, levels: d.levels }); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [hear, song.id]);
  const hearNotes = useMemo<HearNote[]>(() => phrase([...song.notes].sort((a, b) => a.start - b.start)
    .map((n) => ({ id: n.id, start: n.start, end: n.end, pitch: n.midi + engineState.shift + 12 * octaveShift, word: n.word, syl: n.syl })), sung?.song === song.id ? sung.levels : null,
    { legato: song.settings.melody !== "detailed" }),
  [song.notes, song.id, song.settings.melody, engineState.shift, octaveShift, sung]);
  const hearNotesRef = useRef(hearNotes);
  useEffect(() => { hearNotesRef.current = hearNotes; void samplerRef.current?.prepare(hearNotes.map((n) => n.pitch)); hearRef.current?.setNotes(hearNotes); }, [hearNotes]);
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
        hearRef.current.onNote = () => hearListeners.current.forEach((fn) => fn());
        const sampler = samplerRef.current, player = hearRef.current;
        sampler.setVolume(hearVolume);
        // two switches for comparing sounds (see docs/listening-samples/sax-sound/README.md)
        sampler.expression = readPref("na.hearExpression") !== "0";
        const sound = instrumentId === "alto_sax" && readPref("na.saxSound") === "classic" ? "alto_sax_classic" : instrumentId;
        await sampler.use(sound, hearNotesRef.current.map((n) => n.pitch));
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
    engineRef.current?.seek(Math.max(0, line.start - LOOP_LEAD));
    manualLine.current = line.index;
    setCursor((c) => ({ ...c, line: line.index }));
  }, []);
  // While a part is looping, a click on a line outside it grows the loop to take that line in.
  const clickLine = useCallback((line: DisplayLine) => {
    const at = lines.findIndex((l) => l.index === line.index);
    if (session.loop && at >= 0) {
      const grown = extendLoopToLine(lines, session.loop, at, song.duration);
      if (grown[0] !== session.loop[0] || grown[1] !== session.loop[1]) { update({ loop: grown }); return; }
    }
    seekToLine(line);
  }, [lines, session.loop, song.duration, update, seekToLine]);
  const togglePlay = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (engine.getState().playing || engine.getState().countingIn !== null) engine.pause();
    else engine.play(countIn ? { beats: 4, bpm: Math.min(140, Math.max(60, song.tempo_bpm ?? 100)) } : undefined);
  }, [countIn, song.tempo_bpm]);
  const skipLine = useCallback((dir: 1 | -1) => {
    const lyricLines = lines;
    if (!lyricLines.length) return;
    let idx = Math.max(0, Math.min(lyricLines.length - 1, cursor.line + dir));
    // inside a loop, previous and next go round within it
    const inLoop = session.loop ? linesInLoop(lyricLines, session.loop) : null;
    if (inLoop) idx = cursor.line + dir > inLoop.last ? inLoop.first : cursor.line + dir < inLoop.first ? inLoop.last : cursor.line + dir;
    const target = lyricLines[idx];
    if (session.loop && !inLoop) { engineRef.current?.seek(session.loop[0]); return; }
    seekToLine(target);
  }, [lines, cursor.line, seekToLine, session.loop]);
  const loopCurrentLine = useCallback(() => {
    // one press loops the line being sung; the next press ends the loop
    if (session.loop) { update({ loop: null }); return; }
    const loop = loopForLines(lines, cursor.line, cursor.line, song.duration);
    if (!loop) return;
    dismissLoopHint();
    update({ loop });
    const t = engineRef.current?.currentTime ?? 0;
    if (t < loop[0] || t > loop[1]) engineRef.current?.seek(loop[0]);
  }, [lines, cursor.line, session.loop, song.duration, update, dismissLoopHint]);

  // ---- "this note sounds wrong" ----------------------------------------
  const [flagTick, setFlagTick] = useState(0);
  const [flagAnchor, setFlagAnchor] = useState<(Anchor & { id: string }) | null>(null);
  const flagged = useMemo(() => {
    void flagTick;                                    // the list lives in the browser; re-read after each mark
    const mine = readFlags().filter((f) => f.song_id === song.id);
    return new Set(song.notes.filter((n) => mine.some((f) => Math.abs(f.start - n.start) < 0.011)).map((n) => n.id));
  }, [song.id, song.notes, flagTick]);
  const markWrong = useCallback((id?: string | null) => {
    const t = engineRef.current?.currentTime ?? 0;
    // no note named: the one sounding now, else the last one that started (you react a moment after you hear it)
    const note = id ? song.notes.find((n) => n.id === id)
      : song.notes.find((n) => n.id === cursor.note) ?? [...song.notes].reverse().find((n) => n.start <= t && t - n.start < 3);
    if (!note) { setToast("No note here to mark."); return; }
    const word = note.word ? song.words.find((w) => w.id === note.word)?.text ?? null : null;
    const on = flagNote({ song_id: song.id, start: note.start, end: note.end, midi: note.midi, line: note.line, time: Math.round(t * 100) / 100,
      word, melody: song.settings?.melody ?? null, pipeline: (song.quality as { pipeline?: number } | undefined)?.pipeline ?? null });
    setFlagTick((v) => v + 1);
    const name = noteInfo.get(note.id)?.label ?? "note";
    setToast(on ? `Marked ${name}${word ? ` on "${word}"` : ""} at ${formatTime(note.start)} as sounding wrong. Mark it again to undo.` : `Mark on ${name} at ${formatTime(note.start)} removed.`);
  }, [song, cursor.note, noteInfo]);

  // ---- keyboard shortcuts ---------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      // the note editor owns the arrow keys while it is open (checked now, not when this handler was made)
      if (document.querySelector("[role=dialog][aria-label='Change this note']")) return;
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
        case "w": case "W": if (!e.metaKey && !e.ctrlKey && !e.altKey) markWrong(); break;
        case "v": case "V": if (!e.metaKey && !e.ctrlKey && !e.altKey) setViewPref(view === "sheet" ? "letters" : "sheet"); break;
        case "?": setHelpOpen((v) => !v); break;
        case "Escape":
          // one thing at a time: an open panel first, then the loop, then focus mode
          if (helpOpen || settingsOpen) { setHelpOpen(false); setSettingsOpen(false); }
          else if (session.loop) update({ loop: null });
          else setFocus(false);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, skipLine, loopCurrentLine, update, session.key_shift, session.loop, helpOpen, settingsOpen, toggleHear, view, setViewPref, markWrong]);

  // ---- editing -------------------------------------------------------
  const [noteAnchor, setNoteAnchor] = useState<(Anchor & { id: string }) | null>(null);
  const [wordAnchor, setWordAnchor] = useState<(Anchor & { word: Word }) | null>(null);
  const undoStack = useRef<Snapshot[]>([]);
  const redoStack = useRef<Snapshot[]>([]);
  const [, bump] = useState(0);
  const editTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");

  const lastEdit = useRef<{ key: string; at: number } | null>(null);
  const commit = useCallback((fn: (s: Snapshot) => Snapshot, coalesce?: string) => {
    // a drag or a held key sends many small edits: one undo step for a run of the same edit
    const now = Date.now();
    const same = !!coalesce && lastEdit.current?.key === coalesce && now - lastEdit.current.at < 600;
    lastEdit.current = coalesce ? { key: coalesce, at: now } : null;
    setSong((s) => {
      if (!same) undoStack.current.push({ notes: s.notes, words: s.words });
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
  const retimeNote = (id: string, start: number, end: number) => commit((s) => ({ ...s, notes: noteEdit.retime(s.notes, id, start, end) }), `retime:${id}`);
  const nudgeNote = (id: string, d: number) => commit((s) => ({ ...s, notes: noteEdit.nudge(s.notes, id, d) }), `nudge:${id}`);
  const splitNote = (id: string) => commit((s) => ({ ...s, notes: noteEdit.split(s.notes, id) }));
  const joinNote = (id: string) => commit((s) => ({ ...s, notes: noteEdit.joinNext(s.notes, id) }));
  const shiftNoteLine = (id: string, d: number) => commit((s) => {
    const n = s.notes.find((x) => x.id === id);
    return n ? { ...s, notes: noteEdit.shiftLine(s.notes, n.line, d) } : s;
  }, `line:${id}`);

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
  const runStep = async (label: string, step: string, params: { detail_level?: string; melody?: MelodyMode; hooks?: boolean; language?: string; hold_across_words?: boolean }) => {
    setBusy(label);
    try {
      await api.rerun(song.id, step, params);
      await waitForReady();
      await refreshSong();
    } catch (e) { setToast((e as Error).message); }
    finally { setBusy(null); }
  };

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t); }, [toast]);
  // one play counted per visit, once the song really plays (drives "Most played" and "Jump back in")
  useEffect(() => {
    if (engineState.playing && !playRecorded.current) { playRecorded.current = true; recordPlay(initial.id); }
  }, [engineState.playing, recordPlay, initial.id]);
  const leftoverNoted = useRef(false);
  useEffect(() => {
    if (!engineState.playing || leftoverNoted.current || (song.quality?.leftover_vocal_db ?? -99) <= LEFTOVER_VOICE_NOTICEABLE_DB) return;
    const t = setTimeout(() => { leftoverNoted.current = true; setToast("A little of the singer is still in this backing track. That is the recording, not the guide voice."); }, 1500);
    return () => clearTimeout(t);
  }, [engineState.playing, song.quality]);
  useEffect(() => { if (saveState !== "saved") return; const t = setTimeout(() => setSaveState("idle"), 2000); return () => clearTimeout(t); }, [saveState]);

  const exportPdf = () => {
    const q = new URLSearchParams({ instrument: session.instrument, key: String(session.key_shift), octave: session.octave, notation: session.notation, script: session.script });
    if (view === "sheet") q.set("view", "sheet");
    window.open(`/songs/${song.id}/print?${q}`, "_blank");
  };
  const exportMusicXml = async () => {
    // the file has the same bars and chords as the Sheet music view, so it needs the beats from the service
    let data = scoreState?.song === song.id ? scoreState.data : null;
    if (!data && !CLOUD && scoreState?.song !== song.id) {
      setBusy("Writing out the music…");
      try { const r = await fetch(`${API}/api/songs/${song.id}/score`); data = r.ok ? await r.json() : null; if (data) setScoreState({ song: song.id, data }); } catch { data = null; }
      finally { setBusy(null); }
    }
    downloadText(`${song.title}.musicxml`, songToMusicXml(song, session.instrument, session.key_shift, octaveShift, data, wordText), "application/vnd.recordare.musicxml+xml");
  };
  const seekTo = useCallback((t: number) => { engineRef.current?.seek(t); manualLine.current = null; }, []);

  const editingNote = noteAnchor ? noteInfo.get(noteAnchor.id) : null;
  const unsure = useMemo(() => (isCatalogSong(song) ? undefined : unsureLines(lines)), [song, lines]);
  const editTiming = useMemo(() => {
    if (!noteAnchor) return null;
    const sorted = [...song.notes].sort((a, b) => a.start - b.start);
    const i = sorted.findIndex((n) => n.id === noteAnchor.id);
    if (i < 0) return null;
    return { start: sorted[i].start, end: sorted[i].end, prevEnd: sorted[i - 1]?.end ?? null, nextStart: sorted[i + 1]?.start ?? null };
  }, [noteAnchor, song.notes]);
  const catalog = isCatalogSong(song);
  const backHref = catalog ? "/" : "/my-songs";
  // "Now" takes its colour from the song's artwork (built-in songs and uploads alike)
  const [theme] = useTheme();
  const accent = useMemo(() => accentFromArt(colors, theme === "light" ? "light" : "dark"), [colors, theme]);
  const subtitle = [
    song.catalog ? (song.artist === "Traditional" ? `Traditional${cultureOf(song.catalog) ? `, ${cultureOf(song.catalog)}` : ""}` : song.artist) : song.artist,
    song.key ? `${keyName(song.key, session.key_shift)}${session.key_shift !== 0 ? ` (${session.key_shift > 0 ? "+" : ""}${session.key_shift})` : ""}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="flex h-dvh flex-col overflow-hidden" style={{ ...accentVars(accent), ...artVars(colors), "--beat": `${(beat / session.speed).toFixed(3)}s` } as React.CSSProperties}>
      {/* Top bar */}
      <AnimatePresence initial={false}>
        {!focus && (
          <motion.header initial={{ y: -16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -16, opacity: 0 }} transition={{ type: "spring", stiffness: 300, damping: 30 }} className="no-print flex items-center gap-3 px-3 py-3 sm:px-6 sm:py-4">
            <Link href={backHref} className="btn btn-round shrink-0" aria-label={catalog ? "Back to Discover" : "Back to my songs"} data-tip={catalog ? "Discover" : "My songs"} data-tip-pos="below"><ArrowLeft className="h-[18px] w-[18px]" strokeWidth={1.6} /></Link>
            <div className="min-w-0 flex-1">
              <h1 className="display-md truncate text-[1.05rem] sm:text-[1.3rem]">{song.title}</h1>
              <div className="truncate text-[12px] uppercase tracking-[0.08em] text-muted">{subtitle}</div>
            </div>
            {editing ? (
              <div className="flex items-center gap-1">
                <span className="mr-2 hidden text-[13px] text-muted sm:inline" aria-live="polite">{saveState === "saving" ? (signedIn === false ? "" : "Saving…") : saveState === "saved" ? (signedIn === false ? "Changed on this page only" : <span className="inline-flex items-center gap-1"><Check className="h-3.5 w-3.5" /> Saved</span>) : view === "sheet" ? "Click a note to change it. Words are fixed in the Letters view" : "Click a note to move it, or a word to fix it"}</span>
                <button className="btn btn-ghost btn-icon" onClick={undo} disabled={undoStack.current.length === 0} aria-label="Undo" data-tip="Undo" data-tip-pos="below"><Undo2 className="h-[18px] w-[18px]" strokeWidth={1.6} /></button>
                <button className="btn btn-ghost btn-icon" onClick={redo} disabled={redoStack.current.length === 0} aria-label="Redo" data-tip="Redo" data-tip-pos="below"><Redo2 className="h-[18px] w-[18px]" strokeWidth={1.6} /></button>
                <button className="btn btn-primary" onClick={() => { setEditing(false); setNoteAnchor(null); setWordAnchor(null); }}><Check className="h-4 w-4" /> Done</button>
              </div>
            ) : (
              <div className="flex items-center gap-0.5 sm:gap-1">
                <div className="seg mr-1 hidden lg:inline-flex" role="group" aria-label="How the song is shown">
                  <button aria-pressed={view === "letters"} onClick={() => setViewPref("letters")} data-tip="Words with note names (V)" data-tip-pos="below">Letters</button>
                  <button aria-pressed={view === "sheet"} onClick={() => setViewPref("sheet")} data-tip="Notes on a staff (V)" data-tip-pos="below">Sheet music</button>
                </div>
                <button className="btn btn-ghost btn-icon lg:hidden" onClick={() => setViewPref(view === "sheet" ? "letters" : "sheet")}
                  data-tip={view === "sheet" ? "Show letters" : "Show sheet music"} data-tip-pos="below" aria-label={view === "sheet" ? "Show letters" : "Show sheet music"}>
                  {view === "sheet" ? <Type className="h-[18px] w-[18px]" strokeWidth={1.6} /> : <Music2 className="h-[18px] w-[18px]" strokeWidth={1.6} />}
                </button>
                <button className="btn hidden sm:inline-flex" onClick={() => setSettingsOpen(true)} data-tip="Change instrument" data-tip-pos="below">
                  <span className="text-accent"><InstrumentIcon icon={instrument.icon} className="h-[18px] w-[18px]" /></span> {instrument.name}
                </button>
                <FavouriteButton id={song.id} title={song.title} variant="icon" />
                <AddToSetlistButton songId={song.id} title={song.title} />
                <Link href={`/song/${song.id}`} className="btn btn-ghost btn-icon max-sm:hidden" data-tip="About this song" data-tip-pos="below" aria-label="About this song"><Info className="h-[18px] w-[18px]" strokeWidth={1.6} /></Link>
                <button className="btn btn-ghost btn-icon" onClick={() => setEditing(true)} data-tip="Fix notes or words (E)" data-tip-pos="below" aria-label="Fix notes or words"><Pencil className="h-[18px] w-[18px]" strokeWidth={1.6} /></button>
                <button className="btn btn-ghost btn-icon max-sm:hidden" onClick={() => setFocus(true)} data-tip="Focus mode (F)" data-tip-pos="below" aria-label="Focus mode"><Maximize2 className="h-[18px] w-[18px]" strokeWidth={1.6} /></button>
                <button className="btn btn-ghost btn-icon max-sm:hidden" onClick={() => setHelpOpen(true)} data-tip="How to read the screen (?)" data-tip-pos="below" aria-label="Help"><HelpCircle className="h-[18px] w-[18px]" strokeWidth={1.6} /></button>
                <span className="max-sm:hidden"><ThemeToggle /></span>
                <button className={`btn btn-icon ${settingsOpen ? "bg-hover" : ""}`} onClick={() => setSettingsOpen((v) => !v)} data-tip="Settings" data-tip-pos="below" aria-label="Settings" aria-expanded={settingsOpen}><SlidersHorizontal className="h-[18px] w-[18px]" strokeWidth={1.6} /></button>
              </div>
            )}
          </motion.header>
        )}
      </AnimatePresence>

      {!focus && <Suspense><SetlistBar songId={song.id} ended={ended} ready={engineState.ready} onAutoplay={togglePlay} /></Suspense>}
      {/* Stage */}
      <main className={`relative min-h-0 flex-1 transition-[margin] duration-300 ${settingsOpen && !focus ? "lg:mr-[22.5rem]" : ""}`}>
        {view === "sheet" && sheet ? (
          <SheetStage sheet={sheet} xml={sheetXml} pending={!scoreLoaded} noteInfo={noteInfo} getTime={getSmoothTime} editing={editing}
            zoom={sheetZoom} setZoom={(z) => setSheetZoomPref(String(z))} paper={sheetPaperPref === "1"} letters={sheetLettersPref === "1"}
            onSeek={seekTo} onNoteClick={(id, el) => { setWordAnchor(null); setNoteAnchor({ id, el }); }} />
        ) : (
        <LyricStage
          lines={lines} currentLine={cursor.line} currentWordId={cursor.word} currentNoteId={cursor.note} time={time}
          noteInfo={noteInfo} script={session.script} editing={editing}
          timing={timing} cue={cursor} beat={beat} getTime={getSmoothTime}
          onNoteClick={(id, el) => { setWordAnchor(null); setNoteAnchor({ id, el }); }}
          onNoteTap={(id, el) => setFlagAnchor({ id, el })} flagged={flagged}
          onWordClick={(word, el) => { setNoteAnchor(null); setWordAnchor({ word, el }); }}
          onAddNote={addNote}
          onLineClick={clickLine}
          unsure={unsure} chordFor={chordFor}
        />
        )}
        {/* overlays */}
        <AnimatePresence>
          {engineState.countingIn !== null && (
            <motion.div key={engineState.countingIn} initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 1.25, opacity: 0 }} transition={{ type: "spring", stiffness: 500, damping: 30 }} className="pointer-events-none absolute inset-x-0 top-[6%] flex justify-center" aria-live="assertive">
              <div className="display-hero grid h-36 w-36 place-items-center rounded-full border-2 border-accent pt-2 text-[6.5rem] text-accent shadow-[0_0_60px_var(--accent-soft)]">{engineState.countingIn}</div>
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
          <button className="btn btn-ghost btn-icon absolute right-4 top-4 opacity-40 hover:opacity-100 focus-visible:opacity-100" onClick={() => setFocus(false)} data-tip="Leave focus mode (F)" data-tip-pos="below" aria-label="Leave focus mode"><Minimize2 className="h-5 w-5" /></button>
        )}
        {showFingering && !editing && (
          <div className={`absolute bottom-3 left-3 hidden sm:block ${view === "sheet" ? "floating p-2" : ""}`}>
            <FingeringHint note={(cursor.note ? noteInfo.get(cursor.note) : nextNoteInfo) ?? null} />
          </div>
        )}
        {!focus && outOfRangeCount > 0 && !editing && view !== "sheet" && (
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
          onSeek={seekTo}
          onSkip={skipLine}
          onLoop={(loop) => update({ loop })}
          onLoopToggle={loopCurrentLine}
          loopHint={loopHintOn && engineState.ready && !editing} onDismissLoopHint={dismissLoopHint}
          onSpeed={(speed) => update({ speed })}
          focus={focus}
          hear={hear} hearState={hearState} onHear={toggleHear} instrument={instrument} onHearNote={onHearNote}
        />
      </div>

      <SettingsPanel
        open={settingsOpen && !focus} onClose={() => setSettingsOpen(false)} song={song} session={session} update={update}
        countIn={countIn} setCountIn={setCountIn} busy={busy} keyLoading={keyLoading}
        fingering={fingeringPref === "1"} setFingering={(v) => setFingeringPref(v ? "1" : "0")}
        timing={timing} setTiming={(v) => setTimingPref(v ? "1" : "0")}
        view={view} setView={setViewPref} sheetPaper={sheetPaperPref === "1"} setSheetPaper={(v) => setSheetPaperPref(v ? "1" : "0")}
        sheetLetters={sheetLettersPref === "1"} setSheetLetters={(v) => setSheetLettersPref(v ? "1" : "0")}
        chords={chords} setChords={(v) => setChordsPref(v ? "1" : "0")} chordsFound={!chords || !scoreLoaded || score.chords.length > 0}
        hear={hear} hearState={hearState} onHear={toggleHear} hearVolume={hearVolume} setHearVolume={(v) => setHearVolumePref(String(v))}
        onDetailLevel={(level) => runStep("Updating the notes…", "cleanup", { detail_level: level })}
        onMelody={(melody) => runStep("Updating the notes…", "cleanup", { melody })}
        onHooks={catalog ? undefined : (hooks) => runStep("Updating the notes…", "cleanup", { hooks })}
        onHoldAcrossWords={catalog ? undefined : (on) => runStep("Updating the notes…", on ? "attach" : "cleanup", { hold_across_words: on })}
        onLanguage={(lang) => runStep("Reading the words again…", "lyrics", { language: lang })}
        onPasteLyrics={async (text) => { setBusy("Lining up your words…"); try { setSong(await api.pasteLyrics(song.id, text)); } finally { setBusy(null); } }}
        onReprocess={async () => { await api.rerun(song.id, "all"); await reload(); }}
        onSongChanged={(s) => setSong((cur) => ({ ...cur, title: s.title, artist: s.artist }))}
        getTime={() => engineRef.current?.currentTime ?? 0}
        onTrim={catalog ? undefined : async (a, b) => {
          engineRef.current?.pause();
          setBusy("Trimming the song…");
          try { await api.trimSong(song.id, a, b); await reload(); }
          finally { setBusy(null); }
        }}
        onExportPdf={exportPdf} onExportMusicXml={exportMusicXml}
        catalog={song.catalog ?? null}
      />
      <HelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />

      <NotePopover anchor={noteAnchor} label={editingNote ? `${editingNote.label}${editingNote.octaveMark === "up" ? "▲" : editingNote.octaveMark === "down" ? "▼" : ""}` : ""}
        timing={editTiming}
        onUp={() => noteAnchor && moveNote(noteAnchor.id, 1)} onDown={() => noteAnchor && moveNote(noteAnchor.id, -1)}
        onDelete={() => noteAnchor && deleteNote(noteAnchor.id)} onClose={() => setNoteAnchor(null)}
        onRetime={(a, b) => noteAnchor && retimeNote(noteAnchor.id, a, b)} onNudge={(d) => noteAnchor && nudgeNote(noteAnchor.id, d)}
        onSplit={() => noteAnchor && splitNote(noteAnchor.id)} onJoin={() => noteAnchor && joinNote(noteAnchor.id)}
        onShiftLine={(d) => noteAnchor && shiftNoteLine(noteAnchor.id, d)}
        flagged={!!noteAnchor && flagged.has(noteAnchor.id)} onFlag={() => noteAnchor && markWrong(noteAnchor.id)} />
      <FlagPopover anchor={flagAnchor} flagged={!!flagAnchor && flagged.has(flagAnchor.id)}
        onFlag={() => { if (flagAnchor) markWrong(flagAnchor.id); setFlagAnchor(null); }} onClose={() => setFlagAnchor(null)} />
      <WordPopover anchor={wordAnchor} value={wordAnchor?.word.text ?? ""} onSave={(t) => wordAnchor && editWord(wordAnchor.word.id, t)}
        onAddNote={() => wordAnchor && addNote(wordAnchor.word.id, wordAnchor.word.line)} onClose={() => setWordAnchor(null)} />
    </div>
  );
}
