import { describe, expect, it } from "vitest";
import { guessTitle, newSongData, newSongId, snapshotFromSong, stepsFor } from "../cloud/songdata";

describe("online version: song records", () => {
  it("reads artist and title from a file name like the local service", () => {
    expect(guessTitle("Billie - Oh My Love.mp3")).toEqual({ title: "Oh My Love", artist: "Billie" });
    expect(guessTitle("my_song_final.m4a")).toEqual({ title: "my song final", artist: null });
    expect(guessTitle(".mp3").title).toBe("Untitled");
  });

  it("makes ids that the database accepts and that never look like a catalog id", () => {
    for (const t of ["Oh My Love", "Ça plane pour moi", "日本語", "x".repeat(200)]) {
      const id = newSongId(t);
      expect(id).toMatch(/^[a-z0-9][a-z0-9-]{2,80}$/);
      expect(id).toMatch(/-u[0-9a-f]{8}$/);
    }
    expect(newSongId("a")).not.toBe(newSongId("a"));
  });

  it("starts a new upload with the player defaults and the chosen instrument", () => {
    const s = newSongData({ id: "x-u00000000", title: "T", artist: null, filename: "T.mp3", ext: "mp3", instrument: "flute", detail_level: "nonsense", titleFromName: true });
    expect(s.files.original).toBe("original.mp3");
    expect(s.user.instrument).toBe("flute");
    expect(s.settings.detail_level).toBe("balanced");
    expect(s.status).toBe("processing");
  });

  it("re-runs the same steps as the local service", () => {
    const song = { steps: { stems: { status: "done" as const }, melody: { status: "failed" as const } } };
    expect(stepsFor("stems", song)).toEqual(["stems", "melody", "lyrics", "attach"]);
    expect(stepsFor("melody", song)).toEqual(["melody", "attach"]);
    expect(stepsFor("retry", song)).toEqual(["melody", "lyrics", "attach"]);
    expect(stepsFor("retry", { steps: { stems: { status: "done" }, melody: { status: "done" }, lyrics: { status: "done" }, attach: { status: "done" } } })).toEqual(["attach"]);
    expect(stepsFor("bogus", song)).toBeNull();
  });

  it("shows a waiting job as all steps still to do, except those already done", () => {
    const snap = snapshotFromSong({ id: "a", status: "processing", error: null, steps: { stems: { status: "done" }, melody: { status: "failed" } } }, true);
    expect(snap.steps.map((s) => s.status)).toEqual(["done", "pending", "pending", "pending"]);
  });
});
