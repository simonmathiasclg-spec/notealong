// The transport glyphs, drawn for NoteAlong: thin strokes and open triangles, like the controls of a
// small music widget. Everything else uses lucide at a light stroke.
type P = { className?: string; strokeWidth?: number };

export function PlayGlyph({ className = "h-4 w-4" }: P) {
  return <svg viewBox="0 0 16 16" className={className} aria-hidden="true"><path d="M4.5 2.6v10.8c0 .5.55.8.97.53l8.3-5.4a.63.63 0 0 0 0-1.06l-8.3-5.4a.63.63 0 0 0-.97.53Z" fill="currentColor" /></svg>;
}

export function PauseGlyph({ className = "h-4 w-4" }: P) {
  return <svg viewBox="0 0 16 16" className={className} aria-hidden="true"><rect x="3.6" y="2.5" width="2.9" height="11" rx=".9" fill="currentColor" /><rect x="9.5" y="2.5" width="2.9" height="11" rx=".9" fill="currentColor" /></svg>;
}

/** Back: an open triangle against a bar. */
export function SkipBackGlyph({ className = "h-4 w-4", strokeWidth = 1.4 }: P) {
  return <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" aria-hidden="true"><path d="M3.5 3v10" /><path d="M12.5 3.4v9.2L5.8 8z" /></svg>;
}

export function SkipForwardGlyph({ className = "h-4 w-4", strokeWidth = 1.4 }: P) {
  return <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" aria-hidden="true"><path d="M12.5 3v10" /><path d="M3.5 3.4v9.2L10.2 8z" /></svg>;
}

/** Four bars of a waveform; they breathe while the song plays. */
export function WaveGlyph({ on = false, className = "" }: { on?: boolean; className?: string }) {
  return (
    <span className={`wave-glyph ${className}`} data-on={on ? "1" : "0"} aria-hidden="true">
      <i style={{ height: "55%" }} /><i style={{ height: "100%" }} /><i style={{ height: "62%" }} /><i style={{ height: "30%" }} />
    </span>
  );
}

/** A sharp and a flat drawn to sit with the note letters (the display face has no music signs). */
export function Accidental({ kind }: { kind: "sharp" | "flat" }) {
  return kind === "sharp" ? (
    <svg viewBox="0 0 10 16" className="acc" aria-hidden="true">
      <path d="M3.4 1v14M6.9 0.4v14" stroke="currentColor" strokeWidth="1.25" />
      <path d="M1 6.2 9 4.4M1 11.2 9 9.4" stroke="currentColor" strokeWidth="2.4" />
    </svg>
  ) : (
    <svg viewBox="0 0 10 16" className="acc" aria-hidden="true">
      <path d="M2.2 0.6v14.2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2.2 14.8c2.6-1.6 5.6-3.2 5.6-5.6 0-1.9-2-2.6-5.6-.1" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}
