"use client";
import { useState } from "react";
import { Modal } from "./Modal";
import { InstrumentPicker } from "./InstrumentPicker";
import { DEFAULT_INSTRUMENT, getInstrument } from "@/lib/instruments";

export function Welcome({ open, onDone }: { open: boolean; onDone: (instrument: string) => void }) {
  const [choice, setChoice] = useState(DEFAULT_INSTRUMENT);
  return (
    <Modal open={open} wide>
      <div className="mb-5">
        <div className="label mb-2">Welcome</div>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">What do you play?</h1>
        <p className="mt-2 text-muted">
          NoteAlong shows you which note to play for every word of a song. Pick your instrument so the note names match
          what you finger. You can change it any time.
        </p>
      </div>
      <InstrumentPicker value={choice} onChange={setChoice} columns={4} />
      <div className="sticky -bottom-6 -mx-6 -mb-6 mt-6 flex items-center justify-end gap-3 border-t border-border bg-elev px-6 py-4">
        <span className="text-sm text-muted">{getInstrument(choice).description}</span>
        <button className="btn btn-primary" onClick={() => onDone(choice)}>Let&apos;s go</button>
      </div>
    </Modal>
  );
}
