"use client";
// The first thing on Discover and on an empty My songs: a big place to drop a song you love.
// The catalog sits under it as the way to start playing while the upload is processed.
import Link from "next/link";
import { ClipboardPaste, Play, Upload } from "lucide-react";
import { useRef } from "react";
import { Cover, Meta } from "@/components/discover/Discover";
import { ACCEPT } from "@/components/UploadZone";
import { useUploads } from "@/lib/uploads";
import { uploadsLeftText, useEntitlements } from "@/lib/entitlements";
import type { CatalogEntry } from "@/lib/types";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export function DropHero({ pick, firstRun = false }: { pick?: CatalogEntry | null; firstRun?: boolean }) {
  const { addFiles, uploads } = useUploads();
  const input = useRef<HTMLInputElement>(null);
  const entitlements = useEntitlements([uploads.length]);
  const left = uploadsLeftText(entitlements);
  const working = uploads.some((u) => u.status === "uploading" || u.status === "processing");
  return (
    <section className="panel relative isolate overflow-hidden" aria-label="Add a song you love">
      <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[1fr_auto] lg:items-stretch">
        <div
          role="button" tabIndex={0}
          onClick={() => input.current?.click()}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.current?.click(); } }}
          className="group flex cursor-pointer flex-col justify-center rounded-[1.1rem] border-2 border-dashed border-border px-6 py-8 text-center outline-offset-4 transition hover:border-accent hover:bg-hover sm:px-10 sm:py-10"
        >
          <input ref={input} type="file" accept={ACCEPT} multiple className="hidden" onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
          <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-[1.1rem] border border-border bg-elev text-accent transition group-hover:-translate-y-0.5"><Upload className="h-7 w-7" /></div>
          <h1 className="display-lg text-[2.1rem] leading-[1.05] sm:text-[2.8rem]">Drop in a song you love</h1>
          <p className="mx-auto mt-4 max-w-md text-[0.98rem] leading-relaxed text-muted">
            Any MP3, M4A, WAV or FLAC, or a video. NoteAlong separates the singer from the band, finds the notes of the melody and lines them up with the words. Then you play it over the real band.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-3">
            <span className="btn btn-primary btn-lg"><Upload className="h-4 w-4" /> Choose a file</span>
            <span className="hidden items-center gap-1.5 text-sm text-muted sm:inline-flex"><ClipboardPaste className="h-4 w-4" /> or paste one with {isMac ? "⌘V" : "Ctrl+V"}</span>
          </div>
          <p className="mt-5 text-xs text-faint">Several files at once are fine. Your songs stay private to you.{left ? ` ${left}.` : ""}</p>
        </div>

        {pick ? (
          <div className="flex flex-col justify-center gap-4 lg:w-64 lg:border-l lg:border-border lg:pl-8">
            <div className="text-sm font-medium text-muted">{working ? "Play this while it processes" : "Or start with this one"}</div>
            <Link href={`/songs/${pick.id}`} className="tile" aria-label={`Play ${pick.title}`}>
              <Cover song={pick} priority className="rounded-[1rem] shadow-card" />
            </Link>
            <div className="min-w-0">
              <div className="truncate font-semibold">{pick.title}</div>
              <div className="truncate text-sm text-muted">{pick.artist}</div>
              <Meta song={pick} className="mt-1.5 text-xs" />
            </div>
            <Link href={`/songs/${pick.id}`} className="btn w-full"><Play className="h-4 w-4 fill-current" /> Play now</Link>
          </div>
        ) : firstRun ? (
          <div className="flex flex-col justify-center gap-3 text-sm text-muted lg:w-64 lg:border-l lg:border-border lg:pl-8">
            <p>Want to play something right now?</p>
            <Link href="/" className="btn w-full">Pick a built-in song</Link>
            <p className="text-xs text-faint">Built-in songs are public domain or Creative Commons and start instantly.</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
