"use client";
import { Heart } from "lucide-react";
import { useMe } from "@/lib/me";

/** The heart. `overlay` sits on a cover and only shows on hover unless the song is a favourite. */
export function FavouriteButton({ id, title, variant = "button", className = "" }: { id: string; title: string; variant?: "button" | "overlay" | "icon"; className?: string }) {
  const { isFavourite, toggleFavourite } = useMe();
  const on = isFavourite(id);
  const label = on ? `Remove ${title} from favourites` : `Add ${title} to favourites`;
  const icon = <Heart className={`h-4 w-4 ${on ? "fill-current" : ""}`} strokeWidth={1.6} />;
  const click = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); toggleFavourite(id); };
  if (variant === "overlay") {
    return (
      <button onClick={click} aria-pressed={on} aria-label={label}
        className={`absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-full text-white transition hover:bg-white/15 focus-visible:opacity-100 ${on ? "opacity-100 !text-[#ff4a3d]" : "opacity-0 group-hover/tile:opacity-100"} ${className}`}>
        {icon}
      </button>
    );
  }
  if (variant === "icon") {
    return <button onClick={click} aria-pressed={on} aria-label={label} data-tip={on ? "In your favourites" : "Add to favourites"} className={`btn btn-ghost btn-icon ${on ? "!text-[var(--red-text)]" : ""} ${className}`}>{icon}</button>;
  }
  return <button onClick={click} aria-pressed={on} className={`btn ${on ? "!text-[var(--red-text)]" : ""} ${className}`}>{icon} {on ? "Favourite" : "Add to favourites"}</button>;
}
