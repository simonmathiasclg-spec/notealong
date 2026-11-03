"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/prefs";
import { useUploads } from "@/lib/uploads";
import { UploadButton } from "./UploadZone";

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

const NAV: [string, string][] = [["/", "Discover"], ["/my-songs", "My songs"]];

export function MainNav() {
  const path = usePathname();
  return (
    <nav className="seg" aria-label="Sections">
      {NAV.map(([href, label]) => {
        const active = href === "/" ? path === "/" : path.startsWith(href);
        return <Link key={href} href={href} aria-current={active ? "page" : undefined} aria-pressed={active} role="button">{label}</Link>;
      })}
    </nav>
  );
}

export function AppHeader({ right, nav = true }: { right?: React.ReactNode; nav?: boolean }) {
  const { addFiles } = useUploads();
  return (
    <header className="no-print flex items-center justify-between gap-4 px-5 py-4 sm:px-8">
      <div className="flex items-center gap-6"><Logo />{nav && <MainNav />}</div>
      <div className="flex items-center gap-2">{right ?? <UploadButton onFiles={addFiles} />}<ThemeToggle /></div>
    </header>
  );
}
