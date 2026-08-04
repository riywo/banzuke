// Sample 5 — sumo banzuke: east/west spread around a vertical title, ranks alternating outward
// from the centre. Set in the bundled CJK face, whose heavy weight suits the form even in Latin.
import { esc, fitSpan } from "../../skills/banzuke/template/lib/index.mjs";
import data from "../../test/fixtures/sample-data.mjs";
import { CANVAS_H, CANVAS_W, columns, dateLabel, numbered, runIfMain, total } from "./kit.mjs";

const T = {
  bg: "#ece4d1",
  ink: "#17140e",
  seal: "#b3231f",
  ground: "#8a7f68",
  rule: "rgba(23,20,14,0.3)",
  font: "Gothic",
};
// Gothic is a CJK face with a tall glyph box, so clipped boxes need a roomy line-height.
const LINE = 1.45;
const GROUND = 20;
const BW = 7;
const SPINE_W = 118;
const PAD = 10;
const HDR_H = 26;
const FOOT_H = 30;

const INNER_W = CANVAS_W - 2 * GROUND - 2 * BW;
const INNER_H = CANVAS_H - 2 * GROUND - 2 * BW;
const SIDE_W = (INNER_W - SPINE_W) / 2;

const fitT = (text, o) => fitSpan(text, { family: T.font, weight: 900, ...o });

const bandHeader = (name) =>
  `<div style="height:${HDR_H}px;flex:none;display:flex;align-items:center;justify-content:center;background:${T.ink};color:${T.bg};font-size:13px;font-weight:700;letter-spacing:5px;line-height:${LINE}">${esc(name.toUpperCase())}</div>`;

async function side(items, rowH, size, align) {
  const rows = await Promise.all(
    items.map(async ({ title, rank }, i) => {
      // The rank sits between the sheet edge and the title. Without an explicit gap the number
      // hugs the title, which is most obvious in the big top tiers. The gap is padding *inside*
      // numW, so numW has to leave room for two digits on top of it or rank 40 gets clipped.
      const gap = Math.round(size * 0.34);
      const numW = Math.round(size * 0.95);
      const span = await fitT(title, {
        size,
        avail: SIDE_W - numW - 2 * PAD - 6,
        stretch: 1,
      });
      const toText = align === "right" ? "padding-left" : "padding-right";
      const num = `<div style="width:${numW}px;flex:none;${toText}:${gap}px;text-align:${align === "right" ? "left" : "right"};font-size:${Math.round(size * 0.46)}px;font-weight:700;color:rgba(23,20,14,0.5);line-height:1">${rank}</div>`;
      const text = `<div style="flex:1;min-width:0;overflow:hidden;display:flex;justify-content:${align === "right" ? "flex-end" : "flex-start"};line-height:${LINE}">${span}</div>`;
      const bb = i === items.length - 1 ? "" : `border-bottom:1px solid ${T.rule};`;
      return `<div style="height:${rowH}px;flex:none;display:flex;align-items:center;overflow:hidden;padding:0 ${PAD}px;${bb}">
        ${align === "right" ? `${text}${num}` : `${num}${text}`}
      </div>`;
    }),
  );
  return rows.join("");
}

