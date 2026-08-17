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
  sizes: [14, 11, 9.5], // wall font sizes (top wall first; the last one repeats if you run out)
  stretch: 2,
  em: 0.87, // rough column width (font size × em × 16px). ↓ yields more columns
};
// ===============================================

const titleOf = (item) => (typeof item === "string" ? item : item.title);
const lerp = (a, b, t) => a + (b - a) * t;

/** Font size gradient running from `from` at the top to `to` at the bottom */
const ramp = (from, to, n) =>
  Array.from({ length: n }, (_, i) => Math.round(lerp(from, to, n < 2 ? 0 : i / (n - 1))));

/** Derive the per-row font sizes inside a tier from the row height */
function tierSizes(kind, rowH, n) {
  const { cap, rowFill, taper } = TYPE[kind];
  const from = Math.min(cap, Math.round(rowH * rowFill));
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

/** One numbered row: spine, running number, title (fitSpan) */
async function row({ item, rank, size, colW, color, stretch, last }) {
  const rankSize = Math.max(10, size * 0.5);
  const rankW = Math.round(6 + 1.4 * rankSize);
  const avail = colW - SPINE - rankW - 8 - PAD;
  const span = await fitT(titleOf(item), { size, avail, stretch });
  const bb = last ? "" : `border-bottom:${SEP}px solid ${T.ink};`;
  return `<div style="flex:1;display:flex;align-items:center;min-height:0;overflow:hidden;border-left:${SPINE}px solid ${color};background:${T.bg};${bb}">
    <div style="width:${rankW}px;padding-left:6px;text-align:right;color:${T.muted};font-weight:${T.weight};font-size:${rankSize}px;line-height:1">${rank}</div>
    <div style="flex:1;min-width:0;overflow:hidden;padding:0 ${PAD}px 0 8px;line-height:${LINE}">${span}</div>
  </div>`;
}

/** One column of stacked rows (flex spreads the row heights evenly) */
async function rowColumn({ items, startRank, sizes, colW, color, stretch }) {
  const rows = await Promise.all(
    items.map((item, i) =>
      row({
        item,
        rank: startRank + i,
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

/** ranked tier: header + items dealt column-major into `cols` columns */
async function rankedTier({ tier, startRank, height, width, cols: rankCols, isLast }) {
  const n = tier.items.length;
  const cols = Math.min(rankCols, Math.max(1, n));
  const rows = Math.ceil(n / cols); // tallest column, which is what sets the row height
  const sizes = tierSizes("ranked", (height - HDR_H) / rows, n);
  const colW = width / cols;
  const color = tier.color ?? T.accent;
  const start = colSplit(n, cols);
  const columns = await Promise.all(
    Array.from({ length: cols }, (_, c) =>
      rowColumn({
        items: tier.items.slice(start(c), start(c + 1)),
        startRank: startRank + start(c),
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
async function wallTier(tier, size, cols, inner) {
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
      const rule = c > 0 ? `border-left:${SEP}px solid ${T.rule};padding-left:${gutter}px;` : "";
      const pr = c < cols - 1 ? `padding-right:${gutter}px;` : "";
      return `<div style="flex:1;min-width:0;${rule}${pr}">${items.join("")}</div>`;
    }),
  );
  return `<div style="border-bottom:${DIV}px solid ${T.ink};padding-bottom:10px">
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
    ranked: numbered.filter((t) => t !== featured),
    band: tiers.filter((t) => t !== featured && (t.layout !== "wall" || t.row !== undefined)),
    walls: tiers.filter((t) => t.layout === "wall" && t.row === undefined),
  };
}

/** A band wall's own height: it is content-driven, not a share of the band */
function bandWallPlan(tier, cols) {
  const size = tier.size ?? WALL.sizes[0];
  const rows = Math.ceil(tier.items.length / cols);
  const rowH = Math.round(size * LINE);
  // Same border-box budget as the walls at the foot of the sheet: each row's 1px padding is
  // inside rowH, while the block's own padding-bottom and rule sit outside its auto height.
  return { size, cols, rows, rowH, height: HDR_H + 8 + rows * rowH + 10 };
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
 * RANK_COLS may be a number, or "auto": as many columns as RANK_COL_W wants (up to
 * RANK_COLS_MAX), but never so many that the ranked rows grow to rival the featured ones.
 * Splitting a tier into more columns makes each row *taller* (fewer rows share the same band),
 * and a sheet whose rank stops reading by size has lost its whole argument — so hierarchy wins
 * over row width.
 *
 * Each count is judged against the band *that count* would be handed — `band(cols)`, not one
 * band measured once. On the fitting path the canvas fixes the band and every count sees the
 * same one; on the overflow path the band is the legibility floor, and the floor falls as the
 * columns rise (fewer rows per column need less height). Judging a wide split against the narrow
 * split's roomier floor passes it on a band it never gets, which is how a ranked title ends up
 * drawn at twice the size of the featured one above it.
 */
function resolveRankCols({ rightW, band, ranked, rankedFixed }) {
  if (RANK_COLS !== "auto") return RANK_COLS;
  const want = Math.min(RANK_COLS_MAX, Math.max(1, Math.round(rightW / RANK_COL_W)));
  if (ranked.length === 0) return want;
  for (let cols = want; cols > 1; cols--) {
    const { avail, featRowH } = band(cols);
    // No featured tier, or no band to speak of: hierarchy has no opinion, and reading one out of
    // negative heights would flip the comparison and collapse the sheet to a single column.
    if (featRowH <= 0 || avail <= 0) return want;
    const { weighted, weights } = rankedShape(ranked, cols);
    if ((avail - rankedFixed) / weighted <= hierCeiling(featRowH, weights)) return cols;
  }
  return 1;
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

/** The band-height-dependent half of a plan, split out so the overflow path can redo it */
function derive(p, bandH) {
  const { avail, featRowH } = bandParts(p, bandH);
  const plan = p.bandRowPlan ?? [];
  const gaps = Math.max(0, plan.length - 1) * DIV;
  // Rigid rows keep exactly what they asked for. What's left is one shared unit, spent by every
  // flexible row on its own weighted demand — the same single `unit` the sheet always divided its
  // ranked tiers by, just read per row now that a row can hold more than one tier.
  const unit =
    p.weightedDemand > 0 ? Math.max(0, avail - p.fixedH - p.rigidH - gaps) / p.weightedDemand : 0;
  return {
    bandH,
    featRowH,
    unit,
    bandRowHeights: plan.map(
      (r, i) =>
        (r.rigid ? r.need : r.fixed + Math.round(r.demand * r.weight * unit)) +
        (i < plan.length - 1 ? DIV : 0),
    ),
  };
}

/**
 * The column-count-dependent half of a plan: how the ranked tiers deal out over `cols`, and the
 * band height below which the sheet stops being legible (featured rows on the left, ranked rows
 * on the right, whichever needs more). Rounded up to a whole pixel: an overflowing sheet is sized
 * from this floor, and a fractional canvas height cannot be filled exactly.
 */
function shape(p, cols) {
  const colsOf = (t) => Math.min(t.cols ?? cols, Math.max(1, t.items.length));

  // A cell is one stack of tiers. Ranked stacks share whatever height the row gets; a wall stack
  // is worth exactly what its lines add up to, so it asks for that and no more.
  const cellOf = (stack) => {
    if (stack.every((t) => t.layout === "wall")) {
      const walls = stack.map((t) => bandWallPlan(t, colsOf(t)));
      return { stack, walls, need: walls.reduce((s, w) => s + w.height, 0) };
    }
    const rows = stack.map((t) => Math.ceil(t.items.length / colsOf(t)));
    const weights = stack.map((_, i) => TIER_WEIGHT ** (stack.length - 1 - i));
    const weighted = rows.reduce((s, r, i) => s + r * weights[i], 0);
    const fixed = stack.length * HDR_H + Math.max(0, stack.length - 1) * DIV;
    return { stack, rows, weights, weighted, fixed, need: fixed + weighted * MIN_RANK_UNIT };
  };

  // Within a row, tiers sharing a `column:` stack inside one cell; the cells stand side by side.
  const built = p.bandRows.map((tiers) => {
    const byCol = new Map();
    tiers.forEach((t, i) => {
      const k = t.column ?? `_${i}`;
      if (!byCol.has(k)) byCol.set(k, []);
      byCol.get(k).push(t);
    });
    const cells = [...byCol.values()].map(cellOf);
    const rigid = cells.every((c) => c.walls);
    const ranked = cells.filter((c) => !c.walls);
    return {
      tiers,
      cells,
      // A row of nothing but walls cannot use extra height, so it never takes a share of it.
      rigid,
      need: Math.max(...cells.map((c) => c.need)),
      // What a flexible row draws from the shared unit: its hungriest ranked cell's weighted row
      // count, and that cell's own header/rule overhead. A wall cell beside a ranked one in the
      // same row never grows, so it takes no part in either — `need` above already keeps the row
      // tall enough to hold it regardless.
      demand: rigid ? 0 : Math.max(...ranked.map((c) => c.weighted)),
      fixed: rigid ? 0 : Math.max(...ranked.map((c) => c.fixed)),
    };
  });

  // TIER_WEIGHT makes an earlier flexible row taller than a later one — the hierarchy a stacked
  // cell gives its own tiers, carried across rows too, so a data.mjs with no `row:` at all (every
  // tier its own row, the sheet's original shape) still tapers top to bottom. Position is counted
  // over flexible rows only: a rigid row never draws from the shared unit, so it never occupies a
  // rung of the ladder either.
  const flexCount = built.filter((r) => !r.rigid).length;
  let seen = 0;
  const rows = built.map((r) => {
    if (r.rigid) return r;
    const weight = TIER_WEIGHT ** (flexCount - 1 - seen);
    seen += 1;
    return { ...r, weight };
  });

  const rigidH = rows.reduce((s, r) => s + (r.rigid ? r.need : 0), 0);
  const fixedH = rows.reduce((s, r) => s + (r.rigid ? 0 : r.fixed), 0);
  const weightedDemand = rows.reduce((s, r) => s + (r.rigid ? 0 : r.demand * r.weight), 0);
  const bandFloor =
    p.bandRule +
    Math.ceil(
      Math.max(
        p.featured ? HDR_H + p.featRows * FEAT_ROW_MIN : 0,
        rows.length > 0
          ? fixedH + rigidH + weightedDemand * MIN_RANK_UNIT + Math.max(0, rows.length - 1) * DIV
          : 0,
      ),
    );
  return { rankCols: cols, bandRowPlan: rows, rigidH, fixedH, weightedDemand, bandFloor };
}

/** Lay the data out against one candidate sheet width and report whether it fits */
function planAt(sheetW, { featured, ranked, walls, band }) {
  const sheetH = Math.round(sheetW / ASPECT);
  const inner = sheetW - 2 * GROUND - 2 * BW;
  const innerH = sheetH - 2 * GROUND - 2 * BW;

  // The featured column stops widening at FEAT_MAX_W: past that it is one column of titles in a
  // lot of space, and the ranked side uses the width better.
  const split = featured && ranked.length > 0;
  const featW = featured
    ? split
      ? Math.min(Math.round(inner * FEAT_SPLIT), FEAT_MAX_W)
      : inner
    : 0;
  const rightW = Math.max(inner - featW, 1);

  const wallPlan = walls.map((tier, i) => {
    const size = WALL.sizes[Math.min(i, WALL.sizes.length - 1)];
    const cols = wallCols(tier.items.length, size * WALL.em, inner);
    const rows = Math.ceil(tier.items.length / cols);
    const rowH = Math.round(size * LINE);
    // A wall tier is the sheet's one auto-height box, so its padding and bottom rule *do* add on
    // top: header (its rule already inside HDR_H) + the 8px gap + rows (padding inside rowH) +
    // the tier's own padding-bottom + its rule.
    return { tier, size, cols, rows, rowH, height: HDR_H + 8 + rows * rowH + 10 + DIV };
  });
  const wallsH = wallPlan.reduce((sum, w) => sum + w.height, 0);

  const featRows = featured?.items.length ?? 0;
  const rankedFixed = ranked.length * HDR_H + Math.max(0, ranked.length - 1) * DIV;

  const base = {
    sheetW,
    sheetH,
    inner,
    featW,
    rightW,
    wallPlan,
    wallsH,
    featured,
    ranked,
    walls,
    featRows,
    rankedFixed,
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
  const cols = resolveRankCols({
    rightW,
    band: () => bandParts(base, bandH),
    ranked,
    rankedFixed,
  });
  const p = { ...base, ...shape(base, cols) };

  // A candidate width that cannot clear the band's legibility floor does not fit.
  return { ...p, ...derive(p, bandH), fits: bandH >= p.bandFloor, clamped: false };
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
  const cols = resolveRankCols({
    rightW: p.rightW,
    band: (c) => bandParts(p, shape(p, c).bandFloor),
    ranked: p.ranked,
    rankedFixed: p.rankedFixed,
  });
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
  const over = overflow(plan);
  return { ...over, cropRisk: over.sheetW / over.sheetH < SAFE_ASPECT };
}

// ---- The whole sheet ----

export async function sheet() {
  const g = geometry(data);
  const { tiers, numbered, featured, ranked } = partition(data);
  const total = tiers.reduce((sum, t) => sum + t.items.length, 0);

  // Running numbers (featured → ranked, numbered in data order)
  const startRank = new Map();
  let next = 1;
  for (const t of numbered) {
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

  // geometry() now plans the band as rows of cells (see bandRowPlan/bandRowHeights) so a
  // data.mjs `row:`/`column:` can rearrange it, but this renderer still only draws the shape the
  // sheet always had: one ranked tier per row, so `ranked[i]` and `bandRowHeights[i]` line up.
  const rankedBlocks = await Promise.all(
    ranked.map((tier, i) =>
      rankedTier({
        tier,
        startRank: startRank.get(tier),
        height: g.bandRowHeights[i],
        width: g.rightW, // the whole inner width when there is no featured column to share it with
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
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
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
