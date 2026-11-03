"use client";
import { MotionConfig } from "framer-motion";

/** Honours the system "reduce motion" setting for every animation in the app. */
export function Motion({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
