# Layout Exploration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the agent rearrange the banzuke's top band from `data.mjs` alone, and score each arrangement on measured density and rank hierarchy instead of eyeballing it.

**Architecture:** The band's right side becomes a three-level grid — rows stacked, cells side by side within a row, tiers stacked within a cell — driven by `row:` / `column:` / `cols:` on each tier. A `layout: "wall"` tier with a `row:` renders inside the band with the wall's packing, which is what makes a long tier affordable up there. A new `--report` flag measures ink coverage, the type ladder, per-cell slack and squeeze so candidates are compared on numbers.

**Tech Stack:** Plain ESM JavaScript, node >= 22, `node --test`, takumi-js, Biome.

**Spec:** `docs/superpowers/specs/2026-08-17-layout-exploration-design.md`

**Working prototype:** `.superpowers/sdd/prototype-banzuke.mjs` — the layout layer in this plan is already implemented and rendered there, against a real 388-title dataset. Read it. It is the reference for every function below.

**Reading the prototype correctly:** it is a *user project* copy, so it also carries customizations that must NOT come across: `MAST_H = 88`, `LINE = 1.45`, `WALL.sizes = [9, 8]`, `MIN_W`, a CJK `FONT_FILES`, `RANK_INDENT`/`RANK_GAP` in `row()`, a 56px masthead title, and `RANK_COLS = 1`. Take the layout layer only; the template's own values stay as they are.

## Global Constraints

- `skills/banzuke/template/banzuke.mjs` ships to users as an editable scaffold. Comments there address whoever edits it next: explain *why*, not *what*, in the file's existing voice.
- takumi is not a browser: flex + pre-computed px only. No `clamp()`, multicol, pseudo-elements, grid `fr`. Inline styles only.
- **takumi is border-box**: a declared `height` contains its own border and padding. Every height budget in this file depends on that. An auto-height box's padding and border *do* add on top — that asymmetry is why the wall formulas differ from the row formulas.
- Always state `font-weight` on anything that draws text.
- Any box with `overflow: hidden` needs an explicit `line-height` (`LINE`).
- Variable-length text goes through `fitSpan()`, plain text through `esc()`.
- Tests: `npm test` (`node --test`). Biome runs on pre-commit via lefthook; if it reformats, `git commit --amend`.
- Do not touch `samples/build/*`.
- Commit messages: lowercase `type: subject`, imperative, body ending with
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## File Structure

| File | Change |
|---|---|
| `skills/banzuke/template/banzuke.mjs` | Modified — Tasks 1-4 |
| `skills/banzuke/template/data.mjs` | Modified — Task 5, the header comment documents the new keys |
| `test/layout.test.mjs` | Modified — Tasks 1-4 |
| `skills/banzuke/SKILL.md` | Modified — Task 5 |
| `docs/architecture.md` | Modified — Task 5 |

---

## Task 1: The band grid, in geometry

Pure layout math. `sheet()` still renders the old way, so every existing test must keep passing.

**Files:**
- Modify: `skills/banzuke/template/banzuke.mjs` (`partition`, and new functions beside `shape`/`derive`)
- Test: `test/layout.test.mjs`

**Interfaces:**
- Consumes: `geometry()`, `shape()`, `derive()`, `bandParts()` as they stand.
- Produces:
  - `partition(source)` gains `band` — every non-featured tier that belongs in the band, i.e. all ranked tiers plus any `layout: "wall"` tier carrying a `row:`. `walls` now excludes wall tiers with a `row:`.
  - `bandRows(band)` → array of rows, each an array of tiers, grouped by `row:` (default: each tier alone, in data order).
  - `bandWallPlan(tier, cols)` → `{ size, cols, rows, rowH, height }`; `size` defaults to `WALL.sizes[0]`.
  - `shape(p, cols)` now returns `{ rankCols, bandRowPlan, rigidH, shareable, bandFloor }`, where each entry of `bandRowPlan` is `{ tiers, cells, rigid, need }` and each cell is either `{ stack, walls, need }` or `{ stack, rows, weights, weighted, fixed, need }`.
  - `derive(p, bandH)` now returns `{ bandH, featRowH, unit, bandRowHeights }`.

- [ ] **Step 1: Write the failing tests**

Append to `test/layout.test.mjs`:

