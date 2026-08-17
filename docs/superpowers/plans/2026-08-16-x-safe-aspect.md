# Pinned-Aspect Banzuke Sheets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every banzuke sheet render onto a solved 16:9 canvas so X stops center-cropping the top ranks out of the timeline preview.

**Architecture:** The sheet stops growing downward. A pure-arithmetic solver picks the smallest sheet width whose 16:9 height fits the content, capped at 2048 CSS px; the walls absorb extra content sideways by gaining columns, and the top band takes whatever height is left over — so `FEAT_ROW_H` becomes derived rather than given. This is the inversion `samples/build/bauhaus.mjs` already performs by hand against its fixed square canvas, generalised and folded back into the template.

**Tech Stack:** Plain ESM JavaScript, node >= 22, `node --test`, takumi-js for rendering, Biome for formatting.

**Spec:** `docs/superpowers/specs/2026-08-16-x-safe-aspect-design.md`

## Global Constraints

- All work happens in `skills/banzuke/template/banzuke.mjs` — a file that ships to users as an editable scaffold. Comments there are addressed to whoever edits it next; match the existing voice (explain *why*, not *what*).
- takumi is not a browser. Build with **flex + pre-computed px only** — no `clamp()`, no CSS multicol, no pseudo-elements, no grid `fr`. Inline styles only, no `<style>` blocks or classes.
- **Always state `font-weight`** on anything that draws text.
- Any box with `overflow: hidden` needs an explicit `line-height` (`LINE` in the template).
- Variable-length text goes through `fitSpan()`, plain text through `esc()`.
- Tests: `npm test` (which is `node --test`). Single file: `node --test test/layout.test.mjs`.
- Formatting is enforced by Biome via a lefthook pre-commit hook. If a commit reformats files, amend rather than adding a follow-up commit.
- Do not touch `samples/build/*`. Those sheets keep their own square canvas by design.
- Commit messages: lowercase `type: subject` in the imperative, and end the body with
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `skills/banzuke/template/banzuke.mjs` | Sheet design, geometry solve, entry point | Modified (all four code tasks) |
| `test/layout.test.mjs` | Layout math and markup contracts, in-process (no PNG) | Modified (Tasks 1–3) |
| `test/project.test.mjs` | Renders a real scaffold to PNG | Modified (Task 2) |
| `skills/banzuke/SKILL.md` | Agent-facing instructions and eyeball checklist | Modified (Task 5) |
| `docs/architecture.md` | Layout-math notes | Modified (Task 5) |

No new files. The solver lives in `banzuke.mjs` rather than `lib/` on purpose: it encodes the *sheet design's* proportions, which is exactly what the template invites the user to edit, while `lib/` is the rendering engine.

---

## Task 1: The geometry solver

Adds `geometry()` as a pure, exported function. Nothing consumes it yet, so `sheet()` still renders exactly as before and every existing test must keep passing.

