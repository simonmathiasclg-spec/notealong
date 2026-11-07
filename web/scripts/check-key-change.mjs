// Open a song in the browser, play it, step the key up and down, and time how long each change
// takes until the audio is playing again in the new key. Also checks that the notes on screen moved
// with the audio (the player derives both from the key the engine has actually loaded).
//
//   PLAYWRIGHT_DIR=... node scripts/check-key-change.mjs <song_id> [steps e.g. "+1 +1 -1 -3 +5"]
import { createRequire } from "node:module";
const require = createRequire((process.env.PLAYWRIGHT_DIR ?? process.cwd()) + "/");
const { chromium } = require("playwright");
const base = process.env.APP ?? "http://localhost:3000";
const id = process.argv[2];
const steps = (process.argv[3] ?? "+1 +1 -1 -1 -1 +5").split(/\s+/);
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => { localStorage.setItem("na.countin", "0"); });
await page.goto(`${base}/songs/${id}`, { waitUntil: "load" });
await page.waitForSelector("button[aria-label=Play]:not([disabled])", { timeout: 60000 });
await page.waitForTimeout(1500);
await page.click("button[aria-label=Play]");
await page.waitForTimeout(parseInt(process.env.WAIT ?? "3000", 10));   // WAIT: how long the listener plays before touching the key
// the header names the key the player is in, e.g. "G minor (+2)"
const keyNow = () => page.evaluate(() => document.body.innerText.match(/([A-G][#b]? (?:major|minor)(?: \([+-]\d\))?)/)?.[1] ?? null);
const preparing = () => page.evaluate(() => /Preparing the new key/.test(document.body.innerText));
const playing = () => page.evaluate(() => !!document.querySelector("button[aria-label=Pause]"));
const audioPos = () => page.evaluate(() => parseInt(document.querySelector("[role=slider][aria-label^='Position']")?.getAttribute("aria-valuenow") ?? "-1", 10));
console.log(`start: key ${await keyNow()}, playing ${await playing()}`);
let shift = 0;
for (const s of steps) {
  const n = parseInt(s, 10);
  const before = await audioPos();
  const t0 = Date.now();
  for (let i = 0; i < Math.abs(n); i++) await page.keyboard.press(n > 0 ? "ArrowUp" : "ArrowDown");
  shift += n;
  // the player waits 350 ms after the last press, then swaps the audio; "preparing…" shows meanwhile
  await page.waitForTimeout(400);
  let waited = 0;
  while ((await preparing()) && waited < 30000) { await page.waitForTimeout(50); waited += 50; }
  const ms = Date.now() - t0 - 350;
  await page.waitForTimeout(600);
  const after = await audioPos();
  console.log(`${s} -> shift ${shift >= 0 ? "+" : ""}${shift}: ${ms} ms until playing in the new key (${await keyNow()}), playing ${await playing()}, position ${before}s -> ${after}s`);
}
await page.screenshot({ path: (process.env.OUT ?? "/tmp") + `/key-${id}.png` });
await browser.close();
