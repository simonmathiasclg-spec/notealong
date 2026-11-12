import { describe, expect, it } from "vitest";
import { SmoothClock } from "../clock";

describe("SmoothClock after a jump", () => {
  it("stands still until the audio is really moving, then follows it", () => {
    const clock = new SmoothClock();
    // the audio twitches for 20 ms, stalls for 40 ms, then runs: as measured in Chrome after a loop wrap
    const mediaAt = (ms: number) => 18.42 + (ms < 20 ? ms * 0.2 : ms < 60 ? 4 : ms - 56) / 1000;
    let worst = 0;
    for (let ms = 0; ms <= 400; ms += 4) {
      const t = clock.read(mediaAt(ms), 1000 + ms, 1, true);
      if (ms >= 120) worst = Math.max(worst, Math.abs(t - mediaAt(ms)));
      if (ms < 60) expect(clock.settling).toBe(true);
    }
    expect(clock.settling).toBe(false);
    expect(worst).toBeLessThan(0.01);
  });
});
