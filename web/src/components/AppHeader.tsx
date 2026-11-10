"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Moon, Plus, Sun } from "lucide-react";
import { useTheme } from "@/lib/prefs";
import { useUploads } from "@/lib/uploads";
import { UploadButton } from "./UploadZone";
import { HeaderSearch } from "./HeaderSearch";
import { Suspense } from "react";
import { AccountButton } from "./cloud/AccountButton";

/** The mark: a stage light over a note. */
export function Mark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={className} aria-hidden="true">
      <rect width="28" height="28" rx="8" fill="var(--accent)" />
      <path d="M11.5 19.5V8.8l7-1.6v9.3" fill="none" stroke="var(--accent-fg)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="9.3" cy="19.6" r="2.3" fill="var(--accent-fg)" />
      <circle cx="16.3" cy="16.6" r="2.3" fill="var(--accent-fg)" />
    </svg>
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link href="/" className={`flex items-center gap-2.5 font-display text-[1.35rem] font-medium tracking-tight ${className}`} aria-label="NoteAlong home">
      <Mark />
      <span>NoteAlong</span>
    </Link>
  );
}

export function ThemeToggle() {
  const [theme, toggle] = useTheme();
  return (
    <button className="btn btn-ghost btn-icon" onClick={toggle} aria-label={theme === "dark" ? "Switch to light" : "Switch to dark"} data-tip={theme === "dark" ? "House lights up" : "Lights down"} data-tip-pos="below-end">
      {theme === "dark" ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
    </button>
  );
}

const NAV: [string, string][] = [["/", "Discover"], ["/my-songs", "My songs"], ["/setlists", "Setlists"]];

export function MainNav({ className = "flex" }: { className?: string }) {
  const path = usePathname();
  return (
    <nav className={`items-center gap-1 ${className}`} aria-label="Sections">
      {NAV.map(([href, label]) => {
        const active = href === "/" ? path === "/" : path.startsWith(href);
        return (
          <Link key={href} href={href} aria-current={active ? "page" : undefined}
            className={`relative whitespace-nowrap rounded-full px-3 py-2 text-[0.9375rem] transition sm:px-3.5 ${active ? "font-semibold text-fg" : "font-medium text-muted hover:text-fg"}`}>
            {label}
            {active && <span className="absolute inset-x-3 -bottom-0.5 h-0.5 rounded-full bg-fg sm:inset-x-3.5" />}
          </Link>
        );
      })}
    </nav>
  );
}

export function AppHeader({ right, nav = true, search = true, children }: { right?: React.ReactNode; nav?: boolean; search?: boolean; children?: React.ReactNode }) {
  const { addFiles } = useUploads();
  return (
    <header className="no-print mx-auto w-full max-w-7xl px-5 py-4 sm:px-8 sm:py-5">
      <div className="flex items-center justify-between gap-3 sm:gap-4">
        <div className="flex min-w-0 items-center gap-5 sm:gap-8"><Logo />{nav && <MainNav className="hidden sm:flex" />}</div>
        <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
          {children}
          {search && <Suspense><HeaderSearch className="hidden w-72 lg:block" /></Suspense>}
          {right ?? <UploadButton onFiles={addFiles} label="Add a song" icon={<Plus className="h-4 w-4" />} variant="plain" className="max-sm:w-10 max-sm:px-0" labelClassName="max-sm:sr-only" />}
          <ThemeToggle />
          <AccountButton />
        </div>
      </div>
      {/* phones: the sections get a row of their own under the logo */}
      {nav && <MainNav className="-mx-3 mt-2 flex sm:hidden" />}
    </header>
  );
}

/** The search box for narrow screens, under the header (wide screens have it in the header). */
export function MobileSearch() {
  return <div className="mx-auto mb-6 w-full max-w-7xl px-5 sm:px-8 lg:hidden"><Suspense><HeaderSearch /></Suspense></div>;
}
