// Sample 1 — the default look: Bauhaus newsprint, heavy grotesque, primary-colour spines.
//
// Unlike the other five, this is not an independent design: it mirrors the layout of
// skills/banzuke/template/banzuke.mjs with the height pinned to the shared canvas. It cannot
// import that file (which registers its own font and imports its own data.mjs at load), so if
// you retune the template's knobs, retune them here too or the README stops depicting it.
import { esc, fitSpan, measureWidth } from "../../skills/banzuke/template/lib/index.mjs";
import data from "../../test/fixtures/sample-data.mjs";
import { CANVAS_H, CANVAS_W, columns, dateLabel, numbered, runIfMain, total } from "./kit.mjs";

const T = {
  bg: "#f4efe3",
  ink: "#14110d",
  muted: "#6b655a",
  ground: "#9c9384",
  rule: "rgba(20,17,13,0.25)",
  font: "Banzuke Sans",
  weight: 800,
};
const GROUND = 24;
const BW = 8;
const SPINE = 8;
const SEP = 2;
const DIV = 4;
const PAD = 14;
const MAST_H = 64;
const HDR_H = 24;
const LINE = 1.25;
const FOOT_H = 34;
const RANK_COLS = 2;
const TIER_WEIGHT = 1.3;

const INNER_W = CANVAS_W - 2 * GROUND - 2 * BW;
const INNER_H = CANVAS_H - 2 * GROUND - 2 * BW;

const fitT = (text, o) => fitSpan(text, { weight: T.weight, family: T.font, ...o });
const lerp = (a, b, t) => a + (b - a) * t;
const ramp = (from, to, n) =>
  Array.from({ length: n }, (_, i) => Math.round(lerp(from, to, n < 2 ? 0 : i / (n - 1))));

const header = (name, count) =>
  `<div style="height:${HDR_H}px;flex:none;display:flex;align-items:center;padding:0 ${PAD}px;border-bottom:${DIV}px solid ${T.ink}">
    <div style="font-size:13px;font-weight:${T.weight};letter-spacing:0.04em">${esc(name)}</div>
    <div style="margin-left:auto;font-size:14px;font-weight:${T.weight}">${count}</div>
  </div>`;

async function row({ item, size, colW, color, last }) {
  const rankSize = Math.max(10, size * 0.5);
  const rankW = Math.round(6 + 1.4 * rankSize);
  // The title box needs its height pinned, for the reason the wall rows below spell out: a
  // scaleX-squashed span still lays out at its natural width, so its box can take a second line
  // box, and a row centred with align-items:center then clips the glyphs top and bottom.
  const span = await fitT(item.title, {
    size,
    avail: colW - SPINE - rankW - 8 - PAD,
    stretch: 1.5,
  });
  const bb = last ? "" : `border-bottom:${SEP}px solid ${T.ink};`;
  return `<div style="flex:1;display:flex;align-items:center;min-height:0;overflow:hidden;border-left:${SPINE}px solid ${color};background:${T.bg};${bb}">
    <div style="width:${rankW}px;padding-left:6px;text-align:right;color:${T.muted};font-weight:${T.weight};font-size:${rankSize}px;line-height:1">${item.rank}</div>
    <div style="flex:1;min-width:0;height:${Math.round(size * LINE)}px;overflow:hidden;padding:0 ${PAD}px 0 8px;line-height:${LINE}">${span}</div>
  </div>`;
}

async function rowColumn(items, sizes, colW, color) {
  const rows = await Promise.all(
    items.map((item, i) =>
      row({ item, size: sizes[i], colW, color, last: i === items.length - 1 }),
    ),
  );
  return `<div style="flex:1;display:flex;flex-direction:column;min-width:0;min-height:0">${rows.join("")}</div>`;
}

async function rankedTier(tier, height, width, isLast) {
  const n = tier.items.length;
  const rows = Math.ceil(n / RANK_COLS);
  const from = Math.min(30, Math.round(((height - HDR_H) / rows) * 0.63));
  const sizes = ramp(from, Math.round(from * 0.78), n);
  // Split the size ramp with the same helper as the items, so the two cannot drift apart when
  // columns() hands back columns of unequal length.
  const sizeCols = columns(sizes, RANK_COLS);
  const cols = await Promise.all(
    columns(tier.items, RANK_COLS).map((chunk, c) =>
      rowColumn(chunk, sizeCols[c], width / RANK_COLS, tier.color),
    ),
  );
  const sizing = isLast
    ? "flex:1;"
    : `height:${height}px;flex:none;border-bottom:${DIV}px solid ${T.ink};`;
  return `<div style="${sizing}display:flex;flex-direction:column;min-height:0">
    ${header(tier.name, n)}
    <div style="flex:1;display:flex;min-height:0">${cols.join("")}</div>
  </div>`;
}

