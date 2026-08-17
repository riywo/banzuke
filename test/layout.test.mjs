// The template's sheet() against data shapes a real data.mjs will have but the shipped one does
// not: no featured tier, walls only, single-item tiers, empty tiers, more walls than WALL.sizes.
// Those are the layout-math branches where a bad width would surface as fit()'s "avail must be
// positive" throw, so each case asserts the sheet's documented contract rather than its pixels.
//
// The assertions read markup that banzuke.mjs emits (rank cells, tier headers). The template is
// meant to be edited, so these are checks on the shipped version, not a public API. The one
// exception is the canvas-fill test at the bottom, which has to render: no amount of reading the
// markup can tell you what the boxes add up to.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { pngSize, renderPng } from "../skills/banzuke/template/lib/index.mjs";
import { scaffold } from "./helpers/scaffold.mjs";

/** Copy the template with `data` in place and call its sheet() in-process (no PNG render). */
async function sheetFor(name, data) {
  const { sheet } = await templateFor(name, data);
  return sheet();
}

/** The scaffolded template's module — `sheet()` and `geometry()` both come from here. */
async function templateFor(name, data) {
  const dir = scaffold(name, data);
  return import(pathToFileURL(path.join(dir, "banzuke.mjs")).href);
}

const bulk = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

/** Comfortably inside one minimum-width canvas. */
const SPARSE = {
  title: "Sparse",
  unit: "titles",
  tiers: [
    { name: "Featured", layout: "featured", items: bulk("f", 4), color: "#d62828" },
    { name: "Ranked A", layout: "ranked", items: bulk("a", 6), color: "#1b50a8" },
    { name: "Ranked B", layout: "ranked", items: bulk("b", 8), color: "#f4c20d" },
    { name: "Good", layout: "wall", items: bulk("g", 6) },
    { name: "So-so", layout: "wall", items: bulk("s", 5) },
  ],
};

/** Needs a wider canvas than the minimum, but still fits one. */
const MEDIUM = {
  title: "Medium",
  unit: "titles",
  tiers: [
    { name: "Featured", layout: "featured", items: bulk("f", 5), color: "#d62828" },
    { name: "Ranked A", layout: "ranked", items: bulk("a", 8), color: "#1b50a8" },
    { name: "Ranked B", layout: "ranked", items: bulk("b", 12), color: "#f4c20d" },
    { name: "Good", layout: "wall", items: bulk("g", 60) },
    { name: "So-so", layout: "wall", items: bulk("s", 80) },
  ],
};

/** ~390 titles: the shape that motivated the change. Cannot reach 16:9 even at the cap. */
const DENSE = {
  title: "Dense",
  unit: "titles",
  tiers: [
    { name: "Featured", layout: "featured", items: bulk("f", 10), color: "#d62828" },
    { name: "Ranked A", layout: "ranked", items: bulk("a", 10), color: "#1b50a8" },
    { name: "Ranked B", layout: "ranked", items: bulk("b", 20), color: "#f4c20d" },
    { name: "Good", layout: "wall", items: bulk("g", 96) },
    { name: "So-so", layout: "wall", items: bulk("o", 124) },
    { name: "Seen", layout: "wall", items: bulk("s", 128) },
  ],
};

/**
 * An oversized featured tier against five ranked ones: too much data for the canvas, so it lands
 * on the overflow path where the band is the legibility floor rather than what the canvas leaves.
 * The floor *falls* as the columns rise, which is the trap — judged against the one-column floor,
 * a four-column split looks harmless (a 4115px band makes featured rows 205px tall, so nothing
 * ranked could rival them), while the band four columns actually delivers is 1228px and its rows
 * come out taller than the featured ones.
 */
const BIG_FEATURED = {
  title: "Big featured",
  unit: "titles",
  tiers: [
    { name: "Featured", layout: "featured", items: bulk("f", 40), color: "#d62828" },
    ...Array.from({ length: 5 }, (_, i) => ({
      name: `Ranked ${i}`,
      layout: "ranked",
      items: bulk(`r${i}-`, 20),
    })),
    { name: "Wall", layout: "wall", items: bulk("w", 50) },
  ],
};

// JSON.stringify drops an undefined color, so a colorless tier lands in data.mjs without the key.
const tier = (name, layout, items, color) => ({ name, layout, items, color });

// The extractors anchor on layout structure (flex boxes, the auto margin that pushes a count
// right), never on the typography knobs the template invites you to tune — so re-tuning a font
// size or line-height does not fail a test about numbering.

/** The running numbers, in document order: a rank cell is the box before a row's content cell */
const ranks = (html) =>
  [...html.matchAll(/>(\d+)<\/div>\s*<div style="flex:1;min-width:0/g)].map((m) => Number(m[1]));

/** [name, count] per tier header — the count is the box pushed right by margin-left:auto */
const headers = (html) =>
  [...html.matchAll(/>([^<]*)<\/div>\s*<div style="margin-left:auto;[^"]*">(\d+)</g)].map((m) => [
    m[1],
    Number(m[2]),
  ]);

/** The font sizes used by wall rows, in document order (a wall row sizes its own text) */
const wallSizes = (html) =>
  [...html.matchAll(/font-size:([\d.]+)px;line-height:/g)].map((m) => Number(m[1]));

/** Font sizes of every fitSpan in the sheet, order-independent within the style attribute */
const spanSizes = (html) =>
  [...html.matchAll(/<span style="[^"]*?font-size:([\d.]+)px/g)].map((m) => Number(m[1]));

/** Assert the sheet numbers its items 1..n with no gaps, in document order */
const assertRanks = (html, n) =>
  assert.deepEqual(
    ranks(html),
    Array.from({ length: n }, (_, i) => i + 1),
  );

