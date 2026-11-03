"use client";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, Download, FileText, Loader2, Minus, Plus, RotateCcw, X } from "lucide-react";
import { getInstrument } from "@/lib/instruments";
import { keyName, keyShiftLabel } from "@/lib/notes";
import { formatTime } from "@/lib/api";
import type { CatalogEntry, Notation, OctaveMode, Song, UserSession } from "@/lib/types";
import { InstrumentIcon } from "../InstrumentIcon";
import { Modal } from "../Modal";
import { InstrumentPicker } from "../InstrumentPicker";

const LANGUAGES: [string, string][] = [
  ["", "Auto-detect"], ["en", "English"], ["es", "Spanish"], ["fr", "French"], ["de", "German"], ["it", "Italian"], ["pt", "Portuguese"],
  ["hi", "Hindi"], ["pa", "Punjabi"], ["ta", "Tamil"], ["te", "Telugu"], ["bn", "Bengali"], ["ur", "Urdu"], ["ar", "Arabic"],
  ["ko", "Korean"], ["ja", "Japanese"], ["zh", "Chinese"], ["ru", "Russian"], ["tr", "Turkish"], ["nl", "Dutch"], ["sv", "Swedish"],
  ["pl", "Polish"], ["id", "Indonesian"], ["tl", "Filipino"], ["vi", "Vietnamese"], ["th", "Thai"], ["he", "Hebrew"], ["el", "Greek"],
];

