"use client";
// App-wide upload state so "Add a song" works from every page. An upload
// starts the processing pipeline and takes you to the song's progress screen.
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "./api";
import { useInstrumentPref } from "./prefs";

export type Upload = { id: number; name: string; progress: number; error?: string; songId?: string };

type Ctx = { uploads: Upload[]; addFiles: (files: File[]) => void; dismiss: (id: number) => void };
const UploadsContext = createContext<Ctx>({ uploads: [], addFiles: () => {}, dismiss: () => {} });

let nextId = 1;

export function UploadsProvider({ children }: { children: React.ReactNode }) {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [instrument] = useInstrumentPref();
  const router = useRouter();

  const addFiles = useCallback(async (files: File[]) => {
    for (const file of files) {
      const id = nextId++;
      setUploads((u) => [...u, { id, name: file.name, progress: 0 }]);
      try {
        const song = await api.upload(file, { instrument }, (p) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, progress: p } : x))));
        setUploads((u) => u.filter((x) => x.id !== id));
        if (files.length === 1) router.push(`/songs/${song.id}`);
      } catch (e) {
        setUploads((u) => u.map((x) => (x.id === id ? { ...x, error: (e as Error).message } : x)));
      }
    }
  }, [instrument, router]);

  const dismiss = useCallback((id: number) => setUploads((u) => u.filter((x) => x.id !== id)), []);
  const value = useMemo(() => ({ uploads, addFiles, dismiss }), [uploads, addFiles, dismiss]);
  return <UploadsContext.Provider value={value}>{children}</UploadsContext.Provider>;
}

export function useUploads() {
  return useContext(UploadsContext);
}