**Files:**
- Modify: `skills/banzuke/template/banzuke.mjs` (knob block at lines 58-95; new functions before `sheet()` at line 243; `wallCols` at lines 233-239)
- Test: `test/layout.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `export function geometry(source = data)` → a plan object with these fields, all consumed by later tasks:
    `{ sheetW, sheetH, inner, featW, rightW, rankCols, wallPlan, bandH, featRowH, unit, rankedHeights, featured, ranked, walls, featRows, rankedRows, rankedWeights, weightedRows, rankedFixed, wallsH, bandFloor, fits, clamped, cropRisk }`
    — `wallPlan` is an array of `{ tier, size, cols, rows, rowH, height }` in data order; `rankedHeights` is an array of px heights parallel to `ranked`.
  - `function partition(source)` → `{ tiers, numbered, featured, ranked, walls }`
  - `function rankedShape(ranked, cols)` → `{ rows, weights, weighted }`
  - `wallCols(n, em, inner)` — third parameter is new.

**Reference numbers.** This solve was prototyped against the real datasets; the tests below assert
relations rather than these figures, but they are what a correct implementation produces:

| data | canvas | ratio | rankCols | clamped | type sizes (featured / ranked / wall) |
|---|---|---|---|---|---|
| shipped scaffold | 1024×576 | 1.78 | 2 | no | 44→29 / 21→16 / 16→12 / 14, 11 |
| 75-title fixture | 1456×819 | 1.78 | 2 | no | 30→20 / 19→15 / 14→11 / 14, 11, 9.5 |
| ~390 titles (DENSE) | 2048×1287 | 1.59 | 2 | yes | 30→20 / 19→15 / 14→11 / 14, 11, 9.5 |

Type sizes stay monotonic top-to-bottom in every case, which is the point of the hierarchy bound
in `resolveRankCols` below.

- [ ] **Step 1: Write the failing tests**

Add to the top of `test/layout.test.mjs`, right after the existing `sheetFor` helper (line 19), a module-level helper and two fixtures:

```js
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
```

Then append these tests to the end of the file:

```js
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
  assert.ok(
    big.wallPlan[0].cols > small.wallPlan[0].cols,
    "the walls should have gained columns",
  );
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/layout.test.mjs`
Expected: the four new tests FAIL with `geometry is not a function`. The pre-existing tests in the file PASS.

- [ ] **Step 3: Add the canvas knobs**

In `skills/banzuke/template/banzuke.mjs`, replace the `FEAT_ROW_H` / `LONE_ROW_H` lines (86-87) with nothing yet — leave them in place for now so `sheet()` keeps working — and insert this block immediately after the `FEAT_SPLIT` line (69):

```js
// Canvas. The sheet is pinned to a target ratio rather than growing downward: social previews
// center-crop anything much taller, and on a banzuke the first thing lost is the top of the
// ranking. Width is solved from the content — more titles means a wider sheet with more wall
// columns — and the height follows from ASPECT.
const ASPECT = 16 / 9; // target w:h. 16:9 is the ratio X shows uncropped
const SAFE_ASPECT = 1; // anything taller than square is still croppable, and worth warning about
const MIN_W = 1024; // narrowest canvas (CSS px)
const MAX_W = 2048; // widest. dpr 2 doubles it, and 4096px is X's ceiling
const STEP = 16; // width search granularity
const FEAT_ROW_MIN = 30; // a featured row shorter than this stops being legible
const RANK_COL_W = 300; // target width of one ranked column when RANK_COLS is "auto"
const FEAT_MAX_W = 620; // the featured column stops widening here; the ranked side takes the rest
const FOOT_H = 34; // footer strip, an explicit height so the height math is exact
```

- [ ] **Step 4: Give `wallCols` its width parameter**

Replace `wallCols` (lines 232-239) with:

```js
/** Wall column count: split the same way an em-width-based multicol would */
function wallCols(n, em, inner) {
  const avail = inner - 2 * PAD;
  const colw = em * 16;
  const gap = 16;
  const maxCols = Math.max(1, Math.floor((avail + gap) / (colw + gap)));
  return Math.ceil(n / Math.ceil(n / maxCols));
}
```

Its only current caller is `wallTier` (line 191); update that call to `wallCols(names.length, size * WALL.em, INNER)` so the module still runs.

- [ ] **Step 5: Add `partition`, `planAt`, `derive` and `geometry`**

Insert immediately before `// ---- The whole sheet ----` (line 241):

