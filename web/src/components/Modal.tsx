"use client";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect } from "react";

export function Modal({ open, onClose, title, children, wide = false, size }: { open: boolean; onClose?: () => void; title?: string; children: React.ReactNode; wide?: boolean; size?: "md" | "lg" | "xl" }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-[2px] sm:items-center sm:p-6"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            role="dialog" aria-modal="true" aria-label={title}
            className={`floating w-full ${size === "xl" ? "max-w-3xl" : size === "lg" || wide ? "max-w-2xl" : "max-w-lg"} max-h-[90vh] overflow-y-auto rounded-b-none p-6 sm:rounded-b-2xl sm:p-7`}
            initial={{ y: 28, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 20, opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
            onClick={(e) => e.stopPropagation()}
          >
            {(title || onClose) && (
              <div className="mb-5 flex items-center justify-between">
                <h2 className="display-md text-xl">{title}</h2>
                {onClose && <button className="btn btn-ghost btn-icon -mr-2" onClick={onClose} aria-label="Close"><X className="h-5 w-5" /></button>}
              </div>
            )}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
