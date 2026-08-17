// The banzuke sheet template = a runnable script (`node banzuke.mjs`, `bun banzuke.mjs` or
// `deno task render` → banzuke.html / banzuke.png).
// The whole file is meant to be edited. When something looks off, start by changing one of
// the "tuning knobs" constants below — one at a time — and re-running. Rebuilding the layout
// structure from scratch is fine too.
// It is plain JS, so console.log and the debugger work exactly as you would expect.
//
// To keep takumi rendering reliably, the HTML string is built from flex + pre-computed px only
// (no clamp / multicol / pseudo-elements / grid fr; inline style rather than <style> blocks).
// Variable-length text goes through fitSpan() (pre-measured scaleX), plain text through esc().

import { pathToFileURL } from "node:url";
import data from "./data.mjs";
import {
  decodeHtmlEntities,
  esc,
  FONT_FAMILY,
  fitSpan,
  measureWidth,
  registerFontPackage,
  renderFile,
} from "./lib/index.mjs";

// ================= Typeface =================
// No font ships with the skill — this project installs its own, so the choice can suit both the
// design and the data. To swap it: install the font package here, then change FONT_FILES.
//
//   npm i @fontsource-variable/archivo        (bun add … / deno add npm:… on those runtimes)
//
// Every script in data.mjs needs a font that covers it, or those glyphs render as tofu (□).
// Fonts split by unicode subset (Fontsource ships one file per subset) go in as separate family
// names: takumi resolves a missing glyph against every registered font, which stitches the
// subsets back together and is also how you add a second script.
const FONT_FILES = {
  [FONT_FAMILY]: "@fontsource-variable/archivo/files/archivo-latin-wght-normal.woff2",
  [`${FONT_FAMILY} Ext`]: "@fontsource-variable/archivo/files/archivo-latin-ext-wght-normal.woff2",
};

await Promise.all(
  Object.entries(FONT_FILES).map(([name, spec]) => registerFontPackage(name, spec)),
);

// ================= tuning knobs =================
// Nearly every visual adjustment lives here. One change per run, compared against the previous PNG.

// Theme (colors, typeface)
const T = {
  bg: "#f4efe3", // paper
  ink: "#14110d", // text and rules
  muted: "#6b655a", // rank numbers and footer
  ground: "#9c9384", // outer margin
  rule: "rgba(20,17,13,0.25)", // vertical rules in the wall
  accent: "#d62828", // spine color when a tier has no color
  font: FONT_FAMILY, // registered in the Typeface block above
  weight: 800, // base weight (a variable font covers 100–900; a static one has fixed weights)
  tracking: "0.04em",
};

// Dimensions (px). Rules come in three weights: outer frame BW > section DIV > row SEP
const GROUND = 24; // outer margin
const BW = 8; // outer frame
const SPINE = 8; // left spine of a row
const SEP = 2; // row separator
const DIV = 4; // section separator
const PAD = 14; // left/right padding for headers and walls
const MAST_H = 64; // masthead height
const MAST_PAD = 22; // left/right padding inside the masthead
const HDR_H = 24; // tier header height
const FEAT_SPLIT = 3 / 7; // featured column's share of the sheet width

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
const MIN_COL_W = 80; // narrowest a band column may be. A ranked row spends ~57px of its column on
//                       spine + rank cell + padding, so below this there is nothing left for the
//                       title and fitSpan throws on a negative `avail`. Every band tier's column
//                       count is clamped against it (tierCols), and a row with more cells than the
//                       widest canvas can hold at this size is refused outright by geometry().
const FEAT_MAX_W = 620; // the featured column stops widening here; the ranked side takes the rest
const FOOT_H = 34; // footer strip, an explicit height so the height math is exact

// Line-height for every box that clips (overflow:hidden). A box shorter than the font's glyph
// box crops descenders (g / y / p), and rows are a fixed height here, so a roomy value costs
// no density — it only decides where the text is clipped and how it centers.
// Raise it toward 1.45 for a face with tall metrics (any CJK font), whose glyph box is bigger.
const LINE = 1.25;

// Density and typography:
//   cap     = font size ceiling
//   rowFill = text size relative to row height (↑ packs the sheet tighter)
//   taper   = size ratio at the end of a tier (↓ steepens the rank gradient = top stands out more)
//   stretch = fitSpan's stretch ceiling (1 = shrink only)
const TYPE = {
  featured: { cap: 46, rowFill: 0.78, taper: 0.67, stretch: 1.5 },
  ranked: { cap: 30, rowFill: 0.63, taper: 0.78, stretch: 1.5 },
};
const MIN_RANK_UNIT = 22; // floor for one ranked row, so the right side survives a small featured tier
const RANK_COLS = "auto"; // columns per ranked tier. "auto" holds them near RANK_COL_W wide;
//                           a number pins them (more columns = narrower rows = easier to squash)
const RANK_COLS_MAX = 4; // ceiling for "auto". At MAX_W the RANK_COL_W split already wants five,
//                          and a fifth column leaves a row too narrow for its rank cell plus a
//                          title — so this, not RANK_COL_W, is what binds on the widest sheets.
const TIER_WEIGHT = 1.3; // multiplier making higher ranked tiers taller (↑ makes the top stand out)
const WALL = {
  // Wall font sizes (top wall first; the last one repeats if you run out). The first one also has
  // to stay under the last row of the band above it, or the foot out-types the ranking and
  // --report's ladder says so — lower it before anything else when that happens.
  sizes: [13, 11, 9.5],
  stretch: 2,
  em: 0.87, // rough column width (font size × em × 16px). ↓ yields more columns
};
// ===============================================

const titleOf = (item) => (typeof item === "string" ? item : item.title);
const lerp = (a, b, t) => a + (b - a) * t;

/** Font size gradient running from `from` at the top to `to` at the bottom */
const ramp = (from, to, n) =>
  Array.from({ length: n }, (_, i) => Math.round(lerp(from, to, n < 2 ? 0 : i / (n - 1))));

/**
 * Derive the per-row font sizes inside a tier from the row height. `max` is a second ceiling
 * alongside the type knob's own `cap`, for a tier that has more height than its rank has earned
 * (see rankedTier) — pass Infinity when nothing outranks it.
 */
function tierSizes(kind, rowH, n, max = Number.POSITIVE_INFINITY) {
  const { cap, rowFill, taper } = TYPE[kind];
  const from = Math.min(cap, max, Math.round(rowH * rowFill));
  return ramp(from, Math.round(from * taper), n);
}

// ---- Parts (functions returning HTML strings) ----

/** fitSpan using the theme's typeface (T.font / T.weight) */
const fitT = (text, options) => fitSpan(text, { weight: T.weight, family: T.font, ...options });

/** Tier header (name + count) */
const tierHeader = (name, count) =>
  `<div style="height:${HDR_H}px;flex:none;display:flex;align-items:center;padding:0 ${PAD}px;border-bottom:${DIV}px solid ${T.ink}">
    <div style="font-size:13px;font-weight:${T.weight};letter-spacing:${T.tracking}">${esc(name)}</div>
    <div style="margin-left:auto;font-size:14px;font-weight:${T.weight}">${count}</div>
  </div>`;

