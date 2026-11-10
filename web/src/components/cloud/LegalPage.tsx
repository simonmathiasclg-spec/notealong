// The frame of the Terms and Privacy pages: readable text, a clear "draft" notice, links back.
import Link from "next/link";
import { Logo, ThemeToggle } from "../AppHeader";

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-5 py-5 sm:px-8"><Logo /><ThemeToggle /></header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 pb-20 pt-4 sm:px-8">
        <h1 className="display-lg text-[2.2rem]">{title}</h1>
        <p className="mt-2 text-sm text-muted">Last updated {updated}</p>
        <p className="mt-5 rounded-xl border border-dashed border-border-strong px-4 py-3 text-sm text-muted">
          Draft for the private beta. It has not yet been reviewed by a lawyer and will change before NoteAlong opens to everyone.
        </p>
        <div className="legal mt-8 space-y-4 text-[0.98rem] leading-relaxed [&_h2]:mt-9 [&_h2]:font-display [&_h2]:text-[1.3rem] [&_h2]:font-medium [&_li]:ml-5 [&_li]:list-disc [&_li]:pl-1 [&_ul]:space-y-1.5">
          {children}
        </div>
        <p className="mt-12 flex gap-5 text-sm text-faint">
          <Link href="/terms" className="hover:text-fg">Terms</Link>
          <Link href="/privacy" className="hover:text-fg">Privacy</Link>
          <Link href="/" className="hover:text-fg">Back to NoteAlong</Link>
        </p>
      </main>
    </div>
  );
}
