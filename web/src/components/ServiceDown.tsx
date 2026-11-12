export function ServiceDown({ what = "songs" }: { what?: string }) {
  return (
    <div className="border-y border-border py-8" role="alert">
      <p className="flex items-center gap-3 text-[13px] font-medium text-[var(--red-text)]"><span className="h-2 w-2 rounded-full bg-red shadow-[0_0_0_5px_color-mix(in_srgb,var(--red)_20%,transparent)]" aria-hidden="true" /> Not connected</p>
      <h2 className="display-lg mt-3 text-[clamp(1.6rem,3.6vw,2.4rem)]">The NoteAlong service isn&apos;t running, so {what} can&apos;t load</h2>
      <p className="mt-3 text-[14px] text-muted">Open a terminal in the project folder, run <code className="kbd">./start.sh</code>, then refresh this page.</p>
    </div>
  );
}