export default async function build() {
  const tiers = numbered(data);
  const listed = tiers.filter((t) => t.layout !== "wall");
  const walls = tiers.filter((t) => t.layout === "wall");

  // Walls first; the band takes what is left.
  const wallSpec = [
    { tier: walls[0], size: 15, cols: 4 },
    { tier: walls[1], size: 13, cols: 4 },
    { tier: walls[2], size: 11, cols: 5 },
  ];
  const wallH = (w) =>
    HDR_H + 8 + Math.ceil(w.tier.items.length / w.cols) * Math.round(w.size * LINE + 3) + 8;
  const wallsH = wallSpec.reduce((s, w) => s + wallH(w), 0);
  const bandH = INNER_H - wallsH - FOOT_H;

  // Each listed tier is a horizontal band; odd ranks go west, even ranks east.
  const rowsPerTier = listed.map((t) => Math.ceil(t.items.length / 2));
  const weights = listed.map((_, i) => 1.35 ** (listed.length - 1 - i));
  const weighted = rowsPerTier.reduce((s, r, i) => s + r * weights[i], 0);
  const unit = (bandH - listed.length * HDR_H) / weighted;

  const west = [];
  const east = [];
  for (const [i, tier] of listed.entries()) {
    const rowH = weights[i] * unit;
    const size = Math.min(40, Math.round(rowH * 0.52));
    const odd = tier.items.filter((_, k) => k % 2 === 0);
    const even = tier.items.filter((_, k) => k % 2 === 1);
    west.push(bandHeader(tier.name) + (await side(odd, rowH, size, "left")));
    east.push(bandHeader(tier.name) + (await side(even, rowH, size, "right")));
  }

  const wallBlocks = await Promise.all(
    wallSpec.map(async ({ tier, size, cols }) => {
      const colW = INNER_W / cols;
      const blocks = await Promise.all(
        columns(tier.items, cols).map(async (chunk, c) => {
          const lines = await Promise.all(
            chunk.map(async ({ title }) => {
              const span = await fitT(title, { size, avail: colW - 34, weight: 700, stretch: 1 });
              return `<div style="height:${Math.round(size * LINE + 3)}px;display:flex;align-items:center;overflow:hidden;line-height:${LINE}">${span}</div>`;
            }),
          );
          const rule = c > 0 ? `border-left:1px solid ${T.rule};padding-left:11px;` : "";
          return `<div style="flex:1;min-width:0;padding-right:11px;${rule}">${lines.join("")}</div>`;
        }),
      );
      return `<div style="flex:none">
        ${bandHeader(tier.name)}
        <div style="display:flex;padding:8px 12px">${blocks.join("")}</div>
      </div>`;
    }),
  );

  // Vertical title: one letter per line, which is how you set vertical text here.
  const letters = [...data.title.toUpperCase()]
    .map((ch) =>
      ch === " "
        ? `<div style="height:14px"></div>`
        : `<div style="font-size:46px;font-weight:900;line-height:1.08;text-align:center">${esc(ch)}</div>`,
    )
    .join("");

  return `<div style="flex:1;display:flex;background:${T.ground};padding:${GROUND}px;font-family:'${T.font}';color:${T.ink}">
    <div style="flex:1;display:flex;flex-direction:column;border:${BW}px solid ${T.ink};background:${T.bg}">
      <div style="height:${bandH}px;flex:none;display:flex">
        <div style="width:${SIDE_W}px;flex:none;display:flex;flex-direction:column">${west.join("")}</div>
        <div style="width:${SPINE_W}px;flex:none;display:flex;flex-direction:column;align-items:center;justify-content:center;border-left:2px solid ${T.ink};border-right:2px solid ${T.ink};padding:10px 0">
          <div style="font-size:13px;font-weight:700;letter-spacing:3px;color:${T.seal};line-height:${LINE}">OFFICIAL</div>
          <div style="flex:1;display:flex;flex-direction:column;justify-content:center">${letters}</div>
          <div style="font-size:12px;font-weight:700;letter-spacing:1px;line-height:${LINE}">${total(data)} ${esc(data.unit)}</div>
        </div>
        <div style="width:${SIDE_W}px;flex:none;display:flex;flex-direction:column">${east.join("")}</div>
      </div>
      ${wallBlocks.join("")}
      <div style="flex:1;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;letter-spacing:3px;color:rgba(23,20,14,0.55);line-height:${LINE}">banzuke · ${esc(dateLabel())}</div>
    </div>
  </div>`;
}

export const FAMILIES = ["Gothic"];

await runIfMain(import.meta, "sumo", build, FAMILIES);