/** One row: spine, running number, title (fitSpan). No rank means the tier opted out of numbering */
async function row({ item, rank, size, colW, color, stretch, last }) {
  const numbered = rank !== undefined;
  const rankSize = Math.max(10, size * 0.5);
  const rankW = numbered ? Math.round(6 + 1.4 * rankSize) : 0;
  // With no number cell to indent past, the title takes a full PAD off the spine rather than the
  // 8px gap that otherwise separates it from the number.
  const gap = numbered ? 8 : PAD;
  const avail = colW - SPINE - rankW - gap - PAD;
  const span = await fitT(titleOf(item), { size, avail, stretch });
  const bb = last ? "" : `border-bottom:${SEP}px solid ${T.ink};`;
  return `<div style="flex:1;display:flex;align-items:center;min-height:0;overflow:hidden;border-left:${SPINE}px solid ${color};background:${T.bg};${bb}">
    ${numbered ? `<div style="width:${rankW}px;padding-left:6px;text-align:right;color:${T.muted};font-weight:${T.weight};font-size:${rankSize}px;line-height:1">${rank}</div>` : ""}
    <div style="flex:1;min-width:0;overflow:hidden;padding:0 ${PAD}px 0 ${gap}px;line-height:${LINE}">${span}</div>
  </div>`;
}

/** One column of stacked rows (flex spreads the row heights evenly) */
async function rowColumn({ items, startRank, sizes, colW, color, stretch }) {
  const rows = await Promise.all(
    items.map((item, i) =>
      row({
        item,
        rank: startRank === undefined ? undefined : startRank + i,
        size: sizes[i],
        colW,
        color,
        stretch,
        last: i === items.length - 1,
      }),
    ),
  );
  return `<div style="flex:1;display:flex;flex-direction:column;min-width:0;min-height:0">${rows.join("")}</div>`;
}

/**
 * ranked tier: header + items dealt column-major into `cols` columns.
 *
 * `maxSize` is the largest this tier's first title may be typed, which is not always what its row
 * height would allow: a tier sharing a band row with a longer one is handed more height per row
 * than its rank has earned, and no ranked title may out-type the featured column's last. The box
 * keeps its full height either way — a capped tier spends the difference as leading down all of
 * its rows, which reads as air, rather than shrinking and leaving a blank strip under itself.
 * Pass Infinity when there is no featured tier to outrank.
 */
async function rankedTier({ tier, startRank, height, maxSize, width, cols: rankCols, isLast }) {
  const n = tier.items.length;
  const cols = Math.min(rankCols, Math.max(1, n));
  const rows = Math.ceil(n / cols); // tallest column, which is what sets the row height
  const sizes = tierSizes("ranked", (height - HDR_H) / rows, n, maxSize);
  const colW = width / cols;
  const color = tier.color ?? T.accent;
  const start = colSplit(n, cols);
  const columns = await Promise.all(
    Array.from({ length: cols }, (_, c) =>
      rowColumn({
        items: tier.items.slice(start(c), start(c + 1)),
        startRank: startRank === undefined ? undefined : startRank + start(c),
        sizes: sizes.slice(start(c), start(c + 1)),
        colW,
        color,
        stretch: TYPE.ranked.stretch,
      }),
    ),
  );
  const sizing = isLast
    ? "flex:1;"
    : `height:${height}px;flex:none;border-bottom:${DIV}px solid ${T.ink};`;
  return `<div style="${sizing}display:flex;flex-direction:column;min-height:0">
    ${tierHeader(tier.name, n)}
    <div style="flex:1;display:flex;min-height:0">${columns.join("")}</div>
  </div>`;
}

/** wall tier: an unranked packed wall. Explicit columns + vertical rules (multicol substitute) */
async function wallTier(tier, size, cols, inner, rule = true) {
  const names = tier.items.map(titleOf);
  const start = colSplit(names.length, cols);
  const gutter = 8;
  const colW = (inner - 2 * PAD - (cols - 1) * (2 * gutter + SEP)) / cols;
  // One line per item. fitSpan squashes with scaleX, which does not shrink the span's *layout*
  // width, so a shrunk title still overflows the column and would take two line boxes — leaving
  // a blank line mid-column and columns that end at different heights.
  const rowH = Math.round(size * LINE);
  const columns = await Promise.all(
    Array.from({ length: cols }, async (_, c) => {
      const chunk = names.slice(start(c), start(c + 1));
      const items = await Promise.all(
        chunk.map(async (name) => {
          const span = await fitT(name, { size, avail: colW, stretch: WALL.stretch });
          return `<div style="height:${rowH}px;padding:1px 0;font-size:${size}px;line-height:${LINE};overflow:hidden">${span}</div>`;
        }),
      );
      const colRule = c > 0 ? `border-left:${SEP}px solid ${T.rule};padding-left:${gutter}px;` : "";
      const pr = c < cols - 1 ? `padding-right:${gutter}px;` : "";
      return `<div style="flex:1;min-width:0;${colRule}${pr}">${items.join("")}</div>`;
    }),
  );
  // In the band the enclosing *row* already draws the rule underneath (the cell only rules to its
  // right), so a wall there must not draw its own or the two stack up into a double line.
  const under = rule ? `border-bottom:${DIV}px solid ${T.ink};` : "";
  return `<div style="${under}padding-bottom:10px">
    ${tierHeader(tier.name, names.length)}
    <div style="height:8px"></div>
    <div style="display:flex;align-items:flex-start;padding:0 ${PAD}px">${columns.join("")}</div>
  </div>`;
}

/**
 * Column boundaries for `n` items over `cols` columns: `start(c)` → the index column c begins at.
 * The remainder is dealt one row at a time across the leading columns rather than all landing in
 * the last one (128 over 9 columns is 15×8 + 8, which ends the tier on a stub column).
 * The tallest column is still `ceil(n / cols)`, so height math built on that holds.
 */
function colSplit(n, cols) {
  const base = Math.floor(n / cols);
  const extra = n % cols;
  return (c) => c * base + Math.min(c, extra);
}

/** Wall column count: split the same way an em-width-based multicol would */
function wallCols(n, em, inner) {
  const avail = inner - 2 * PAD;
  const colw = em * 16;
  const gap = 16;
  const maxCols = Math.max(1, Math.floor((avail + gap) / (colw + gap)));
  return Math.ceil(n / Math.ceil(n / maxCols));
}

/**
 * How many columns a band tier deals into: its own `cols:` from data.mjs when it sets one, the
 * sheet's shared count otherwise. Three clamps, because all three are reachable from a data.mjs
 * edit alone. Floored at 1: a stray `0` or negative turns `n / cols` into `Infinity` rows and
 * everything built on it into a broken canvas. Capped at the tier's own item count: a tier cannot
 * fill more columns than it has items. Capped at `maxCols`, the columns the width can hold: this
 * is the one that used to be missing, and without it `cols: 40` on a 40-item tier deals 13px
 * columns and the run dies inside fitSpan on a negative `avail` — an opaque stack trace for what
 * is only a number in the data.
 *
 * One function rather than one clamp per caller: the height math, the column solver and the markup
 * all divide by this number, and if any two of them disagree the width one hands out and the
 * columns another draws drift apart — an over-wide `cols:` over-credits a cell's share of the row
 * and starves its neighbor's `avail` negative.
 */
const tierCols = (tier, cols, maxCols) =>
  Math.min(
    Math.max(1, tier.cols ?? cols),
    Math.max(1, tier.items.length),
    Math.max(1, Math.floor(maxCols)),
  );

/**
 * The most columns any one cell of a row may plan for, given the width that row has to share.
 *
 * A row hands its width out *in proportion to its cells' column counts*, so every column in a row
 * ends up the same width — which turns the whole row into one budget, `width / MIN_COL_W`, and an
 * equal share of that budget per cell is enough to hold every column at or above MIN_COL_W however
 * lopsided the cells turn out to be. Deliberately not a function of what each cell asked for: the
 * width follows the column counts, so a cap that followed the width too would chase its own tail.
 */
const cellColBudget = (width, cellCount) => Math.max(1, width / Math.max(1, cellCount) / MIN_COL_W);