```js
// ---- Geometry: solving the canvas ----
// All of this is integer arithmetic — no text measurement, no rendering — so searching ~64
// candidate widths costs nothing. Everything the sheet's boxes need comes out of one call.

/** Split the data into the three layout families the sheet is built from */
function partition(source) {
  const tiers = source.tiers.filter((t) => t.items.length > 0);
  const numbered = tiers.filter((t) => t.layout !== "wall");
  const featured = numbered.find((t) => t.layout === "featured");
  return {
    tiers,
    numbered,
    featured,
    ranked: numbered.filter((t) => t !== featured),
    walls: tiers.filter((t) => t.layout === "wall"),
  };
}

/** Rows per ranked tier at a given column count, and the weighting that shares the band out */
function rankedShape(ranked, cols) {
  const rows = ranked.map((t) =>
    Math.ceil(t.items.length / Math.min(cols, Math.max(1, t.items.length))),
  );
  const weights = ranked.map((_, i) => TIER_WEIGHT ** (ranked.length - 1 - i));
  return { rows, weights, weighted: rows.reduce((sum, r, i) => sum + r * weights[i], 0) };
}

/**
 * The tallest a ranked row may get before the first title of a ranked tier would out-type the
 * last row of the featured one. Derived from the type knobs rather than guessed, so re-tuning
 * `taper` or `rowFill` keeps the bound honest.
 */
const hierCeiling = (featRowH, weights) =>
  (featRowH * TYPE.featured.rowFill * TYPE.featured.taper) /
  (TYPE.ranked.rowFill * Math.max(...weights, 1));

/**
 * RANK_COLS may be a number, or "auto": as many columns as RANK_COL_W wants, but never so many
 * that the ranked rows grow to rival the featured ones. Splitting a tier into more columns makes
 * each row *taller* (fewer rows share the same band), and a sheet whose rank stops reading by
 * size has lost its whole argument — so hierarchy wins over row width.
 */
function resolveRankCols({ rightW, bandH, featRowH, ranked, rankedFixed }) {
  if (RANK_COLS !== "auto") return RANK_COLS;
  const want = Math.min(4, Math.max(1, Math.round(rightW / RANK_COL_W)));
  if (!featRowH || ranked.length === 0) return want;
  for (let cols = want; cols > 1; cols--) {
    const { weighted, weights } = rankedShape(ranked, cols);
    if ((bandH - rankedFixed) / weighted <= hierCeiling(featRowH, weights)) return cols;
  }
  return 1;
}

/** The band-height-dependent half of a plan, split out so the overflow path can redo it */
function derive(p, bandH) {
  const unit = p.ranked.length > 0 ? (bandH - p.rankedFixed) / p.weightedRows : 0;
  return {
    bandH,
    unit,
    featRowH: p.featured ? (bandH - HDR_H) / p.featRows : 0,
    rankedHeights: p.rankedRows.map(
      (r, i) =>
        HDR_H +
        Math.round(r * p.rankedWeights[i] * unit) +
        (i < p.ranked.length - 1 ? DIV : 0),
    ),
  };
}

/** Lay the data out against one candidate sheet width and report whether it fits */
function planAt(sheetW, { featured, ranked, walls }) {
  const sheetH = Math.round(sheetW / ASPECT);
  const inner = sheetW - 2 * GROUND - 2 * BW;
  const innerH = sheetH - 2 * GROUND - 2 * BW;

  // The featured column stops widening at FEAT_MAX_W: past that it is one column of titles in a
  // lot of space, and the ranked side uses the width better.
  const split = featured && ranked.length > 0;
  const featW = featured ? (split ? Math.min(Math.round(inner * FEAT_SPLIT), FEAT_MAX_W) : inner) : 0;
  const rightW = Math.max(inner - featW, 1);

  const wallPlan = walls.map((tier, i) => {
    const size = WALL.sizes[Math.min(i, WALL.sizes.length - 1)];
    const cols = wallCols(tier.items.length, size * WALL.em, inner);
    const rows = Math.ceil(tier.items.length / cols);
    const rowH = Math.round(size * LINE);
    // header + its rule + the 8px gap + rows (each padded 1px top and bottom) + pad + rule
    return { tier, size, cols, rows, rowH, height: HDR_H + DIV + 8 + rows * (rowH + 2) + 10 + DIV };
  });
  const wallsH = wallPlan.reduce((sum, w) => sum + w.height, 0);

  const featRows = featured?.items.length ?? 0;
  const rankedFixed = ranked.length * HDR_H + Math.max(0, ranked.length - 1) * DIV;

  // The band takes whatever the masthead, the walls and the footer leave. The featured row height
  // and then the ranked column count both follow from it, in that order — the column count needs
  // to know how tall a featured row ended up before it can avoid out-growing one.
  const bandH = innerH - (MAST_H + BW) - wallsH - FOOT_H;
  const featRowH = featured ? (bandH - HDR_H) / featRows : 0;
  const rankCols = resolveRankCols({ rightW, bandH, featRowH, ranked, rankedFixed });
  const { rows: rankedRows, weights: rankedWeights, weighted: weightedRows } = rankedShape(
    ranked,
    rankCols,
  );

  // Both sides of the band have a floor: legible featured rows on the left, MIN_RANK_UNIT on the
  // right. A candidate width that cannot clear them does not fit.
  const bandFloor = Math.max(
    featured ? HDR_H + featRows * FEAT_ROW_MIN : 0,
    ranked.length > 0 ? rankedFixed + weightedRows * MIN_RANK_UNIT : 0,
  );

  const base = {
    sheetW,
    sheetH,
    inner,
    featW,
    rightW,
    rankCols,
    wallPlan,
    wallsH,
    featured,
    ranked,
    walls,
    featRows,
    rankedRows,
    rankedWeights,
    weightedRows,
    rankedFixed,
    bandFloor,
  };
  return { ...base, ...derive(base, bandH), fits: bandH >= bandFloor, clamped: false };
}

/**
 * No candidate width fits: keep the widest canvas, give the band exactly its floor and let the
 * sheet run past the target ratio. A sheet a little taller than 16:9 still renders and still
 * escapes the crop; one whose rows are squeezed below the floor is unreadable either way.
 */
function overflow(p) {
  const band = derive(p, p.bandFloor);
  const sheetH = 2 * GROUND + 2 * BW + MAST_H + BW + band.bandH + p.wallsH + FOOT_H;
  return { ...p, ...band, sheetH, clamped: true };
}

/**
 * Solve the canvas: the narrowest width whose ASPECT height holds the data. Pass `source` to
 * plan a different dataset than the project's own (the tests do this).
 */
export function geometry(source = data) {
  const parts = partition(source);
  let plan;
  for (let w = MIN_W; w <= MAX_W; w += STEP) {
    plan = planAt(w, parts);
    if (plan.fits) return { ...plan, cropRisk: false };
  }
  const over = overflow(plan);
  return { ...over, cropRisk: over.sheetW / over.sheetH < SAFE_ASPECT };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test test/layout.test.mjs`
