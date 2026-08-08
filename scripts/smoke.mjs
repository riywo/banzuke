// Smoke test of the deliverable itself, on whichever node is running: a user copies
// template/, installs from its own lockfile, adds a font and runs it.
//
// The suite under test/ covers the template's code but symlinks this repo's node_modules
// into every scaffold, so nothing there ever installs the template's own dependency
// closure — that is what this does, and why it is a separate script rather than a test.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pngSize } from "../skills/banzuke/template/lib/index.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
// The family the scaffold's Typeface block points at. Unpinned on purpose: SKILL.md hands
// the agent this exact command, so a release that moves the woff2 files fails here too.
const FONT = "@fontsource-variable/archivo";

const dir = mkdtempSync(path.join(tmpdir(), `banzuke-smoke-node${process.versions.node}-`));
cpSync(path.join(root, "skills/banzuke/template"), dir, { recursive: true });

const run = (file, args) => execFileSync(file, args, { cwd: dir, stdio: "inherit" });
run("npm", ["ci"]); // the template's own lock, nothing of this repo's
run("npm", ["i", FONT]);
run(process.execPath, ["banzuke.mjs"]); // the same node running this script

const { width, height } = pngSize(readFileSync(path.join(dir, "banzuke.png")));
assert.equal(width, 2144); // SHEET_W 1072 CSS px × dpr 2
assert.ok(height > 500, `height ${height}`);
console.log(`smoke ok on node ${process.version}: ${width}×${height} px in ${dir}`);
