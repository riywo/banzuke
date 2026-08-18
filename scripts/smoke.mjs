// Smoke test of the deliverable itself: a user copies template/, prunes it down to one runtime,
// installs from that runtime's own lockfile, adds a font and renders.
//
//   node scripts/smoke.mjs                 the node running this script
//   node scripts/smoke.mjs --runtime bun   bun / deno off PATH
//
// The suite under test/ covers the template's code but symlinks this repo's node_modules into
// every scaffold, so nothing there ever installs the template's own dependency closure — that is
// what this does, and why it is a separate script rather than a test. It is also the only place
// the bun and deno promises in SKILL.md are actually kept honest, since the recipe it runs is
// the one SKILL.md hands the agent, prune included.
//
// pngSize comes from the template's leaf module rather than its lib/index.mjs barrel: the barrel
// pulls in takumi-js, and this script otherwise needs nothing installed in this repo at all.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pngSize } from "../skills/banzuke/template/lib/png.mjs";
import { RUNTIMES, runtimeFiles, template } from "./runtimes.mjs";

// The family the scaffold's Typeface block points at. Unpinned on purpose: SKILL.md hands
// the agent this exact command, so a release that moves the woff2 files fails here too.
const FONT = "@fontsource-variable/archivo";

const flag = process.argv.indexOf("--runtime");
const name = flag === -1 ? "node" : process.argv[flag + 1];
const runtime = RUNTIMES[name];
assert.ok(runtime, `unknown runtime ${JSON.stringify(name)} (expected ${Object.keys(RUNTIMES)})`);

const dir = mkdtempSync(path.join(tmpdir(), `banzuke-smoke-${name}-`));
cpSync(template, dir, { recursive: true });

// Prune to this runtime's files, the way the scaffold step does. Anything another runtime owns
// would go stale the moment the font lands in package.json, and a stale package-lock.json turns
// a later `npm ci` into a hard error.
for (const file of runtimeFiles) {
  if (!runtime.files.includes(file)) rmSync(path.join(dir, file), { force: true });
}

const run = ([file, args]) => execFileSync(file, args, { cwd: dir, stdio: "inherit" });
run(runtime.install); // this runtime's own lock, nothing of this repo's
run(runtime.add(FONT));
run(runtime.run);

// First line only, with any name the runtime prints itself dropped: `deno --version` leads with
// "deno 2.9.5 (stable, …)", where node and bun report a bare version.
const version = execFileSync(...runtime.version, { encoding: "utf8" })
  .trim()
  .split("\n")[0]
  .replace(new RegExp(`^${name}\\s+`), "");
const { width, height } = pngSize(readFileSync(path.join(dir, "banzuke.png")));
assert.equal(width, 2048); // MIN_W 1024 CSS px × dpr 2 — the shipped scaffold needs no more
assert.equal(height, 1152); // pinned to 16:9
console.log(`smoke ok on ${name} ${version}: ${width}×${height} px in ${dir}`);
