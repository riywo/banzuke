// e2e: a "user project" copied wholesale from template/ works self-contained.
// Instead of npm ci, the repo's node_modules is symlinked in (the dependency set is identical).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { pngSize } from "../skills/banzuke/template/lib/index.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const tmp = path.join(root, "test/.tmp");

function scaffold(name) {
  const dir = path.join(tmp, name);
  rmSync(dir, { recursive: true, force: true });
  cpSync(path.join(root, "skills/banzuke/template"), dir, { recursive: true });
  symlinkSync(path.join(root, "node_modules"), path.join(dir, "node_modules"));
  return dir;
}

function runScript(script) {
  return execFileSync(process.execPath, [script], { encoding: "utf8" });
}

const sizeOf = (file) => pngSize(readFileSync(file));

test("an untouched scaffold produces a PNG and HTML (with the dated edition label)", () => {
  const dir = scaffold("proj-default");
  const out = runScript(path.join(dir, "banzuke.mjs"));
  assert.match(out, /2144×\d+ px/);
  const { width, height } = sizeOf(path.join(dir, "banzuke.png"));
  assert.equal(width, 2144); // SHEET_W 1072 CSS px × dpr 2
  assert.ok(height > 500, `height ${height}`);
  const html = readFileSync(path.join(dir, "banzuke.html"), "utf8");
  assert.match(html, /Anime Banzuke/);
  assert.match(html, /scaleX|<span/);
  assert.match(html, /\d{4}-\d{2}-\d{2} edition/); // generation date label
});

test("renders at real-world scale with the 75-title fixture", () => {
  const dir = scaffold("proj-75");
  cpSync(path.join(root, "test/fixtures/sample-data.mjs"), path.join(dir, "data.mjs"));
  runScript(path.join(dir, "banzuke.mjs"));
  const { width, height } = sizeOf(path.join(dir, "banzuke.png"));
  assert.equal(width, 2144);
  assert.ok(height > 1900 && height < 2400, `height ${height}`);
});

test("variants: a copy with different colors stays independent of the original", () => {
  const dir = scaffold("proj-variant");
  const src = readFileSync(path.join(dir, "banzuke.mjs"), "utf8");
  const dark = src
    .replace('bg: "#f4efe3"', 'bg: "#1a1713"')
    .replace('ink: "#14110d"', 'ink: "#f0ead9"')
    .replaceAll("banzuke.png", "dark.png")
    .replaceAll("banzuke.html", "dark.html");
  writeFileSync(path.join(dir, "banzuke-dark.mjs"), dark);
  runScript(path.join(dir, "banzuke.mjs"));
  runScript(path.join(dir, "banzuke-dark.mjs"));
  assert.ok(existsSync(path.join(dir, "banzuke.png")));
  assert.ok(existsSync(path.join(dir, "dark.png")));
  // different files, so the contents differ
  assert.notDeepEqual(
    readFileSync(path.join(dir, "banzuke.png")).subarray(0, 4096),
    readFileSync(path.join(dir, "dark.png")).subarray(0, 4096),
  );
});

test("template ships with its lock and package.json", () => {
  const pkg = JSON.parse(
    readFileSync(path.join(root, "skills/banzuke/template/package.json"), "utf8"),
  );
  assert.ok(pkg.dependencies["takumi-js"]);
  // No font ships with the template — the project installs the one it wants.
  assert.deepEqual(Object.keys(pkg.dependencies), ["takumi-js"]);
  const lock = JSON.parse(
    readFileSync(path.join(root, "skills/banzuke/template/package-lock.json"), "utf8"),
  );
  assert.equal(lock.lockfileVersion, 3);
  // via takumi-js, even the native binary (@takumi-rs/core) is pinned in the lock
  assert.ok(Object.keys(lock.packages).some((k) => k.includes("@takumi-rs/core")));
});