```js
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

test("band grid: with no `row:` anywhere, the band is one tier per row as before", async () => {
  const { geometry } = await templateFor("grid-default", SPARSE);
  const g = geometry();
  assert.equal(g.bandRowPlan.length, 2, "two ranked tiers, stacked");
  for (const row of g.bandRowPlan) assert.equal(row.cells.length, 1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/layout.test.mjs`
Expected: the four new tests FAIL (`g.bandRowPlan` is undefined). Everything else PASSES.

- [ ] **Step 3: Port the geometry layer from the prototype**

From `.superpowers/sdd/prototype-banzuke.mjs`, port verbatim: `bandRows`, `bandWallPlan`, the
`partition` change (the `band` / `walls` split with its comment), and the rewritten `shape` and
`derive`. The prototype's versions are the reference — the cell classification, the rigid/shareable
split, and the proportional slack share are all load-bearing and were arrived at by rendering.

Keep the template's own `rankedShape`, `hierCeiling` and `resolveRankCols` untouched in this task;
Task 3 reconciles them with cells.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, including every pre-existing test.

- [ ] **Step 5: Commit**

```bash
git add skills/banzuke/template/banzuke.mjs test/layout.test.mjs
git commit -m "feat: model the band as rows of cells of stacks"
```

---

## Task 2: Render the grid

**Files:**
- Modify: `skills/banzuke/template/banzuke.mjs` (`row`, `rowColumn`, `rankedTier`, `wallTier`, the band assembly in `sheet()`)
- Test: `test/layout.test.mjs`

**Interfaces:**
- Consumes: `bandRowPlan`, `bandRowHeights` from Task 1.
- Produces: `wallTier(tier, size, cols, inner, rule = true)`; `row()` treats `rank === undefined` as "this tier opted out of numbering".

- [ ] **Step 1: Write the failing tests**

```js
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
  const widths = [...html.matchAll(/<div style="width:(\d+)px;flex:none;display:flex;flex-direction:column;/g)]
    .map((m) => Number(m[1]));
  assert.ok(widths.length >= 2, "expected a box per cell");
  assert.ok(
    Math.abs(widths.slice(-2).reduce((a, b) => a + b, 0) - g.rightW) <= 4,
    `cells should tile rightW ${g.rightW}, got ${widths.slice(-2)}`,
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/layout.test.mjs`
Expected: all three FAIL.

- [ ] **Step 3: Port the rendering layer from the prototype**

From `.superpowers/sdd/prototype-banzuke.mjs`, port:

- `row()`'s `numbered = rank !== undefined` branch — the rank cell becomes conditional and the
  title's left padding takes the gap the number would have used. **Re-express against the
  template's own `row()`**, which uses the literals `6`, `1.4` and `8` where the prototype uses
  `RANK_INDENT` / `RANK_GAP`.
- `rowColumn` and `rankedTier` threading `undefined` through instead of doing arithmetic on it.
- The `numbers: false` skip in `sheet()`'s running-number loop.
- `wallTier`'s `rule = true` parameter and the `under` local; the inner per-column variable is
  renamed `colRule` to avoid the collision.
- The band assembly in `sheet()`: rows → cells → stacks, with the per-cell width split by column
  count and the per-cell `unit` for ranked stacks.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Render and look at the sheet**

```bash
node scripts/smoke.mjs
```

Open the PNG. The shipped data has no `row:`/`column:`, so this must look **identical** to before
the task — that is the real check on the default path.

Then scaffold a copy with the `GRID` shape from the tests, render it, and open that too: three
cells, no double rule under the band wall, no blank strip below any cell.

- [ ] **Step 6: Commit**

```bash
git add skills/banzuke/template/banzuke.mjs test/layout.test.mjs
git commit -m "feat: render the band as a grid of cells"
```

---

## Task 3: Re-derive the hierarchy bound against cells

`resolveRankCols` compares one `unit` against the featured row height. With cells there is a unit
per cell, and the bound silently stops binding.

**Files:**
- Modify: `skills/banzuke/template/banzuke.mjs` (`resolveRankCols`, and its call sites)
- Test: `test/layout.test.mjs`

**Interfaces:**
- Consumes: `bandRowPlan` cells from Task 1.
- Produces: `resolveRankCols` judges against the **densest** ranked cell — the one whose rows come out shortest, i.e. the largest `weighted` relative to the height it gets.

- [ ] **Step 1: Write the failing test**

