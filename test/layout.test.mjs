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

/**
 * The one promise the hierarchy machinery exists to keep, read off the render: the featured tier's
 * last row is the largest any ranked title may be typed.
 *
 * Row *height* is deliberately not the measure. A band cell sharing a row with a longer one is
 * handed more height per row than its rank has earned; it keeps that height and spends the surplus
 * as leading (`rankedTier`'s `maxSize`), because shrinking the box instead would leave a blank
 * strip inside the band. So such a cell's rows are legitimately taller than a featured row while
 * its type is not, and only the type can be asserted on.
 *
 * `featN` is the featured tier's item count and `bandN` the band's; the masthead title is span 0
 * and the foot walls follow the band, sized independently of all this.
 */
const hierarchy = (html, featN, bandN) => {
  const sizes = spanSizes(html);
  return {
    featLast: sizes[featN],
    topRanked: Math.max(...sizes.slice(1 + featN, 1 + featN + bandN)),
  };
};

const assertHierarchy = (html, featN, bandN, label) => {
  const { featLast, topRanked } = hierarchy(html, featN, bandN);
  assert.ok(
    topRanked <= featLast,
    `${label}: a ranked title is typed at ${topRanked}px, over the featured tier's last row at ${featLast}px`,
  );
};

test("RANK_COLS auto: hierarchy outranks row width", async () => {
  // DENSE is wide enough to want four columns, but the wider splits would type its ranked tiers as
  // large as its featured one — gappy rows beat a ranking that stops reading by size. How many
  // columns that leaves is data- and knob-dependent (and a knob away from changing), so assert the
  // principle rather than the count.
  const { sheet } = await templateFor("geom-rankcols-hier", DENSE);
  assertHierarchy(await sheet(), 10, 10 + 20, "DENSE"); // Featured 10; Ranked A 10 + Ranked B 20
});

