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
const FRAME = 1024; // width of the sheet itself
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
const FEAT_ROW_H = 58.8; // height of one featured row. Sets the height of the whole top band
const LONE_ROW_H = 44; // row height given to the top ranked tier when there is no featured tier
const MIN_RANK_UNIT = 22; // floor for one ranked row, so the right side survives a small featured tier
const RANK_COLS = 2; // columns per ranked tier (more columns = narrower rows = easier to squash)
const TIER_WEIGHT = 1.3; // multiplier making higher ranked tiers taller (↑ makes the top stand out)
const WALL = {
  sizes: [14, 11, 9.5], // wall font sizes (top wall first; the last one repeats if you run out)
  stretch: 2,
  em: 0.87, // rough column width (font size × em × 16px). ↓ yields more columns
};
// ===============================================

const INNER = FRAME - 2 * BW;
const SHEET_W = FRAME + 2 * GROUND;

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

/** ranked tier: header + items dealt column-major into RANK_COLS columns */
async function rankedTier({ tier, startRank, height, width, isLast }) {
  const n = tier.items.length;
  const cols = Math.min(RANK_COLS, Math.max(1, n));
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
async function wallTier(tier, size) {
  const names = tier.items.map(titleOf);
  const cols = wallCols(names.length, size * WALL.em);
  const start = colSplit(names.length, cols);
  const gutter = 8;
  const colW = (INNER - 2 * PAD - (cols - 1) * (2 * gutter + SEP)) / cols;
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
function wallCols(n, em) {
  const avail = INNER - 2 * PAD;
  const colw = em * 16;
  const gap = 16;
  const maxCols = Math.max(1, Math.floor((avail + gap) / (colw + gap)));
  return Math.ceil(n / Math.ceil(n / maxCols));
}

// ---- The whole sheet ----

export async function sheet() {
  const tiers = data.tiers.filter((t) => t.items.length > 0);
  const numbered = tiers.filter((t) => t.layout !== "wall");
  const walls = tiers.filter((t) => t.layout === "wall");
  const featured = numbered.find((t) => t.layout === "featured");
  const ranked = numbered.filter((t) => t !== featured);
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
    avail: INNER - 2 * MAST_PAD - countW,
    stretch: 1,
    letterSpacing: -0.72,
  });

  // Top band: the featured row count sets the height. On the right, ranked tiers share it
  // proportionally to rows × weight. The per-row `unit` has a MIN_RANK_UNIT floor, so a small
  // featured tier cannot squash the right side (any extra band height just lets the featured
  // rows grow via flex).
  const featRows = featured?.items.length ?? 0;
  const featW = ranked.length > 0 ? Math.round(INNER * FEAT_SPLIT) : INNER;
  const rightW = INNER - featW;

  const rankedRows = ranked.map((t) => Math.ceil(t.items.length / RANK_COLS));
  const rankedWeights = ranked.map((_, i) => TIER_WEIGHT ** (ranked.length - 1 - i));
  const weightedRows = rankedRows.reduce((sum, r, i) => sum + r * rankedWeights[i], 0);
  const rankedFixed = ranked.length * HDR_H + Math.max(0, ranked.length - 1) * DIV;
  const featBandH = Math.round(HDR_H + featRows * FEAT_ROW_H);
  const rawUnit = featured
    ? (featBandH - rankedFixed) / Math.max(1, weightedRows)
    : LONE_ROW_H / Math.max(...rankedWeights, 1);
  const unit = Math.max(rawUnit, MIN_RANK_UNIT);
  const rankedHeights = rankedRows.map(
    (r, i) => HDR_H + Math.round(r * rankedWeights[i] * unit) + (i < ranked.length - 1 ? DIV : 0),
  );

  const rankedBlocks = await Promise.all(
    ranked.map((tier, i) =>
      rankedTier({
        tier,
        startRank: startRank.get(tier),
        height: rankedHeights[i],
        width: featured ? rightW : INNER,
        isLast: featured ? i === ranked.length - 1 : false,
      }),
    ),
  );

  let band = "";
  if (featured) {
    const featColumn = await rowColumn({
      items: featured.items,
      startRank: startRank.get(featured),
      sizes: tierSizes("featured", FEAT_ROW_H, featRows),
      colW: featW - DIV,
      color: featured.color ?? T.accent,
      stretch: TYPE.featured.stretch,
    });
    // With no ranked tiers there is nothing on the right to size the band against — it is exactly
    // the featured column. (Deriving it from weightedRows there gives 0, which collapses the band
    // and drops the featured tier off the sheet entirely.)
    const bandH = ranked.length > 0 ? rankedFixed + Math.ceil(weightedRows * unit) : featBandH;
    const border = ranked.length > 0 ? `border-right:${DIV}px solid ${T.ink};` : "";
    const rightSide =
      ranked.length > 0
        ? `<div style="width:${rightW}px;display:flex;flex-direction:column">${rankedBlocks.join("")}</div>`
        : "";
    band = `<div style="height:${bandH}px;flex:none;display:flex;border-bottom:${DIV}px solid ${T.ink}">
      <div style="width:${featW}px;flex:none;display:flex;flex-direction:column;${border}">
        ${tierHeader(featured.name, featured.items.length)}
        ${featColumn}
      </div>
      ${rightSide}
    </div>`;
  } else {
    band = rankedBlocks.join("");
  }

  const wallBlocks = await Promise.all(
    walls.map((tier, i) => wallTier(tier, WALL.sizes[Math.min(i, WALL.sizes.length - 1)])),
  );

  return `<div style="width:${SHEET_W}px;background:${T.ground};padding:${GROUND}px;font-family:'${T.font}';color:${T.ink}">
  <div style="border:${BW}px solid ${T.ink};background:${T.bg};display:flex;flex-direction:column">
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
    <div style="padding:10px ${PAD}px;display:flex;justify-content:center;font-size:12px;font-weight:${T.weight};letter-spacing:2.2px;color:${T.muted}">banzuke</div>
  </div>
</div>`;
}

// ---- Entry point: this runs on `node banzuke.mjs` / `bun banzuke.mjs` / `deno task render` ----
// It does not run when imported (i.e. when a variant script or your own driver calls sheet()).
// --draft renders a dpr 1 draft (~3× faster). For the fine-tuning loop only — always finish
// with a normal run.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const draft = process.argv.includes("--draft");
  const out = await renderFile(await sheet(), `${import.meta.dirname}/banzuke.png`, {
    devicePixelRatio: draft ? 1 : 2,
    html: `${import.meta.dirname}/banzuke.html`,
  });
  console.log(`${out.width}×${out.height} px, ${out.ms}ms → ${out.path}${draft ? " (draft)" : ""}`);
  // The rendering half of the job is the easy half. This line is the reminder that the sheet has
  // not been checked yet, printed where whoever ran it is already looking — a note in the docs
  // loses to a tool result every time.
  console.log(
    "Not done yet → open banzuke.png as an image and check it: is it densely filled,\n" +
      "are the margins aligned, does #1 read as the biggest thing? Fix, then re-run.",
  );
}