async function wall(tier, size, cols) {
  const gutter = 8;
  const colW = (INNER_W - 2 * PAD - (cols - 1) * (2 * gutter + SEP)) / cols;
  // One line per item — scaleX does not shrink the span's layout width, so a squashed title
  // still overflows the column and would otherwise take two line boxes (which is also what
  // wallH() below assumes it never does).
  const rowH = Math.round(size * LINE);
  const blocks = await Promise.all(
    columns(tier.items, cols).map(async (chunk, c) => {
      const lines = await Promise.all(
        chunk.map(async ({ title }) => {
          const span = await fitT(title, { size, avail: colW, stretch: 2 });
          return `<div style="height:${rowH}px;padding:1px 0;font-size:${size}px;line-height:${LINE};overflow:hidden">${span}</div>`;
        }),
      );
      const rule = c > 0 ? `border-left:${SEP}px solid ${T.rule};padding-left:${gutter}px;` : "";
      const pr = c < cols - 1 ? `padding-right:${gutter}px;` : "";
      return `<div style="flex:1;min-width:0;${rule}${pr}">${lines.join("")}</div>`;
    }),
  );
  return `<div style="flex:none;border-bottom:${DIV}px solid ${T.ink};padding-bottom:10px">
    ${header(tier.name, tier.items.length)}
    <div style="height:8px"></div>
    <div style="display:flex;align-items:flex-start;padding:0 ${PAD}px">${blocks.join("")}</div>
  </div>`;
}

const wallH = (rows, size) => HDR_H + DIV + 8 + rows * (Math.round(LINE * size) + 2) + 10 + DIV;

export default async function build() {
  const tiers = numbered(data);
  const featured = tiers.find((t) => t.layout === "featured");
  const ranked = tiers.filter((t) => t.layout === "ranked");
  const walls = tiers.filter((t) => t.layout === "wall");

  // Wall geometry first: whatever it leaves over is the top band.
  const wallSpec = [
    { tier: walls[0], size: 14, cols: 4 },
    { tier: walls[1], size: 11, cols: 4 },
    { tier: walls[2], size: 9.5, cols: 5 },
  ];
  const wallsH = wallSpec.reduce(
    (s, w) => s + wallH(Math.ceil(w.tier.items.length / w.cols), w.size),
    0,
  );
  const bandH = INNER_H - (MAST_H + BW) - wallsH - FOOT_H;

  // Masthead: measure the right-hand labels, then fit the title into what is left.
  const labels = [
    { text: `${total(data)} ${data.unit}`, size: 13, weight: 700, letterSpacing: 3.4, style: "" },
    {
      text: dateLabel(),
      size: 10,
      weight: 700,
      letterSpacing: 1.5,
      style: `margin-top:3px;color:${T.muted};`,
    },
  ];
  const countW =
    Math.ceil(Math.max(...(await Promise.all(labels.map((l) => measureWidth(l.text, l)))))) +
    2 * 22 +
    BW;
  const titleSpan = await fitT(data.title, {
    size: 36,
    avail: INNER_W - 2 * 22 - countW,
    stretch: 1,
    letterSpacing: -0.72,
  });

  // Right side of the band: rows × weight, top tiers weighted heavier.
  const featW = Math.round((INNER_W * 1.5) / 3.5);
  const rightW = INNER_W - featW;
  const rRows = ranked.map((t) => Math.ceil(t.items.length / RANK_COLS));
  const weights = ranked.map((_, i) => TIER_WEIGHT ** (ranked.length - 1 - i));
  const weighted = rRows.reduce((s, r, i) => s + r * weights[i], 0);
  const fixed = ranked.length * HDR_H + (ranked.length - 1) * DIV;
  const unit = (bandH - fixed) / weighted;
  const rankedBlocks = await Promise.all(
    ranked.map((t, i) =>
      rankedTier(
        t,
        HDR_H + Math.round(rRows[i] * weights[i] * unit) + (i < ranked.length - 1 ? DIV : 0),
        rightW,
        i === ranked.length - 1,
      ),
    ),
  );

  const featRowH = (bandH - HDR_H) / featured.items.length;
  const featFrom = Math.min(46, Math.round(featRowH * 0.78));
  const featColumn = await rowColumn(
    featured.items,
    ramp(featFrom, Math.round(featFrom * 0.67), featured.items.length),
    featW - DIV,
    featured.color,
  );

  const wallBlocks = await Promise.all(wallSpec.map((w) => wall(w.tier, w.size, w.cols)));

  return `<div style="flex:1;display:flex;background:${T.ground};padding:${GROUND}px;font-family:'${T.font}';color:${T.ink}">
    <div style="flex:1;border:${BW}px solid ${T.ink};background:${T.bg};display:flex;flex-direction:column">
      <div style="height:${MAST_H}px;flex:none;display:flex;border-bottom:${BW}px solid ${T.ink}">
        <div style="flex:1;min-width:0;overflow:hidden;display:flex;align-items:center;padding:0 22px;line-height:${LINE}">${titleSpan}</div>
        <div style="flex:none;white-space:nowrap;display:flex;flex-direction:column;align-items:flex-end;justify-content:center;padding:0 22px;border-left:${BW}px solid ${T.ink}">
          ${labels
            .map(
              (l) =>
                `<div style="font-size:${l.size}px;font-weight:${l.weight};letter-spacing:${l.letterSpacing}px;line-height:${LINE};${l.style}">${esc(l.text)}</div>`,
            )
            .join("")}
        </div>
      </div>
      <div style="height:${bandH}px;flex:none;display:flex;border-bottom:${DIV}px solid ${T.ink}">
        <div style="width:${featW}px;flex:none;display:flex;flex-direction:column;border-right:${DIV}px solid ${T.ink}">
          ${header(featured.name, featured.items.length)}
          ${featColumn}
        </div>
        <div style="width:${rightW}px;display:flex;flex-direction:column">${rankedBlocks.join("")}</div>
      </div>
      ${wallBlocks.join("")}
      <div style="flex:1;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:${T.weight};letter-spacing:2.2px;color:${T.muted}">banzuke</div>
    </div>
  </div>`;
}

export const FAMILIES = [];

await runIfMain(import.meta, "anime", build);