test("numbering runs 1..N across featured then ranked, and walls get none", async () => {
  const html = await sheetFor("layout-numbering", {
    title: "T",
    unit: "titles",
    tiers: [
      tier("Featured", "featured", ["f1", "f2", "f3"], "#d62828"),
      tier("Ranked A", "ranked", ["a1", "a2", "a3", "a4"], "#1b50a8"),
      tier("Ranked B", "ranked", ["b1", "b2"], "#f4c20d"),
      tier("Wall", "wall", ["w1", "w2", "w3"]),
    ],
  });
  // 3 + 4 + 2 numbered items, continuous and gapless; the 3 wall items are unnumbered
  assertRanks(html, 9);
  assert.deepEqual(headers(html), [
    ["Featured", 3],
    ["Ranked A", 4],
    ["Ranked B", 2],
    ["Wall", 3],
  ]);
  // the masthead count spans every tier, walls included
  assert.match(html, />12 titles</);
  for (const item of ["f1", "a1", "b2", "w3"]) assert.ok(html.includes(`>${item}<`), item);
});

test("a second featured tier is demoted to ranked, numbering unbroken", async () => {
  const html = await sheetFor("layout-two-featured", {
    title: "T",
    unit: "titles",
    tiers: [
      tier("First", "featured", ["a", "b"]),
      tier("Second", "featured", ["c", "d"]),
      tier("Third", "ranked", ["e"]),
    ],
  });
  assertRanks(html, 5);
  assert.deepEqual(headers(html), [
    ["First", 2],
    ["Second", 2],
    ["Third", 1],
  ]);
});

test("data with no featured tier still lays out (the lone-ranked path)", async () => {
  const html = await sheetFor("layout-no-featured", {
    title: "T",
    unit: "titles",
    tiers: [
      tier("Ranked A", "ranked", ["a", "b", "c", "d", "e"]),
      tier("Ranked B", "ranked", ["f"]),
    ],
  });
  assertRanks(html, 6);
  assert.match(html, />6 titles</);
});

// The mirror of the case above, and the one that used to drop rows off the sheet: with no ranked
// tiers there is nothing on the right to size the top band against, so it has to come from the
// featured column itself. Sized off the (absent) ranked tiers it collapses to 0px.
test("a featured tier with no ranked tier divides the band into its rows", async () => {
  const featuredOnly = (n) => ({
    title: "T",
    unit: "titles",
    tiers: [
      tier(
        "Featured",
        "featured",
        Array.from({ length: n }, (_, i) => `f${i + 1}`),
      ),
    ],
  });
  // The masthead and the top band are the sheet's two fixed-height flex rows, in that order.
  const bandHeight = (html) => {
    const boxes = [...html.matchAll(/height:(\d+)px;flex:none;display:flex;border-bottom:/g)];
    assert.equal(boxes.length, 2, "expected a masthead and a top band");
    return Number(boxes[1][1]);
  };
  const two = await sheetFor("layout-feat-only-2", featuredOnly(2));
  const six = await sheetFor("layout-feat-only-6", featuredOnly(6));
  const { geometry } = await templateFor("layout-feat-only-geom", featuredOnly(2));
  assert.ok(bandHeight(two) > 0, "the band collapsed, so the featured rows have nowhere to go");
  assert.ok(bandHeight(six) > 0, "the band collapsed, so the featured rows have nowhere to go");
  // Pinned to a canvas, the band no longer grows with the tier — the same height is divided into
  // more, shorter rows.
  assert.ok(
    geometry(featuredOnly(6)).featRowH < geometry(featuredOnly(2)).featRowH,
    "more featured rows must divide the band into shorter ones",
  );
  assertRanks(six, 6);
});

test("walls-only data renders a sheet with no rank numbers", async () => {
  const html = await sheetFor("layout-walls-only", {
    title: "T",
    unit: "titles",
    tiers: [tier("Wall A", "wall", ["a", "b"]), tier("Wall B", "wall", ["c"])],
  });
  assert.deepEqual(ranks(html), []);
  assert.deepEqual(headers(html), [
    ["Wall A", 2],
    ["Wall B", 1],
  ]);
  assert.match(html, />3 titles</);
});

// With neither a featured nor a ranked tier, nothing else in the sheet claims the geometry's
// reserved band height. On a canvas pinned to a fixed height (rather than one that grows with the
// content) an unclaimed band shows up as a real blank stripe, stranding the footer partway up the
// sheet instead of pinning it to the bottom — the walls-only and fully-empty cases above render
// distinct HTML either way, so those assertions alone would not have caught it.
test("a sheet with no featured and no ranked tier still fills the canvas", async () => {
  const wallsOnly = {
    title: "T",
    unit: "titles",
    tiers: [tier("Wall A", "wall", ["a", "b"]), tier("Wall B", "wall", ["c"])],
  };
  const empty = { title: "T", unit: "titles", tiers: [] };
  for (const data of [wallsOnly, empty]) {
    const html = await sheetFor(`layout-fill-${data.tiers.length}`, data);
    // Whatever sits between the masthead and the footer has to be able to grow into the leftover
    // space, or a fixed-height box there leaves the reserve unrendered.
    assert.match(
      html,
      /<div style="flex:1;display:flex;flex-direction:column;justify-content:space-between;min-height:0">/,
      `expected a flex box able to absorb the band height for ${JSON.stringify(data.tiers.length)} wall tier(s)`,
    );
  }
});

test("single-item tiers render (the flat size ramp)", async () => {
  const html = await sheetFor("layout-single", {
    title: "T",
    unit: "titles",
    tiers: [tier("Featured", "featured", ["only one"]), tier("Ranked", "ranked", ["and one more"])],
  });
  assertRanks(html, 2);
  assert.match(html, />only one</);
  assert.match(html, />and one more</);
});

