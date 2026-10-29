"use client";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect } from "react";

export function Modal({ open, onClose, title, children, wide = false }: { open: boolean; onClose?: () => void; title?: string; children: React.ReactNode; wide?: boolean }) {
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
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-6"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            role="dialog" aria-modal="true"
            className={`card w-full ${wide ? "max-w-2xl" : "max-w-lg"} max-h-[90vh] overflow-y-auto rounded-b-none sm:rounded-b-2xl p-6`}
            initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 24, opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
          >
            {(title || onClose) && (
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-display text-xl font-bold">{title}</h2>
                {onClose && (
                  <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close"><X className="h-5 w-5" /></button>
                )}
              </div>
            )}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
