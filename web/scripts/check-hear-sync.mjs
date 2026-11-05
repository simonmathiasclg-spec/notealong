// Real-browser check that "Hear it played" stays on time for a whole song.
//
//   PLAYWRIGHT_DIR=/path/to/a/folder/with/playwright node scripts/check-hear-sync.mjs [song-id] [speed ...]
//
// (Playwright is not a dependency of the app; point PLAYWRIGHT_DIR at any folder where it is installed,
// and CHROME at a Chromium binary if Playwright's own is not downloaded.)
// The app and the service must be running. The page is opened with window.__hearDebug set, which makes the
// scheduler record, for every note, where the song really was (by the media clock) when the note sounded.
import { createRequire } from "node:module";
const require = createRequire((process.env.PLAYWRIGHT_DIR ?? process.cwd()) + "/");
const { chromium } = require("playwright");

const song = process.argv[2] ?? "frere-jacques";
const speeds = process.argv.slice(3).map(Number).filter(Boolean);
if (!speeds.length) speeds.push(1, 0.5);
const base = process.env.APP ?? "http://localhost:3000";
const api = process.env.API ?? "http://localhost:8000";

const first = await (await fetch(`${api}/api/songs/${song}`)).json();
if (!first.catalog) { console.log("Use a built-in song: this check resets the song's saved settings."); process.exit(2); }
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ["--autoplay-policy=no-user-gesture-required"] });
let failed = false;
for (const speed of speeds) {
  await fetch(`${api}/api/songs/${song}`, { method: "DELETE" }).catch(() => undefined);          // forget saved position and speed
  if (speed !== 1) await fetch(`${api}/api/songs/${song}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ user: { speed } }) });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.addInitScript(() => { localStorage.setItem("na.instrument", "alto_sax"); localStorage.setItem("na.hear", "1"); localStorage.setItem("na.countin", "0"); window.__hearDebug = true; });
  page.on("pageerror", (e) => { console.log("page error:", e.message); failed = true; });
  await page.goto(`${base}/songs/${song}`, { waitUntil: "load" });
  await page.waitForSelector("button[aria-label=Play]:not([disabled])", { timeout: 30000 });
  await page.waitForTimeout(2500);                                                               // instrument recordings load
  const info = await (await fetch(`${api}/api/songs/${song}`)).json();
  await page.click("button[aria-label=Play]");
  const total = (info.duration / speed) * 1000 + 4000;
  const t0 = Date.now();
  while (Date.now() - t0 < total) {
    await page.waitForTimeout(1000);
    if (Date.now() - t0 > 5000 && await page.$("button[aria-label=Play]")) break;                // the song ended
  }
  const log = await page.evaluate(() => window.__hearLog ?? []);
  await page.close();
  const onTime = log.filter((l) => !l.late);
  const errs = onTime.map((l) => l.errorMs);
  const n = errs.length;
  const mean = errs.reduce((a, b) => a + b, 0) / Math.max(1, n);
  const sd = Math.sqrt(errs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n));
  const worst = Math.max(...errs.map(Math.abs), 0);
  // drift: do the notes in the last third of the song land later or earlier than those in the first third?
  const third = Math.floor(n / 3);
  const avg = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  const drift = third ? avg(errs.slice(-third)) - avg(errs.slice(0, third)) : 0;
  const expected = info.notes.length;
  const got = new Set(log.map((l) => l.id));
  const missing = info.notes.filter((x) => !got.has(x.id)).map((x) => x.start.toFixed(1));
  if (missing.length) console.log(`  not measured (${missing.length}): starts at ${missing.slice(0, 12).join(", ")}${missing.length > 12 ? " … " + missing.slice(-3).join(", ") : ""}`);
  console.log(`${song} at ${speed}x: ${n} of ${expected} notes measured (${log.length - n} joined late), mean ${mean.toFixed(1)} ms, spread ${sd.toFixed(1)} ms, worst ${worst.toFixed(1)} ms, start to end ${drift.toFixed(1)} ms`);
  if (n < expected * 0.95 || worst > 30 || Math.abs(drift) > 6) failed = true;
}
await fetch(`${api}/api/songs/${song}`, { method: "DELETE" }).catch(() => undefined);
await browser.close();
console.log(failed ? "FAILED" : "OK: every note within 30 ms, no drift");
process.exit(failed ? 1 : 0);
