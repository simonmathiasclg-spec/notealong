"use client";
// Title, artist and cover of one of your own songs. The cover comes from the file's tags when it has
// one, or is generated; here it can be replaced with any picture.
import { useRef, useState } from "react";
import { ImagePlus, Loader2, RotateCcw } from "lucide-react";
import { api } from "@/lib/api";
import type { Song } from "@/lib/types";
import { Modal } from "../Modal";

export function SongDetailsModal({ open, onClose, song, onSaved }: { open: boolean; onClose: () => void; song: Song; onSaved: (s: Song) => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Song details">
      <DetailsForm song={song} onClose={onClose} onSaved={onSaved} />
    </Modal>
  );
}

/** Mounted fresh each time the dialog opens, so the fields start from the song as it is now. */
function DetailsForm({ song, onClose, onSaved }: { song: Song; onClose: () => void; onSaved: (s: Song) => void }) {
  const [title, setTitle] = useState(song.title);
  const [artist, setArtist] = useState(song.artist ?? "");
  const [coverVersion, setCoverVersion] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const save = async () => {
    const t = title.trim();
    if (!t) { setError("Give the song a title."); return; }
    setBusy("Saving…");
    try {
      onSaved(await api.patchSong(song.id, { title: t, artist: artist.trim() }));
      onClose();
    } catch { setError("Could not save. Is the service running?"); }
    finally { setBusy(null); }
  };
  const replaceCover = async (f: File | undefined) => {
    if (!f) return;
    setBusy("Uploading the picture…"); setError(null);
    try { await api.putCover(song.id, f); setCoverVersion((v) => v + 1); }
    catch (e) { setError((e as Error).message || "That picture could not be used. Use a JPEG or PNG."); }
    finally { setBusy(null); }
  };
  const resetCover = async () => {
    setBusy("Putting the cover back…");
    try { await api.deleteCover(song.id); setCoverVersion((v) => v + 1); } finally { setBusy(null); }
  };

  return (
      <div className="flex flex-col gap-6 sm:flex-row">
        <div className="shrink-0">
          <button type="button" className="tile relative block h-40 w-40 overflow-hidden rounded-[1rem] shadow-card" onClick={() => file.current?.click()} aria-label="Replace the cover picture" disabled={!!busy}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={api.uploadCoverUrl(song.id, coverVersion + 1)} alt="" className="h-full w-full object-cover" />
            <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 bg-black/55 py-2 text-xs font-medium text-white"><ImagePlus className="h-3.5 w-3.5" /> Replace</span>
          </button>
          <input ref={file} type="file" accept="image/jpeg,image/png" className="hidden" onChange={(e) => { replaceCover(e.target.files?.[0]); e.target.value = ""; }} />
          <button type="button" className="mt-2 inline-flex items-center gap-1 text-xs text-muted hover:text-fg" onClick={resetCover} disabled={!!busy}><RotateCcw className="h-3 w-3" /> Use the original cover</button>
        </div>
        <div className="min-w-0 flex-1 space-y-4">
          <label className="block text-sm">
            <div className="mb-1.5">Title</div>
            <input className="field w-full" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} autoFocus />
          </label>
          <label className="block text-sm">
            <div className="mb-1.5">Artist</div>
            <input className="field w-full" value={artist} onChange={(e) => setArtist(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} placeholder="Unknown artist" />
          </label>
          <p className="text-xs text-faint">Read from the file&apos;s tags when it had them. The picture and the song stay private to you.</p>
          {error && <p className="text-sm text-danger" role="alert">{error}</p>}
          <div className="flex items-center justify-end gap-2 pt-2">
            {busy && <span className="mr-auto inline-flex items-center gap-1.5 text-xs text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {busy}</span>}
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={!!busy}>Save</button>
          </div>
        </div>
      </div>
  );
}
