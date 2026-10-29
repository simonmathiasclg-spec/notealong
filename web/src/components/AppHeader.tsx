"use client";
import Link from "next/link";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/prefs";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link href="/" className={`flex items-center gap-2 font-display text-lg font-extrabold tracking-tight ${className}`}>
      <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-accent-fg text-sm">♪</span>
      NoteAlong
    </Link>
  );
}

export function ThemeToggle() {
  const [theme, toggle] = useTheme();
  return (
    <button className="btn btn-ghost btn-icon" onClick={toggle} aria-label="Switch light or dark mode" title="Light / dark">
      {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}

export function AppHeader({ right }: { right?: React.ReactNode }) {
  return (
    <header className="no-print flex items-center justify-between px-5 py-4 sm:px-8">
      <Logo />
      <div className="flex items-center gap-2">{right}<ThemeToggle /></div>
    </header>
  );
}
