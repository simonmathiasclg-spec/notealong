"use client";
// App-wide upload queue so "Add a song" works from every page and several files can be added at
// once. Each file is uploaded, then followed while it processes; the queue is shown by
// <UploadQueue /> wherever you are in the app. Files can be dropped, picked, or pasted.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "./api";
import { useInstrumentPref } from "./prefs";
import { useMe } from "./me";
import { cannotUpload } from "./entitlements";
import type { ProgressSnapshot } from "./types";

export type UploadStatus = "uploading" | "processing" | "ready" | "failed" | "duplicate";
export type Upload = {
  id: number;
  name: string;
  /** Upload progress 0..1 while uploading, then processing progress 0..1. */
  progress: number;
  status: UploadStatus;
  /** A plain-language message for failed uploads and failed processing. */
  error?: string;
  songId?: string;
  title?: string;
  /** What the processing is doing right now, e.g. "Finding the notes". */
  step?: string;
  secondsLeft?: number;
};

type Ctx = { uploads: Upload[]; addFiles: (files: File[]) => void; dismiss: (id: number) => void; clearDone: () => void };
const UploadsContext = createContext<Ctx>({ uploads: [], addFiles: () => {}, dismiss: () => {}, clearDone: () => {} });

let nextId = 1;
const STEP_LABEL: Record<string, string> = { stems: "Separating the singer", melody: "Finding the notes", lyrics: "Reading the words", attach: "Lining it all up", cleanup: "Tidying the notes" };

export function UploadsProvider({ children }: { children: React.ReactNode }) {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [instrument] = useInstrumentPref();
  const router = useRouter();
  const patch = useCallback((id: number, p: Partial<Upload>) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, ...p } : x))), []);
  const { allowance, refreshAllowance, showPaidPanel } = useMe();

  const addFiles = useCallback(async (picked: File[]) => {
    // online: a guest signs up first and comes back to add the song; a free account that used its song sees the
    // paid-plans panel. (The server and the database refuse these too; this only saves a pointless upload.)
    const blocked = cannotUpload(allowance);
    if (blocked === "guest") { router.push(`/sign-in?next=${encodeURIComponent("/my-songs?add=1")}`); return; }
    if (blocked === "used") { showPaidPanel(); return; }
    const files = allowance?.plan === "free" ? picked.slice(0, Math.max(1, allowance.uploads.remaining ?? 1)) : picked;
    const single = files.length === 1;
    for (const file of files) {
      const id = nextId++;
      setUploads((u) => [...u, { id, name: file.name, progress: 0, status: "uploading" }]);
      try {
        const song = await api.upload(file, { instrument }, (p) => patch(id, { progress: p }));
        if (song.duplicate_of) {
          patch(id, { status: "duplicate", songId: song.id, title: song.title, progress: 1 });
          if (single) router.push(`/songs/${song.id}`);
          continue;
        }
        patch(id, { status: "processing", songId: song.id, title: song.title, progress: 0, step: "Starting" });
        if (single) router.push(`/songs/${song.id}`);
      } catch (e) {
        patch(id, { status: "failed", error: (e as Error).message });
      }
    }
    refreshAllowance();
  }, [instrument, router, patch, allowance, refreshAllowance, showPaidPanel]);

  // Follow the songs that are processing; a snapshot every couple of seconds is plenty for a queue.
  const following = uploads.filter((u) => u.status === "processing" && u.songId).map((u) => [u.id, u.songId!] as const);
  const followKey = following.map(([, s]) => s).join(",");
  const followRef = useRef(following);
  useEffect(() => { followRef.current = following; });
  useEffect(() => {
    if (!followKey) return;
    let stopped = false;
    const tick = async () => {
      for (const [id, songId] of followRef.current) {
        try {
          const snap: ProgressSnapshot = await api.progressSnapshot(songId);
          if (stopped) return;
          const done = snap.steps.filter((s) => s.status === "done").length;
          const running = snap.steps.find((s) => s.status === "running");
          const progress = snap.steps.length ? (done + (running?.progress ?? 0)) / snap.steps.length : 0;
          if (snap.duplicate_of) patch(id, { status: "duplicate", songId: snap.duplicate_of, progress: 1, step: undefined });
          else if (snap.status === "ready") patch(id, { status: "ready", progress: 1, step: undefined });
          else if (snap.status === "failed") patch(id, { status: "failed", error: snap.error ?? "Something went wrong. Open the song to try again." });
          else patch(id, { progress, step: running ? STEP_LABEL[running.id] ?? running.label : "Waiting to start", secondsLeft: snap.estimated_seconds_left });
        } catch { /* the service may be restarting; try again on the next tick */ }
      }
    };
    tick();
    const t = setInterval(tick, 2500);
    return () => { stopped = true; clearInterval(t); };
  }, [followKey, patch]);

  // Paste a file (Finder, a file manager, or a copied attachment) anywhere in the app.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("audio/") || f.type.startsWith("video/") || /\.(mp3|wav|m4a|aac|flac|ogg|opus|aiff?|mp4|m4v|mov|webm|mkv)$/i.test(f.name));
      if (files.length) { e.preventDefault(); addFiles(files); }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addFiles]);

  const dismiss = useCallback((id: number) => setUploads((u) => u.filter((x) => x.id !== id)), []);
  const clearDone = useCallback(() => setUploads((u) => u.filter((x) => x.status === "uploading" || x.status === "processing")), []);
  const value = useMemo(() => ({ uploads, addFiles, dismiss, clearDone }), [uploads, addFiles, dismiss, clearDone]);
  return <UploadsContext.Provider value={value}>{children}</UploadsContext.Provider>;
}

export function useUploads() {
  return useContext(UploadsContext);
}
