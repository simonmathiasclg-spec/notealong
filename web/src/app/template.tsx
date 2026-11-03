"use client";
import { motion } from "framer-motion";

/** A quiet fade between pages. The player manages its own entrance. */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }} className="flex min-h-full flex-1 flex-col">
      {children}
    </motion.div>
  );
}
