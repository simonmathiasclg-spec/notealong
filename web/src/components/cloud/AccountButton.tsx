"use client";
// Online version: the signed-in user's initial in the header, opening their account page.
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/cloud/browser";
import { CLOUD } from "@/lib/cloud/config";

export function AccountButton() {
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    if (!CLOUD) return;
    supabase().auth.getSession().then(({ data }) => setEmail(data.session?.user.email ?? null));
  }, []);
  if (!CLOUD || !email) return null;
  return (
    <Link href="/account" className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border bg-elev text-sm font-semibold uppercase text-fg hover:border-border-strong" aria-label="Your account" data-tip={email} data-tip-pos="below-end">
      {email[0]}
    </Link>
  );
}