/** The cells of one band row: tiers sharing a `column:` stack into one cell, in data order. */
function rowCells(tiers) {
  const byCol = new Map();
  tiers.forEach((t, i) => {
    const k = t.column ?? `_${i}`;
    if (!byCol.has(k)) byCol.set(k, []);
    byCol.get(k).push(t);
  });
  return [...byCol.values()];
}

// ---- Geometry: solving the canvas ----
// All of this is pure arithmetic — no text measurement, no rendering — so searching ~65
// candidate widths costs nothing. Everything the sheet's boxes need comes out of one call.
//
// The whole height budget below rests on one fact: takumi sizes boxes *border-box*. A declared
// `height` already contains that box's border and padding — `height:50px;border-bottom:10px`
// occupies 50px, not 60 — while a box with no `height` grows by them. So a rule you can see
// between two fixed-height boxes costs nothing extra, and only the auto-height boxes (the wall
// tiers) have to add their padding and rules in. Reserve height for a border twice and the sheet
// comes out short of the canvas it is pinned to, leaving a bare strip of paper above the frame.

/** Split the data into the three layout families the sheet is built from */
function partition(source) {
  const tiers = source.tiers.filter((t) => t.items.length > 0);
  const numbered = tiers.filter((t) => t.layout !== "wall");
  const featured = numbered.find((t) => t.layout === "featured");
  // A `row:` puts a tier in the band whatever its layout, so a wall can sit up there packed the
  // way the walls at the foot of the sheet are — no rules between rows, no per-row floor, just
  // one line each. That is what makes a long tier cheap enough to keep in the band.
  return {
    tiers,
    numbered,
    featured,
    band: tiers.filter((t) => t !== featured && (t.layout !== "wall" || t.row !== undefined)),
    walls: tiers.filter((t) => t.layout === "wall" && t.row === undefined),
  };
}

/** A band wall's own height: it is content-driven, not a share of the band */
function bandWallPlan(tier, cols) {
  // Both inputs are guarded here, not just at the callers, because both come straight out of
  // data.mjs: a 0 or negative `cols:` divides into Infinity rows, and a 0 or negative `size:`
  // makes every line box zero-or-negative tall, which shrinks the whole tier away.
  const size = Math.max(1, tier.size ?? WALL.sizes[0]);
  const safeCols = Math.max(1, cols);
  const rows = Math.ceil(tier.items.length / safeCols);
  const rowH = Math.round(size * LINE);
  // Same border-box budget as the walls at the foot of the sheet: each row's 1px padding is
  // inside rowH, while the block's own padding-bottom and rule sit outside its auto height.
  return { size, cols: safeCols, rows, height: HDR_H + 8 + rows * rowH + 10 };
}

/**
 * The band's right side, as rows stacked top to bottom. Ranked tiers sharing a `row:` in data.mjs
 * stand side by side within one row; without it each tier is its own row, which is the single
 * stacked column this sheet started with. A row is as tall as its longest tier, so pairing a short
 * tier with a long one costs nothing.
 */
