import { ViewTransition } from "react";

/** Pages cross-fade (a short fade out, a slower fade and rise in); a song's artwork morphs on its own (see Art.tsx). */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition default="page">
      <div className="flex min-h-full flex-1 flex-col">{children}</div>
    </ViewTransition>
  );
}
