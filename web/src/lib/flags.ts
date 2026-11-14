// "This note sounds wrong": a list of notes the player marked while practising. It lives in this browser
// and, when the app runs on its own machine, in the library folder too, where the Melody Lab reads it
// (service/scripts/lab/flags_to_cases.py) to turn each mark into a test case.
import { API } from "./api";
import { CLOUD } from "./cloud/config";

export type NoteFlag = { song_id: string; start: number; end: number; midi: number; line: number; time: number; word: string | null; melody: string | null; pipeline: number | null; at: string };

const STORE = "notealong.flags";
const same = (a: Pick<NoteFlag, "song_id" | "start">, b: Pick<NoteFlag, "song_id" | "start">) => a.song_id === b.song_id && Math.abs(a.start - b.start) < 0.011;

/** The list with the mark added, or taken away if the note was already marked. */
export function toggleFlag(list: NoteFlag[], flag: NoteFlag): { list: NoteFlag[]; on: boolean } {
  const on = !list.some((f) => same(f, flag));
  const rest = list.filter((f) => !same(f, flag));
  return { list: on ? [...rest, flag] : rest, on };
}

export function readFlags(): NoteFlag[] {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

/** Marks or unmarks a note; returns whether it is marked now. */
export function flagNote(flag: Omit<NoteFlag, "at">): boolean {
  const { list, on } = toggleFlag(readFlags(), { ...flag, at: new Date().toISOString() });
  try { localStorage.setItem(STORE, JSON.stringify(list.slice(-5000))); } catch {}
  if (!CLOUD) fetch(`${API}/api/me/flags`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...flag, on }) }).catch(() => {});
  return on;
}
