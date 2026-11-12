import { describe, expect, it } from "vitest";
import { DEFAULT_HUE, HOUSE_COLORS, accentFor, accentFromArt, artVars, colorsFromPixels, contrast, hexToRgb, rgbToHex } from "../color";

const DARK = "#0b0a09";   // the room (globals.css --bg)
const LIGHT = "#f3eee7";  // house lights

describe("adaptive accent", () => {
  it("round-trips hex", () => {
    expect(rgbToHex(hexToRgb("#ff6b57"))).toBe("#ff6b57");
    expect(contrast("#ffffff", "#000000")).toBeCloseTo(21, 0);
  });
  it("keeps every hue readable on both backgrounds", () => {
    for (let hue = 0; hue < 360; hue += 15) {
      const d = accentFor(hue, "dark");
      const l = accentFor(hue, "light");
      expect(contrast(d.accent, DARK)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(l.accent, LIGHT)).toBeGreaterThanOrEqual(4.5);
      // text on an accent chip must read too
      expect(contrast(d.accent, d.accentFg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(l.accent, l.accentFg)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("falls back to the house red", () => {
    expect(accentFor(null, "dark").accent).toBe(accentFor(DEFAULT_HUE, "dark").accent);
    expect(accentFor(NaN, "light").accent).toBe(accentFor(DEFAULT_HUE, "light").accent);
  });
});

describe("colours from the artwork", () => {
  it("takes the hue of the cover's light", () => {
    // a green foliage cover: the "now" colour is a readable green, not the house red
    const green = accentFromArt({ deep: "#11230c", mid: "#465923", glow: "#e5ee89" }, "dark");
    const [r, g, b] = hexToRgb(green.accent);
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
    expect(contrast(green.accent, DARK)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(green.accent, green.accentFg)).toBeGreaterThanOrEqual(4.5);
  });
  it("uses the house red for colourless artwork and for none", () => {
    const red = accentFor(DEFAULT_HUE, "dark").accent;
    expect(accentFromArt({ deep: "#12100e", mid: "#3b342c", glow: "#ece6db" }, "dark").accent).toBe(red);
    expect(accentFromArt(null, "dark").accent).toBe(red);
  });
  it("stays readable in both themes for every catalog-like palette", () => {
    for (const glow of ["#fdf7b2", "#eb7151", "#cadcf6", "#fdda89", "#c3b05b", "#d8fff0", "#ffc3d6"]) {
      for (const theme of ["dark", "light"] as const) {
        const a = accentFromArt({ deep: "#111111", mid: "#555555", glow }, theme);
        expect(contrast(a.accent, theme === "dark" ? DARK : LIGHT)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it("samples shadows, body and light from pixels", () => {
    const px = new Uint8ClampedArray(100 * 4);
    for (let i = 0; i < 100; i++) { const v = i < 50 ? 10 : i < 94 ? 120 : 250; px.set([v, v, v, 255], i * 4); }
    const c = colorsFromPixels(px);
    expect(hexToRgb(c.deep)[0]).toBe(10);
    expect(hexToRgb(c.glow)[0]).toBe(250);
    expect(hexToRgb(c.mid)[0]).toBeGreaterThan(10);
  });
  it("gives CSS variables, with the house colours as the default", () => {
    expect(artVars(null)["--art-deep"]).toBe(HOUSE_COLORS.deep);
    expect(artVars({ deep: "#000001", mid: "#000002", glow: "#000003" })["--art-glow"]).toBe("#000003");
  });
});
