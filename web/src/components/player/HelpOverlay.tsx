"use client";
import { Modal } from "../Modal";

const KEYS: [string, string][] = [
  ["Space", "Play or pause"],
  ["← / →", "Previous or next line"],
  ["L", "Loop the line you're on (L or Esc to stop)"],
  ["↑ / ↓", "Move the key up or down"],
  ["H", "Hear it played on your instrument"],
  ["F", "Focus mode: hide everything but the words"],
  ["E", "Fix notes and words"],
  ["↑ / ↓", "With a note selected while fixing: a semitone higher or lower"],
  ["← / →", "With a note selected: move it earlier or later (Shift for small steps)"],
  ["[ / ]", "With a note selected: move its whole line earlier or later"],
  ["S / J", "With a note selected: split it in two, or join it with the next note"],
  ["?", "This help"],
  ["Esc", "Close panels, stop looping"],
];

export function HelpOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="How to read the screen">
      <div className="space-y-3 text-sm leading-relaxed text-muted">
        <p><span className="note-chip inline-flex h-6 min-w-6 px-1 align-middle text-xs" data-state="future">C</span> is the note to play, shown above each word. It lights up when it is time to play it.</p>
        <p>The bar under a note shows how long to hold it. A line sweeps along the words: start each note when the line reaches it, and let go when its bar is full. After a long pause the next note counts you in: 3, 2, 1.</p>
        <p><span className="font-semibold text-fg">▲</span> after a note means the higher version of that note on your instrument, <span className="font-semibold text-fg">▼</span> the lower one.</p>
        <p><span className="note-chip inline-flex h-6 min-w-6 px-1 align-middle text-xs" data-range="out">C</span> A dashed red note is outside what your instrument can play. Try the octave setting or move the key.</p>
        <p><span className="font-semibold text-fg">Hear it played</span> plays the notes on your instrument along with the song, so you can hear how it should sound before you try it.</p>
        <p>Click or drag along the thin line at the bottom to move through the song. To practise one part, press the loop button: it repeats the line you&rsquo;re on. Drag the two handles on the line to loop more or less (they jump to the starts and ends of lines; hold Alt to move them freely), or click another line to take it in.</p>
        <p>A small mark beside a line means the notes there were hard to hear in the recording: worth a listen, and a fix if they are off (✎).</p>
      </div>
      <h3 className="label mt-6 mb-3">Keyboard</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 text-sm">
        {KEYS.map(([k, d]) => (
          <div key={k} className="contents">
            <dt><kbd className="kbd">{k}</kbd></dt>
            <dd className="text-muted">{d}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
