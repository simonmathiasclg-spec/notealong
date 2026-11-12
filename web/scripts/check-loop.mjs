// Real-browser check that a loop holds: the song stays inside the looped lines for several passes, at full
// and half speed, with "Hear it played" on, and still after a key change made while it loops. Every played
// note must sound within 30 ms of where the song really is.
//
//   PLAYWRIGHT_DIR=/path/to/a/folder/with/playwright node scripts/check-loop.mjs [song-id]
//
// The app and the service must be running. Use a built-in song: the check resets its saved settings.
import { createRequire } from "node:module";
const require = createRequire((process.env.PLAYWRIGHT_DIR ?? process.cwd()) + "/");
const { chromium } = require("playwright");

const song = process.argv[2] ?? "la-cucaracha";
const base = process.env.APP ?? "http://localhost:3001";
const api = process.env.API ?? "http://localhost:8000";
const info = await (await fetch(`${api}/api/songs/${song}`)).json();
if (!info.catalog) { console.log("Use a built-in song: this check resets the song's saved settings."); process.exit(2); }
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ["--autoplay-policy=no-user-gesture-required"] });
let failed = false;
for (const speed of [1, 0.5]) {
  await fetch(`${api}/api/songs/${song}`, { method: "DELETE" }).catch(() => undefined);
  if (speed !== 1) await fetch(`${api}/api/songs/${song}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ user: { speed } }) });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.addInitScript(() => { localStorage.setItem("na.instrument", "alto_sax"); localStorage.setItem("na.hear", "1"); localStorage.setItem("na.countin", "0"); localStorage.setItem("na.loopHint", "1"); window.__hearDebug = true; });
  page.on("pageerror", (e) => { console.log("page error:", e.message); failed = true; });
  await page.goto(`${base}/songs/${song}`, { waitUntil: "load" });
  await page.waitForSelector("button[aria-label=Play]:not([disabled])", { timeout: 30000 });
  await page.waitForTimeout(2500);
  const bar = await page.locator("[role=slider][aria-label^='Position']").boundingBox();
  await page.mouse.click(bar.x + bar.width * 0.35, bar.y + bar.height / 2);
  await page.waitForTimeout(300);
  await page.keyboard.press("l");
  await page.waitForTimeout(500);
  // take in the next line too, with the keyboard on the end handle
  await page.locator('.loop-handle[data-edge="end"]').focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(400);
  await page.evaluate(() => document.activeElement?.blur());
  const loop = await page.evaluate((d) => { const l = document.querySelector(".string .loop"); const a = parseFloat(l.style.left) / 100 * d; return [a, a + parseFloat(l.style.width) / 100 * d]; }, info.duration);
  const label = (await page.locator(".loop-chip").innerText()).replace(/\s+/g, " ").trim();
  const watch = async (passes) => {
    // sample the playhead; count how often it wraps and how far outside the loop it ever is
    const len = (loop[1] - loop[0]) / speed;
    const until = Date.now() + (len * passes + 1.5) * 1000;
    let wraps = 0, worstOut = 0, last = -1;
    while (Date.now() < until) {
      const t = await page.evaluate((d) => parseFloat(document.querySelector(".string .head").style.left) / 100 * d, info.duration);
      worstOut = Math.max(worstOut, loop[0] - t, t - loop[1]);
      if (last >= 0 && t < last - (loop[1] - loop[0]) / 2) wraps++;
      last = t;
      await page.waitForTimeout(40);
    }
    return { wraps, worstOut };
  };
  await page.click("button[aria-label=Play]");
  const a = await watch(4);
  // change the key while it loops
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(450);
  let waited = 0;
  while ((await page.evaluate(() => /Preparing the new key/.test(document.body.innerText))) && waited < 30000) { await page.waitForTimeout(50); waited += 50; }
  const b = await watch(3);
  const still = (await page.locator(".loop-chip").count()) === 1;
  const log = await page.evaluate(() => window.__hearLog ?? []);
  await page.close();
  const errs = log.filter((l) => !l.late).map((l) => Math.abs(l.errorMs));
  const worst = Math.max(...errs, 0);
  for (const l of log.filter((l) => !l.late && Math.abs(l.errorMs) > 30).slice(0, 6)) console.log(`  off: note at ${l.start.toFixed(2)} s by ${l.errorMs.toFixed(0)} ms`);
  const inLoop = info.notes.filter((n) => n.start >= loop[0] && n.start < loop[1]).length;
  const outside = log.filter((l) => !l.late && (l.start < loop[0] - 0.01 || l.start > loop[1] + 0.01)).length;
  console.log(`${song} at ${speed}x, ${label} (${loop.map((v) => v.toFixed(2)).join("–")} s, ${inLoop} notes): ` +
    `${a.wraps} passes then ${b.wraps} more after a key change; furthest outside the loop ${(Math.max(a.worstOut, b.worstOut, 0) * 1000).toFixed(0)} ms; ` +
    `${errs.length} notes timed, worst ${worst.toFixed(1)} ms; notes played from outside the loop: ${outside}; still looping: ${still}`);
  if (a.wraps < 3 || b.wraps < 2 || Math.max(a.worstOut, b.worstOut) > 0.12 || worst > 30 || errs.length < inLoop * 4 || outside > 0 || !still) failed = true;
}
await fetch(`${api}/api/songs/${song}`, { method: "DELETE" }).catch(() => undefined);
await browser.close();
console.log(failed ? "FAILED" : "ok");
process.exit(failed ? 1 : 0);
