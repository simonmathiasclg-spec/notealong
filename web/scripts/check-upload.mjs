// Upload a real file through the browser like a user, watch it process, then open the player.
//
//   PLAYWRIGHT_DIR=... node scripts/check-upload.mjs /path/to/song.mp3 [more files...]
//
// Prints, per file: upload time, time per processing step, total wall time, words and notes found,
// how many notes have no word under them, and whether the player opened with the timing guide and
// "Hear it played" running. Processes files one after another (the service does anyway).
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire((process.env.PLAYWRIGHT_DIR ?? process.cwd()) + "/");
const { chromium } = require("playwright");
const base = process.env.APP ?? "http://localhost:3000";
const api = process.env.API ?? "http://localhost:8000";
const outDir = process.env.OUT ?? "/tmp";
const files = process.argv.slice(2);
if (!files.length) { console.log("give at least one audio or video file"); process.exit(2); }

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ["--autoplay-policy=no-user-gesture-required"] });
const results = [];
for (const file of files) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => { localStorage.setItem("na.instrument", "alto_sax"); localStorage.setItem("na.countin", "0"); localStorage.setItem("na.hear", "1"); });
  await page.goto(`${base}/my-songs`, { waitUntil: "load" });
  const t0 = Date.now();
  const input = page.locator("input[type=file]").first();
  await input.setInputFiles(file);
  // the app moves to the song's page once the upload is accepted
  await page.waitForURL(/\/songs\//, { timeout: 120000 });
  const id = page.url().split("/songs/")[1];
  const uploaded = (Date.now() - t0) / 1000;
  let snap = null, stuck = 0, last = "";
  while (true) {
    await page.waitForTimeout(2000);
    snap = await (await fetch(`${api}/api/songs/${id}/progress/snapshot`)).json();
    const sig = JSON.stringify(snap.steps.map((s) => [s.status, Math.round(s.progress * 20)]));
    stuck = sig === last ? stuck + 2 : 0; last = sig;
    if (snap.status !== "processing" || stuck > 600) break;
  }
  const total = (Date.now() - t0) / 1000;
  const song = await (await fetch(`${api}/api/songs/${id}`)).json();
  const steps = Object.fromEntries(Object.entries(song.steps).map(([k, v]) => [k, v.seconds]));
  const wordless = song.notes.filter((n) => !n.word).length;
  let player = "not opened";
  if (song.status === "ready") {
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector("button[aria-label=Play]:not([disabled])", { timeout: 60000 });
    await page.waitForTimeout(2500);
    await page.click("button[aria-label=Play]");
    await page.waitForTimeout(8000);
    const state = await page.evaluate(() => ({
      pause: !!document.querySelector("button[aria-label=Pause]"),
      bars: document.querySelectorAll("[data-bar]").length,
      hear: document.querySelector('button[aria-pressed][aria-label^="Hear it played"]')?.getAttribute("aria-pressed"),
    }));
    player = `${state.pause ? "playing" : "NOT playing"}, ${state.bars} timing bars, hear it played ${state.hear}`;
    await page.screenshot({ path: path.join(outDir, `upload-${path.basename(file, path.extname(file))}.png`) });
  }
  const row = { file: path.basename(file), id, status: song.status, error: song.error, duration: song.duration, uploadSeconds: +uploaded.toFixed(1), totalSeconds: +total.toFixed(0), steps,
    words: song.words.length, notes: song.notes.length, wordless, lines: song.lines.length, language: song.language?.detected, tempo: song.tempo_bpm, key: song.key?.name, player, pageErrors: errors.length, stuck: stuck > 600 };
  results.push(row);
  console.log(JSON.stringify(row));
  await ctx.close();
}
await browser.close();
fs.writeFileSync(path.join(outDir, "upload-results.json"), JSON.stringify(results, null, 1));