Expected: PASS, including every pre-existing test in the file (`sheet()` is untouched so far).

- [ ] **Step 7: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add skills/banzuke/template/banzuke.mjs test/layout.test.mjs
git commit -m "feat: solve the sheet's canvas from its content"
```

---

## Task 2: Render onto the solved canvas

Wires `sheet()` to `geometry()`, which is where `FEAT_ROW_H` and `LONE_ROW_H` stop existing.

**Files:**
- Modify: `skills/banzuke/template/banzuke.mjs` (lines 86-87, 96-99, `row`/`rankedTier`/`wallTier`, all of `sheet()`, the entry point)
- Test: `test/layout.test.mjs`, `test/project.test.mjs`

**Interfaces:**
- Consumes: `geometry(source = data)` and its fields from Task 1.
- Produces: `sheet()` keeps its signature (`async () => string`) and now emits a root div carrying both `width` and `height`; `wallTier(tier, size, cols, inner)` and `rankedTier({ tier, startRank, height, width, isLast })` take their geometry rather than reading module constants.

- [ ] **Step 1: Write the failing tests**

Append to `test/layout.test.mjs`:

```js
test("the sheet is pinned to the solved canvas", async () => {
  const { sheet, geometry } = await templateFor("layout-canvas", SPARSE);
  const g = geometry();
  const html = await sheet();
  assert.ok(
    html.startsWith(`<div style="width:${g.sheetW}px;height:${g.sheetH}px`),
    `root box does not carry the canvas: ${html.slice(0, 140)}`,
  );
});
```

`test/project.test.mjs` hardcodes today's fixed width in three places, all of which change: the
canvas is now 1024 CSS px wide at the minimum (2048 device px at dpr 2), not 1072 (2144). Replace
lines 21-24 in `"an untouched scaffold produces a PNG and HTML (with the dated edition label)"`:

```js
  assert.match(out, /2048×1152 px \(1\.78:1\)/); // the solved canvas, reported by the script
  const { width, height } = sizeOf(path.join(dir, "banzuke.png"));
  assert.equal(width, 2048); // MIN_W 1024 CSS px × dpr 2 — sparse data needs no more
  // Pinned to 16:9 so social previews stop cropping the top ranks off the sheet
  assert.equal(height, 1152);