```js
test("band grid: the hierarchy bound is judged against the densest cell", async () => {
  const { geometry } = await templateFor("grid-hier", {
    title: "T",
    unit: "titles",
    tiers: [
      { name: "Featured", layout: "featured", items: bulk("f", 8), color: "#d62828" },
      { name: "Short", layout: "ranked", items: bulk("s", 4), row: 1, column: 1 },
      { name: "Long", layout: "ranked", items: bulk("l", 60), row: 1, column: 2 },
    ],
  });
  const g = geometry();
  const row = g.bandRowPlan[0];
  const H = g.bandRowHeights[0];
  for (const cell of row.cells) {
    const unit = (H - cell.fixed) / cell.weighted;
    const top = unit * Math.max(...cell.weights);
    assert.ok(
      top < g.featRowH,
      `cell ${cell.stack.map((t) => t.name)} rows ${top} must stay under the featured ${g.featRowH}`,
    );
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/layout.test.mjs`
Expected: FAIL — the `Long` cell's rows out-grow the featured rows because the bound never saw it.

- [ ] **Step 3: Judge against the densest cell**

Change `resolveRankCols` to take the row plan rather than a single `ranked`/`rankedFixed` pair:
for each candidate column count, build the cells, compute each ranked cell's `unit` at the band it
would get, and accept the count only when **every** ranked cell clears `hierCeiling`. Keep the
existing countdown from `want` to 1, the `featRowH <= 0` guard, and the `band(cols)` callback that
`overflow()` uses to judge against the floor it will actually deliver.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, including the Task 1 and 2 tests and the pre-existing hierarchy tests.

- [ ] **Step 5: Commit**

```bash
git add skills/banzuke/template/banzuke.mjs test/layout.test.mjs
git commit -m "feat: judge the hierarchy bound against every ranked cell"
```

---

## Task 4: `--report`

**Files:**
- Modify: `skills/banzuke/template/banzuke.mjs` (a `report()` function and the entry point)
- Test: `test/layout.test.mjs`

**Interfaces:**
- Consumes: `geometry()`, `sheet()`, and `measureWidth` from `lib/index.mjs` (already imported).
- Produces: `export async function report()` → `{ canvas, ratio, clamped, cropRisk, coverage, ladder, slack, squeeze }`, and `node banzuke.mjs --report` printing it.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/layout.test.mjs`
Expected: FAIL — `report is not a function`.

- [ ] **Step 3: Implement `report()`**

Build the sheet's HTML, then measure it. Every drawn string is a `fitSpan`, which emits a span
carrying its own size, weight, family, letter-spacing and `scaleX` — so the report reads the same
markup takumi will:

```js
const SPAN =
  /<span style="[^"]*?font-size:([\d.]+)px;font-weight:(\d+);font-family:'([^']+)';letter-spacing:([-\d.]+)px;transform:scaleX\(([\d.]+)\);">([^<]*)<\/span>/g;

/**
 * Score a candidate layout. Ink coverage is the one number that answers "is this denser?" — the
 * eye cannot judge it from a thumbnail, and it routinely disagrees with intuition: shrinking the
 * tier that holds most of the characters lowers it, however much height it frees.
 */
