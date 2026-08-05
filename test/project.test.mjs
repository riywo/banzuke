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

/** A data.mjs source string for the given tiers. */
const project = (tiers) =>
  `export default ${JSON.stringify({ title: "Test", unit: "titles", tiers }, null, 2)};\n`;

const FEATURED = { name: "Top", layout: "featured", color: "#d62828", items: ["One", "Two"] };
const RANKED = { name: "Ranked", layout: "ranked", color: "#1b50a8", items: ["R1", "R2", "R3"] };
const wall = (items) => ({ name: "Wall", layout: "wall", items });

/**
 * Items per wall column, read back off the generated HTML. Everything from the wall block's
 * opening tag onward is wall columns (plus the footer, which matches neither marker) — the
 * numbered tiers above it use the same `flex:1;min-width:0` on their title cells.
 */
function wallColumnCounts(html) {
  return html
    .slice(html.indexOf('padding-bottom:10px">'))
    .split('<div style="flex:1;min-width:0;')
    .slice(1)
    .map((col) => col.split("padding:1px 0;font-size:").length - 1);
}

test("wall: every item box is pinned to exactly one line", () => {
  const dir = scaffold("proj-wall-oneline");
  const titles = Array.from({ length: 30 }, (_, i) => `Item ${i + 1}`);
  titles[3] = "A wall title far too long to ever fit inside one column";
  writeFileSync(path.join(dir, "data.mjs"), project([FEATURED, RANKED, wall(titles)]));
  runScript(path.join(dir, "banzuke.mjs"));

  // fitSpan squashes with scaleX, which leaves the span's *layout* width untouched, so a shrunk
  // title still overflows its column. Left to size itself the box then takes a second line box —
  // a blank line mid-column and columns that end at ragged heights. Only an explicit height,
  // paired with the overflow:hidden already there, rules that out.
  const boxes = [
    ...readFileSync(path.join(dir, "banzuke.html"), "utf8").matchAll(
      /<div style="height:([\d.]+)px;padding:1px 0;font-size:([\d.]+)px;line-height:([\d.]+);overflow:hidden">/g,
    ),
  ];
  assert.equal(boxes.length, 30);
  for (const [, h, size, line] of boxes) {
    assert.equal(Number(h), Math.round(Number(size) * Number(line)));
  }
});

test("wall: the remainder is spread across columns, not dumped in the last one", () => {
  const dir = scaffold("proj-wall-split");
  const titles = Array.from({ length: 30 }, (_, i) => `Item ${i + 1}`);
  writeFileSync(path.join(dir, "data.mjs"), project([FEATURED, RANKED, wall(titles)]));
  runScript(path.join(dir, "banzuke.mjs"));

  const counts = wallColumnCounts(readFileSync(path.join(dir, "banzuke.html"), "utf8"));
  assert.equal(
    counts.reduce((a, b) => a + b, 0),
    30,
  );
  assert.equal(Math.max(...counts) - Math.min(...counts), 1); // 30 over 4 columns = 8,8,7,7
});

test("a featured tier with no ranked tier still gets its band", () => {
  const dir = scaffold("proj-feat-only");
  const featured = { ...FEATURED, items: ["One", "Two", "Three"] };
  writeFileSync(
    path.join(dir, "data.mjs"),
    project([featured, wall(["A", "B", "C", "D", "E", "F"])]),
  );
  runScript(path.join(dir, "banzuke.mjs"));

  // The band used to be sized off the (absent) ranked tiers, collapsing to 0px and dropping every
  // featured row off the sheet.
  const html = readFileSync(path.join(dir, "banzuke.html"), "utf8");
  // border-bottom:4px is DIV — the masthead above it closes with BW (8px).
  const band = html.match(/height:(\d+)px;flex:none;display:flex;border-bottom:4px/);
  assert.ok(band, "no top band in the output");
  assert.ok(Number(band[1]) > 100, `band height ${band[1]}px`);
  for (const title of ["One", "Two", "Three"]) assert.match(html, new RegExp(`>${title}</span>`));
  assert.ok(sizeOf(path.join(dir, "banzuke.png")).height > 700);
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
