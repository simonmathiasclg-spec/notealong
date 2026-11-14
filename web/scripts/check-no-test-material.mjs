// Runs before every production build (package.json "prebuild"): the build fails if internal test
// material (recordings, covers, lyrics or transcriptions of copyrighted songs kept for measuring the note
// algorithm) could ship with the web app. With the whole repository present it runs the full check
// (service/scripts/check_no_test_material.py); on a host that builds web/ alone it checks web/ itself.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const bad = [];
const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const marker = ["test", "recordings"].join("-");
for (const p of [...walk(join(web, "src")), ...walk(join(web, "public"))]) {
  if (p.includes(marker)) bad.push(`${p} is inside a test folder`);
  if ([".m4a", ".mp3", ".wav", ".mid", ".midi", ".npz", ".musicxml"].includes(extname(p))) bad.push(`${p}: a recording or transcription in the web app`);
  if ([".ts", ".tsx", ".js", ".mjs", ".json", ".css"].includes(extname(p)) && statSync(p).size < 2e6 && readFileSync(p, "utf8").includes(marker)) bad.push(`${p} mentions the test folder`);
}
const full = join(web, "..", "service", "scripts", "check_no_test_material.py");
if (existsSync(full)) {
  const r = spawnSync("python3", [full], { stdio: "inherit" });
  if (r.error) console.warn("check-no-test-material: python3 not found, only web/ was checked");
  else if (r.status !== 0) bad.push("the repository check failed (see above)");
}
if (bad.length) {
  for (const b of bad) console.error("TEST MATERIAL WOULD SHIP:", b);
  process.exit(1);
}
console.log("check-no-test-material: ok");
