"use client";
// The song that keeps playing after you leave the player. The player "parks" its audio engine here when you
// navigate away while it plays; the mini player shows it; opening that song again takes the same engine back,
// so the music never stops or jumps. Opening another song stops it.
import { useSyncExternalStore } from "react";
import type { AudioEngine } from "./audio";
import type { HearEngine } from "./hear";
import type { Sampler } from "./sampler";
import type { ArtColors, UserSession } from "./types";
import { api } from "./api";

export type Parked = {
  id: string;
  title: string;
  artist: string;
  cover: string;
  colors: ArtColors | null;
  duration: number;
  engine: AudioEngine;
  hear: HearEngine | null;
  sampler: Sampler | null;
  session: UserSession;
};

let parked: Parked | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

function savePosition(p: Parked) {
  const position = Math.floor(p.engine.currentTime || 0);
  api.patchSong(p.id, { user: { ...p.session, position } }).catch(() => undefined);
}

export const nowPlaying = {
  get: (): Parked | null => parked,
  park(p: Parked) {
    if (parked && parked.engine !== p.engine) nowPlaying.stop();
    parked = p;
    p.engine.onEnded = () => { savePosition(p); emit(); };
    emit();
  },
  /** The parked engine for this song, handed back to its player (null if another song or nothing is parked). */
  take(id: string): Parked | null {
    if (!parked || parked.id !== id) return null;
    const p = parked;
    p.engine.onEnded = null;
    parked = null;
    emit();
    return p;
  },
  /** Stops the parked song (remembering where it got to) and frees its audio. */
  stop() {
    const p = parked;
    if (!p) return;
    parked = null;
    savePosition(p);
    p.hear?.destroy();
    p.engine.destroy();
    emit();
  },
  subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
};

export function useNowPlaying(): Parked | null {
  return useSyncExternalStore(nowPlaying.subscribe, nowPlaying.get, () => null);
}