export async function report() {
  const g = geometry(data);
  const html = await sheet();
  let ink = 0;
  let squeeze = 0;
  for (const m of html.matchAll(SPAN)) {
    const [, size, weight, family, ls, scale, text] = m;
    if (!text.trim()) continue;
    const w = await measureWidth(text, {
      size: Number(size),
      weight: Number(weight),
      family,
      letterSpacing: Number(ls),
    });
    ink += w * Number(scale) * Number(size);
    if (Number(scale) < 1) squeeze += 1;
  }
  return {
    canvas: [g.sheetW, g.sheetH],
    ratio: g.sheetW / g.sheetH,
    clamped: g.clamped,
    cropRisk: g.cropRisk,
    coverage: ink / (g.sheetW * g.sheetH),
    ladder: ladderOf(g),
    slack: slackOf(g),
    squeeze,
  };
}
```

`ladderOf(g)` walks the sheet top to bottom — featured, then each band row's cells in order, then
the foot walls — and returns `{ name, from, to }` per tier using the same `tierSizes` the renderer
uses (a wall's rung is `{ from: size, to: size }`). `slackOf(g)` returns, per band cell,
`{ name, need, got, slack }` where `got` is the row's height.

In the entry point, `--report` prints this instead of rendering: the canvas line, coverage as a
percentage, the ladder as `name from→to` joined by ` > ` with a marker where the sequence stops
descending, any cell whose slack exceeds 20px, and the squeeze count.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Try it on real data**

```bash
node scripts/smoke.mjs
```

Then run `--report` on the scaffolded copy and read the output. Sanity-check it against the PNG:
does the ladder match what you see, and is a cell it calls slack actually short of its row?

- [ ] **Step 6: Commit**

```bash
git add skills/banzuke/template/banzuke.mjs test/layout.test.mjs
git commit -m "feat: score a layout with --report"
```

---

## Task 5: Documentation

**Files:**
- Modify: `skills/banzuke/SKILL.md`, `skills/banzuke/template/data.mjs`, `docs/architecture.md`

- [ ] **Step 1: Document the keys where they are used**

`data.mjs`'s header comment lists `layout:` and what the item shapes are. Extend it with `row:`,
`column:`, `cols:`, `size:` and `numbers:`, in the same terse register — one line each, saying what
the key does, not how the machinery works.

- [ ] **Step 2: Add the exploration section to SKILL.md**

Insert after the "eyeball checklist" and before "Tips for fixing things":

```markdown
## Exploring layouts — measure, don't squint

The band's arrangement is the biggest lever on a dense sheet, and it is a data edit, not a rewrite:
`row:` puts tiers side by side, `column:` stacks them inside one cell, `cols:` splits a tier, and a
`layout: "wall"` tier with a `row:` gets the wall's packing up in the band.

So when a sheet is dense enough to be interesting, **do not polish the first arrangement**.
Produce three to five that differ *structurally*, score each with `node banzuke.mjs --report`, then
open the winner as an image and walk the checklist. `--report` gives you:

- **coverage** — ink over sheet area. The answer to "is this denser?"
- **ladder** — each tier's first→last size, top to bottom, and where it stops descending
- **slack** — a band cell shorter than its row, which renders as a blank strip
- **squeeze** — titles at `scaleX < 1`, one step from wrapping and being clipped

Levers worth knowing before you start guessing:

- **A long tier is cheap as a wall and expensive as a ranked tier.** A ranked row cannot go below
  `MIN_RANK_UNIT`, so 96 titles cost ≥2100px ranked and ~600px as a wall. Promoting a long tier
  into the band is usually only affordable as a wall
- **Compressing the bottom does not raise density.** Most of the characters live in the biggest
  tiers; shrinking them lowers the average even as it frees height. Measured on a 388-title sheet,
  squeezing the two largest tiers took coverage from 27.8% to 25.5%
- **The solver takes the narrowest fitting width**, so freeing height shrinks the whole sheet
  rather than giving the band more room. Pin `MIN_W` to `MAX_W` when you want the space to go to
  the band instead
- **Balance a cell against its row.** A cell whose natural height falls short leaves a blank strip;
  the fix is fewer columns, a larger `size:`, or a different split of the neighbouring cell
- Coverage compares candidates *on the same data*. It is not a score to chase in the abstract —
  a sheet of long titles will always read denser than one of short ones
```

- [ ] **Step 3: Note the grid in the architecture doc**

Add a paragraph to `docs/architecture.md` describing the three levels (rows, cells, stacks), that a
row is as tall as its hungriest cell, that wall cells are rigid while ranked cells share the slack,
and that `--report` measures the emitted markup rather than re-deriving the layout.

- [ ] **Step 4: Verify**

Run: `npm test` and `npm run check:ci`
Expected: PASS. `test/project.test.mjs` asserts SKILL.md's runtime table matches `deno.json`; this
task does not touch that table.

- [ ] **Step 5: Commit**

```bash
git add skills/banzuke/SKILL.md skills/banzuke/template/data.mjs docs/architecture.md
git commit -m "docs: teach the band grid and the measure-first loop"
```

---

## Final verification

- [ ] `npm test` passes
- [ ] `npm run check:ci` passes
- [ ] `node scripts/smoke.mjs` renders, and the PNG is **identical in layout** to before the branch for the shipped data (no `row:`/`column:` in it)
- [ ] A scaffolded copy using `row:`/`column:`/band-wall renders correctly, and has been **opened as an image**: three cells, no double rule, no blank strip
- [ ] `--report` output has been read and sanity-checked against that PNG