function bandRows(band) {
  const byKey = new Map();
  band.forEach((t, i) => {
    const k = t.row ?? `_${i}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(t);
  });
  return [...byKey.values()];
}

/**
 * The tallest a ranked row may get before the first title of a ranked tier would out-type the
 * last row of the featured one. Derived from the type knobs rather than guessed — including the
 * caps, which clamp both sides of the comparison, so lowering `TYPE.featured.cap` tightens the
 * bound and raising `TYPE.ranked.cap` is what makes it bind at all.
 */
function hierCeiling(featRowH, weights) {
  const feat = TYPE.featured;
  const last = Math.min(feat.cap, featRowH * feat.rowFill) * feat.taper; // the featured tier's smallest row
  // Ranked type that cannot reach `last` even at its own cap can never out-size it, whatever the
  // rows do, so there is nothing for the bound to say.
  if (TYPE.ranked.cap <= last) return Number.POSITIVE_INFINITY;
  return last / (TYPE.ranked.rowFill * Math.max(...weights, 1));
}

/**
 * What a band of `bandH` leaves the tiers, and the featured row height that follows — the two
 * numbers the column count is decided against, before any tier heights are derived. The band's
 * own bottom rule lives inside bandH, so the tiers share what is left of it.
 */
function bandParts(p, bandH) {
  const avail = bandH - p.bandRule;
  return { avail, featRowH: p.featured ? (avail - HDR_H) / p.featRows : 0 };
}

/**
 * One band row's height at a given ranked unit: a rigid row keeps exactly what it asked for, and a
 * flexible one takes its ranked cell's fixed-plus-growth or its wall cell's fixed need, whichever
 * is taller. shape() judges the band's floor through this and derive() distributes the solved band
 * through it, so the floor and the distribution are the same expression by construction. They were
 * two hand-copies once, and the copies disagreed: derive() paid a wall-bound row twice and the
 * band overflowed by the difference.
 */
const rowHeight = (r, unit) =>
  r.rigid ? r.need : Math.max(r.wallFloor, r.fixed + r.demand * r.weight * unit);

/** The band-height-dependent half of a plan, split out so the overflow path can redo it */
function derive(p, bandH) {
  const { avail, featRowH } = bandParts(p, bandH);
  const plan = p.bandRowPlan ?? [];
  const gaps = Math.max(0, plan.length - 1) * DIV;

  // Rows that cannot spend a share of the band are settled first and taken *out* of the pool: the
  // rigid ones (all wall, nothing in them grows), and any flexible row whose wall cell's floor
  // already beats the share the unit would hand it. Leaving one of those in the pool pays for its
  // height twice — once as a share of the unit, once as the floor laid on top — and the rows then
  // add up past the band, which the renderer settles by cutting content off the bottom.
  //
  // Which rows those are depends on the unit and the unit depends on which rows those are, so this
  // iterates to a fixed point. Settling a row always lowers the unit (it removes more height from
  // the pool than the share it was drawing), so a settled row never comes back: at most one pass
  // per row, and in practice one or two.
  const settled = new Set(plan.filter((r) => r.rigid));
  let unit = 0;
  for (let pass = 0; pass <= plan.length; pass++) {
    // rowHeight(r, 0) is `need` for a rigid row and `wallFloor` for a wall-bound one — in both
    // cases exactly the height that row is about to keep, whatever the unit ends up being.
    const taken = plan.reduce((sum, r) => sum + (settled.has(r) ? rowHeight(r, 0) : 0), 0);
    const fixed = plan.reduce((sum, r) => sum + (settled.has(r) ? 0 : r.fixed), 0);
    const demand = plan.reduce((sum, r) => sum + (settled.has(r) ? 0 : r.demand * r.weight), 0);
    unit = demand > 0 ? Math.max(0, avail - taken - fixed - gaps) / demand : 0;
    const bound = plan.filter(
      (r) => !settled.has(r) && r.wallFloor > r.fixed + r.demand * r.weight * unit,
    );
    if (bound.length === 0) break;
    for (const r of bound) settled.add(r);
  }

  // Round on the running total rather than per row. The unrounded heights add up to `avail`
  // exactly; rounding each one alone scatters up to half a pixel per row into (or out of) a band
  // that has no way to absorb it, while carrying the remainder forward keeps the sum exact and
  // still leaves every row within a pixel of its share. report() checks that sum — see
  // bandResidue.
  let drawn = 0;
  let exact = 0;
  const bandRowHeights = plan.map((r, i) => {
    exact += rowHeight(r, unit);
    const h = Math.round(exact) - drawn;
    drawn += h;
    return h + (i < plan.length - 1 ? DIV : 0);
  });
  return { bandH, featRowH, bandRowHeights };
}

/**
 * The column-count-dependent half of a plan: how the ranked tiers deal out over `cols`, and the
 * band height below which the sheet stops being legible (featured rows on the left, ranked rows
 * on the right, whichever needs more). Rounded up to a whole pixel: an overflowing sheet is sized
 * from this floor, and a fractional canvas height cannot be filled exactly.
 */
function shape(p, cols) {
  // A cell is one stack of tiers. Ranked stacks share whatever height the row gets; a wall stack
  // is worth exactly what its lines add up to, so it asks for that and no more.
  const cellOf = (stack, maxCols) => {
    const colsOf = (t) => tierCols(t, cols, maxCols);
    const walls = stack.filter((t) => t.layout === "wall");
    if (walls.length === stack.length) {
      const plans = stack.map((t) => bandWallPlan(t, colsOf(t)));
      return { stack, walls: plans, need: plans.reduce((s, w) => s + w.height, 0) };
    }
    // A stack has one height and one way of spending it, so it cannot be half of each: a wall
    // packs one line per item off its own `size:`, a ranked tier divides the row into numbered
    // rows. Rejected rather than quietly coerced — the old code read the stack as ranked, which
    // dropped the wall's `size:` and packing, gave it rank numbers, and moved the canvas.
    if (walls.length > 0) {
      throw new Error(
        `banzuke data.mjs: the column: stack [${stack.map((t) => t.name).join(" + ")}] mixes a ` +
          `"wall" tier with ranked ones. A stack has to be all wall or all ranked — give the ` +
          'wall tier a column: of its own, or drop its layout: "wall".',
      );
    }
    const rows = stack.map((t) => Math.ceil(t.items.length / colsOf(t)));
    const weights = stack.map((_, i) => TIER_WEIGHT ** (stack.length - 1 - i));
    const weighted = rows.reduce((s, r, i) => s + r * weights[i], 0);
    const fixed = stack.length * HDR_H + Math.max(0, stack.length - 1) * DIV;
    return { stack, rows, weights, weighted, fixed, need: fixed + weighted * MIN_RANK_UNIT };
  };

  // Within a row, tiers sharing a `column:` stack inside one cell; the cells stand side by side.
  const built = p.bandRows.map((tiers) => {
    const stacks = rowCells(tiers);
    // How many cells share this row is known before any column count is: `column:` groups them.
    // That is what makes the width budget below solvable rather than circular.
    const maxCols = cellColBudget(p.rightW, stacks.length);
    const cells = stacks.map((stack) => cellOf(stack, maxCols));
    const rigid = cells.every((c) => c.walls);
    const ranked = cells.filter((c) => !c.walls);
    const walls = cells.filter((c) => c.walls);
    return {
      cells,
      // A row of nothing but walls cannot use extra height, so it never takes a share of it.
      rigid,
      need: Math.max(...cells.map((c) => c.need)),
      // What a flexible row draws from the shared unit: its hungriest ranked cell's weighted row
      // count, and that cell's own header/rule overhead.
      demand: rigid ? 0 : Math.max(...ranked.map((c) => c.weighted)),
      fixed: rigid ? 0 : Math.max(...ranked.map((c) => c.fixed)),
      // A wall cell beside a ranked one in the same row never grows, so its height has to be
      // *reserved*, not shared — but the two sit at the *same* row height rather than stacking, so
      // the row only has to clear whichever one needs more, not both added together. Kept apart
      // from `fixed` (which only the ranked side feeds) so this stays a `Math.max` at the row
      // level, not a second addend the ranked cell's own growth would pile on top of.
      wallFloor: rigid ? 0 : walls.reduce((m, c) => Math.max(m, c.need), 0),
    };
  });

  // TIER_WEIGHT makes an earlier flexible row taller than a later one — the hierarchy a stacked
  // cell gives its own tiers, carried across rows too, so a data.mjs with no `row:` at all (every
  // tier its own row, the sheet's original shape) still tapers top to bottom. Position is counted
  // over flexible rows only: a rigid row never draws from the shared unit, so it never occupies a
  // rung of the ladder either.
  const flexCount = built.filter((r) => !r.rigid).length;
  let seen = 0;
  const plan = built.map((r) => {
    if (r.rigid) return r;
    const weight = TIER_WEIGHT ** (flexCount - 1 - seen);
    seen += 1;
    return { ...r, weight };
  });

  // The band's floor is every row at the shared unit's own minimum (MIN_RANK_UNIT), which is
  // rowHeight's job — so a wall-heavy row contributes its wall's need and nothing more. Summed row
  // by row rather than folded into one weighted total: a `Math.max` doesn't distribute over a sum,
  // and a wall-bound row's floor must only ever raise its own row, never eat another row's share.
  const rowFloors = plan.reduce((s, r) => s + rowHeight(r, MIN_RANK_UNIT), 0);
  const bandFloor =
    p.bandRule +
    Math.ceil(
      Math.max(
        p.featured ? HDR_H + p.featRows * FEAT_ROW_MIN : 0,
        plan.length > 0 ? rowFloors + Math.max(0, plan.length - 1) * DIV : 0,
      ),
    );
  return { rankCols: cols, bandRowPlan: plan, bandFloor };
}

/**
 * RANK_COLS may be a number, or "auto": as many columns as RANK_COL_W wants (up to
 * RANK_COLS_MAX), but never so many that the ranked rows grow to rival the featured ones.
 * Splitting a tier into more columns makes each row *taller* (fewer rows share the same band),
 * and a sheet whose rank stops reading by size has lost its whole argument — so hierarchy wins
 * over row width.
 *
 * Each count is judged against the band *that count* would be handed — `bandOf(shape)`, not one
 * band measured once. On the fitting path the canvas fixes the band and every count sees the
 * same one; on the overflow path the band is the legibility floor, and the floor falls as the
 * columns rise (fewer rows per column need less height). Judging a wide split against the narrow
 * split's roomier floor passes it on a band it never gets, which is how a ranked title ends up
 * drawn at twice the size of the featured one above it.
 *
 * And against every ranked cell that *sets* a row's height, not against the band as one stack.
 * Each row divides its own height by its own cell's rows, so judging the band as a single column
 * of tiers (all it was before rows and cells) passes a count on a height no cell is drawn at.
 *
 * A cell shorter than the one beside it is deliberately not asked. Its rows are tall because its
 * neighbor's are, not because the band is generous, and the column count is a sheet-wide lever
 * that scales every cell together — it cannot pull one cell down without squeezing the rest, and
 * often cannot pull it down at all. Chasing that here is what drives the count to 1, which is the
 * narrowest, tallest, most croppable sheet on offer. `sheet()` caps such a cell's type instead;
 * this bound stays on what a wider or narrower split can genuinely change.
 */
function resolveRankCols(p, bandOf) {
  if (RANK_COLS !== "auto") return RANK_COLS;
  const want = Math.min(RANK_COLS_MAX, Math.max(1, Math.round(p.rightW / RANK_COL_W)));
  for (let cols = want; cols > 1; cols--) {
    const s = shape(p, cols);
    const bandH = bandOf(s);
    const { avail, featRowH } = bandParts(p, bandH);
    // No featured tier, or no band to speak of: hierarchy has no opinion, and reading one out of
    // negative heights would flip the comparison and collapse the sheet to a single column.
    if (featRowH <= 0 || avail <= 0) return want;
    const { bandRowHeights } = derive({ ...p, ...s }, bandH);
    const lastRow = s.bandRowPlan.length - 1;
    const clears = s.bandRowPlan.every((r, i) =>
      r.cells.every((c) => {
        // A wall cell types itself off its own `size:`, so the band's height never sets it.
        if (c.walls) return true;
        // A cell that does not fill its row is bound by its neighbor rather than by the band, and
        // is capped at the type instead — see this function's note above.
        if (c.weighted < r.demand) return true;
        // border-box: a non-last row's declared height already contains the rule under it, so what
        // its cells actually have to type into is what the rule leaves — the same content height
        // the markup divides by, or the bound would judge a height nothing is drawn at.
        const content = bandRowHeights[i] - (i < lastRow ? DIV : 0);
        return (content - c.fixed) / c.weighted <= hierCeiling(featRowH, c.weights);
      }),
    );
    if (clears) return cols;
  }
  // Nothing cleared, so every count here draws its top cell at the same capped size and the choice
  // is no longer about hierarchy at all — it is about how much air sits around that type. Extra
  // columns mean fewer, taller rows holding the same size text, so the widest split is also the
  // emptiest. Narrowing is only unaffordable when it costs canvas: a narrower split needs more
  // band, and past a point that is a taller sheet and the crop this whole solve exists to avoid.
  // So take the narrowest split the sheet already pays for — same canvas as `want`, tighter rows.
  const budget = bandOf(shape(p, want));
  for (let cols = 1; cols < want; cols++) {
    if (shape(p, cols).bandFloor <= budget) return cols;
  }
  return want;
}

/** Lay the data out against one candidate sheet width and report whether it fits */
function planAt(sheetW, { featured, walls, band }) {
  const sheetH = Math.round(sheetW / ASPECT);
  const inner = sheetW - 2 * GROUND - 2 * BW;
  const innerH = sheetH - 2 * GROUND - 2 * BW;

  // The featured column stops widening at FEAT_MAX_W: past that it is one column of titles in a
  // lot of space, and the ranked side uses the width better. Anything in the band claims that
  // side — a `row:`'d wall tier as much as a ranked one — so the split turns on the band being
  // occupied, not on there being a ranked tier: otherwise a band holding only a wall is handed
  // the 1px of width `rightW` floors at, with no room to lay a single column into.
  const split = featured && band.length > 0;
  const featW = featured
    ? split
      ? Math.min(Math.round(inner * FEAT_SPLIT), FEAT_MAX_W)
      : inner
    : 0;
  const rightW = Math.max(inner - featW, 1);

  const wallPlan = walls.map((tier, i) => {
    const size = WALL.sizes[Math.min(i, WALL.sizes.length - 1)];
    // A foot wall spans the whole sheet, so it is its own single cell. `cols:` overrides the
    // em-width split the same way it overrides the shared count in the band, under the same clamps.
    const cols = tierCols(
      tier,
      wallCols(tier.items.length, size * WALL.em, inner),
      cellColBudget(inner, 1),
    );
    const rows = Math.ceil(tier.items.length / cols);
    const rowH = Math.round(size * LINE);
    // A wall tier is the sheet's one auto-height box, so its padding and bottom rule *do* add on
    // top: header (its rule already inside HDR_H) + the 8px gap + rows (padding inside rowH) +
    // the tier's own padding-bottom + its rule.
    return { tier, size, cols, rows, rowH, height: HDR_H + 8 + rows * rowH + 10 + DIV };
  });
  const wallsH = wallPlan.reduce((sum, w) => sum + w.height, 0);

  const featRows = featured?.items.length ?? 0;

  const base = {
    sheetW,
    sheetH,
    inner,
    featW,
    rightW,
    wallPlan,
    wallsH,
    featured,
    featRows,
    bandRows: bandRows(band),
    // Only the featured layout wraps the band in a box of its own, and that box's bottom rule is
    // inside the height it is given — so with a featured tier the tiers get DIV less than bandH.
    bandRule: featured ? DIV : 0,
  };

  // The band takes whatever the masthead, the walls and the footer leave (the masthead's heavy
  // bottom rule is inside MAST_H — see the border-box note above). The featured row height and
  // then the ranked column count both follow from it, in that order — the column count needs to
  // know how tall a featured row ended up before it can avoid out-growing one.
  const bandH = innerH - MAST_H - wallsH - FOOT_H;
  // The canvas fixes the band here, so every candidate column count is offered the same one.
  const cols = resolveRankCols(base, () => bandH);
  const p = { ...base, ...shape(base, cols) };

  // Cells split their row's width between them, so a row holding more cells than `rightW` can give
  // MIN_COL_W each has no legible arrangement at this canvas however the columns are dealt. That is
  // a width problem, and this sheet answers width problems by getting wider — so it counts as a
  // miss and the search moves on, the same as missing the band's height floor.
  const crowded = base.bandRows.filter((tiers) => rowCells(tiers).length * MIN_COL_W > rightW);

  // A candidate width that cannot clear the band's legibility floor does not fit.
  return {
    ...p,
    ...derive(p, bandH),
    crowded,
    fits: bandH >= p.bandFloor && crowded.length === 0,
    clamped: false,
  };
}

/**
 * No candidate width fits: keep the widest canvas, give the band exactly its floor and let the
 * sheet run past the target ratio. A sheet a little taller than 16:9 still renders and still
 * escapes the crop; one whose rows are squeezed below the floor is unreadable either way.
 *
 * The column count is re-resolved here because the band changes underneath it: the candidate was
 * rejected precisely because its band was too small, and deciding the split against that band
 * rules out exactly the wider splits that would have made this sheet shorter. Here the band is
 * whatever floor the count itself produces, so each count is offered its own floor and the one
 * that comes back is already consistent with the sheet it gets.
 */
function overflow(p) {
  const cols = resolveRankCols(p, (s) => s.bandFloor);
  const re = { ...p, ...shape(p, cols) };
  const band = derive(re, re.bandFloor);
  const sheetH = 2 * GROUND + 2 * BW + MAST_H + band.bandH + re.wallsH + FOOT_H;
  return { ...re, ...band, sheetH, clamped: true };
}

/**
 * The widths to try, narrowest first. Always ends on exactly MAX_W, whether or not STEP divides
 * the range — the last candidate is the canvas an overflowing sheet falls back to, and it should
 * be the widest one allowed rather than wherever the steps happened to stop. That also means a
 * MIN_W left above MAX_W renders at MAX_W instead of leaving the solver with no plan at all.
 */
function candidateWidths() {
  const widths = [];
  for (let w = MIN_W; w < MAX_W; w += Math.max(1, STEP)) widths.push(w);
  widths.push(MAX_W);
  return widths;
}

/**
 * Solve the canvas: the narrowest width whose ASPECT height holds the data. Pass `source` to
 * plan a different dataset than the project's own (the tests do this).
 */
export function geometry(source = data) {
  const parts = partition(source);
  let plan;
  for (const w of candidateWidths()) {
    plan = planAt(w, parts);
    if (plan.fits) return { ...plan, cropRisk: false };
  }
  // Overflow can rescue a band that is too *short* — it just lets the sheet run taller. It cannot
  // rescue one that is too *narrow*: the widest canvas is already on the table. Say so here, where
  // the row and the remedy are both still in hand, rather than letting the sheet get all the way
  // into fitSpan and die there on a negative width with nothing but a title to point at.
  if (plan.crowded.length > 0) {
    const [tiers] = plan.crowded;
    const names = rowCells(tiers)
      .map((stack) => stack.map((t) => t.name).join(" + "))
      .join(" | ");
    throw new Error(
      `banzuke data.mjs: band row [${names}] stands ${rowCells(tiers).length} cells side by side, ` +
        `which leaves under ${MIN_COL_W}px a column even at the ${MAX_W}px maximum width. Give ` +
        "some of those tiers the same column: so they stack instead, move one to another row:, " +
        "or raise MAX_W.",
    );
  }
  const over = overflow(plan);
  return { ...over, cropRisk: over.sheetW / over.sheetH < SAFE_ASPECT };
}

// ---- Scoring a layout ----
// geometry() says what fits; it does not say whether the fit is any good. Three implementers on
// this branch each eyeballed a render and called it "unchanged" or "fine" and were wrong — a 13px
// row-height swing, a 1px type change, a sheet gone croppable. report() puts a number on the things
// the eye is bad at: how much of the canvas is ink, whether the rank still reads by size, and which
// cells are spending their box on air instead of type. Compare two candidate data.mjs edits by
// this, not by squinting at two PNGs.

// The transform group is optional: fitSpan (lib/fit-span.mjs) only emits `transform:scaleX(…)`
// when the scale isn't 1 — the common case for text that fits without shrinking or stretching, the
// masthead title included — so a regex that required it silently skipped that span's ink. Report
// it as unscaled (default 1) rather than drop it.
const SPAN =
  /<span style="[^"]*?font-size:([\d.]+)px;font-weight:(\d+);font-family:'([^']+)';letter-spacing:([-\d.]+)px;(?:transform:scaleX\(([\d.]+)\);)?">([^<]*)<\/span>/g;

/** The featured column's own ramp, needed by both the ladder and the per-cell cap below it. */
const featuredRamp = (g) => (g.featured ? tierSizes("featured", g.featRowH, g.featRows) : null);

/**
 * Walks the band the way groupColumns() draws it — per row, per cell, per tier in its stack —
 * recomputing only the same rowH/unit/height arithmetic and feeding it to the same tierSizes() call
 * rankedTier() makes. The ladder and the slack/fill report both read off this once, so neither can
 * independently drift from what sheet() actually draws.
 *
 * Each entry carries its `row` index, because where a cell sits decides what it may be compared
 * with: rows stack, cells within a row stand side by side.
 */
function bandCells(g) {
  const featLast = featuredRamp(g)?.at(-1) ?? Number.POSITIVE_INFINITY;
  return g.bandRowPlan.flatMap((row, ri) => {
    const lastRow = ri === g.bandRowPlan.length - 1;
    const rowH = g.bandRowHeights[ri] - (lastRow ? 0 : DIV);
    const maxCols = cellColBudget(g.rightW, row.cells.length);
    return row.cells.map((cell, ci) => {
      if (cell.walls) {
        // A wall types itself off its own `size:`, flat top to bottom, and never stretches to fill
        // the row — so it has a ladder rung but no meaningful fill (see slackOf below).
        const tiers = cell.stack.map((tier, j) => ({
          tier,
          from: cell.walls[j].size,
          to: cell.walls[j].size,
          fill: null,
        }));
        return { cell, row: ri, beside: ci > 0, got: rowH, tiers };
      }
      const unit = (rowH - cell.fixed) / cell.weighted;
      const tiers = cell.stack.map((tier, j) => {
        const height = HDR_H + Math.round(cell.rows[j] * cell.weights[j] * unit);
        const rowBoxH = (height - HDR_H) / cell.rows[j];
        const sizes = tierSizes("ranked", rowBoxH, tier.items.length, featLast);
        // The line box a row's text actually draws, over the box the row is drawn in — see
        // report()'s doc comment for why this, and not slack, is what finds a starved cell. `cols`
        // rides along so slackOf can tell whether pinning it lower is a real lever for this tier or
        // a no-op (see the doc comment there): a tier already at its floor of 1 has no more rows to
        // gain by pinning, so a box that is still generous there is TYPE.ranked.cap's doing, not a
        // neighbour's.
        return {
          tier,
          from: sizes[0],
          to: sizes.at(-1),
          fill: (sizes[0] * LINE) / rowBoxH,
          cols: tierCols(tier, g.rankCols, maxCols),
        };
      });
      return { cell, row: ri, beside: ci > 0, got: rowH, tiers };
    });
  });
}

/**
 * One rung per tier that draws text, top to bottom: featured, the band cells in draw order, then
 * the foot walls — the same order sheet() lays them out in.
 *
 * The band is a grid, not a chain, so the order alone does not say what a rung may be measured
 * against. Each rung carries `above`: the size it genuinely sits under on the sheet. Within a
 * stack that is the tier above it. For the top of a cell it is the whole row above — a band row
 * spans the full width, so its smallest type is what the next row down has to stay under — or, in
 * the first row, the featured column's last line, the bound every ranked tier owes. A foot wall
 * sits under the entire band, so it answers to the last band row the same way.
 *
 * `beside` marks a rung that stands *next* to the one printed before it rather than under it. Two
 * cells in a row are side by side and comparing their sizes says nothing at all, which is what the
 * old flat chain did — and it reported an inversion on every correct two-cell sheet.
 */
function ladderOf(g) {
  const feat = featuredRamp(g);
  const featLast = feat?.at(-1) ?? null;
  const ladder = feat
    ? [{ name: g.featured.name, from: feat[0], to: feat.at(-1), above: null, beside: false }]
    : [];
  const cells = bandCells(g);
  const rowFloor = (ri) => {
    const inRow = cells.filter((c) => c.row === ri).flatMap((c) => c.tiers.map((t) => t.to));
    return inRow.length > 0 ? Math.min(...inRow) : featLast;
  };
  for (const { row, beside, tiers } of cells) {
    tiers.forEach((t, j) => {
      ladder.push({
        name: t.tier.name,
        from: t.from,
        to: t.to,
        above: j > 0 ? tiers[j - 1].to : row > 0 ? rowFloor(row - 1) : featLast,
        beside: beside && j === 0,
      });
    });
  }
  let above = g.bandRowPlan.length > 0 ? rowFloor(g.bandRowPlan.length - 1) : featLast;
  for (const w of g.wallPlan) {
    ladder.push({ name: w.tier.name, from: w.size, to: w.size, above, beside: false });
    above = w.size;
  }
  return ladder;
}

/**
 * Per band cell: `got` (the row's height) against `need` catches a cell shorter than its row — and
 * only a wall cell can be. A wall's height is exactly its lines and nothing more (bandCells' `got`
 * for it), so `need` is `cell.need`, its real content height, and a gap between the two is genuine
 * blank paper below the wall. A ranked cell has no such fixed requirement: bandCells' own `unit`
 * stretches it to fill the row exactly, whatever its rank has earned, so `need` is `got` and its
 * slack is always 0 — the row is, by construction, never short of that cell.
 *
 * That is exactly why slack alone misses the more common failure: a ranked cell squeezed *tall* by
 * a bigger neighbour in the same row is never short of its row, so slack cannot see it. `fill` — the
 * drawn line box over the row box, from bandCells — is what catches it instead: a small tier handed
 * a big neighbour's row height still types no larger than its cap allows, leaving most of that
 * height as leading. In the swept family behind this task, 142 of 148 such cells sat under 0.3 fill.
 *
 * `cols` (of the tier with the worst fill, ties broken toward the first) is what tells the two
 * starved causes apart, because the fix only exists for one of them. When that tier's own resolved
 * column count is above 1, pinning it lower buys real rows — the row's height is fixed by something
 * else in the row (a taller neighbour, most often), so more rows means a shorter box per row, same
 * capped type, higher fill; that is the free remedy this task is named for. When it is already 1,
 * every item already has its own row and there is no lower to pin — the box is generous because
 * `TYPE.ranked.cap` (or the featured tier's last row) caps the type below what even this cell's own
 * modest row count would otherwise draw, and no `cols:` change touches that.
 */
function slackOf(g) {
  return bandCells(g).map(({ cell, got, tiers }) => {
    const need = cell.walls ? cell.need : got;
    const worst = cell.walls ? null : tiers.reduce((a, b) => (b.fill < a.fill ? b : a));
    return {
      name: cell.stack.map((t) => t.name).join(" + "),
      need,
      got,
      slack: got - need,
      fill: worst?.fill ?? null,
      cols: worst?.cols ?? null,
    };
  });
}

// A cell's type filling less than this share of its row's line box reads as bare paper rather than
// a deliberate small tier. Measured across the family of shapes this was tuned on, a healthy cell
// fills about 0.78 of its line box and a starved one 0.14–0.29, so 0.3 splits them with room to
// spare on both sides.
const STARVED_FILL = 0.3;

// Slack under this is the rounding left over from dealing a band out in whole pixels, not a gap
// anyone can see, so it is not worth a line of report.
const SLACK_PX = 20;

/**
 * The band's rows against the band itself. Their heights are dealt from exactly what the band has
 * to give (`bandH`, less the band's own rule), so the two should agree to the pixel. Positive means
 * the rows add up past their box and takumi settles it by cutting whatever falls off the bottom;
 * negative means blank paper inside the band that no row claims — a rigid wall row is the usual
 * cause, since it cannot grow into the slack and nothing else in the band can take it either.
 *
 * Worth checking rather than eyeballing: neither shows up in a canvas-fill check (the sheet still
 * measures exactly `sheetH`), and geometry() reports finite, plausible numbers through both.
 */
const bandResidue = (g) => g.bandRowHeights.reduce((sum, h) => sum + h, 0) - (g.bandH - g.bandRule);

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
    // The span holds esc()'d text, so what is captured here is HTML-escaped: an "&" reads as the
    // five glyphs of "&amp;". takumi decodes it back before drawing (see lib/entities.mjs), so
    // measuring the escaped form counts ink the sheet never puts down — a title full of ampersands
    // scored half again as much as it draws.
    const w = await measureWidth(decodeHtmlEntities(text), {
      size: Number(size),
      weight: Number(weight),
      family,
      letterSpacing: Number(ls),
    });
    // scale is undefined when the span carried no transform at all, i.e. it drew at its natural
    // (unsquashed, unstretched) width — scale 1, not the NaN `Number(undefined)` would give.
    const s = scale === undefined ? 1 : Number(scale);
    ink += w * s * Number(size);
    if (s < 1) squeeze += 1;
  }
  return {
    canvas: [g.sheetW, g.sheetH],
    ratio: g.sheetW / g.sheetH,
    clamped: g.clamped,
    cropRisk: g.cropRisk,
    coverage: ink / (g.sheetW * g.sheetH),
    ladder: ladderOf(g),
    slack: slackOf(g),
    bandResidue: bandResidue(g),
    squeeze,
  };
}

/**
 * `name from→to`, joined by ` > ` where the rung sits under the previous one and ` | ` where it
 * stands beside it in the same band row. `!>` marks a rung typing bigger than what is genuinely
 * above it (`above` in ladderOf) — the inversion the hierarchy bound and the per-cell cap both
 * exist to prevent. A new cell that inverts prints both: ` | !> `.
 */
function formatLadder(ladder) {
  return ladder
    .map((rung, i) => {
      // `beside` picks the separator — `|` for a cell to the right, `>` for anything below — and
      // `!>` stands in for `>` (and follows `|`) wherever the rung out-types what is above it.
      const inverted = rung.above !== null && rung.above < rung.from;
      const marks = [];
      if (i > 0 && rung.beside) marks.push("|");
      if (i > 0 && inverted) marks.push("!>");
      else if (i > 0 && !rung.beside) marks.push(">");
      const joiner = marks.length > 0 ? ` ${marks.join(" ")} ` : "";
      return `${joiner}${rung.name} ${rung.from}→${rung.to}`;
    })
    .join("");
}

// ---- The whole sheet ----

export async function sheet() {
  const g = geometry(data);
  const { tiers, numbered, featured, band: bandTiers } = partition(data);
  const total = tiers.reduce((sum, t) => sum + t.items.length, 0);

  // Running numbers (featured → ranked, numbered in data order)
  const startRank = new Map();
  let next = 1;
  for (const t of numbered) {
    if (t.numbers === false) continue; // data.mjs opt-out: laid out by rank, but not numbered
    startRank.set(t, next);
    next += t.items.length;
  }

  // Generation date ("YYYY-MM-DD edition") — always stamp which version the sheet is
  const now = new Date();
  const pad2 = (n) => String(n).padStart(2, "0");
  const dateLabel = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} edition`;

  // Labels at the right of the masthead. The style feeds both the measurement and the inline
  // style (if they disagree, the width is wrong)
  const labels = [
    { text: `${total} ${data.unit}`, size: 13, weight: 700, letterSpacing: 3.4 },
    {
      text: dateLabel,
      size: 10,
      weight: 700,
      letterSpacing: 1.5,
      style: `margin-top:3px;color:${T.muted};`,
    },
  ];
  // Measure the labels first so the title's available width is settled
  const countW =
    Math.ceil(Math.max(...(await Promise.all(labels.map((l) => measureWidth(l.text, l)))))) +
    2 * MAST_PAD +
    BW;
  const titleSpan = await fitT(data.title, {
    size: 36,
    avail: g.inner - 2 * MAST_PAD - countW,
    stretch: 1,
    letterSpacing: -0.72,
  });

  // The featured column's own sizes, needed before the band because the band is typed against
  // them: its last row is the largest any ranked title is allowed to be. Read from the ramp that
  // is actually drawn rather than re-derived from the knobs, so the two cannot round apart by the
  // pixel that turns "equal to" into "bigger than". No featured tier, nothing to outrank.
  const featSizes = featured ? tierSizes("featured", g.featRowH, g.featRows) : [];
  const featLast = featured ? featSizes.at(-1) : Number.POSITIVE_INFINITY;

  // An empty band still costs `g.bandH`, but `planAt()` gives the featured column the whole width
  // when there is nothing to share it with, leaving `g.rightW` at the 1px it floors at. Skip the
  // right side entirely on that shape rather than let `wallTier` divide a sliver into columns and
  // fail on a negative width — the same condition the width was split on.
  const bandRight = !featured || bandTiers.length > 0;
  const groupColumns = bandRight
    ? await Promise.all(
        g.bandRowPlan.map(async (r, ri) => {
          const lastRow = ri === g.bandRowPlan.length - 1;
          // border-box again: bandRowHeights[ri] already reserves this row's own rule (see
          // derive()), so the row's declared height stays the full value — only the *content* math
          // below (cell widths, the ranked unit) works off what the rule leaves behind.
          const boxH = g.bandRowHeights[ri];
          const rowH = boxH - (lastRow ? 0 : DIV);
          // The row's cells share its width in proportion to how many columns each one draws — the
          // same `tierCols` the geometry divided their heights by (down to the same per-row budget),
          // so the width dealt here and the columns `rankedTier` draws cannot come apart.
          const colsOf = (t) => tierCols(t, g.rankCols, cellColBudget(g.rightW, r.cells.length));
          // A stack's own demand is the *widest* of its tiers, not their total: every tier in a
          // stack is drawn at the full cell width with its own `cols:`, one under the other, so
          // three single-column tiers stacked still only need one column's worth of width.
          const weightOf = (c) => Math.max(...c.stack.map(colsOf));
          const totalCols = r.cells.reduce((sum, c) => sum + weightOf(c), 0);
          let used = 0;
          const cells = await Promise.all(
            r.cells.map(async (cell, i) => {
              const lastCell = i === r.cells.length - 1;
              const w = lastCell
                ? g.rightW - used
                : Math.floor((g.rightW * weightOf(cell)) / totalCols);
              used += w;
              const cellRule = lastCell ? "" : `border-right:${DIV}px solid ${T.ink};`;
              const cellW = w - (lastCell ? 0 : DIV);
              // A wall stack keeps its own height; a ranked stack divides the row by weight.
              const unit = cell.walls ? 0 : (rowH - cell.fixed) / cell.weighted;
              // Every cell of a row is handed the same height, so a cell holding fewer rows than
              // the one beside it gets more height per row than its rank has earned — enough to
              // out-type the featured column, which is the one thing this sheet may not do.
              // `resolveRankCols` cannot fix that: the column count scales every cell at once, so
              // splitting until the short cell behaves squeezes the whole sheet (and, past a
              // point, only makes it taller). The bound is applied to the type here instead, per
              // cell, where the imbalance actually is.
              //
              // One ceiling for every tier in the stack, not a per-tier share of it: the promise is
              // only that no ranked title out-types the featured column's last row, which a lower
              // tier drawn at exactly that size keeps. Tapering the ceiling down the stack as well
              // compounds with the taper tierSizes already applies inside each tier, and a third
              // level lands around 7px — illegible, and below the floor MIN_RANK_UNIT exists to
              // hold. Where the ceiling does not bind, the stack's own weights still taper it.
              const blocks = await Promise.all(
                cell.stack.map((tier, j) =>
                  cell.walls
                    ? wallTier(tier, cell.walls[j].size, cell.walls[j].cols, cellW, false)
                    : rankedTier({
                        tier,
                        startRank: startRank.get(tier),
                        height: HDR_H + Math.round(cell.rows[j] * cell.weights[j] * unit),
                        maxSize: featLast,
                        width: cellW,
                        cols: colsOf(tier),
                        isLast: j === cell.stack.length - 1,
                      }),
                ),
              );
              return `<div style="width:${w}px;flex:none;display:flex;flex-direction:column;${cellRule}">${blocks.join("")}</div>`;
            }),
          );
          // The rule between two rows belongs to the upper one, and border-box puts it inside the
          // declared height (boxH already carries it — see derive()), so drawing it costs the row's
          // content nothing. The last row has nothing under it to be separated from.
          const rowRule = lastRow ? "" : `border-bottom:${DIV}px solid ${T.ink};`;
          const sizing = `height:${boxH}px;flex:none;${rowRule}`;
          return `<div style="${sizing}display:flex;min-height:0">${cells.join("")}</div>`;
        }),
      )
    : [];

  let band = "";
  if (featured) {
    const featColumn = await rowColumn({
      items: featured.items,
      startRank: startRank.get(featured),
      sizes: featSizes,
      colW: g.featW - DIV,
      color: featured.color ?? T.accent,
      stretch: TYPE.featured.stretch,
    });
    const border = bandRight ? `border-right:${DIV}px solid ${T.ink};` : "";
    const rightSide = bandRight
      ? `<div style="width:${g.rightW}px;display:flex;flex-direction:column">${groupColumns.join("")}</div>`
      : "";
    band = `<div style="height:${g.bandH}px;flex:none;display:flex;border-bottom:${DIV}px solid ${T.ink}">
      <div style="width:${g.featW}px;flex:none;display:flex;flex-direction:column;${border}">
        ${tierHeader(featured.name, featured.items.length)}
        ${featColumn}
      </div>
      ${rightSide}
    </div>`;
  } else {
    band = groupColumns.join("");
  }

  const wallBlocks = await Promise.all(
    g.wallPlan.map((w) => wallTier(w.tier, w.size, w.cols, g.inner)),
  );

  // With neither a featured nor a ranked tier, nothing above claims g.bandH — band is "". On a
  // canvas pinned to a fixed height that would otherwise show up as a blank stripe below the
  // walls, stranding the footer partway up the sheet instead of at the bottom. Give the walls
  // flex:1 so they claim it instead, with the leftover spread *between* them via space-between:
  // the first wall stays flush under the masthead — top-anchored like every other tier on the
  // sheet — the last one sits flush against the footer, and the gap collects where there's more
  // than one wall tier to put it between, rather than floating the whole block in the middle.
  const wallsBlock =
    numbered.length === 0
      ? `<div style="flex:1;display:flex;flex-direction:column;justify-content:space-between;min-height:0">${wallBlocks.join("")}</div>`
      : wallBlocks.join("");

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
    ${wallsBlock}
    <div style="height:${FOOT_H}px;flex:none;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:${T.weight};letter-spacing:2.2px;color:${T.muted}">banzuke</div>
  </div>
</div>`;
}

// ---- Entry point: this runs on `node banzuke.mjs` / `bun banzuke.mjs` / `deno task render` ----
// It does not run when imported (i.e. when a variant script or your own driver calls sheet()).
// --draft renders a dpr 1 draft (~3× faster). For the fine-tuning loop only — always finish
// with a normal run.
// --report scores the current data.mjs instead of rendering it — no PNG, no HTML file — so two
// candidate layouts can be compared on measurement before spending a render on either.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--report")) {
    const r = await report();
    const ratio = r.ratio.toFixed(2);
    console.log(
      `${r.canvas[0]}×${r.canvas[1]} (${ratio}:1)${r.clamped ? ", clamped" : ""}` +
        `${r.cropRisk ? ", CROP RISK" : ""}`,
    );
    console.log(`coverage: ${(r.coverage * 100).toFixed(1)}% of the canvas is ink`);
    console.log(`ladder: ${formatLadder(r.ladder)}`);
    if (r.bandResidue > 0) {
      console.log(
        `band: the rows add up to ${r.bandResidue}px MORE than the band holds — whatever falls ` +
          "past the bottom is being cut off. This is a bug in the height math, not a knob.",
      );
    } else if (r.bandResidue < 0) {
      console.log(
        `band: ${-r.bandResidue}px of the band is blank paper no row claims — a rigid wall row ` +
          "cannot grow into it and nothing else in the band can take it. Move a ranked tier into " +
          "that row, or give the wall more items.",
      );
    }
    for (const cell of r.slack.filter((c) => c.slack > SLACK_PX)) {
      console.log(
        `slack: "${cell.name}" got ${cell.got}px against a ${cell.need}px need ` +
          `(+${cell.slack}px unused)`,
      );
    }
    for (const cell of r.slack.filter((c) => c.fill !== null && c.fill < STARVED_FILL)) {
      // Two different causes read the same in fill, and only one has a free fix (see slackOf's doc
      // comment): a tier still above cols: 1 can be pinned lower to buy more, shorter rows; one
      // already at 1 has no rows left to gain, so the box is generous because TYPE.ranked.cap (or
      // the featured tier's last row) caps the type, not because a neighbour set the row height.
      const remedy =
        cell.cols > 1
          ? "pin cols: 1 on it in data.mjs to shrink its own row box without moving the canvas"
          : "already at cols: 1, so there is no lower to pin — its box is generous because " +
            "TYPE.ranked.cap (or the featured tier's last row) caps the type, not a neighbour; " +
            "raising that cap is the lever, not cols:";
      console.log(
        `starved: "${cell.name}" types at ${(cell.fill * 100).toFixed(1)}% of its row's line box — ${remedy}`,
      );
    }
    console.log(`squeeze: ${r.squeeze} title(s) drawn narrower than their natural width`);
  } else {
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
    // The rendering half of the job is the easy half. This line is the reminder that the sheet has
    // not been checked yet, printed where whoever ran it is already looking — a note in the docs
    // loses to a tool result every time.
    console.log(
      "Not done yet → open banzuke.png as an image and check it: is it densely filled,\n" +
        "are the margins aligned, does #1 read as the biggest thing? Fix, then re-run.",
    );
  }
}
