"use client";
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Modal } from "./Modal";
import { InstrumentPicker } from "./InstrumentPicker";
import { DEFAULT_INSTRUMENT, getInstrument } from "@/lib/instruments";

/** First run: one question, then straight to the songs. */
export function Welcome({ open, onDone }: { open: boolean; onDone: (instrument: string) => void }) {
  const [choice, setChoice] = useState(DEFAULT_INSTRUMENT);
  return (
    <Modal open={open} size="xl">
      <div className="mb-6">
        <h1 className="display-lg text-[2.1rem]">What do you play?</h1>
        <p className="mt-3 max-w-md text-[0.95rem] leading-relaxed text-muted">
          NoteAlong shows the note to play above every word of a song. Your instrument decides what those notes are called.
          You can change it any time.
        </p>
      </div>
      <InstrumentPicker value={choice} onChange={setChoice} columns={4} />
      <div className="sticky -bottom-6 -mx-6 -mb-6 mt-6 flex items-center justify-between gap-3 border-t border-border bg-elev px-6 py-4 sm:-mx-7 sm:-mb-7 sm:px-7">
        <span className="text-sm text-muted">{getInstrument(choice).description}</span>
        <button className="btn btn-primary btn-lg" onClick={() => onDone(choice)}>Start playing <ArrowRight className="h-4 w-4" /></button>
      </div>
    </Modal>
  );
}
