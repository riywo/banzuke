// The template's sheet() against data shapes a real data.mjs will have but the shipped one does
// not: no featured tier, walls only, single-item tiers, empty tiers, more walls than WALL.sizes.
// Those are the layout-math branches where a bad width would surface as fit()'s "avail must be
// positive" throw, so each case asserts the sheet's documented contract rather than its pixels.
//
// The assertions read markup that banzuke.mjs emits (rank cells, tier headers). The template is
// meant to be edited, so these are checks on the shipped version, not a public API.
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
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
test("a featured tier with no ranked tier is sized from its own rows", async () => {
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
  assert.ok(bandHeight(two) > 0, "the band collapsed, so the featured rows have nowhere to go");
  assert.ok(
    bandHeight(six) > bandHeight(two) * 2,
    `band should grow with the rows: 2 rows ${bandHeight(two)}px, 6 rows ${bandHeight(six)}px`,
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
