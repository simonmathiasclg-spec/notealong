"use client";
// This user's favourites, plays and setlists, shared by every page. Changes show at once and are
// saved to the service in the background (service/notealong/me.py).
// Online it also knows whether anyone is signed in and what they may upload. A guest (not signed in) can play
// every built-in song; anything that would be saved asks them to sign in instead (`nudge`).
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { CLOUD } from "./cloud/config";
import type { Entitlements, MyLibrary, Setlist } from "./types";
import { PaidPlansPanel, SignInNudge } from "@/components/cloud/Prompts";

const LOCAL: Entitlements = { plan: "local", uploads: { used: 0, limit: null, remaining: null }, catalog: "free" };

type Ctx = MyLibrary & {
  loaded: boolean;
  /** null while it is being checked (online); always true on this computer. */
  signedIn: boolean | null;
  /** What this person may upload; null while it is being checked. */
  allowance: Entitlements | null;
  refreshAllowance: () => void;
  /** A small "Sign in to save" prompt for a guest, with a link back to this page. */
  nudge: (message: string) => void;
  /** "You've used your free song. Paid plans are coming soon." */
  showPaidPanel: () => void;
  isFavourite: (id: string) => boolean;
  toggleFavourite: (id: string) => void;
  recordPlay: (id: string) => void;
  createSetlist: (name: string, songs?: string[]) => Promise<Setlist | null>;
  updateSetlist: (id: string, patch: Partial<Pick<Setlist, "name" | "songs" | "gap_seconds">>) => void;
  deleteSetlist: (id: string) => void;
  addToSetlist: (setId: string, songId: string) => void;
  refresh: () => void;
};
const empty: MyLibrary = { favourites: [], plays: {}, setlists: [] };
const MeContext = createContext<Ctx>({
  ...empty, loaded: false, signedIn: true, allowance: LOCAL, refreshAllowance: () => {}, nudge: () => {}, showPaidPanel: () => {}, isFavourite: () => false, toggleFavourite: () => {}, recordPlay: () => {},
  createSetlist: async () => null, updateSetlist: () => {}, deleteSetlist: () => {}, addToSetlist: () => {}, refresh: () => {},
});

export function MeProvider({ children }: { children: React.ReactNode }) {
  const [lib, setLib] = useState<MyLibrary>(empty);
  const [loaded, setLoaded] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean | null>(CLOUD ? null : true);
  const [allowance, setAllowance] = useState<Entitlements | null>(CLOUD ? null : LOCAL);
  const [nudgeText, setNudgeText] = useState<string | null>(null);
  const [paidPanel, setPaidPanel] = useState(false);
  const refresh = useCallback(() => {
    api.myLibrary().then((l) => { setLib(l); setLoaded(true); }).catch(() => setLoaded(true));
  }, []);
  const refreshAllowance = useCallback(() => {
    api.me().then(setAllowance).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!CLOUD) return;
    let alive = true;
    import("./cloud/browser").then(({ supabase }) => {
      const sb = supabase();
      sb.auth.getSession().then(({ data }) => { if (alive) setSignedIn(!!data.session); });
      const { data: sub } = sb.auth.onAuthStateChange((_event, session) => { if (alive) setSignedIn(!!session); });
      cleanup = () => sub.subscription.unsubscribe();
    });
    let cleanup = () => {};
    return () => { alive = false; cleanup(); };
  }, []);
  // what the library and the allowance hold depends on who is signed in
  useEffect(() => { if (signedIn !== null) { refresh(); refreshAllowance(); } }, [signedIn, refresh, refreshAllowance]);
  const nudge = useCallback((message: string) => setNudgeText(message), []);
  const showPaidPanel = useCallback(() => setPaidPanel(true), []);

  const favSet = useMemo(() => new Set(lib.favourites), [lib.favourites]);
  const isFavourite = useCallback((id: string) => favSet.has(id), [favSet]);
  const toggleFavourite = useCallback((id: string) => {
    if (signedIn === false) { setNudgeText("Sign in to keep your favourites."); return; }
    const on = !favSet.has(id);
    setLib((l) => ({ ...l, favourites: on ? [id, ...l.favourites.filter((x) => x !== id)] : l.favourites.filter((x) => x !== id) }));
    api.setFavourite(id, on).catch(() => refresh());
  }, [favSet, refresh, signedIn]);
  const recordPlay = useCallback((id: string) => {
    setLib((l) => ({ ...l, plays: { ...l.plays, [id]: { count: (l.plays[id]?.count ?? 0) + 1, last: new Date().toISOString() } } }));
    api.played(id).catch(() => undefined);
  }, []);
  const createSetlist = useCallback(async (name: string, songs: string[] = []) => {
    if (signedIn === false) { setNudgeText("Sign in to make setlists."); return null; }
    try {
      const s = await api.createSetlist({ name, songs });
      setLib((l) => ({ ...l, setlists: [s, ...l.setlists] }));
      return s;
    } catch { return null; }
  }, [signedIn]);
  const updateSetlist = useCallback((id: string, patch: Partial<Pick<Setlist, "name" | "songs" | "gap_seconds">>) => {
    setLib((l) => ({ ...l, setlists: l.setlists.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
    api.updateSetlist(id, patch).catch(() => refresh());
  }, [refresh]);
  const deleteSetlist = useCallback((id: string) => {
    setLib((l) => ({ ...l, setlists: l.setlists.filter((s) => s.id !== id) }));
    api.deleteSetlist(id).catch(() => refresh());
  }, [refresh]);
  const addToSetlist = useCallback((setId: string, songId: string) => {
    const sl = lib.setlists.find((s) => s.id === setId);
    if (!sl || sl.songs.includes(songId)) return;
    updateSetlist(setId, { songs: [...sl.songs, songId] });
  }, [lib.setlists, updateSetlist]);

  const value = useMemo(() => ({ ...lib, loaded, signedIn, allowance, refreshAllowance, nudge, showPaidPanel, isFavourite, toggleFavourite, recordPlay, createSetlist, updateSetlist, deleteSetlist, addToSetlist, refresh }),
    [lib, loaded, signedIn, allowance, refreshAllowance, nudge, showPaidPanel, isFavourite, toggleFavourite, recordPlay, createSetlist, updateSetlist, deleteSetlist, addToSetlist, refresh]);
  return (
    <MeContext.Provider value={value}>
      {children}
      {CLOUD && <SignInNudge message={nudgeText} onClose={() => setNudgeText(null)} />}
      {CLOUD && <PaidPlansPanel open={paidPanel} onClose={() => setPaidPanel(false)} />}
    </MeContext.Provider>
  );
}

export function useMe() {
  return useContext(MeContext);
}
