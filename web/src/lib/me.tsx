"use client";
// This user's favourites, plays and setlists, shared by every page. Changes show at once and are
// saved to the service in the background (service/notealong/me.py).
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type { MyLibrary, Setlist } from "./types";

type Ctx = MyLibrary & {
  loaded: boolean;
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
  ...empty, loaded: false, isFavourite: () => false, toggleFavourite: () => {}, recordPlay: () => {},
  createSetlist: async () => null, updateSetlist: () => {}, deleteSetlist: () => {}, addToSetlist: () => {}, refresh: () => {},
});

export function MeProvider({ children }: { children: React.ReactNode }) {
  const [lib, setLib] = useState<MyLibrary>(empty);
  const [loaded, setLoaded] = useState(false);
  const refresh = useCallback(() => {
    api.myLibrary().then((l) => { setLib(l); setLoaded(true); }).catch(() => setLoaded(true));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const favSet = useMemo(() => new Set(lib.favourites), [lib.favourites]);
  const isFavourite = useCallback((id: string) => favSet.has(id), [favSet]);
  const toggleFavourite = useCallback((id: string) => {
    const on = !favSet.has(id);
    setLib((l) => ({ ...l, favourites: on ? [id, ...l.favourites.filter((x) => x !== id)] : l.favourites.filter((x) => x !== id) }));
    api.setFavourite(id, on).catch(() => refresh());
  }, [favSet, refresh]);
  const recordPlay = useCallback((id: string) => {
    setLib((l) => ({ ...l, plays: { ...l.plays, [id]: { count: (l.plays[id]?.count ?? 0) + 1, last: new Date().toISOString() } } }));
    api.played(id).catch(() => undefined);
  }, []);
  const createSetlist = useCallback(async (name: string, songs: string[] = []) => {
    try {
      const s = await api.createSetlist({ name, songs });
      setLib((l) => ({ ...l, setlists: [s, ...l.setlists] }));
      return s;
    } catch { return null; }
  }, []);
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

  const value = useMemo(() => ({ ...lib, loaded, isFavourite, toggleFavourite, recordPlay, createSetlist, updateSetlist, deleteSetlist, addToSetlist, refresh }),
    [lib, loaded, isFavourite, toggleFavourite, recordPlay, createSetlist, updateSetlist, deleteSetlist, addToSetlist, refresh]);
  return <MeContext.Provider value={value}>{children}</MeContext.Provider>;
}

export function useMe() {
  return useContext(MeContext);
}
