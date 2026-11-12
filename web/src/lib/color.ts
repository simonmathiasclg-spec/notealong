import type { ArtColors } from "./types";

/**
 * The accent ("now") colour. Coral by default; on a song page it takes the hue
 * of the song's cover art. Lightness is fixed per theme and then nudged until
 * the colour reads against the background, so every hue stays legible.
 */
export const DEFAULT_HUE = 4; // the house red

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
  const background = bg ?? (theme === "dark" ? "#0b0a09" : "#f3eee7");
  const sat = theme === "dark" ? 88 : 72;
  let l = theme === "dark" ? 64 : 44;
  let hex = rgbToHex(hslToRgb(h, sat, l));
  // move away from the background until it reads
  for (let i = 0; i < 20 && contrast(hex, background) < minContrast; i++) {
    l += theme === "dark" ? 2 : -2;
    hex = rgbToHex(hslToRgb(h, sat, l));
  }
  // and until the letters on an accent chip (black or white, whichever reads better) read on it too
  const fgFor = (c: string) => (contrast(c, "#000000") >= contrast(c, "#ffffff") ? "#13100e" : "#ffffff");
  for (let i = 0; i < 20 && contrast(hex, fgFor(hex)) < 4.5; i++) {
    l += theme === "dark" ? 2 : -2;
    hex = rgbToHex(hslToRgb(h, sat, l));
  }
  const strong = rgbToHex(hslToRgb(h, sat, theme === "dark" ? Math.min(90, l + 10) : Math.max(20, l - 8)));
  const fg = fgFor(hex);
  const [r, g, b] = hexToRgb(hex);
  return { accent: hex, accentStrong: strong, accentSoft: `rgba(${r}, ${g}, ${b}, ${theme === "dark" ? 0.18 : 0.14})`, accentFg: fg };
}

/** CSS custom properties for an accent, to spread onto a style prop. */
export function accentVars(a: Accent): Record<string, string> {
  return { "--accent": a.accent, "--accent-strong": a.accentStrong, "--accent-soft": a.accentSoft, "--accent-fg": a.accentFg, "--ring": a.accentSoft };
}

// ---- colours from the artwork --------------------------------------------------------------------

/** Colours for a song without known artwork colours: a warm dark room. */
export const HOUSE_COLORS: ArtColors = { deep: "#1d1915", mid: "#4a3a2e", glow: "#f0c9a0" };

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s * 100, l * 100];
}

/**
 * The song's "now" colour, taken from its artwork: the hue of its light (or of its body when the light is
 * nearly white), saturated and then moved in lightness until it reads on the background. Artwork with almost
 * no colour (black and white photographs) gets the house red.
 */
export function accentFromArt(colors: ArtColors | null | undefined, theme: "dark" | "light", bg?: string): Accent {
  if (!colors) return accentFor(DEFAULT_HUE, theme, bg);
  // colourfulness as chroma (max - min channel): HSL saturation overstates it for very light colours
  const chroma = (hex: string) => { const c = hexToRgb(hex); return (Math.max(...c) - Math.min(...c)) / 255; };
  const glow = rgbToHsl(hexToRgb(colors.glow));
  if (chroma(colors.glow) >= 0.12 && glow[2] < 94) return accentFor(glow[0], theme, bg);
  if (chroma(colors.mid) >= 0.08) return accentFor(rgbToHsl(hexToRgb(colors.mid))[0], theme, bg);
  return accentFor(DEFAULT_HUE, theme, bg);
}

/** CSS custom properties for a song's artwork colours. */
export function artVars(colors: ArtColors | null | undefined): Record<string, string> {
  const c = colors ?? HOUSE_COLORS;
  return { "--art-deep": c.deep, "--art-mid": c.mid, "--art-glow": c.glow };
}

/** Deep, mid and glow of an image, sampled like the cover generator does (service/notealong/catalog/artwork.py). */
export function colorsFromPixels(data: Uint8ClampedArray): ArtColors {
  const px: [number, number, number, number][] = [];
  for (let i = 0; i < data.length; i += 4) px.push([data[i], data[i + 1], data[i + 2], 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]]);
  px.sort((a, b) => a[3] - b[3]);
  const mean = (lo: number, hi: number): string => {
    const a = Math.floor(px.length * lo), b = Math.max(a + 1, Math.floor(px.length * hi));
    const s = [0, 0, 0];
    for (let i = a; i < b; i++) for (let k = 0; k < 3; k++) s[k] += px[i][k];
    return rgbToHex(s.map((v) => Math.round(v / (b - a))) as [number, number, number]);
  };
  return { deep: mean(0.05, 0.35), mid: mean(0.45, 0.8), glow: mean(0.94, 1) };
}

const artCache = new Map<string, Promise<ArtColors | null>>();

/** The colours of a picture at a URL (an upload's own cover). Null when the picture can't be read. */
export function colorsFromImage(url: string): Promise<ArtColors | null> {
  let p = artCache.get(url);
  if (!p) {
    p = new Promise<ArtColors | null>((resolve) => {
      if (typeof window === "undefined") return resolve(null);
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.decoding = "async";
      img.onload = () => {
        try {
          const c = document.createElement("canvas");
          c.width = c.height = 32;
          const ctx = c.getContext("2d", { willReadFrequently: true });
          if (!ctx) return resolve(null);
          ctx.drawImage(img, 0, 0, 32, 32);
          resolve(colorsFromPixels(ctx.getImageData(0, 0, 32, 32).data));
        } catch { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
    artCache.set(url, p);
  }
  return p;
}
