"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, Suspense } from "react";
import { motion } from "framer-motion";
import { Moon, Plus, Sun } from "lucide-react";
import { useTheme } from "@/lib/prefs";
import { useUploads } from "@/lib/uploads";
import { UploadButton } from "./UploadZone";
import { HeaderSearch } from "./HeaderSearch";
import { AccountButton } from "./cloud/AccountButton";

/** The mark: a red disc with a note's stem, the stage light over a note. Used for the favicon and small places. */
export function Mark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={className} aria-hidden="true">
      <circle cx="14" cy="14" r="14" fill="var(--red)" />
      <circle cx="11.6" cy="17.4" r="3.6" fill="#fff" />
      <path d="M14.6 17.2V7.4c2.6.4 4.2 1.9 4.6 4.3" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** The wordmark: set in the display face, black and tight. */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link href="/" className={`wordmark text-[1.15rem] leading-none ${className}`} aria-label="NoteAlong home">NoteAlong</Link>
  );
}

export function ThemeToggle() {
  const [theme, toggle] = useTheme();
  return (
    <button className="btn btn-ghost btn-icon" onClick={toggle} aria-label={theme === "dark" ? "Switch to light" : "Switch to dark"} data-tip={theme === "dark" ? "House lights up" : "Lights down"} data-tip-pos="below-end">
      {theme === "dark" ? <Sun className="h-[18px] w-[18px]" strokeWidth={1.6} /> : <Moon className="h-[18px] w-[18px]" strokeWidth={1.6} />}
    </button>
  );
}

const NAV: [string, string][] = [["/", "Discover"], ["/my-songs", "My songs"], ["/setlists", "Setlists"]];

/** The sections as a row of words; the one you're in is the bone pill (it slides between them). */
export function MainNav({ className = "flex", id = "main" }: { className?: string; id?: string }) {
  const path = usePathname();
  return (
    <nav className={`items-center gap-1 ${className}`} aria-label="Sections">
      {NAV.map(([href, label]) => {
        const active = href === "/" ? path === "/" : path.startsWith(href);
        return (
          <Link key={href} href={href} aria-current={active ? "page" : undefined}
            className={`relative whitespace-nowrap rounded-full px-4 py-2.5 text-[0.875rem] font-medium leading-none transition-colors ${active ? "text-[var(--pill-fg)]" : "text-fg/90 hover:text-fg"}`}>
            {active && <motion.span layoutId={`nav-pill-${id}`} className="absolute inset-0 z-0 rounded-full bg-[var(--pill)]" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
            <span className="relative z-10">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * The bar at the top of every page: the wordmark, the sections in the middle (one bone pill), search, adding a
 * song, the lights and the account. It stays at the top and gains a backing once the page scrolls under it.
 */
export function AppHeader({ right, nav = true, search = true, children }: { right?: React.ReactNode; nav?: boolean; search?: boolean; children?: React.ReactNode }) {
  const { addFiles } = useUploads();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header className={`no-print sticky top-0 z-30 w-full transition-[background-color,box-shadow] duration-300 ${scrolled ? "bg-bg/92 shadow-[0_1px_0_var(--border)]" : "bg-transparent"}`}>
      <div className="relative mx-auto flex w-full max-w-[90rem] items-center justify-between gap-3 px-5 py-4 sm:px-8 lg:px-12">
        <Logo />
        {nav && <MainNav className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 md:flex" />}
        <div className="flex min-w-0 items-center gap-1 sm:gap-1.5">
          {children}
          {search && <Suspense><HeaderSearch className="hidden w-56 xl:block" /></Suspense>}
          {right ?? <UploadButton onFiles={addFiles} label="Add a song" icon={<Plus className="h-4 w-4" strokeWidth={2} />} variant="red" className="max-sm:w-10 max-sm:px-0" labelClassName="max-sm:sr-only" />}
          <ThemeToggle />
          <AccountButton />
        </div>
      </div>
      {/* phones and small tablets: the sections get a row of their own */}
      {nav && <MainNav id="phone" className="-mt-1 flex justify-center pb-3 md:hidden" />}
    </header>
  );
}

/** The search box for narrower screens, under the header (wide screens have it in the header). */
export function MobileSearch() {
  return <div className="mx-auto mb-6 w-full max-w-[90rem] px-5 sm:px-8 lg:px-12 xl:hidden"><Suspense><HeaderSearch /></Suspense></div>;
}
