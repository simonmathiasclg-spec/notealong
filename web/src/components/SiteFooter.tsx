import Link from "next/link";
import { CLOUD } from "@/lib/cloud/config";

/** The end of a page: the wordmark large and red, where the built-in songs come from, and the small print. */
export function SiteFooter() {
  return (
    <footer className="no-print mx-auto mt-16 w-full max-w-[90rem] border-t border-border px-5 pb-10 pt-12 sm:px-8 lg:px-12">
      <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <Link href="/" className="wordmark block text-[clamp(2.6rem,6vw,4.4rem)] leading-[0.9] text-red" aria-label="NoteAlong home">NoteAlong</Link>
          <p className="mt-4 max-w-sm text-[13px] leading-relaxed text-muted">The note to play above every word of a song, while the band plays. For saxophones, flutes, trumpets, violins and voices.</p>
        </div>
        <div>
          <h2 className="mb-3 text-[12px] font-medium text-faint">Songs</h2>
          <ul className="space-y-2 text-[14px]">
            <li><Link href="/" className="hover:text-fg text-muted">Discover</Link></li>
            <li><Link href="/browse" className="hover:text-fg text-muted">All built-in songs</Link></li>
            <li><Link href="/my-songs" className="hover:text-fg text-muted">My songs</Link></li>
            <li><Link href="/setlists" className="hover:text-fg text-muted">Setlists</Link></li>
          </ul>
        </div>
        <div>
          <h2 className="mb-3 text-[12px] font-medium text-faint">Where the songs come from</h2>
          <p className="text-[13px] leading-relaxed text-muted">Built-in songs are public domain or shared under Creative Commons; each song&apos;s page says where it comes from. Your own uploads stay private to you.</p>
          {CLOUD && <p className="mt-3 flex gap-4 text-[13px]"><Link href="/terms" className="text-muted hover:text-fg">Terms</Link><Link href="/privacy" className="text-muted hover:text-fg">Privacy</Link></p>}
        </div>
      </div>
    </footer>
  );
}