```

And replace lines 35-36 in `"renders at real-world scale with the 75-title fixture"`. The solved
width for that fixture is data-dependent, so assert the shape rather than the number:

```js
  assert.ok(width > 2048, `expected the fixture to need a wider canvas, got ${width}`);
  assert.ok(width <= 4096, `past X's ceiling: ${width}`); // MAX_W 2048 CSS × dpr 2
  assert.ok(
    Math.abs(height - (width * 9) / 16) <= 4,
    `expected a 16:9 canvas, got ${width}×${height}`,
  );
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/layout.test.mjs test/project.test.mjs`
Expected: `the sheet is pinned to the solved canvas` FAILS (the root box has no `height`); the project ratio assertions FAIL (the sheet is far taller than 16:9). The existing test `a featured tier with no ranked tier is sized from its own rows` still PASSES for now.

- [ ] **Step 3: Delete the knobs the canvas replaces**

In `skills/banzuke/template/banzuke.mjs`, delete these two lines (86-87):

```js
const FEAT_ROW_H = 58.8; // height of one featured row. Sets the height of the whole top band
const LONE_ROW_H = 44; // row height given to the top ranked tier when there is no featured tier
```

And delete the two derived constants (98-99), whose values now come from the solve:

```js
const INNER = FRAME - 2 * BW;
const SHEET_W = FRAME + 2 * GROUND;
```

Delete `const FRAME = 1024;` (line 59) along with them.

- [ ] **Step 4: Thread geometry through the parts**

`wallTier` (line 189) takes its column count and width instead of computing them from `INNER`:

```js
async function wallTier(tier, size, cols, inner) {
  const names = tier.items.map(titleOf);
  const start = colSplit(names.length, cols);
  const gutter = 8;
  const colW = (inner - 2 * PAD - (cols - 1) * (2 * gutter + SEP)) / cols;
```

The rest of the function body is unchanged.

`rankedTier` (line 159) takes `cols` rather than reading `RANK_COLS`:

```js
async function rankedTier({ tier, startRank, height, width, cols: rankCols, isLast }) {
  const n = tier.items.length;
  const cols = Math.min(rankCols, Math.max(1, n));
```

The rest of the function body is unchanged.

- [ ] **Step 5: Rewrite `sheet()` to consume the plan**

Replace the body of `sheet()` from its first line through the end. The pieces that change:

```js
export async function sheet() {
  const g = geometry(data);
  const { tiers, numbered, featured, ranked, walls } = partition(data);
  const total = tiers.reduce((sum, t) => sum + t.items.length, 0);
```

Keep the running-number and date blocks (lines 251-262) exactly as they are. In the masthead measurement, `INNER` becomes `g.inner`:

```js
  const titleSpan = await fitT(data.title, {
    size: 36,
    avail: g.inner - 2 * MAST_PAD - countW,
    stretch: 1,
    letterSpacing: -0.72,
  });
```

Replace the whole band-height block (lines 288-307 — `featRows` through `rankedHeights`) with nothing: those values are now `g.featRows`, `g.featW`, `g.rightW`, `g.rankedHeights`, `g.unit`. Then:

```js
  const rankedBlocks = await Promise.all(
    ranked.map((tier, i) =>
      rankedTier({
        tier,
        startRank: startRank.get(tier),
        height: g.rankedHeights[i],
        width: featured ? g.rightW : g.inner,
        cols: g.rankCols,
        isLast: i === ranked.length - 1,
      }),
    ),
  );

  let band = "";
  if (featured) {
    const featColumn = await rowColumn({
      items: featured.items,
      startRank: startRank.get(featured),
      sizes: tierSizes("featured", g.featRowH, g.featRows),
      colW: g.featW - DIV,
      color: featured.color ?? T.accent,
      stretch: TYPE.featured.stretch,
    });
    const border = ranked.length > 0 ? `border-right:${DIV}px solid ${T.ink};` : "";
    const rightSide =
      ranked.length > 0
        ? `<div style="width:${g.rightW}px;display:flex;flex-direction:column">${rankedBlocks.join("")}</div>`
        : "";
    band = `<div style="height:${g.bandH}px;flex:none;display:flex;border-bottom:${DIV}px solid ${T.ink}">
      <div style="width:${g.featW}px;flex:none;display:flex;flex-direction:column;${border}">
        ${tierHeader(featured.name, featured.items.length)}
        ${featColumn}
      </div>
      ${rightSide}
    </div>`;
  } else {
    band = rankedBlocks.join("");
  }

  const wallBlocks = await Promise.all(
    g.wallPlan.map((w) => wallTier(w.tier, w.size, w.cols, g.inner)),
  );
```

Note two behaviour changes folded in above: `isLast` is now true for the final ranked tier whether or not there is a featured tier (with the canvas pinned, that block should flex to absorb rounding slack instead of leaving a gap), and the `bandH` special-case for "featured tier with no ranked tiers" is gone because the solve already handles it.

The returned markup becomes (root carries the canvas, framed box flexes into it, footer gets an explicit height):

```js
  return `<div style="width:${g.sheetW}px;height:${g.sheetH}px;display:flex;background:${T.ground};padding:${GROUND}px;font-family:'${T.font}';color:${T.ink}">
  <div style="flex:1;border:${BW}px solid ${T.ink};background:${T.bg};display:flex;flex-direction:column">
    <div style="height:${MAST_H}px;flex:none;display:flex;border-bottom:${BW}px solid ${T.ink}">
      <div style="flex:1;min-width:0;overflow:hidden;display:flex;align-items:center;padding:0 ${MAST_PAD}px;line-height:${LINE}">${titleSpan}</div>
      <div style="flex:none;white-space:nowrap;display:flex;flex-direction:column;align-items:flex-end;justify-content:center;padding:0 ${MAST_PAD}px;border-left:${BW}px solid ${T.ink}">
        ${labels
          .map(
            (l) =>
              `<div style="font-size:${l.size}px;font-weight:${l.weight};letter-spacing:${l.letterSpacing}px;${l.style ?? ""}">${esc(l.text)}</div>`,
          )
          .join("")}
      </div>
    </div>
    ${band}
    ${wallBlocks.join("")}
    <div style="height:${FOOT_H}px;flex:none;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:${T.weight};letter-spacing:2.2px;color:${T.muted}">banzuke</div>
  </div>
</div>`;
}
```

- [ ] **Step 6: Update the featured-only test to the pinned model**

The existing test `a featured tier with no ranked tier is sized from its own rows` asserts the band grows with the featured row count. Under a pinned canvas both sheets fill the same canvas instead, and it is the *rows* that shrink. Replace its two assertions (the `bandHeight(two) > 0` and `bandHeight(six) > bandHeight(two) * 2` lines) with:

```js
  const { geometry } = await templateFor("layout-feat-only-geom", featuredOnly(2));
  assert.ok(bandHeight(two) > 0, "the band collapsed, so the featured rows have nowhere to go");
  assert.ok(bandHeight(six) > 0, "the band collapsed, so the featured rows have nowhere to go");
  // Pinned to a canvas, the band no longer grows with the tier — the same height is divided into
  // more, shorter rows.
  assert.ok(
    geometry(featuredOnly(6)).featRowH < geometry(featuredOnly(2)).featRowH,
    "more featured rows must divide the band into shorter ones",
  );
```

Update the test's name to `a featured tier with no ranked tier divides the band into its rows` and its leading comment to match.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS. If `test/project.test.mjs` reports a sheet taller than 16:9 for the untouched scaffold, the solve is not being consumed — check the root div actually carries `height`.

- [ ] **Step 8: Render and look at the sheet**

```bash
node scripts/smoke.mjs
```

Then **open the PNG it produces as an image** and walk the skill's own checklist: is it densely filled, are the margins even, is #1 the biggest thing on the sheet? A render that exits 0 tells you nothing about whether it looks right. Fix what you see before committing.

- [ ] **Step 9: Commit**

```bash
git add skills/banzuke/template/banzuke.mjs test/layout.test.mjs test/project.test.mjs
git commit -m "feat: render the sheet onto the solved canvas"
```

---

## Task 3: Width absorption

Stops a wide canvas from turning into wide, half-empty rows.

**Files:**
- Modify: `skills/banzuke/template/banzuke.mjs` (the `RANK_COLS` knob, line 89)
- Test: `test/layout.test.mjs`

**Interfaces:**
- Consumes: `resolveRankCols(rightW)` and `geometry().rankCols` from Task 1; `rankedTier({ …, cols })` from Task 2.
- Produces: `RANK_COLS` accepts `"auto"` (the new default) as well as an integer.

- [ ] **Step 1: Write the failing tests**

Append to `test/layout.test.mjs`:

```js
test("RANK_COLS auto: the ranked block gains columns as the canvas widens", async () => {
  const { geometry } = await templateFor("geom-rankcols", SPARSE);
  assert.equal(geometry().rankCols, 2, "a minimum-width sheet keeps the two-column ranked block");
  assert.equal(geometry(MEDIUM).rankCols, 3, "a wider canvas should split the ranked tiers further");
});

test("RANK_COLS auto: hierarchy outranks row width", async () => {
  // DENSE is wide enough to want four columns, but four would make its ranked rows as tall as
  // its featured ones. Gappy rows beat a ranking that stops reading by size.
  const { geometry } = await templateFor("geom-rankcols-hier", SPARSE);
  const g = geometry(DENSE);
  assert.equal(g.rankCols, 2);
  assert.ok(
    g.unit < g.featRowH,
    `ranked rows (${g.unit}) must stay shorter than featured ones (${g.featRowH})`,
  );
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
```

Add `readFileSync` and `writeFileSync` to the `node:fs` import at the top of the test file (add the import if the file does not have one yet).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/layout.test.mjs`
Expected: `the ranked block gains columns` FAILS (`rankCols` is still the literal `2`, so `MEDIUM`
reports 2 rather than 3) and `an explicit number overrides` FAILS (the source contains no `"auto"`
string to replace). `hierarchy outranks row width` already PASSES — a pinned `2` trivially
satisfies the bound, and the test is there to keep it satisfied once the knob goes automatic.

- [ ] **Step 3: Switch the knob to auto**

Replace line 89:

```js
const RANK_COLS = "auto"; // columns per ranked tier. "auto" holds them near RANK_COL_W wide;
//                           a number pins them (more columns = narrower rows = easier to squash)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Render and look at the sheet**

```bash
node scripts/smoke.mjs
```

Open the PNG. This is the step where the two absorption defaults get judged: if the ranked rows look stretched and gappy, lower `RANK_COL_W`; if the featured column has too much air to its right, lower `FEAT_MAX_W`. One change per render.

- [ ] **Step 6: Commit**

```bash
git add skills/banzuke/template/banzuke.mjs test/layout.test.mjs
git commit -m "feat: split ranked tiers further as the canvas widens"
```

---

## Task 4: Report the canvas, warn when it is still croppable

**Files:**
- Modify: `skills/banzuke/template/banzuke.mjs` (entry point, lines 379-392)
- Test: manual — the entry point is a script, and the smoke run exercises it

**Interfaces:**
- Consumes: `geometry()`, `.sheetW`, `.sheetH`, `.clamped`, `.cropRisk` from Task 1.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Report the solved canvas**

Replace the entry-point block (from `const draft = …` to the end of the file) with:

```js
  const draft = process.argv.includes("--draft");
  const g = geometry(data);
  const out = await renderFile(await sheet(), `${import.meta.dirname}/banzuke.png`, {
    devicePixelRatio: draft ? 1 : 2,
    html: `${import.meta.dirname}/banzuke.html`,
  });
  const ratio = (g.sheetW / g.sheetH).toFixed(2);
  console.log(
    `${out.width}×${out.height} px (${ratio}:1), ${out.ms}ms → ${out.path}${draft ? " (draft)" : ""}`,
  );
  // Overflowing the target ratio a little is fine — 1.7:1 still posts uncropped. Warn only once
  // the sheet is taller than square, which is the shape social previews cut the top off.
  if (g.cropRisk) {
    console.warn(
      `The sheet is ${ratio}:1, taller than the ${SAFE_ASPECT}:1 social previews crop to, and it\n` +
        "cannot get shorter at the maximum width. Move titles into a wall tier, or lower\n" +
        "WALL.sizes, and re-run.",
    );
  }
  console.log(
    "Not done yet → open banzuke.png as an image and check it: is it densely filled,\n" +
      "are the margins aligned, does #1 read as the biggest thing? Fix, then re-run.",
  );
}
```

- [ ] **Step 2: Verify the normal path**

Run: `node scripts/smoke.mjs`
Expected: the log line reports a ratio near `1.78:1` and no warning appears.

- [ ] **Step 3: Verify the warning path**

```bash
node -e "
const { readFileSync, writeFileSync, cpSync, rmSync, symlinkSync } = require('node:fs');
rmSync('test/.tmp/warn', { recursive: true, force: true });
cpSync('skills/banzuke/template', 'test/.tmp/warn', { recursive: true });
symlinkSync(process.cwd() + '/node_modules', 'test/.tmp/warn/node_modules');
const items = Array.from({ length: 2000 }, (_, i) => 'w' + i);
writeFileSync('test/.tmp/warn/data.mjs', 'export default ' + JSON.stringify({
  title: 'Huge', unit: 'titles',
  tiers: [
    { name: 'Featured', layout: 'featured', items: ['a','b','c','d','e','f'], color: '#d62828' },
    { name: 'Wall', layout: 'wall', items },
  ],
}) + ';');
"
node test/.tmp/warn/banzuke.mjs --draft
```

Expected: the render succeeds and the crop warning is printed. Delete `test/.tmp/warn` afterwards.

- [ ] **Step 4: Commit**

```bash
git add skills/banzuke/template/banzuke.mjs
git commit -m "feat: report the solved canvas and warn when it stays croppable"
```

---

## Task 5: Documentation

The skill's eyeball checklist is written for a sheet that grows to fit its data. Half of it stops being true.

**Files:**
- Modify: `skills/banzuke/SKILL.md` (lines 123-134, 205-210)
- Modify: `docs/architecture.md`

**Interfaces:**
- Consumes: the knob names from Tasks 1 and 3.
- Produces: nothing.

- [ ] **Step 1: Confirm nothing still references the removed knobs**

```bash
rg -n 'FEAT_ROW_H|LONE_ROW_H' --glob '!samples/**'
```

Expected: hits only in `skills/banzuke/SKILL.md` (fixed in the next step). `samples/build/*` has its own independent copies of these constants and is deliberately excluded.

- [ ] **Step 2: Rewrite the density checklist**

In `skills/banzuke/SKILL.md`, replace the `### 1. Density — is it packed?` section (lines 123-134) with:

```markdown
### 1. Density — is it packed?

A banzuke is supposed to be densely filled. The sheet is pinned to a canvas
(`ASPECT`, 16:9 by default), so it always *fills* — which means too little data shows up as
stretched rows and oversized type rather than as blank space at the bottom.

- **Too much space inside rows** → raise `TYPE.*.rowFill`, or shift height between tiers with
  `TIER_WEIGHT`
- **The featured column looks stretched, with one or two enormous rows** → **this is a data
  problem, and no knob fixes it.** The band's height comes from the canvas, and the featured tier
  divides it into however many rows it has, so a lone item gets the whole band. Aim for **4–6
  featured items**. `TYPE.featured.cap` holds the text size while the row keeps its height, so a
  short tier gives you tall, mostly empty boxes — promote more titles, or drop `layout: "featured"`
  and let #1 lead the top ranked tier
- **A ranked or wall tier looks stretched** → re-tier in the data: merge it with its neighbour,
  or move its tail into the wall
- **Wall columns end at ragged heights** → adjust `WALL.em` or the number of items
- **The rows are cramped and the render warned about the ratio** → the data cannot fit the canvas
  even at `MAX_W`. Move titles into a wall tier, lower `WALL.sizes`, or raise `FEAT_ROW_MIN` to
  protect the top at the cost of the walls
- **Font too thin, sheet looks washed out** → raise `T.weight` (250–900, continuously variable)
```

- [ ] **Step 3: Update the knob list**

In the `### Code side (banzuke.mjs / lib)` section, replace the "main knobs" bullet (lines 207-209) with:

```markdown
- The main knobs are all in the block at the top: `T` (colors, font, weight) / `TYPE`
  (cap, rowFill, taper, stretch) / `ASPECT`, `MIN_W`, `MAX_W` (the canvas) / `FEAT_ROW_MIN`,
  `TIER_WEIGHT`, `MIN_RANK_UNIT` (height distribution) / `RANK_COLS`, `RANK_COL_W`, `FEAT_MAX_W`
  (how a wide canvas is filled) / `WALL` (sizes, em, stretch)
```

- [ ] **Step 4: Explain the canvas**

Add this section to `SKILL.md` immediately before `## Constraints — write for takumi's CSS subset`:

```markdown
## The canvas — why sheets are 16:9

The sheet is pinned to a target ratio rather than growing downward with the data. Social previews
(X in particular) **center-crop** anything much taller than landscape, and on a banzuke the first
thing cropped away is the top of the ranking — the whole point of the sheet.

So `geometry()` in `banzuke.mjs` solves the canvas before any markup is built: it walks candidate
widths from `MIN_W` to `MAX_W` and takes the narrowest one whose `ASPECT` height holds the data.
More titles means a *wider* sheet with more wall columns, not a longer one. The top band takes
whatever the masthead, walls and footer leave over, which is why the featured row height is
derived rather than set.

- Very dense data can miss the ratio even at `MAX_W`. The sheet then renders at the cap, slightly
  taller than the target, with the band at its `FEAT_ROW_MIN` floor. A little over is fine —
  1.7:1 still posts uncropped
- The render **warns** only when the result is still taller than square, which is genuinely
  croppable. Take that warning seriously: thin the walls or re-tier
- Raising `ASPECT` past roughly 1:1 reintroduces the crop on X. Lower it (a wider sheet) freely

A wide canvas is filled by splitting tiers into more columns, not by stretching rows. `RANK_COLS`
is `"auto"` for that reason — but note that more columns means *taller* rows, since fewer rows
share the same band. So auto stops short of any split that would let a ranked tier's first title
out-type the featured tier's last one. Rank has to read by size; a gappy row is the cheaper price.
Pin `RANK_COLS` to a number when you want to overrule that.
```

- [ ] **Step 5: Note the solve in the architecture doc**

Add to `docs/architecture.md`, alongside the other layout-math notes:

```markdown
The template solves its canvas before building markup. `geometry()` is pure integer arithmetic —
wall column counts, row counts, tier heights, no text measurement and no rendering — so searching
every candidate width between `MIN_W` and `MAX_W` costs nothing, and the sheet can be pinned to a
target aspect ratio instead of growing downward with the data. Everything the boxes need (the
canvas, the band height, the derived featured row height, per-tier ranked heights, the wall plan)
comes out of one call, which also makes the layout assertable in tests without a render.
```

- [ ] **Step 6: Verify the docs tests still pass**

Run: `npm test`
Expected: PASS — `test/project.test.mjs` asserts the SKILL.md runtime table matches `deno.json`, which this task does not touch.

- [ ] **Step 7: Commit**

```bash
git add skills/banzuke/SKILL.md docs/architecture.md
git commit -m "docs: describe the solved canvas and retire the grow-to-fit advice"
```

---

## Final verification

- [ ] `npm test` passes
- [ ] `npm run check:ci` passes (Biome)
- [ ] `node scripts/smoke.mjs` renders, reports a ratio at or above 1.0:1, and prints no crop warning for the shipped data
- [ ] The rendered PNG has been **opened as an image** and walked against the skill's eyeball checklist — density, alignment, hierarchy (#1 is still the biggest thing on the sheet), fitSpan health at the new row widths
- [ ] `rg -n 'FEAT_ROW_H|LONE_ROW_H' --glob '!samples/**'` returns nothing
