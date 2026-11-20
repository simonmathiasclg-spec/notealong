"use client";
// Online version: the signed-in user's initial in the header, opening their account page; "Sign in" for a guest.
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/cloud/browser";
import { CLOUD } from "@/lib/cloud/config";
import { useMe } from "@/lib/me";
import { signInHref } from "./Prompts";

export function AccountButton() {
  const { signedIn } = useMe();
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    if (!CLOUD || !signedIn) return;
    supabase().auth.getSession().then(({ data }) => setEmail(data.session?.user.email ?? null));
  }, [signedIn]);
  if (!CLOUD || signedIn === null) return null;
  if (!signedIn) return <Link href={signInHref()} className="btn btn-ghost hidden sm:inline-flex">Sign in</Link>;
  if (!email) return null;
  return (
    <Link href="/account" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--pill)] font-display text-sm font-black uppercase text-[var(--pill-fg)] transition hover:opacity-85" aria-label="Your account" data-tip={email} data-tip-pos="below-end">
      {email[0]}
    </Link>
  );
}
