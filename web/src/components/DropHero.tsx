"use client";
// Adding your own song: on Discover (under the ring of built-in songs) and on an empty My songs. The whole band
// is the place to drop a file; a record waits on the left and turns when a file comes near.
import Link from "next/link";
import { useRef, useState } from "react";
import { ClipboardPaste, Plus } from "lucide-react";
import { ACCEPT } from "@/components/UploadZone";
import { useUploads } from "@/lib/uploads";
import { cannotUpload, uploadsLeftText, useEntitlements } from "@/lib/entitlements";
import { PaidInterestButton, PaidPlansCopy, signInHref } from "@/components/cloud/Prompts";
import type { CatalogEntry } from "@/lib/types";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** A record: grooves, a red label and a spindle. It spins while something is being added or dragged over. */
export function Record({ spinning = false, className = "" }: { spinning?: boolean; className?: string }) {
  return (
    <span className={`relative block aspect-square rounded-full ${className}`} aria-hidden="true"
      style={{ background: "repeating-radial-gradient(circle at 50% 50%, #151210 0 1.5px, #0d0b0a 1.5px 3.2px)", boxShadow: "0 40px 80px -30px rgb(0 0 0 / .8), inset 0 0 0 1px rgb(255 255 255 / .05)" }}>
      <span className={`absolute inset-0 rounded-full ${spinning ? "animate-[spin_2.4s_linear_infinite]" : "transition-transform duration-700 group-hover:rotate-[24deg]"}`}
        style={{ background: "conic-gradient(from 20deg, transparent 0 12%, rgb(255 255 255 / .09) 16%, transparent 22% 58%, rgb(255 255 255 / .06) 63%, transparent 68%)" }} />
      <span className="absolute inset-[33%] grid place-items-center rounded-full bg-red text-white">
        <Plus className="h-[38%] w-[38%]" strokeWidth={2.2} />
      </span>
    </span>
  );
}

export function DropHero({ firstRun = false }: { pick?: CatalogEntry | null; firstRun?: boolean }) {
  const { addFiles, uploads } = useUploads();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const entitlements = useEntitlements();
  const left = uploadsLeftText(entitlements);
  const working = uploads.some((u) => u.status === "uploading" || u.status === "processing");
  const blocked = cannotUpload(entitlements);
  if (blocked === "used") {
    return (
      <section aria-label="Your free song is used" className="grid items-center gap-8 border-y border-border py-10 sm:py-14 md:grid-cols-[minmax(0,17rem)_1fr] md:gap-14">
        <Record className="mx-auto w-44 opacity-60 sm:w-56 md:w-full" />
        <div className="text-center md:text-left">
          <h2 className="display-xl text-[clamp(2.2rem,5vw,4rem)]">You&apos;ve used your free song. Paid plans are coming soon.</h2>
          <div className="mx-auto mt-5 max-w-xl md:mx-0"><PaidPlansCopy /></div>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3 md:justify-start">
            <PaidInterestButton />
            <Link href="/my-songs" className="btn">My songs</Link>
          </div>
        </div>
      </section>
    );
  }
  if (blocked === "guest") {
    return (
      <section aria-label="Convert your own song" className="grid items-center gap-8 border-y border-border py-10 sm:py-14 md:grid-cols-[minmax(0,17rem)_1fr] md:gap-14">
        <Link href={signInHref("/my-songs?add=1")} className="group" aria-hidden="true" tabIndex={-1}><Record className="mx-auto w-44 sm:w-56 md:w-full" /></Link>
        <div className="text-center md:text-left">
          <h2 className="display-xl text-[clamp(2.4rem,5.6vw,4.6rem)]">Your songs, too</h2>
          <p className="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-muted md:mx-0">
            Bring an MP3, M4A, WAV or FLAC, or a video. NoteAlong takes the singer out, finds the notes of the melody and lines them up with the words. Then you play it over the real band.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-3 md:justify-start">
            <Link href={signInHref("/my-songs?add=1")} className="btn btn-red btn-lg">Sign up free to convert your own song</Link>
          </div>
          <p className="mt-5 text-[12px] text-faint">One song of your own is free with an account. The built-in songs above are free to play without one.</p>
        </div>
      </section>
    );
  }
  return (
    <section aria-label="Add a song you love"
      className="group relative grid cursor-pointer items-center gap-8 border-y border-border py-10 outline-offset-8 sm:py-14 md:grid-cols-[minmax(0,17rem)_1fr] md:gap-14"
      role="button" tabIndex={0}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.current?.click(); } }}
      onDragEnter={() => setOver(true)} onDragLeave={() => setOver(false)} onDrop={() => setOver(false)}
    >
      <input ref={input} type="file" accept={ACCEPT} multiple className="hidden" onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      <Record spinning={over || working} className="mx-auto w-44 sm:w-56 md:w-full" />
      <div className="text-center md:text-left">
        <h2 className="display-xl text-[clamp(2.4rem,5.6vw,4.6rem)]">{firstRun ? "Start with a song you love" : "Your songs, too"}</h2>
        <p className="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-muted md:mx-0">
          Drop in any MP3, M4A, WAV or FLAC, or a video. NoteAlong takes the singer out, finds the notes of the melody and lines them up with the words. Then you play it over the real band.
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-3 md:justify-start">
          <span className="btn btn-primary btn-lg">Choose a file</span>
          <span className="hidden items-center gap-1.5 text-[13px] text-muted sm:inline-flex"><ClipboardPaste className="h-4 w-4" strokeWidth={1.6} /> or drop it here, or paste it with {isMac ? "⌘V" : "Ctrl+V"}</span>
        </div>
        <p className="mt-5 text-[12px] text-faint">{entitlements?.plan === "free" ? "Your song stays private to you." : "Several at once is fine. Your songs stay private to you."}{left ? ` ${left}.` : ""}</p>
        {firstRun && (
          <p className="mt-3 text-[13px] text-muted">Want to play right now? <Link href="/" onClick={(e) => e.stopPropagation()} className="font-medium text-fg underline decoration-border-strong underline-offset-4 hover:decoration-fg">Pick a built-in song</Link>.</p>
        )}
      </div>
    </section>
  );
}
