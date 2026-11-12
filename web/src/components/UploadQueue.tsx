"use client";
// The queue of songs being added: uploading, processing, ready, or needing attention. Floats at the
// bottom right on every page except the song being looked at, so browsing and playing can go on.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, Check, Copy, Loader2, Play, X } from "lucide-react";
import { useUploads, type Upload } from "@/lib/uploads";

function Row({ u, onDismiss }: { u: Upload; onDismiss: () => void }) {
  const name = u.title ?? u.name.replace(/\.[^.]+$/, "");
  const open = u.songId ? `/songs/${u.songId}` : null;
  const icon = u.status === "ready" ? <Check className="h-4 w-4 text-ok" strokeWidth={2} />
    : u.status === "failed" ? <AlertCircle className="h-4 w-4 text-danger" />
    : u.status === "duplicate" ? <Copy className="h-4 w-4 text-muted" />
    : <Loader2 className="h-4 w-4 animate-spin text-fg" strokeWidth={1.8} />;
  const line = u.status === "uploading" ? `Uploading, ${Math.round(u.progress * 100)}%`
    : u.status === "processing" ? `${u.step ?? "Working"}…${u.secondsLeft && u.secondsLeft > 5 ? ` about ${u.secondsLeft < 60 ? `${Math.round(u.secondsLeft / 5) * 5} s` : `${Math.ceil(u.secondsLeft / 60)} min`} left` : ""}`
    : u.status === "ready" ? "Ready to play"
    : u.status === "duplicate" ? "Already in My songs"
    : u.error ?? "Something went wrong";
  const body = (
    <>
      <div className="grid h-8 w-8 shrink-0 place-items-center">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{name}</div>
        <div className={`truncate text-xs ${u.status === "failed" ? "text-danger" : "text-muted"}`}>{line}</div>
        {(u.status === "uploading" || u.status === "processing") && (
          <div className="mt-2 h-px overflow-hidden bg-border-strong"><div className="h-full bg-fg transition-[width] duration-500" style={{ width: `${Math.max(3, u.progress * 100)}%` }} /></div>
        )}
      </div>
    </>
  );
  return (
    <motion.li layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="group flex items-center gap-2 px-3 py-2.5">
      {open ? <Link href={open} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg outline-offset-4">{body}</Link> : <div className="flex min-w-0 flex-1 items-center gap-2">{body}</div>}
      {u.status === "ready" && open && <Link href={open} className="btn btn-sm" aria-label={`Play ${name}`}><Play className="h-3.5 w-3.5 fill-current" /> Play</Link>}
      {(u.status === "failed" && open) && <Link href={open} className="btn btn-sm">Open</Link>}
      {u.status !== "uploading" && <button onClick={onDismiss} className="rounded-full p-1.5 text-faint hover:bg-sunken hover:text-fg" aria-label={`Remove ${name} from the list`}><X className="h-3.5 w-3.5" /></button>}
    </motion.li>
  );
}

export function UploadQueue() {
  const { uploads, dismiss, clearDone } = useUploads();
  const path = usePathname();
  // on a song's own page its progress is the whole screen already
  const visible = uploads.filter((u) => !(u.songId && path === `/songs/${u.songId}`));
  const working = visible.filter((u) => u.status === "uploading" || u.status === "processing").length;
  const failed = visible.filter((u) => u.status === "failed").length;
  const done = visible.length - working;
  return (
    <AnimatePresence>
      {visible.length > 0 && (
        <motion.aside
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }} transition={{ type: "spring", stiffness: 380, damping: 32 }}
          className="no-print fixed left-3 right-3 top-3 z-40 overflow-hidden rounded-[1.5rem] bg-elev shadow-[0_30px_60px_-20px_rgba(0,0,0,.8)] sm:bottom-6 sm:left-6 sm:right-auto sm:top-auto sm:w-[22rem]"
          aria-label="Songs being added" aria-live="polite"
        >
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
            <div className="font-display text-[15px] font-bold tracking-[-0.01em]">
              {working > 0 ? `Adding ${working === 1 ? "a song" : `${working} songs`}` : failed === done ? (failed === 1 ? "A song could not be added" : "These could not be added") : done === 1 ? "Song added" : `${done} songs added`}
            </div>
            {done > 0 && <button className="text-xs text-muted hover:text-fg" onClick={clearDone}>Clear finished</button>}
          </div>
          <ul className="max-h-[50vh] divide-y divide-border overflow-y-auto">
            <AnimatePresence initial={false}>
              {visible.map((u) => <Row key={u.id} u={u} onDismiss={() => dismiss(u.id)} />)}
            </AnimatePresence>
          </ul>
          {working > 0 && <div className="px-4 py-2 text-xs text-faint">Songs are processed one after another. Keep browsing or playing; this list follows you.</div>}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