test("empty tiers are dropped, and an entirely empty sheet still renders", async () => {
  const html = await sheetFor("layout-empty-tiers", {
    title: "T",
    unit: "titles",
    tiers: [
      tier("Gone", "featured", []),
      tier("Kept", "ranked", ["a"]),
      tier("Also gone", "wall", []),
    ],
  });
  assert.deepEqual(headers(html), [["Kept", 1]]);
  assert.doesNotMatch(html, /Gone|Also gone/);
  assert.match(html, />1 titles</);

  const none = await sheetFor("layout-no-tiers", {
    title: "Nothing Yet",
    unit: "titles",
    tiers: [],
  });
  assert.deepEqual(headers(none), []);
  assert.match(none, />0 titles</);
  assert.match(none, />Nothing Yet</); // the masthead survives
});

test("more walls than WALL.sizes: the last size repeats", async () => {
  const html = await sheetFor("layout-many-walls", {
    title: "T",
    unit: "titles",
    tiers: [1, 2, 3, 4, 5].map((i) => tier(`Wall ${i}`, "wall", [`w${i}`])),
  });
  // WALL.sizes has three entries and each wall is smaller than the last, so walls 4 and 5
  // can only come from the final entry — whatever that entry currently is.
  const sizes = wallSizes(html);
  assert.equal(sizes.length, 5);
  assert.ok(sizes[0] > sizes[1] && sizes[1] > sizes[2], `not descending: ${sizes}`);
  assert.equal(sizes[3], sizes[2]);
  assert.equal(sizes[4], sizes[2]);
});

test("item objects use .title, and year is not displayed by default", async () => {
  const html = await sheetFor("layout-objects", {
    title: "T",
    unit: "titles",
    tiers: [tier("Featured", "featured", [{ title: "Cowboy Bebop", year: 1998 }])],
  });
  assert.match(html, />Cowboy Bebop</);
  assert.doesNotMatch(html, /1998/);
});

