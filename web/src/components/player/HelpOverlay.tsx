"use client";
import { Modal } from "../Modal";

const KEYS: [string, string][] = [
  ["Space", "Play / pause"],
  ["← / →", "Previous / next line"],
  ["L", "Loop the current line (again to stop)"],
  ["↑ / ↓", "Key higher / lower"],
  ["F", "Focus mode (hide controls)"],
  ["E", "Edit notes and words"],
  ["?", "Show this help"],
  ["Esc", "Close panels"],
];

export function HelpOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts">
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
        {KEYS.map(([k, d]) => (
          <div key={k} className="contents">
            <dt><kbd className="kbd">{k}</kbd></dt>
            <dd className="text-muted">{d}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-6 space-y-2 text-sm text-muted">
        <p><span className="note-chip inline-flex h-6 min-w-6 px-1 text-xs align-middle">C</span> Note to play, shown above each word. <span className="font-semibold text-fg">▲</span> means the higher version of that note on your instrument, <span className="font-semibold text-fg">▼</span> the lower one.</p>
        <p><span className="note-chip inline-flex h-6 min-w-6 px-1 text-xs align-middle" data-range="out">C</span> A dashed red note is outside what your instrument can play. Try the octave control or a different key.</p>
        <p>Drag across the progress bar to loop a section.</p>
      </div>
    </Modal>
  );
}
