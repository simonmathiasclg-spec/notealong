import { describe, expect, it } from "vitest";
import { accentFor, contrast, hexToRgb, rgbToHex } from "../color";

describe("adaptive accent", () => {
  it("round-trips hex", () => {
    expect(rgbToHex(hexToRgb("#ff6b57"))).toBe("#ff6b57");
    expect(contrast("#ffffff", "#000000")).toBeCloseTo(21, 0);
  });
  it("keeps every hue readable on both backgrounds", () => {
    for (let hue = 0; hue < 360; hue += 15) {
      const d = accentFor(hue, "dark");
      const l = accentFor(hue, "light");
      expect(contrast(d.accent, "#0c0e14")).toBeGreaterThanOrEqual(4.5);
      expect(contrast(l.accent, "#f3f2ee")).toBeGreaterThanOrEqual(4.5);
      // text on an accent chip must read too
      expect(contrast(d.accent, d.accentFg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(l.accent, l.accentFg)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("falls back to coral", () => {
    expect(accentFor(null, "dark").accent).toBe(accentFor(8, "dark").accent);
    expect(accentFor(NaN, "light").accent).toBe(accentFor(8, "light").accent);
  });
});