type Props = {
  open: boolean;
  onClose: () => void;
  song: Song;
  session: UserSession;
  update: (patch: Partial<UserSession>) => void;
  countIn: boolean;
  setCountIn: (v: boolean) => void;
  fingering: boolean;
  setFingering: (v: boolean) => void;
  busy: string | null;
  onDetailLevel: (level: string) => void;
  onLanguage: (lang: string) => void;
  onPasteLyrics: (text: string) => Promise<void>;
  onReprocess: () => void;
  onExportPdf: () => void;
  onExportMusicXml: () => void;
  keyLoading: boolean;
  /** Set for built-in songs: shows attribution and hides reprocessing. */
  catalog?: CatalogEntry | null;
};

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-border px-5 py-4 last:border-0">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <div className="label">{label}</div>
        {hint && <div className="text-right text-xs text-faint">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

export function SettingsPanel(p: Props) {
  const { song, session, update } = p;
  const inst = getInstrument(session.instrument);
  const [pickInstrument, setPickInstrument] = useState(false);
  const [lyricsOpen, setLyricsOpen] = useState(false);

  return (
    <>
      <AnimatePresence>
        {p.open && (
          <>
            <motion.div className="fixed inset-0 z-30 bg-black/30 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={p.onClose} />
            <motion.aside
              className="no-print fixed inset-y-0 right-0 z-30 flex w-[min(100vw,22rem)] flex-col border-l border-border bg-elev shadow-card"
              initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }} transition={{ type: "spring", stiffness: 380, damping: 36 }}
              aria-label="Settings"
            >
              <div className="flex items-center justify-between border-b border-border px-5 py-3">
                <div className="font-display text-lg font-bold">Settings</div>
                <button className="btn btn-ghost btn-icon" onClick={p.onClose} aria-label="Close settings"><X className="h-5 w-5" /></button>
              </div>
              <div className="flex-1 overflow-y-auto">
                <Row label="Instrument">
                  <button className="flex w-full items-center gap-3 rounded-xl border border-border px-3 py-2.5 text-left hover:bg-sunken" onClick={() => setPickInstrument(true)}>
                    <span className="text-accent-strong"><InstrumentIcon icon={inst.icon} /></span>
                    <span className="flex-1 font-semibold">{inst.name}</span>
                    <ChevronRight className="h-4 w-4 text-faint" />
                  </button>
                </Row>

                <Row label="Key" hint={song.key ? `Song is in ${keyName(song.key, 0)}` : undefined}>
                  <div className="flex items-center gap-2">
                    <button className="btn btn-icon" onClick={() => update({ key_shift: Math.max(-6, session.key_shift - 1) })} aria-label="Lower" disabled={session.key_shift <= -6}><Minus className="h-4 w-4" /></button>
                    <div className="flex-1 text-center">
                      <div className="font-display text-lg font-bold">{keyShiftLabel(session.key_shift)}</div>
                      <div className="text-xs text-muted">{p.keyLoading ? <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> preparing…</span> : song.key ? `now ${keyName(song.key, session.key_shift)}` : ""}</div>
                    </div>
                    <button className="btn btn-icon" onClick={() => update({ key_shift: Math.min(6, session.key_shift + 1) })} aria-label="Higher" disabled={session.key_shift >= 6}><Plus className="h-4 w-4" /></button>
                  </div>
                  <p className="mt-2 text-xs text-faint" title="Moves the whole song, backing track and notes together, so it sits better for your voice or instrument.">Shifts the backing track and every note together.</p>
                </Row>

                <Row label="Octave" hint="Same notes, higher or lower">
                  <div className="seg w-full">
                    {(["down", "auto", "up"] as OctaveMode[]).map((o) => (
                      <button key={o} className="flex-1" aria-pressed={session.octave === o} onClick={() => update({ octave: o })}>{o === "auto" ? "Auto" : o === "up" ? "Up" : "Down"}</button>
                    ))}
                  </div>
                </Row>

                <Row label="Speed" hint={`${Math.round(session.speed * 100)}%`}>
                  <input type="range" min={0.5} max={1} step={0.05} value={session.speed} onChange={(e) => update({ speed: Number(e.target.value) })} aria-label="Speed" />
                  <p className="mt-1 text-xs text-faint">Slower without changing the pitch.</p>
                </Row>

                <Row label="Loop" hint="Drag on the progress bar to set">
                  {session.loop ? (
                    <div className="flex items-center justify-between text-sm">
                      <span>{formatTime(session.loop[0])} – {formatTime(session.loop[1])}</span>
                      <button className="btn btn-ghost text-xs" onClick={() => update({ loop: null })}>Clear</button>
                    </div>
                  ) : <div className="text-sm text-faint">No loop set.</div>}
                </Row>

                <Row label="Sound">
                  <div className="space-y-3">
                    <label className="block text-sm">
                      <div className="mb-1 flex justify-between"><span>Backing track</span><span className="text-muted">{Math.round(session.backing_volume * 100)}%</span></div>
                      <input type="range" min={0} max={1} step={0.05} value={session.backing_volume} onChange={(e) => update({ backing_volume: Number(e.target.value) })} />
                    </label>
                    <label className="flex items-center justify-between text-sm">
                      <span>{p.catalog?.source.kind === "traditional" ? "Hear the melody quietly" : "Hear the original singer quietly"}</span>
                      <input type="checkbox" className="h-5 w-5 accent-accent" checked={session.guide_vocal} onChange={(e) => update({ guide_vocal: e.target.checked })} />
                    </label>
                    {session.guide_vocal && (
                      <input type="range" min={0} max={1} step={0.05} value={session.guide_volume} onChange={(e) => update({ guide_volume: Number(e.target.value) })} aria-label="Guide vocal volume" />
                    )}
                    <label className="flex items-center justify-between text-sm">
                      <span>Count-in before playing</span>
                      <input type="checkbox" className="h-5 w-5 accent-accent" checked={p.countIn} onChange={(e) => p.setCountIn(e.target.checked)} />
                    </label>
                  </div>
                </Row>

                {inst.family === "Saxophones" && (
                  <Row label="Fingering">
                    <label className="flex items-center justify-between text-sm">
                      <span>Show sax fingering for the current note</span>
                      <input type="checkbox" className="h-5 w-5 accent-accent" checked={p.fingering} onChange={(e) => p.setFingering(e.target.checked)} />
                    </label>
                  </Row>
                )}

                <Row label="Note names">
                  <div className="seg w-full">
                    {([["sharps", "C♯"], ["flats", "D♭"], ["solfege", "Do Re"], ["sargam", "Sa Re"]] as [Notation, string][]).map(([n, l]) => (
                      <button key={n} className="flex-1" aria-pressed={session.notation === n} onClick={() => update({ notation: n })}>{l}</button>
                    ))}
                  </div>
                </Row>

                {!p.catalog && <Row label="Detail" hint={p.busy === "cleanup" ? "updating…" : "How many notes to show"}>
                  <div className="seg w-full">
                    {["simple", "balanced", "detailed"].map((d) => (
                      <button key={d} className="flex-1 capitalize" aria-pressed={song.settings.detail_level === d} disabled={!!p.busy} onClick={() => p.onDetailLevel(d)}>{d}</button>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-faint">Simple leaves out quick slides and runs. Detailed keeps them.</p>
                </Row>}

                <Row label="Lyrics">
                  <div className="space-y-3">
                    {song.language.script === "other" && (
                      <div className="seg w-full">
                        <button className="flex-1" aria-pressed={session.script === "original"} onClick={() => update({ script: "original" })}>Original</button>
                        <button className="flex-1" aria-pressed={session.script === "roman"} onClick={() => update({ script: "roman" })}>Romanized</button>
                      </div>
                    )}
                    {!p.catalog && <label className="block text-sm">
                      <div className="mb-1 flex justify-between"><span>Language</span>{song.language.detected && <span className="text-muted">detected: {song.language.detected}</span>}</div>
                      <select className="w-full rounded-lg border border-border bg-elev px-2 py-1.5 text-sm" value={song.language.override ?? ""} disabled={!!p.busy} onChange={(e) => p.onLanguage(e.target.value)}>
                        {LANGUAGES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
                      </select>
                    </label>}
                    {!p.catalog && <button className="btn w-full justify-center" onClick={() => setLyricsOpen(true)}><FileText className="h-4 w-4" /> {song.settings.lyrics_source === "pasted" ? "Edit pasted lyrics" : "Paste the correct lyrics"}</button>}
                    {p.catalog && song.language.script !== "other" && <p className="text-sm text-faint">Words and notes for this song were checked by hand.</p>}
                  </div>
                </Row>

                <Row label="Export">
                  <div className="grid grid-cols-2 gap-2">
                    <button className="btn justify-center" onClick={p.onExportPdf}><FileText className="h-4 w-4" /> PDF sheet</button>
                    <button className="btn justify-center" onClick={p.onExportMusicXml}><Download className="h-4 w-4" /> MusicXML</button>
                  </div>
                </Row>

                {p.catalog ? (
                  <Row label="About this song">
                    <p className="text-sm text-muted">{p.catalog.attribution}</p>
                    <p className="mt-2 text-xs text-faint">
                      {p.catalog.licence.url ? <a href={p.catalog.licence.url} target="_blank" rel="noreferrer" className="underline">{p.catalog.licence.name}</a> : p.catalog.licence.name}
                      {p.catalog.source.url && <> · <a href={p.catalog.source.url} target="_blank" rel="noreferrer" className="underline">Source</a></>}
                    </p>
                  </Row>
                ) : (
                  <Row label="Processing" hint={song.settings.whisper_model ?? undefined}>
                    <button className="btn w-full justify-center" disabled={!!p.busy} onClick={p.onReprocess}><RotateCcw className="h-4 w-4" /> Run everything again</button>
                    <p className="mt-1 text-xs text-faint">Takes a few minutes. Your note edits will be replaced.</p>
                  </Row>
                )}
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <Modal open={pickInstrument} onClose={() => setPickInstrument(false)} title="Your instrument" wide>
        <InstrumentPicker value={session.instrument} onChange={(id) => { update({ instrument: id }); setPickInstrument(false); }} />
      </Modal>

      <LyricsModal open={lyricsOpen} onClose={() => setLyricsOpen(false)} songId={song.id} onSubmit={p.onPasteLyrics} />
    </>
  );
}

function LyricsModal({ open, onClose, songId, onSubmit }: { open: boolean; onClose: () => void; songId: string; onSubmit: (t: string) => Promise<void> }) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    import("@/lib/api").then(({ api }) => api.getPastedLyrics(songId).then((r) => setText(r.text)).catch(() => undefined));
  }, [open, songId]);
  return (
    <Modal open={open} onClose={onClose} title="Paste the lyrics" wide>
      <p className="mb-3 text-sm text-muted">Paste the real lyrics, one line per sung line. They will be lined up with the singing and replace what was heard automatically. Leave empty to go back to the automatic lyrics.</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={14} className="w-full rounded-xl border border-border bg-bg p-3 font-display text-sm leading-relaxed" placeholder={"First line of the song\nSecond line…"} />
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={saving} onClick={async () => { setSaving(true); try { await onSubmit(text); onClose(); } finally { setSaving(false); } }}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Use these lyrics
        </button>
      </div>
    </Modal>
  );
}
