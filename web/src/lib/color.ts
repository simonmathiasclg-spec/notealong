/**
 * The accent ("now") colour. Coral by default; on a song page it takes the hue
 * of the song's cover art. Lightness is fixed per theme and then nudged until
 * the colour reads against the background, so every hue stays legible.
 */
export const DEFAULT_HUE = 8; // coral

export type Accent = { accent: string; accentStrong: string; accentSoft: string; accentFg: string };

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("");
}

export function luminance([r, g, b]: [number, number, number]): number {
  const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG contrast ratio between two colours (1..21). */
export function contrast(a: string, b: string): number {
  const la = luminance(hexToRgb(a)), lb = luminance(hexToRgb(b));
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Accent colours for a hue on a given background. Yellows and cyans are
 * naturally lighter than blues and reds, so lightness is adjusted until the
 * contrast against the background is at least `minContrast`.
 */
export function accentFor(hue: number | null | undefined, theme: "dark" | "light", bg?: string, minContrast = 4.5): Accent {
  const h = hue == null || Number.isNaN(hue) ? DEFAULT_HUE : hue;
  const background = bg ?? (theme === "dark" ? "#0c0e14" : "#f3f2ee");
  const sat = theme === "dark" ? 88 : 72;
  let l = theme === "dark" ? 64 : 44;
  let hex = rgbToHex(hslToRgb(h, sat, l));
  // move away from the background until it reads
  for (let i = 0; i < 20 && contrast(hex, background) < minContrast; i++) {
    l += theme === "dark" ? 2 : -2;
    hex = rgbToHex(hslToRgb(h, sat, l));
  }
  const strong = rgbToHex(hslToRgb(h, sat, theme === "dark" ? Math.min(90, l + 10) : Math.max(20, l - 8)));
  const fg = contrast(hex, "#000000") >= contrast(hex, "#ffffff") ? "#13100e" : "#ffffff";
  const [r, g, b] = hexToRgb(hex);
  return { accent: hex, accentStrong: strong, accentSoft: `rgba(${r}, ${g}, ${b}, ${theme === "dark" ? 0.18 : 0.14})`, accentFg: fg };
}

/** CSS custom properties for an accent, to spread onto a style prop. */
export function accentVars(a: Accent): Record<string, string> {
  return { "--accent": a.accent, "--accent-strong": a.accentStrong, "--accent-soft": a.accentSoft, "--accent-fg": a.accentFg, "--ring": a.accentSoft };
}
