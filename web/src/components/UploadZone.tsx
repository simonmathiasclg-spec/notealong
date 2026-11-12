"use client";
import { Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

/** Audio and video files; a video's soundtrack is used. Kept in one place with the drop filter. */
export const ACCEPT_EXT = /\.(mp3|wav|m4a|aac|flac|ogg|oga|opus|aiff?|wma|m4b|caf|mp4|m4v|mov|webm|mkv|avi|mpe?g|3gp)$/i;
export const ACCEPT = ".mp3,.wav,.m4a,.aac,.flac,.ogg,.opus,.aiff,.aif,.wma,.mp4,.m4v,.mov,.webm,.mkv,.avi,audio/*,video/*";

export function UploadButton({ onFiles, big = false, label = "Add a song", icon, className = "", labelClassName = "", variant = "primary" }: { onFiles: (files: File[]) => void; big?: boolean; label?: string; icon?: React.ReactNode; className?: string; labelClassName?: string; variant?: "primary" | "plain" | "red" }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" accept={ACCEPT} multiple className="hidden" onChange={(e) => { onFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      <button className={`btn ${variant === "primary" ? "btn-primary" : variant === "red" ? "btn-red" : ""} ${big ? "btn-lg" : ""} ${className}`} onClick={() => ref.current?.click()} aria-label={labelClassName ? label : undefined}>
        {icon ?? <Upload className="h-4 w-4" />} <span className={labelClassName}>{label}</span>
      </button>
    </>
  );
}

/** Whole-page drag and drop. Shows an overlay while a file is dragged over the window. */
export function PageDropZone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const [active, setActive] = useState(false);
  const depth = useRef(0);
  const handle = useCallback((files: File[]) => {
    const ok = files.filter((f) => ACCEPT_EXT.test(f.name) || f.type.startsWith("audio/") || f.type.startsWith("video/"));
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
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none fixed inset-0 z-50 flex flex-col items-center justify-center bg-bg/90 p-6 text-center">
          <motion.span initial={{ scale: 0.92, y: 12 }} animate={{ scale: 1, y: 0 }} transition={{ type: "spring", stiffness: 300, damping: 24 }}
            className="display-hero text-[clamp(4rem,14vw,11rem)] text-red">Drop it in</motion.span>
          <span className="mt-5 text-[15px] text-muted">Let go to add the song. It stays private to you.</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
