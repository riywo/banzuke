// e2e: a "user project" copied wholesale from template/ works self-contained.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { commandLine, RUNTIMES, runtimeFiles } from "../scripts/runtimes.mjs";
import { pngSize } from "../skills/banzuke/template/lib/index.mjs";
import sampleData from "./fixtures/sample-data.mjs";
import { root, scaffold } from "./helpers/scaffold.mjs";

function runScript(script) {
  return execFileSync(process.execPath, [script], { encoding: "utf8" });
}

const sizeOf = (file) => pngSize(readFileSync(file));

test("an untouched scaffold produces a PNG and HTML (with the dated edition label)", () => {
  const dir = scaffold("proj-default");
  const out = runScript(path.join(dir, "banzuke.mjs"));
  assert.match(out, /2048×1152 px \(1\.78:1\)/); // the solved canvas, reported by the script
  const { width, height } = sizeOf(path.join(dir, "banzuke.png"));
  assert.equal(width, 2048); // MIN_W 1024 CSS px × dpr 2 — sparse data needs no more
  // Pinned to 16:9 so social previews stop cropping the top ranks off the sheet
  assert.equal(height, 1152);
  const html = readFileSync(path.join(dir, "banzuke.html"), "utf8");
  assert.match(html, /Anime Banzuke/);
  assert.match(html, /scaleX|<span/);
  assert.match(html, /\d{4}-\d{2}-\d{2} edition/); // generation date label
});

test("renders at real-world scale with the 75-title fixture", () => {
  const dir = scaffold("proj-75", sampleData);
  runScript(path.join(dir, "banzuke.mjs"));
  const { width, height } = sizeOf(path.join(dir, "banzuke.png"));
  assert.ok(width > 2048, `expected the fixture to need a wider canvas, got ${width}`);
  assert.ok(width <= 4096, `past X's ceiling: ${width}`); // MAX_W 2048 CSS × dpr 2
  assert.ok(
    Math.abs(height - (width * 9) / 16) <= 4,
    `expected a 16:9 canvas, got ${width}×${height}`,
  );
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

/** Scaffold data for the given tiers (scaffold() writes it out as data.mjs). */
const project = (tiers) => ({ title: "Test", unit: "titles", tiers });

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
  const titles = Array.from({ length: 30 }, (_, i) => `Item ${i + 1}`);
  titles[3] = "A wall title far too long to ever fit inside one column";
  const dir = scaffold("proj-wall-oneline", project([FEATURED, RANKED, wall(titles)]));
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
  const titles = Array.from({ length: 30 }, (_, i) => `Item ${i + 1}`);
  const dir = scaffold("proj-wall-split", project([FEATURED, RANKED, wall(titles)]));
  runScript(path.join(dir, "banzuke.mjs"));

  const counts = wallColumnCounts(readFileSync(path.join(dir, "banzuke.html"), "utf8"));
  assert.equal(
    counts.reduce((a, b) => a + b, 0),
    30,
  );
  assert.equal(Math.max(...counts) - Math.min(...counts), 1); // 30 over 4 columns = 8,8,7,7
});

test("a featured tier with no ranked tier still gets its band", () => {
  const featured = { ...FEATURED, items: ["One", "Two", "Three"] };
  const data = project([featured, wall(["A", "B", "C", "D", "E", "F"])]);
  const dir = scaffold("proj-feat-only", data);
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

const templateFile = (file) =>
  readFileSync(path.join(root, "skills/banzuke/template", file), "utf8");

test("template ships with its lock and package.json", () => {
  const pkg = JSON.parse(templateFile("package.json"));
  assert.ok(pkg.dependencies["takumi-js"]);
  // No font ships with the template — the project installs the one it wants. @takumi-rs/wasm is
  // takumi's own fallback renderer, declared explicitly because deno refuses to import a bare
  // specifier the project does not depend on (which left the fallback in lib/engine.mjs dead).
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), ["@takumi-rs/wasm", "takumi-js"]);
  const lock = JSON.parse(templateFile("package-lock.json"));
  assert.equal(lock.lockfileVersion, 3);
  // via takumi-js, even the native binary (@takumi-rs/core) is pinned in the lock
  assert.ok(Object.keys(lock.packages).some((k) => k.includes("@takumi-rs/core")));
  // npm mirrors engines into the lock's own entry, so raising the floor in the
  // manifest alone leaves the scaffold stating two different versions.
  assert.equal(lock.packages[""].engines.node, pkg.engines.node);
});

test("the bun and deno locks pin the same takumi as the npm one", () => {
  // One manifest, three locks: bun migrates package-lock.json only when bun.lock is absent, and
  // deno ignores it entirely, so nothing but `npm run locks` keeps them in step.
  const version = JSON.parse(templateFile("package-lock.json")).packages["node_modules/takumi-js"]
    .version;
  // Read through each runtime's own `pins`, which is what scripts/locks.mjs diffs the regenerated
  // locks with. A reader that stops finding anything makes that gate vacuous — two empty lists
  // are equal — so it has to be a reader, not a substring, that answers here.
  for (const [name, runtime] of Object.entries(RUNTIMES)) {
    assert.ok(
      runtime.pins(templateFile(runtime.lock)).includes(`takumi-js@${version}`),
      `${name}: ${runtime.lock} does not pin takumi-js@${version}`,
    );
  }
});

test("docs match the runtime table", () => {
  // SKILL.md is the product: an agent follows its table, never scripts/runtimes.mjs. The two
  // cannot import each other (template/ is copied out of this repo, and the docs ship to users),
  // so this is what keeps a command changed in one from rotting in the other.
  const skill = readFileSync(path.join(root, "skills/banzuke/SKILL.md"), "utf8");
  // Matched as the whole of a `backticked` span, not as a substring: plain `includes` would let
  // `bun install --frozen` pass against a doc that says `bun install --frozen-lockfile`.
  for (const [name, runtime] of Object.entries(RUNTIMES)) {
    for (const command of [runtime.install, runtime.add("<pkg>"), runtime.run]) {
      const line = commandLine(command);
      assert.ok(skill.includes(`\`${line}\``), `SKILL.md never states \`${line}\` for ${name}`);
    }
  }
  // Every runtime-owned file has to appear in some prune command, or a scaffolded project keeps
  // a lockfile that nothing maintains.
  for (const file of runtimeFiles) {
    assert.match(
      skill,
      new RegExp(`rm[^\\n|]*${file.replaceAll(".", "\\.")}(?![\\w.])`),
      `${file} is pruned nowhere`,
    );
  }
});

test("deno.json's render task carries the permissions the renderer needs", () => {
  // A deno user runs `deno task render`, so this task line is the deno equivalent of
  // `node banzuke.mjs` — a missing flag here fails the render, not the install.
  const { tasks } = JSON.parse(templateFile("deno.json"));
  assert.match(tasks.render, /\bbanzuke\.mjs$/);
  for (const perm of ["read", "write", "env", "sys", "ffi", "net"]) {
    assert.match(tasks.render, new RegExp(`--allow-${perm}\\b`), `--allow-${perm} missing`);
  }
});
