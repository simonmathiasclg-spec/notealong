"use client";
// Small app-wide preferences kept in localStorage (instrument, theme, first run).
import { useCallback, useEffect, useState } from "react";
import { DEFAULT_INSTRUMENT } from "./instruments";

const KEY_INSTRUMENT = "na.instrument";
const KEY_THEME = "na.theme";
const KEY_COUNTIN = "na.countin";

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch {}
}

export function usePref(key: string, fallback: string): [string, (v: string) => void, boolean] {
  const [value, setValue] = useState(fallback);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const v = read(key);
    if (v !== null) setValue(v);
    setLoaded(true);
  }, [key]);
  const set = useCallback((v: string) => { setValue(v); write(key, v); }, [key]);
  return [value, set, loaded];
}

export function useInstrumentPref() {
  return usePref(KEY_INSTRUMENT, DEFAULT_INSTRUMENT);
}

export function hasChosenInstrument(): boolean {
  return read(KEY_INSTRUMENT) !== null;
}

export function useTheme(): [string, () => void] {
  const [theme, setTheme] = usePref(KEY_THEME, "light");
  useEffect(() => {
    const current = document.documentElement.dataset.theme;
    if (current && current !== theme && read(KEY_THEME) === null) setTheme(current);
  }, [theme, setTheme]);
  const toggle = useCallback(() => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    setTheme(next);
  }, [setTheme]);
  return [theme, toggle];
}

export function useCountInPref(): [boolean, (v: boolean) => void] {
  const [v, set] = usePref(KEY_COUNTIN, "1");
  return [v !== "0", (b) => set(b ? "1" : "0")];
}