test("RANK_COLS auto: a clamped sheet is judged against the band it actually gets", async () => {
  // The overflow path chooses the split and the band height together, so it is possible to accept
  // a split on the strength of a band that only the *rejected* split would have produced. Assert
  // the invariant on the layout that ships, whatever count came out.
  const { sheet, geometry } = await templateFor("geom-clamped-hier", BIG_FEATURED);
  assert.equal(geometry().clamped, true, "the fixture is meant to exercise the overflow path");
  assertHierarchy(await sheet(), 40, 5 * 20, "BIG_FEATURED"); // Featured 40; five ranked tiers of 20
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
    ["shipped", undefined], // no data override: the project's own data.mjs, as it ships
    // A band grid whose short cell is capped: the capped tier keeps its box and spends the surplus
    // as leading, so the boxes still have to add up. Shrinking the box instead would show up here
    // as a strip of bare paper, which is the failure this whole test exists to catch.
    [
      "grid-capped",
      {
        title: "Grid",
        unit: "titles",
        tiers: [
          { name: "Featured", layout: "featured", items: bulk("f", 12), color: "#d62828" },
          { name: "Big", layout: "ranked", items: bulk("g", 30), row: 1, column: 1 },
          { name: "Small", layout: "ranked", items: bulk("s", 8), row: 1, column: 2 },
          { name: "Wall", layout: "wall", items: bulk("w", 150) },
        ],
      },
    ],
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

// `planAt()` used to split the sheet's width between the featured column and the band only when
// there was a *ranked* tier to share it with, which a `row:`'d wall tier is not — so a band holding
// only a wall was handed the 1px `rightW` floors at, `wallTier` divided that sliver into columns
// and got a negative `avail`, and the tier was dropped from the sheet to avoid the throw. Anything
// in the band claims that side now, so the wall is laid out rather than merely not crashing.
test("band grid: a `row:`'d wall tier with a featured tier but no ranked tiers gets half the sheet", async () => {
  const { sheet, geometry } = await templateFor("grid-no-ranked-wall-row", {
    title: "T",
    unit: "titles",
    tiers: [
      { name: "Featured", layout: "featured", items: bulk("f", 4), color: "#d62828" },
      { name: "WallInBand", layout: "wall", items: bulk("w", 50), row: 1 },
    ],
  });
  const g = geometry();
  assert.ok(
    g.featW < g.inner && g.rightW > 1,
    `the featured column took the whole ${g.inner}px (featW ${g.featW}, rightW ${g.rightW})`,
  );
  const html = await sheet();
  assert.match(html, />Featured</);
  for (const item of ["w1", "w50"]) assert.ok(html.includes(`>${item}<`), item);
});

// The mirror of the case above: with the split keyed to ranked tiers only, moving one band tier
// between `wall` and `ranked` also moved the sheet's whole width decision, so the canvas jumped
// (1344×756 as a wall against 1024×576 as a ranked tier) on a change that is supposed to be about
// how one tier is packed. A wall is the cheaper of the two, so it must never cost a bigger sheet.
test("band grid: flipping a lone band tier between wall and ranked does not swing the canvas", async () => {
  const band = (layout) => ({
    title: "T",
    unit: "titles",
    tiers: [
      { name: "Featured", layout: "featured", items: bulk("f", 6), color: "#d62828" },
      { name: "Band", layout, items: bulk("b", 30), row: 1 },
    ],
  });
  const { geometry } = await templateFor("grid-flip-wall-ranked", band("wall"));
  const asWall = geometry();
  const asRanked = geometry(band("ranked"));
  assert.ok(
    asWall.sheetW <= asRanked.sheetW && asWall.sheetH <= asRanked.sheetH,
    `wall ${asWall.sheetW}×${asWall.sheetH} should not outgrow ranked ` +
      `${asRanked.sheetW}×${asRanked.sheetH}`,
  );
  assert.ok(asWall.rightW > 1, "the band's wall needs a real width to lay out into");
});

// The bound used to read the band as the single stacked column it was before rows and cells —
// every ranked tier's rows summed, divided into the band once — which is not a height any cell is
// actually drawn at once two of them stand side by side: two 12-item tiers sharing a row each got
// the *whole* row, not half of it, so their titles came out ~2.3x the size the bound had approved.
// Measured on this fixture at 39ea20f: ranked #1 rendered at 29px against the featured tier's last
// row at 16px — the ranking upside down.
test("band grid: side-by-side cells do not out-type the featured column", async () => {
  const { geometry, sheet } = await templateFor("grid-hier-cells", {
    title: "T",
    unit: "titles",
    tiers: [
      { name: "Featured", layout: "featured", items: bulk("f", 6), color: "#d62828" },
      { name: "Left", layout: "ranked", items: bulk("l", 12), row: 1, column: 1, color: "#1b50a8" },
      {
        name: "Right",
        layout: "ranked",
        items: bulk("r", 12),
        row: 1,
        column: 2,
        color: "#f4c20d",
      },
      { name: "Wall", layout: "wall", items: bulk("w", 200) },
    ],
  });
  const g = geometry();
  assert.equal(g.bandRowPlan.length, 1, "Left and Right share a `row:`");
  assert.equal(g.bandRowPlan[0].cells.length, 2, "different `column:`s, so two cells side by side");
  assertHierarchy(await sheet(), 6, 12 + 12, "two cells sharing a row");
});

// Which cell the bound reads matters, and a symmetric fixture cannot show it: with Left and Right
// the same size, consulting either one alone gives the same answer as consulting both. So mirror an
// asymmetric row — the 30-item tier on the left in one dataset, on the right in the other — and
// require the same sheet out of both. A bound that only ever reads the first cell misses the
// driving cell in the mirrored dataset, and one that only reads the last cell misses it in the
// first; either way the missed dataset falls back to the count the width alone asked for, and the
// two sheets stop matching.
test("band grid: the bound reads whichever cell drives the row, on either side", async () => {
  const row = (mirrored) => ({
    title: "T",
    unit: "titles",
    tiers: [
      { name: "Featured", layout: "featured", items: bulk("f", 12), color: "#d62828" },
      ...(mirrored
        ? [
            { name: "Small", layout: "ranked", items: bulk("s", 8), row: 1, column: 1 },
            { name: "Big", layout: "ranked", items: bulk("g", 30), row: 1, column: 2 },
          ]
        : [
            { name: "Big", layout: "ranked", items: bulk("g", 30), row: 1, column: 1 },
            { name: "Small", layout: "ranked", items: bulk("s", 8), row: 1, column: 2 },
          ]),
      { name: "Wall", layout: "wall", items: bulk("w", 150) },
    ],
  });
  const { geometry } = await templateFor("grid-driving-cell", row(false));
  const bigFirst = geometry();
  const smallFirst = geometry(row(true));

  // RANK_COL_W / RANK_COLS_MAX from the "tuning knobs" section: the count the width alone asks for,
  // which is also what the solver falls back to when narrowing cannot buy the bound.
  const [RANK_COL_W, RANK_COLS_MAX] = [300, 4];
  const want = (x) => Math.min(RANK_COLS_MAX, Math.max(1, Math.round(x.rightW / RANK_COL_W)));
  assert.ok(
    bigFirst.rankCols < want(bigFirst),
    `the bound should have narrowed the split (got ${bigFirst.rankCols}, width asked ${want(bigFirst)})`,
  );
  assert.equal(bigFirst.rankCols, smallFirst.rankCols, "mirroring must not change the split");
  assert.equal(bigFirst.sheetW, smallFirst.sheetW, "mirroring must not change the canvas");
  assert.equal(bigFirst.sheetH, smallFirst.sheetH, "mirroring must not change the canvas");
});

// The underlying defect behind both of the above: a row hands every cell the same height, so a
// cell with fewer rows than the one beside it is handed more height per row than its rank has
// earned. The column count cannot aim at one cell — it scales them all — so the type is capped per
// cell instead, at the featured tier's own last row. What the cap must NOT do is shrink the boxes:
// a cell falling short of its row leaves a strip of bare paper inside the band, which reads as a
// rendering bug. The surplus becomes leading down the cell's rows instead, and the boxes still add
// up (see the canvas-fill test above, which covers this same shape).
test("band grid: a cell that cannot fill its row caps its type rather than its boxes", async () => {
  const { geometry, sheet } = await templateFor("grid-cap", {
    title: "T",
    unit: "titles",
    tiers: [
      { name: "Featured", layout: "featured", items: bulk("f", 12), color: "#d62828" },
      { name: "Big", layout: "ranked", items: bulk("g", 30), row: 1, column: 1 },
      { name: "Small", layout: "ranked", items: bulk("s", 8), row: 1, column: 2 },
      { name: "Wall", layout: "wall", items: bulk("w", 150) },
    ],
  });
  const g = geometry();
  const [row] = g.bandRowPlan;
  const [big, small] = row.cells;
  assert.ok(small.weighted < big.weighted, "Small is the cell that cannot fill the row");

  const sizes = spanSizes(await sheet());
  const featLast = sizes[12]; // span 0 is the masthead title, 1..12 the featured tier
  const smallFirst = sizes[1 + 12 + 30]; // Big's 30 titles come first in the row
  assert.equal(smallFirst, featLast, "a capped cell types exactly at the featured tier's last row");

  // TYPE.ranked.rowFill from the "tuning knobs" section. Uncapped, the height Small's rows are
  // actually drawn at would have typed them larger — which is what makes this a cap and not a
  // coincidence of the ramp.
  const ROWFILL = 0.63;
  const drawnRowH = (g.bandRowHeights[0] - small.fixed) / small.weighted;
  assert.ok(
    Math.round(drawnRowH * ROWFILL) > featLast,
    `the cap must bind: a ${drawnRowH}px row would otherwise type at ` +
      `${Math.round(drawnRowH * ROWFILL)}px against the featured tier's ${featLast}px`,
  );
  // And the box is not shrunk to match: the last tier of a cell is flex:1, so it still spans the
  // whole row and the difference is leading.
  assert.ok(drawnRowH > featLast, "the row keeps its height; only the type is capped");
});

// The fallback is the whole of finding 1, and nothing pinned it: reverting it left the suite green.
// Two datasets, because the rule has two halves. Both have a 26-item featured tier, so the band is
// sized by 26 featured rows and no split can bring the ranked type under the cap — the bound never
// clears and the fallback decides. Where narrowing is free it must be taken (a wider split spends
// the same canvas on taller, emptier rows holding the same capped type); where it would cost canvas
// it must not be. `return want` fails the first, `return 1` fails the second.
test("band grid: when narrowing cannot buy the bound it buys density, but never at the canvas's expense", async () => {
  const band = (right) => ({
    title: "T",
    unit: "titles",
    tiers: [
      { name: "Featured", layout: "featured", items: bulk("f", 26), color: "#d62828" },
      { name: "Left", layout: "ranked", items: bulk("l", 12), row: 1, column: 1 },
      { name: "Right", layout: "ranked", items: bulk("r", right), row: 1, column: 2 },
    ],
  });
  const { geometry } = await templateFor("grid-fallback", band(12));
  const [RANK_COL_W, RANK_COLS_MAX] = [300, 4]; // the "tuning knobs" section
  const want = (g) => Math.min(RANK_COLS_MAX, Math.max(1, Math.round(g.rightW / RANK_COL_W)));

  // Free: both cells hold 12, so even one column each needs no more band than the featured tier
  // already claims. The narrowest split is therefore the densest at no cost, and must be taken.
  const free = geometry();
  assert.ok(free.rankCols < want(free), `the fallback should not keep the width's count`);
  assert.equal(free.rankCols, 1, "narrowing is free here, so take all of it");

  // Paid: the same 12-item cell now sits beside a 40-item one. One column would give that cell 40
  // rows, which needs more band than the sheet has — so the fallback has to stop short.
  const paid = geometry(band(40));
  assert.ok(paid.rankCols > 1, "narrowing to one column would cost canvas, so it must stop short");
  assert.equal(paid.cropRisk, false, "and it must not buy density with a croppable sheet");
  assert.equal(paid.sheetW, free.sheetW, "neither dataset should move the canvas");
  assert.equal(paid.sheetH, free.sheetH, "neither dataset should move the canvas");
});

// The bound and the cap are two mechanisms keeping one promise, and the tests above cannot tell
// them apart: `sheet()` caps unconditionally, so `topRanked <= featLast` holds even with the solver
// broken. This fixture pins the bound on its own. It clears at a narrower split, so the ranked type
// lands *strictly under* the featured tier's last row rather than pressed against it — which is
// only true when the count was chosen for it. Disable the hierarchy loop and the split goes back to
// the width's own count, where the same promise is kept by the cap alone and the type sits exactly
// at featLast.
test("band grid: the bound narrows the split so the type fits under the ceiling, not against it", async () => {
  const { geometry, sheet } = await templateFor("grid-bound-alone", {
    title: "T",
    unit: "titles",
    tiers: [
      { name: "Featured", layout: "featured", items: bulk("f", 14), color: "#d62828" },
      { name: "Big", layout: "ranked", items: bulk("g", 40), row: 1, column: 1 },
      { name: "Small", layout: "ranked", items: bulk("s", 10), row: 1, column: 2 },
      { name: "Wall", layout: "wall", items: bulk("w", 200) },
    ],
  });
  const g = geometry();
  const [RANK_COL_W, RANK_COLS_MAX] = [300, 4];
  const want = Math.min(RANK_COLS_MAX, Math.max(1, Math.round(g.rightW / RANK_COL_W)));
  assert.ok(
    g.rankCols < want,
    `the bound should have narrowed the split (${g.rankCols} of ${want})`,
  );

  const sizes = spanSizes(await sheet());
  const featLast = sizes[14];
  const bigFirst = sizes[1 + 14];
  assert.ok(
    bigFirst < featLast,
    `the narrowed split should type Big under the featured tier's last row, not at it ` +
      `(${bigFirst}px vs ${featLast}px)`,
  );
});

// A tier's own `cols:` reached the height math and the markup but not the column solver, which
// re-derived every ranked tier's row count from the *shared* count instead. A tier pinned narrow
// therefore looked to the solver like it had far fewer (so far taller) rows than it really has, and
// the bound rejected splits the sheet could have taken — the pin, whose whole point is to hold one
// tier narrow while the rest of the sheet spreads out, bought nothing at all.
test("band grid: a tier's own `cols:` is counted by the column solver, not just the height math", async () => {
  const pinned = (pin) => ({
    title: "T",
    unit: "titles",
    tiers: [
      { name: "Featured", layout: "featured", items: bulk("f", 8), color: "#d62828" },
      { name: "Pinned", layout: "ranked", items: bulk("p", 12), ...(pin ? { cols: 2 } : {}) },
      { name: "Other", layout: "ranked", items: bulk("o", 12) },
      { name: "Wall", layout: "wall", items: bulk("w", 200) },
    ],
  });
  const { geometry } = await templateFor("grid-cols-solver", pinned(true));
  const withPin = geometry();
  const noPin = geometry(pinned(false));
  assert.equal(withPin.bandRowPlan[0].cells[0].rows[0], 6, "`cols: 2` over 12 items is 6 rows");
  // Holding one tier to a single column costs the solver nothing — its rows only get shorter — so
  // the rest of the sheet may split wider than it could have without the pin.
  assert.ok(
    withPin.rankCols > noPin.rankCols,
    `the pin should free the split (${noPin.rankCols} unpinned, ${withPin.rankCols} pinned)`,
  );
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

// ---- --report: scoring a layout instead of rendering it ----

test("--report: measures coverage, the type ladder, slack and squeeze", async () => {
  const { report } = await templateFor("grid-report", GRID);
  const r = await report();
  assert.ok(r.coverage > 0 && r.coverage < 1, `coverage out of range: ${r.coverage}`);
  assert.ok(r.ladder.length >= 3, "one rung per tier that draws text");
  for (const rung of r.ladder) {
    assert.equal(typeof rung.name, "string");
    assert.ok(rung.from >= rung.to, `${rung.name} should taper, got ${rung.from}→${rung.to}`);
  }
  assert.ok(Array.isArray(r.slack), "per-cell slack");
  assert.ok(Number.isInteger(r.squeeze), "count of titles at scaleX < 1");
});

test("--report: coverage rises when the same data is set larger", async () => {
  const { report } = await templateFor("grid-report-a", SPARSE);
  const sparse = await report();
  const { report: report2 } = await templateFor("grid-report-b", DENSE);
  const dense = await report2();
  assert.ok(
    dense.coverage > sparse.coverage,
    `a packed sheet should score denser: ${dense.coverage} vs ${sparse.coverage}`,
  );
});

// A cell can be full by height and still mostly bare paper by type: a small tier sharing a row with
// a much bigger one is handed that bigger tier's row height, but its own type still caps out at the
// featured tier's last row. `slack` (got vs a cell's own MIN_RANK_UNIT-floor need) does not catch
// this — a ranked cell always stretches to fill its row, so slack reads large for practically every
// ranked cell, starved or not. `fill` (drawn line box over row box) is the number that isolates it,
// and the free remedy — pinning `cols:` on the starved tier alone — must move that number without
// moving the canvas the row's actual driver (the big neighbour) already paid for.
const STARVED = (pinSmall) => ({
  title: "T",
  unit: "titles",
  tiers: [
    { name: "Featured", layout: "featured", items: bulk("f", 26), color: "#d62828" },
    {
      name: "Small",
      layout: "ranked",
      items: bulk("s", 12),
      row: 1,
      column: 1,
      ...(pinSmall ? { cols: 1 } : {}),
    },
    { name: "Big", layout: "ranked", items: bulk("g", 40), row: 1, column: 2 },
  ],
});

test("--report: a cell starved by a bigger neighbor reads low in fill (not slack), and pinning cols: on it raises the fill without moving the canvas", async () => {
  const STARVED_FILL = 0.3; // mirrors the template's own knob, next to report()
  const { report: reportBefore } = await templateFor("report-starved-before", STARVED(false));
  const before = await reportBefore();
  const smallBefore = before.slack.find((c) => c.name === "Small");
  assert.ok(smallBefore, "expected a Small cell in the report");
  assert.ok(
    smallBefore.fill < STARVED_FILL,
    `expected Small to read as starved, got fill ${smallBefore.fill}`,
  );

  const { report: reportAfter } = await templateFor("report-starved-after", STARVED(true));
  const after = await reportAfter();
  const smallAfter = after.slack.find((c) => c.name === "Small");
  assert.ok(
    smallAfter.fill > smallBefore.fill,
    `pinning cols: on the starved tier should raise its fill (${smallBefore.fill} -> ${smallAfter.fill})`,
  );
  assert.deepEqual(before.canvas, after.canvas, "the pin must not move the canvas");
});
