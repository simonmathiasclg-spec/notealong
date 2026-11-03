"use client";
import { Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

const ACCEPT = ".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a";

export function UploadButton({ onFiles, big = false, label = "Add a song", icon, className = "", variant = "primary" }: { onFiles: (files: File[]) => void; big?: boolean; label?: string; icon?: React.ReactNode; className?: string; variant?: "primary" | "plain" }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" accept={ACCEPT} multiple className="hidden" onChange={(e) => { onFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      <button className={`btn ${variant === "primary" ? "btn-primary" : ""} ${big ? "btn-lg" : ""} ${className}`} onClick={() => ref.current?.click()}>
        {icon ?? <Upload className="h-4 w-4" />} {label}
      </button>
    </>
  );
}

/** Whole-page drag and drop. Shows an overlay while a file is dragged over the window. */
export function PageDropZone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const [active, setActive] = useState(false);
  const depth = useRef(0);
  const handle = useCallback((files: File[]) => {
    const ok = files.filter((f) => /\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(f.name));
    if (ok.length) onFiles(ok);
  }, [onFiles]);
  useEffect(() => {
    const enter = (e: DragEvent) => { e.preventDefault(); depth.current++; setActive(true); };
    const leave = (e: DragEvent) => { e.preventDefault(); depth.current--; if (depth.current <= 0) { depth.current = 0; setActive(false); } };
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => { e.preventDefault(); depth.current = 0; setActive(false); handle(Array.from(e.dataTransfer?.files ?? [])); };
    window.addEventListener("dragenter", enter); window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over); window.addEventListener("drop", drop);
    return () => { window.removeEventListener("dragenter", enter); window.removeEventListener("dragleave", leave); window.removeEventListener("dragover", over); window.removeEventListener("drop", drop); };
  }, [handle]);
  return (
    <AnimatePresence>
      {active && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-bg/70 p-6 backdrop-blur-sm">
          <div className="floating flex items-center gap-3 border-2 border-dashed border-accent px-8 py-6 text-lg font-medium">
            <Upload className="h-6 w-6 text-accent" /> Drop the song to add it
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
