// Screenshots of the Sheet music view at desktop, iPad and phone sizes, with the song paused part-way in.
//
//   PLAYWRIGHT_DIR=/path/to/a/folder/with/playwright node scripts/shoot-sheet.mjs <song-id> <out-dir> [name] [at-fraction]
//
// Options (environment): SIZES=desktop,ipad,phone  PREFS='{"na.sheetPaper":"1"}'  THEME=light  PLAY=1
import { createRequire } from "node:module";
const require = createRequire((process.env.PLAYWRIGHT_DIR ?? process.cwd()) + "/");
const { chromium } = require("playwright");

const [song = "la-cucaracha", out = ".", name = song, at = "0.2"] = process.argv.slice(2);
const base = process.env.APP ?? "http://localhost:3001";
const SIZES = { desktop: [1440, 900], ipad: [1024, 1366], phone: [390, 844] };
const prefs = { "na.view": "sheet", "na.countin": "0", "na.loopHint": "1", ...(process.env.THEME ? { "na.theme": process.env.THEME } : {}), ...JSON.parse(process.env.PREFS ?? "{}") };
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ["--autoplay-policy=no-user-gesture-required"] });
for (const size of (process.env.SIZES ?? "desktop,ipad,phone").split(",")) {
  const [width, height] = SIZES[size];
  const page = await (await browser.newContext({ viewport: { width, height }, deviceScaleFactor: size === "desktop" ? 1 : 2 })).newPage();
  await page.addInitScript((p) => { for (const [k, v] of Object.entries(p)) localStorage.setItem(k, v); }, prefs);
  page.on("pageerror", (e) => console.log(size, "page error:", e.message));
  page.on("console", (m) => { if (m.type() === "error") console.log(size, "console:", m.text().slice(0, 300)); });
  const t0 = Date.now();
  await page.goto(`${base}/songs/${song}`, { waitUntil: "load" });
  await page.waitForSelector(".sheet-host svg", { timeout: 120000 });
  await page.waitForSelector("button[aria-label=Play]:not([disabled])", { timeout: 60000 });
  const drawn = Date.now() - t0;
  const bar = await page.locator("[role=slider][aria-label^='Position']").boundingBox();
  await page.mouse.click(bar.x + bar.width * Number(at), bar.y + bar.height / 2);
  if (process.env.PLAY) { await page.keyboard.press(" "); await page.waitForTimeout(Number(process.env.PLAY) * 1000); await page.keyboard.press(" "); }
  await page.mouse.move(width / 2, 4);
  await page.waitForTimeout(1200);
  const facts = await page.evaluate(() => {
    const svg = document.querySelector(".sheet-host svg"), line = document.querySelector(".sheet-line");
    return { svg: [Math.round(svg.getBoundingClientRect().width), Math.round(svg.getBoundingClientRect().height)], notes: document.querySelectorAll(".sheet-host .vf-stavenote").length,
      lit: document.querySelectorAll(".sheet-host .is-now").length, line: line.style.transform + " h=" + line.style.height, names: document.querySelectorAll(".sheet-names span").length };
  });
  console.log(size, `${drawn} ms`, JSON.stringify(facts));
  await page.screenshot({ path: `${out}/${name}-${size}.png` });
  await page.context().close();
}
await browser.close();
