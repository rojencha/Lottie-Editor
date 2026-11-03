// Dependency-free build: syntax-check every module, run the tests, copy the static site into dist/.
import { readdirSync, statSync, mkdirSync, rmSync, cpSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const run = (cmd, args) => { const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit" }); if (r.status !== 0) { console.error(`\nBuild failed: ${cmd} ${args.join(" ")}`); process.exit(r.status || 1); } };

const mods = walk(join(root, "js")).filter((f) => extname(f) === ".js");
console.log(`Checking ${mods.length} modules…`);
for (const f of mods) run(process.execPath, ["--check", f]);

if (!process.env.SKIP_TESTS) {
  const tests = existsSync(join(root, "tests")) ? readdirSync(join(root, "tests")).filter((f) => f.endsWith(".test.mjs")).map((f) => join("tests", f)) : [];
  console.log(`Running ${tests.length} test files…`);
  if (tests.length) run(process.execPath, ["--test", ...tests]);
}

const out = join(root, "dist");
rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
for (const e of ["index.html", "lottie.min.js", "css", "js", "assets"]) if (existsSync(join(root, e))) cpSync(join(root, e), join(out, e), { recursive: true });
console.log(`Built → dist/ (${walk(out).length} files)`);
