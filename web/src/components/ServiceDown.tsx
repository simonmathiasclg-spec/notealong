import { AlertCircle } from "lucide-react";

export function ServiceDown({ what = "songs" }: { what?: string }) {
  return (
    <div className="panel flex items-start gap-3 p-5 text-sm" role="alert">
      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
      <div>
        <div className="font-semibold">The NoteAlong service isn&apos;t running, so {what} can&apos;t load.</div>
        <div className="mt-1 text-muted">Open a terminal in the project folder, run <code className="kbd">./start.sh</code>, then refresh this page.</div>
      </div>
    </div>
  );
}
