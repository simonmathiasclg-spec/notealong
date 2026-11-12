/**
 * Reads real songs from the running service and reports how their sheet music comes out.
 * Not part of the normal run:  SCORE_EVAL=id1,id2 npx vitest run src/lib/__tests__/score.eval.test.ts
 */
import { describe, expect, it } from "vitest";
import { buildSheet, type ScoreData } from "../score";
import { songToMusicXml } from "../musicxml";
import type { Song } from "../types";

const ids = (process.env.SCORE_EVAL ?? "").split(",").filter(Boolean);
const API = process.env.SCORE_API ?? "http://localhost:8000";

describe.skipIf(!ids.length)("sheet music of real songs", () => {
  for (const id of ids) {
    it(id, { timeout: 300000 }, async () => {
      const song = (await (await fetch(`${API}/api/songs/${id}`)).json()) as Song;
      const score = (await (await fetch(`${API}/api/songs/${id}/score`)).json()) as ScoreData;
      const sheet = buildSheet(song, score);
      let pieces = 0, heads = 0, ties = 0, rests = 0, small = 0, tuplets = 0, off = 0, worst = 0, chords = 0, lyrics = 0;
      const byId = new Map(song.notes.map((n) => [n.id, n]));
      for (const m of sheet.measures) {
        expect(m.pieces.reduce((a, p) => a + p.dur, 0)).toBe(m.len);
        for (const p of m.pieces) {
          pieces++;
          if (p.chord) chords++;
          if (p.lyric) lyrics++;
          if (p.tuplet) tuplets++;
          if (p.rest) { if (!p.whole) rests++; if (p.dur < 12) small++; continue; }
          if (p.tieStart) ties++;
          if (p.dur < 6) small++;
          if (!p.tieStop) {
            heads++;
            const err = Math.abs(sheet.grid.time(m.bar + p.start) - byId.get(p.id!)!.start);
            off += err; worst = Math.max(worst, err);
          }
        }
      }
      const xml = songToMusicXml(song, song.user.instrument, song.user.key_shift, 0, score);
      expect((xml.match(/<note>/g) ?? []).length).toBe(pieces);
      console.log(`${id}: ${score.source} ${score.meter.join("/")} at ${Math.round(score.tempo)}; ${sheet.measures.length} bars (+${sheet.introBars} intro${sheet.measures[0]?.pickup ? ", pickup" : ""}); ` +
        `${song.notes.length} notes -> ${heads} written (${song.notes.length - heads} merged), ${ties} ties, ${rests} rests (${small} shorter than an 8th), ${tuplets} triplet notes, ` +
        `${chords} chord symbols, ${lyrics} lyrics; start moved ${Math.round((off / Math.max(1, heads)) * 1000)} ms on average, ${Math.round(worst * 1000)} ms at most`);
      if (score.source === "authored") { expect(heads).toBe(song.notes.length); expect(worst).toBeLessThan(0.02); }
    });
  }
});
