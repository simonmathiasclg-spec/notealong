// Renders the "Hear it played" instrument for a song to a WAV file, using the app's real sampler code
// in an OfflineAudioContext (so what is rendered is exactly what the browser plays).
//
//   PLAYWRIGHT_DIR=... node scripts/render-hear-demo.mjs <song-id> <instrument-id> <out.wav> [seconds] [key-shift]
//
// Used to make docs/listening-samples and to check tuning and levels by analysis.
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire((process.env.PLAYWRIGHT_DIR ?? process.cwd()) + "/");
const { chromium } = require("playwright");
const [song, instrument, out, secondsArg, shiftArg] = process.argv.slice(2);
const base = process.env.APP ?? "http://localhost:3000";
const api = process.env.API ?? "http://localhost:8000";
const info = await (await fetch(`${api}/api/songs/${song}`)).json();
const seconds = Math.min(Number(secondsArg) || info.duration, info.duration);
const shift = Number(shiftArg) || 0;
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const page = await browser.newPage();
await page.addInitScript(() => { window.__hearDebug = true; localStorage.setItem("na.instrument", "alto_sax"); });
await page.goto(`${base}/songs/${song}`, { waitUntil: "load" });
await page.waitForFunction(() => !!window.__NoteAlongSampler, null, { timeout: 30000 });
const b64 = await page.evaluate(async ({ notes, instrument, seconds, shift }) => {
  const sr = 44100;
  const ctx = new OfflineAudioContext(2, Math.ceil((seconds + 2) * sr), sr);
  const sampler = new window.__NoteAlongSampler(ctx);
  sampler.setVolume(0.8);
  await sampler.use(instrument);
  for (const n of notes) if (n.start < seconds) sampler.play(n.id, n.midi + shift, n.start, n.end - n.start);
  const buf = await ctx.startRendering();
  // 16-bit stereo WAV
  const len = buf.length, bytes = new Uint8Array(44 + len * 4), v = new DataView(bytes.buffer);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i); };
  w(0, "RIFF"); v.setUint32(4, 36 + len * 4, true); w(8, "WAVEfmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, len * 4, true);
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  for (let i = 0; i < len; i++) { v.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true); v.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true); }
  let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}, { notes: info.notes.map((n) => ({ id: n.id, start: n.start, end: n.end, midi: n.midi })), instrument, seconds, shift });
fs.writeFileSync(out, Buffer.from(b64, "base64"));
await browser.close();
console.log("wrote", out, `${seconds.toFixed(1)} s, ${info.notes.filter((n) => n.start < seconds).length} notes`);