test("a tier without a color falls back to the accent", async () => {
  const html = await sheetFor("layout-no-color", {
    title: "T",
    unit: "titles",
    tiers: [
      tier("Featured", "featured", ["a"]), // no color: featured spine
      tier("Ranked plain", "ranked", ["b"]), // no color: ranked spine
      tier("Ranked colored", "ranked", ["c"], "#1b50a8"),
    ],
  });
  // a row's spine is the border-left followed by the row background (the masthead rule is not)
  const spines = [...html.matchAll(/border-left:\d+px solid ([^;"]+);background:/g)].map(
    (m) => m[1],
  );
  assert.equal(spines.length, 3);
  assert.equal(spines[0], spines[1], "both colorless tiers fall back to the same accent");
  assert.match(spines[0], /^(#|rgb)/, `accent is not a color: ${spines[0]}`);
  assert.equal(spines[2], "#1b50a8", "a tier's own color is used as-is");
});

test("every text field from data is escaped", async () => {
  const html = await sheetFor("layout-escaping", {
    title: `A & B <hr>`,
    unit: `ti<t>les`, // reaches the sheet through the masthead count label
    tiers: [tier(`Tier & <b>`, "ranked", [`x & <y> "z"`]), tier(`Wall <i>`, "wall", [`<script>`])],
  });
  assert.doesNotMatch(html, /<hr>|<b>|<i>|<t>|<y>|<script>/);
  assert.match(html, /A &amp; B &lt;hr&gt;/);
  assert.match(html, /Tier &amp; &lt;b&gt;/);
  assert.match(html, /x &amp; &lt;y&gt; &quot;z&quot;/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, />2 ti&lt;t&gt;les</); // the count label, escaped
});

test("a small featured tier does not squash the ranked rows (the rank-unit floor)", async () => {
  const html = await sheetFor("layout-min-unit", {
    title: "T",
    unit: "titles",
    tiers: [
      tier("Featured", "featured", ["just one"]),
      tier(
        "Ranked",
        "ranked",
        Array.from({ length: 20 }, (_, i) => `r${i}`),
      ),
    ],
  });
  // Without MIN_RANK_UNIT the band's height is divided among 10 rows of a 1-row featured tier,
  // and the right-hand rows collapse to ~3px. Every row has to stay legible instead.
  const sizes = spanSizes(html);
  assert.ok(sizes.length >= 21, `expected a span per item, got ${sizes.length}`);
  assert.ok(Math.min(...sizes) >= 10, `smallest row is ${Math.min(...sizes)}px`);
});

test("titles far too long for their column still produce a sheet", async () => {
  // the squeeze case: a long title in a narrow ranked column is what negative avail would break
  const long =
    "The Extraordinarily Long Name of a Show That Simply Refuses To End, Part Two: Electric Boogaloo";
  const html = await sheetFor("layout-long", {
    title: long,
    unit: "titles",
    tiers: [
      tier("Featured", "featured", [long, "short"]),
      tier("Ranked", "ranked", [long]),
      tier("Wall", "wall", [long]),
    ],
  });
  // squeezed text is scaled down rather than clipped or overflowing
  const scales = [...html.matchAll(/transform:scaleX\(([\d.]+)\)/g)].map((m) => Number(m[1]));
  assert.ok(scales.length >= 3, `expected squeezed spans, got ${scales.length}`);
  assert.ok(
    scales.some((s) => s < 1),
    `expected at least one shrink, got ${scales.join(", ")}`,
  );
});

test("a large sheet stays consistent (40 featured, 6 ranked tiers, 200-item wall)", async () => {
  const html = await sheetFor("layout-large", {
    title: "T",
    unit: "titles",
    tiers: [
      tier(
        "Featured",
        "featured",
        Array.from({ length: 40 }, (_, i) => `f${i}`),
      ),
      ...Array.from({ length: 6 }, (_, t) =>
        tier(
          `Ranked ${t}`,
          "ranked",
          Array.from({ length: 9 }, (_, i) => `r${t}-${i}`),
        ),
      ),
      tier(
        "Wall",
        "wall",
        Array.from({ length: 200 }, (_, i) => `w${i}`),
      ),
    ],
  });
  const n = 40 + 6 * 9;
  assertRanks(html, n);
  assert.ok(html.includes(`>${n + 200} titles<`));
});

// ---- geometry: the canvas is solved, not fixed ----
// Widths are data-dependent, so these assert relations (wider / on-ratio / flagged) rather than
// magic numbers — except the minimum, which is the documented floor.

test("geometry: a sparse sheet sits at the minimum width, on the target ratio", async () => {
  const { geometry } = await templateFor("geom-sparse", SPARSE);
  const g = geometry();
  assert.equal(g.sheetW, 1024);
  assert.equal(g.sheetH, Math.round((g.sheetW * 9) / 16));
  assert.equal(g.clamped, false);
  assert.ok(g.bandH > 0, "the band collapsed");
});

test("geometry: more data widens the canvas instead of lengthening it", async () => {
  const { geometry } = await templateFor("geom-widen", SPARSE);
  const small = geometry();
  const big = geometry(MEDIUM);
  assert.ok(big.sheetW > small.sheetW, `expected a wider canvas, got ${big.sheetW}`);
  assert.equal(big.sheetH, Math.round((big.sheetW * 9) / 16));
  assert.equal(big.clamped, false);
  // sideways, not downward: the walls answered the extra data with columns
  assert.ok(big.wallPlan[0].cols > small.wallPlan[0].cols, "the walls should have gained columns");
});

test("geometry: data that cannot reach the ratio keeps the cap and overflows, flagged", async () => {
  const { geometry } = await templateFor("geom-clamp", SPARSE);
  const g = geometry(DENSE);
  assert.equal(g.sheetW, 2048);
  assert.equal(g.clamped, true);
  assert.ok(
    g.sheetH > Math.round((g.sheetW * 9) / 16),
    "an overflowing sheet is taller than its target, not crushed into it",
  );
  assert.ok(g.bandH >= g.bandFloor, "the band must not fall below its legibility floor");
});

test("geometry: only a sheet still taller than square counts as a crop risk", async () => {
  const { geometry } = await templateFor("geom-crop", SPARSE);
  // Overflowing 16:9 by a little is not a crop risk — 1.7:1 is still well inside X's safe band.
  assert.equal(geometry(DENSE).cropRisk, false);
  const huge = geometry({
    title: "Huge",
    unit: "titles",
    tiers: [
      { name: "Featured", layout: "featured", items: bulk("f", 6), color: "#d62828" },
      { name: "Ranked", layout: "ranked", items: bulk("r", 20), color: "#1b50a8" },
      { name: "Wall", layout: "wall", items: bulk("w", 2000) },
    ],
  });
  assert.equal(huge.clamped, true);
  assert.equal(huge.cropRisk, true);
});

test("the sheet is pinned to the solved canvas", async () => {
  const { sheet, geometry } = await templateFor("layout-canvas", SPARSE);
  const g = geometry();
  const html = await sheet();
  assert.ok(
    html.startsWith(`<div style="width:${g.sheetW}px;height:${g.sheetH}px`),
    `root box does not carry the canvas: ${html.slice(0, 140)}`,
  );
});

test("RANK_COLS auto: the ranked block gains columns as the canvas widens", async () => {
  const { geometry } = await templateFor("geom-rankcols", SPARSE);
  assert.equal(geometry().rankCols, 2, "a minimum-width sheet keeps the two-column ranked block");
  assert.equal(
    geometry(MEDIUM).rankCols,
    3,
    "a wider canvas should split the ranked tiers further",
  );
});

// Every band row's own cell now carries the fixed/weighted numbers `derive()` divided its height
// by (see `shape()`), so the "weighted unit" the old top-level `g.unit` used to expose is
// reconstructed per cell instead: the height of that cell's tallest single ranked row. None of
// these fixtures use `row:`, so every ranked tier still gets a row (and a cell) of its own — this
// is the same invariant `resolveRankCols`/`hierCeiling` enforce, just read back through the grid.
const topRankedRow = (g) =>
  Math.max(
    ...g.bandRowPlan.flatMap((row, i) =>
      row.cells
        .filter((c) => !c.walls)
        .map((c) => ((g.bandRowHeights[i] - c.fixed) / c.weighted) * Math.max(...c.weights)),
    ),
  );

test("RANK_COLS auto: hierarchy outranks row width", async () => {
  // DENSE is wide enough to want four columns, but the wider splits would make its ranked rows
  // rival its featured ones — gappy rows beat a ranking that stops reading by size. How many
  // columns that leaves is data- and knob-dependent (and a knob away from changing), so assert
  // the principle: no band cell's tallest ranked row may rival a featured one.
  const { geometry } = await templateFor("geom-rankcols-hier", SPARSE);
  const g = geometry(DENSE);
  const topRow = topRankedRow(g);
  assert.ok(
    topRow < g.featRowH,
    `the top ranked row (${topRow}) must stay shorter than a featured one (${g.featRowH})`,
  );
});

test("RANK_COLS auto: a clamped sheet is judged against the band it actually gets", async () => {
  // The overflow path chooses the split and the band height together, so it is possible to accept
  // a split on the strength of a band that only the *rejected* split would have produced. Assert
  // the invariant on the layout that ships: whatever count came out, no band cell's tallest ranked
  // row may rival a featured row in the same sheet.
  const { geometry } = await templateFor("geom-clamped-hier", SPARSE);
  const g = geometry(BIG_FEATURED);
  assert.equal(g.clamped, true, "the fixture is meant to exercise the overflow path");
  const topRow = topRankedRow(g);
  assert.ok(
    topRow < g.featRowH,
    `${g.rankCols} columns: the top ranked row (${topRow}) out-grows a featured one (${g.featRowH})`,
  );
});

// The one promise the solver exists to keep: the sheet's boxes add up to the canvas it pins
// itself to. Strip the root's `height` and takumi auto-fits the sheet to whatever its boxes
// really come to, so the two numbers can be compared. Reserving height twice for the same rule
// (takumi is border-box: a declared height already contains the box's border and padding) shows
// up here as a bare strip of paper under the footer, and nothing else in this file would catch
// it. Featured shapes only — with no featured tier the last block is flex:1, which collapses to
// its content once the pinned height is gone, so the comparison has nothing to say.
test("the sheet's boxes add up to the canvas it is pinned to", async () => {
  for (const [name, data] of [
    ["sparse", SPARSE],
    ["medium", MEDIUM],
    ["dense", DENSE], // the overflow path, where the band is the floor and the sheet runs tall
  ]) {
    const { sheet, geometry } = await templateFor(`fill-${name}`, data);
    const g = geometry();
    const html = await sheet();
    const loose = html.replace(`height:${g.sheetH}px;`, "");
    assert.notEqual(loose, html, `${name}: the root box did not carry the solved height`);
    const png = await renderPng(loose, { devicePixelRatio: 1, width: g.sheetW });
    assert.deepEqual(
      pngSize(png),
      { width: g.sheetW, height: g.sheetH },
      `${name}: the sheet does not fill its ${g.sheetW}×${g.sheetH} canvas`,
    );
  }
});

test("RANK_COLS: an explicit number overrides the auto split", async () => {
  const dir = scaffold("geom-rankcols-fixed", DENSE);
  const file = path.join(dir, "banzuke.mjs");
  writeFileSync(
    file,
    readFileSync(file, "utf8").replace('const RANK_COLS = "auto"', "const RANK_COLS = 3"),
  );
  const { geometry } = await import(pathToFileURL(file).href);
  assert.equal(geometry().rankCols, 3);
});

// ---- the band grid ----

const GRID = {
  title: "Grid",
  unit: "titles",
  tiers: [
    { name: "Featured", layout: "featured", items: bulk("f", 6), color: "#d62828" },
    { name: "A", layout: "ranked", items: bulk("a", 10), row: 1, column: 1, color: "#1b50a8" },
    { name: "B", layout: "ranked", items: bulk("b", 20), row: 1, column: 1, cols: 2 },
    { name: "C", layout: "wall", items: bulk("c", 96), row: 1, column: 2, cols: 3, size: 12 },
    { name: "Rest", layout: "wall", items: bulk("r", 120) },
  ],
};

test("band grid: `numbers: false` drops the rank cells and takes no running numbers", async () => {
  const html = await sheetFor("grid-numbers", {
    title: "T",
    unit: "titles",
    tiers: [
      { name: "Featured", layout: "featured", items: bulk("f", 3), color: "#d62828" },
      { name: "Quiet", layout: "ranked", items: bulk("q", 4), numbers: false },
      { name: "Loud", layout: "ranked", items: bulk("l", 3) },
    ],
  });
  // 3 featured then 3 in Loud: the unnumbered tier neither shows nor consumes numbers
  assertRanks(html, 6);
  for (const item of ["q1", "q4", "l1"]) assert.ok(html.includes(`>${item}<`), item);
});

test("band grid: a wall in the band draws no rule of its own", async () => {
  const html = await sheetFor("grid-rule", GRID);
  // The enclosing cell already rules underneath; a second one stacks into a double line.
  assert.equal(
    html.split('<div style="padding-bottom:10px">').length - 1,
    1,
    "the band's wall should render without its own bottom rule",
  );
});

test("band grid: side-by-side cells split the width and each fills the row", async () => {
  const { sheet, geometry } = await templateFor("grid-render", GRID);
  const g = geometry();
  const html = await sheet();
  const widths = [
    ...html.matchAll(/<div style="width:(\d+)px;flex:none;display:flex;flex-direction:column;/g),
  ].map((m) => Number(m[1]));
  assert.ok(widths.length >= 2, "expected a box per cell");
  assert.ok(
    Math.abs(widths.slice(-2).reduce((a, b) => a + b, 0) - g.rightW) <= 4,
    `cells should tile rightW ${g.rightW}, got ${widths.slice(-2)}`,
  );
});

test("band grid: `row:` and `column:` build rows of cells of stacks", async () => {
  const { geometry } = await templateFor("grid-shape", GRID);
  const g = geometry();
  assert.equal(g.bandRowPlan.length, 1, "all three band tiers share row 1");
  const [row] = g.bandRowPlan;
  assert.equal(row.cells.length, 2, "two columns: the A/B stack, and C");
  assert.deepEqual(
    row.cells.map((c) => c.stack.map((t) => t.name)),
    [["A", "B"], ["C"]],
  );
});

test("band grid: a wall tier with a `row:` moves into the band, not the foot", async () => {
  const { geometry } = await templateFor("grid-wall", GRID);
  const g = geometry();
  assert.deepEqual(
    g.wallPlan.map((w) => w.tier.name),
    ["Rest"],
    "only the tier without a `row:` stays at the foot",
  );
  const cell = g.bandRowPlan[0].cells.find((c) => c.walls);
  assert.ok(cell, "the band should hold a wall cell");
  assert.equal(cell.walls[0].size, 12); // data.mjs `size:`
  assert.equal(cell.walls[0].rows, 32); // 96 items over `cols: 3`
});

test("band grid: a wall in the band is far cheaper than the same tier ranked", async () => {
  const { geometry } = await templateFor("grid-cost", GRID);
  const asWall = geometry();
  const asRanked = geometry({
    ...GRID,
    tiers: GRID.tiers.map((t) => (t.name === "C" ? { ...t, layout: "ranked" } : t)),
  });
  assert.ok(
    asWall.sheetH < asRanked.sheetH,
    `wall ${asWall.sheetH} should be shorter than ranked ${asRanked.sheetH}`,
  );
});

// A wall cell cannot grow with the rest of its row, so its height has to be reserved rather than
// shared — the row GRID's own "C" wall shares with the "A"/"B" ranked stack is exactly this case.
// Missing this let a mixed row size itself off the ranked cell alone and clip the wall beside it.
test("band grid: a flexible row is never shorter than the wall cell it holds", async () => {
  const { geometry } = await templateFor("grid-wall-floor", GRID);
  const g = geometry();
  const row = g.bandRowPlan[0];
  const wallCell = row.cells.find((c) => c.walls);
  const wallNeed = wallCell.walls.reduce((sum, w) => sum + w.height, 0);
  assert.ok(
    g.bandRowHeights[0] >= wallNeed,
    `row height (${g.bandRowHeights[0]}) must clear its wall cell's need (${wallNeed})`,
  );
});

test("band grid: with no `row:` anywhere, the band is one tier per row as before", async () => {
  const { geometry } = await templateFor("grid-default", SPARSE);
  const g = geometry();
  assert.equal(g.bandRowPlan.length, 2, "two ranked tiers, stacked");
  for (const row of g.bandRowPlan) assert.equal(row.cells.length, 1);
});

// A row of one tier is a stack of one, so TIER_WEIGHT (which taller-izes an *earlier* tier in the
// same stack) has nothing to act on unless the row itself carries a weight too — the gap this grid
// briefly opened: with every ranked tier on its own row, the whole gradient silently disappeared
// and row height tracked item count instead. Two tiers close enough in size that item count alone
// would favor the later one is what catches that regression; a lopsided pair would pass either way.
test("band grid: with no `row:` anywhere, an earlier tier still reads taller than a later, bigger one", async () => {
  const { geometry } = await templateFor("grid-tier-weight", {
    title: "T",
    unit: "titles",
    tiers: [
      { name: "Featured", layout: "featured", items: bulk("f", 4), color: "#d62828" },
      { name: "Fewer", layout: "ranked", items: bulk("a", 8) },
      { name: "More", layout: "ranked", items: bulk("b", 10) },
    ],
  });
  const g = geometry();
  assert.equal(g.bandRowPlan.length, 2);
  assert.ok(
    g.bandRowHeights[0] > g.bandRowHeights[1],
    `the earlier, smaller tier (${g.bandRowHeights[0]}px) should still outsize the later, ` +
      `bigger one (${g.bandRowHeights[1]}px)`,
  );
});

// TIER_WEIGHT applies at both levels now: across a row's own position (`shape()`'s row loop) and
// within a cell's stack (`cellOf`'s weights). A tier that is both the top of its row *and* the top
// of a `column:` stack draws on both, so three flexible rows (enough for a row weight of TIER_WEIGHT²
// to appear) with a stack in the middle one is the fixture that would catch either compounding
// silently dropping back to one level only.
test("band grid: `row:` and `column:` together, TIER_WEIGHT compounds across rows and within a stack", async () => {
  const DATA = {
    title: "T",
    unit: "titles",
    tiers: [
      { name: "Featured", layout: "featured", items: bulk("f", 4), color: "#d62828" },
      { name: "Top", layout: "ranked", items: bulk("t", 6), row: 1 },
      { name: "MidA", layout: "ranked", items: bulk("a", 6), row: 2, column: 1 },
      { name: "MidB", layout: "ranked", items: bulk("b", 6), row: 2, column: 1 },
      { name: "Bottom", layout: "ranked", items: bulk("c", 6), row: 3 },
    ],
  };
  const { geometry, sheet } = await templateFor("grid-weight-compound", DATA);
  const g = geometry();
  assert.equal(g.bandRowPlan.length, 3, "three flexible band rows: Top, Mid, Bottom");
  assert.equal(g.bandRowPlan[1].cells.length, 1, "MidA/MidB share a `column:`, so one cell");
  assert.equal(g.bandRowPlan[1].cells[0].stack.length, 2, "that cell holds both tiers, stacked");

  // Top and Bottom are each a stack of one, so their own within-stack weight is 1 — any height
  // difference between them is purely the row-level weight this fixture is pinning.
  const perRowHeight = (rowIndex) => {
    const row = g.bandRowPlan[rowIndex];
    const cell = row.cells.find((c) => !c.walls);
    return ((g.bandRowHeights[rowIndex] - cell.fixed) / cell.weighted) * Math.max(...cell.weights);
  };
  const ratio = perRowHeight(0) / perRowHeight(2);
  // TIER_WEIGHT is 1.3 in this template (the "tuning knobs" section) — three flexible rows put the
  // top one at TIER_WEIGHT^2 and the bottom at TIER_WEIGHT^0, so their ratio is TIER_WEIGHT².
  const TIER_WEIGHT = 1.3;
  assert.ok(
    Math.abs(ratio - TIER_WEIGHT ** 2) < 0.1,
    `top:bottom should compound to TIER_WEIGHT² (${(TIER_WEIGHT ** 2).toFixed(2)}), got ${ratio.toFixed(2)}`,
  );

  // The geometry-only assertions above hold on `2e482fa` too, since Task 1 built `bandRowPlan`
  // before this task drew it — they pin the compounding, not this task's renderer. `sheet()` is
  // what turns a 4-tier `ranked` list sharing a 3-row `bandRowPlan` into markup: at `2e482fa` that
  // renderer still indexes `g.bandRowHeights[i]` by position in `ranked` (`ranked[3]`, "Bottom",
  // reads `bandRowHeights[3]`, which does not exist), so it throws before ever reaching a span. A
  // render that succeeds and keeps the same TIER_WEIGHT² gradient in its actual font sizes is what
  // only this task's grid-aware renderer can produce.
  const html = await sheet();
  const spanSizes = [...html.matchAll(/<span style="[^"]*?font-size:([\d.]+)px/g)].map((m) =>
    Number(m[1]),
  );
  // title(1) + Featured(4) precede the band; Top(6), MidA(6), MidB(6), Bottom(6) follow in order.
  const topSize = spanSizes[1 + 4];
  const bottomSize = spanSizes[1 + 4 + 6 + 6 + 6];
  const renderedRatio = topSize / bottomSize;
  assert.ok(
    Math.abs(renderedRatio - TIER_WEIGHT ** 2) < 0.15,
    `rendered top:bottom font sizes should also compound to TIER_WEIGHT² ` +
      `(${(TIER_WEIGHT ** 2).toFixed(2)}), got ${renderedRatio.toFixed(2)} (${topSize} vs ${bottomSize})`,
  );
});

// `t.cols` is honored (colsOf) now that a tier can pick its own column count, so a stray `0` or
// negative value in data.mjs is newly reachable here — and `n / 0` is Infinity, not a thrown error,
// so it would otherwise surface as a silently broken canvas rather than a clear failure.
test("band grid: a nonsense `cols:` still yields a finite canvas", async () => {
  const { geometry } = await templateFor("grid-cols-zero", {
    title: "T",
    unit: "titles",
    tiers: [
      { name: "Featured", layout: "featured", items: bulk("f", 4), color: "#d62828" },
      { name: "Zero cols", layout: "ranked", items: bulk("a", 8), cols: 0 },
      { name: "Negative cols", layout: "wall", items: bulk("b", 12), row: 1, cols: -3 },
    ],
  });
  const g = geometry();
  assert.ok(Number.isFinite(g.sheetH), `sheetH must be finite, got ${g.sheetH}`);
  for (const h of g.bandRowHeights) {
    assert.ok(Number.isFinite(h), `every band row height must be finite, got ${h}`);
  }
});

// takumi is border-box: a row's own declared height already reserves DIV px for its `border-bottom`
// separator, so only a non-last row's *content* — what tierSizes actually gets to budget font size
// against — is DIV px smaller than the row's declared height. The single-tier-per-row renderer this
// replaced fed tierSizes the full declared height (no −DIV) for every row, over-budgeting a non-last
// row's type by a hair; this task's grid renderer corrects it (see task-2-report.md, "a real
// regression, found by measurement"). Pinning the *corrected* relationship here, analytically, off
// public `geometry()` numbers and the template's own DIV/HDR_H/TYPE.ranked knobs — not by copying
// one render's numbers — so a future refactor can't drift back to the over-budgeted version without
// this failing.
test("band grid: a non-last flexible row budgets its ranked type off content height, not the declared box height", async () => {
  const { geometry, sheet } = await templateFor("grid-font-budget", {
    title: "T",
    unit: "titles",
    tiers: [
      { name: "Featured", layout: "featured", items: bulk("f", 4), color: "#d62828" },
      // cols: 1 pins each tier to exactly `n` rows, decoupled from the canvas-width-dependent auto
      // column split, so the row-content math below doesn't also have to reproduce that solve.
      { name: "Top", layout: "ranked", items: bulk("t", 6), cols: 1 },
      { name: "Bottom", layout: "ranked", items: bulk("b", 6), cols: 1 },
    ],
  });
  const g = geometry();
  assert.equal(
    g.bandRowPlan.length,
    2,
    "two ranked tiers, one row each: Top non-last, Bottom last",
  );

  const DIV = 4;
  const HDR_H = 24;
  const TYPE_RANKED = { cap: 30, rowFill: 0.63, taper: 0.78 }; // mirrors TYPE.ranked in the "tuning knobs" section
  const lerp = (a, b, t) => a + (b - a) * t;
  const ramp = (from, to, n) =>
    Array.from({ length: n }, (_, i) => Math.round(lerp(from, to, n < 2 ? 0 : i / (n - 1))));
  const expectedSizes = (rowBudget, n) => {
    const from = Math.min(TYPE_RANKED.cap, Math.round(rowBudget * TYPE_RANKED.rowFill));
    return ramp(from, Math.round(from * TYPE_RANKED.taper), n);
  };
  const n = 6;
  // Non-last: its declared height reserves DIV for the rule below it, so content is height−DIV.
  const topBudget = (g.bandRowHeights[0] - DIV - HDR_H) / n;
  // Last: no rule below it, nothing reserved — content is the full declared height.
  const bottomBudget = (g.bandRowHeights[1] - HDR_H) / n;

  const html = await sheet();
  const spanSizes = [...html.matchAll(/<span style="[^"]*?font-size:([\d.]+)px/g)].map((m) =>
    Number(m[1]),
  );
  // title(1) + Featured(4) precede Top(6) then Bottom(6).
  const top = spanSizes.slice(1 + 4, 1 + 4 + n);
  const bottom = spanSizes.slice(1 + 4 + n, 1 + 4 + n + n);
  assert.deepEqual(top, expectedSizes(topBudget, n), `non-last row's rendered sizes: ${top}`);
  assert.deepEqual(bottom, expectedSizes(bottomBudget, n), `last row's rendered sizes: ${bottom}`);

  // The regression this pins: budgeting off the declared height with no −DIV gives a strictly
  // different (larger) sequence for the non-last row.
  const regressedBudget = (g.bandRowHeights[0] - HDR_H) / n;
  assert.notDeepEqual(
    top,
    expectedSizes(regressedBudget, n),
    "must not match the un-border-box-corrected (larger) budget",
  );
});

// Carry-over #2 (the brief): `sheet()` used to ignore a tier's own `cols:` and always split it by
// the row's shared `g.rankCols`. `GRID`'s own "B" (`cols: 2` against a 10-item "A" that shares the
// row's auto split) already exercises this in geometry — Task 1's `shape()` always read `t.cols`
// correctly — but nothing checked that the *render* does too. It's a render-only bug: `cell.rows[j]`
// (what `derive()` sized B's row height against) already comes from `shape()`'s own correctly-`cols:`
// -aware count, so a renderer that silently fell back to `g.rankCols` for the `cols:` it passes to
// `rankedTier` would still produce a canvas of the right height — just with B's row count (and so
// its font-size budget) computed against the wrong divisor. Confirmed by disabling the fix locally
// during development: B's rendered sizes jump from [21, 21, 20, …] to a cap-clipped [30, 30, 29, …]
// (rows halve from 10 to 5, doubling the per-row budget) — a difference this test would catch.
test("band grid: a tier's own `cols:` reaches the renderer, not just geometry", async () => {
  const { geometry, sheet } = await templateFor("grid-cols-render", GRID);
  const g = geometry();
  const row = g.bandRowPlan[0];
  const stackCell = row.cells.find((c) => !c.walls && c.stack.some((t) => t.name === "B"));
  const j = stackCell.stack.findIndex((t) => t.name === "B");
  assert.equal(stackCell.rows[j], 10, "B's own `cols: 2` over 20 items is 10 rows, geometry side");

  const HDR_H = 24;
  const TYPE_RANKED = { cap: 30, rowFill: 0.63, taper: 0.78 };
  const lerp = (a, b, t) => a + (b - a) * t;
  const ramp = (from, to, n) =>
    Array.from({ length: n }, (_, i) => Math.round(lerp(from, to, n < 2 ? 0 : i / (n - 1))));
  // GRID's band is a single row, so it's also the last row: no DIV subtraction (see the border-box
  // test above for the non-last case).
  const rowH = g.bandRowHeights[0];
  const unit = (rowH - stackCell.fixed) / stackCell.weighted;
  const heightForB = HDR_H + Math.round(stackCell.rows[j] * stackCell.weights[j] * unit);
  const budget = (heightForB - HDR_H) / stackCell.rows[j];
  const from = Math.min(TYPE_RANKED.cap, Math.round(budget * TYPE_RANKED.rowFill));
  const expected = ramp(from, Math.round(from * TYPE_RANKED.taper), 20);

  const html = await sheet();
  const spanSizes = [...html.matchAll(/<span style="[^"]*?font-size:([\d.]+)px/g)].map((m) =>
    Number(m[1]),
  );
  // title(1) + Featured(6) + A(10) precede B(20).
  const bStart = 1 + 6 + 10;
  const bSizes = spanSizes.slice(bStart, bStart + 20);
  assert.deepEqual(
    bSizes,
    expected,
    `B's rendered sizes must reflect its own cols: 2, not the row's shared rankCols: ${bSizes}`,
  );
});

// Findings from code review: two crashes the grid renderer introduced beyond the one already fixed
// above (double-DIV). Both reproduced against the pre-fix code and confirmed absent at `2e482fa`
// (which never draws band content at all — it renders blank in the first case, and simply doesn't
// exist as a code path for the second — so neither crash is possible there).

// `groupColumns` used to be computed unconditionally, before the `ranked.length > 0` gate that
// decides whether it's even used. With a featured tier, zero ranked tiers, and a wall tier moved
// into the band via `row:`, `planAt()`'s `split` is false (nothing to share the width with, by its
// own reasoning) so the featured column claims the whole inner width and `g.rightW` degenerates to
// 1px — `wallTier` then divides that sliver into columns and gets a negative `avail`. Gating the
// computation on the same condition its consumer already used to check is the fix; this pins that
// the fixture renders instead of throwing.
test("band grid: a `row:`'d wall tier with a featured tier but no ranked tiers does not crash", async () => {
  const { sheet } = await templateFor("grid-no-ranked-wall-row", {
    title: "T",
    unit: "titles",
    tiers: [
      { name: "Featured", layout: "featured", items: bulk("f", 4), color: "#d62828" },
      { name: "WallInBand", layout: "wall", items: bulk("w", 50), row: 1 },
    ],
  });
  const html = await sheet();
  assert.match(html, />Featured</);
});

// The renderer's own `colsOf` used to read `t.cols ?? g.rankCols` with no clamp, unlike `shape()`'s
// (`Math.min(Math.max(1, …), Math.max(1, t.items.length))`). Two ways that disagreement broke:
// a `cols:` bigger than a tier's own item count over-credits that cell's width share (starving its
// row neighbor's `avail` negative), and an unclamped `cols: 0` makes `rankedTier` build zero
// columns (`Array.from({ length: 0 }, …)`), silently dropping every item in that tier.
test("band grid: an over-wide `cols:` beside another cell does not crash", async () => {
  const { sheet } = await templateFor("grid-cols-overwide", {
    title: "T",
    unit: "titles",
    tiers: [
      { name: "Featured", layout: "featured", items: bulk("f", 4), color: "#d62828" },
      { name: "Narrow", layout: "ranked", items: bulk("n", 2), row: 1, column: 1, cols: 9 },
      { name: "Wide", layout: "ranked", items: bulk("c", 20), row: 1, column: 2 },
    ],
  });
  const html = await sheet();
  for (const item of ["n1", "n2", "c1", "c20"]) assert.ok(html.includes(`>${item}<`), item);
});

test("band grid: `cols: 0` on a tier beside another does not silently drop its items", async () => {
  const { sheet } = await templateFor("grid-cols-zero-render", {
    title: "T",
    unit: "titles",
    tiers: [
      { name: "Featured", layout: "featured", items: bulk("f", 4), color: "#d62828" },
      { name: "ZeroCols", layout: "ranked", items: bulk("z", 6), row: 1, column: 1, cols: 0 },
      { name: "Other", layout: "ranked", items: bulk("o", 6), row: 1, column: 2 },
    ],
  });
  const html = await sheet();
  for (const item of ["z1", "z6", "o1", "o6"]) assert.ok(html.includes(`>${item}<`), item);
});
