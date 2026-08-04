// Sample 6 — broadsheet gazette: didone serif, hairline column rules, masthead and dateline.
// The quiet, typographic end of the range, against the poster and terminal treatments.
import { esc, fitSpan } from "../../skills/banzuke/template/lib/index.mjs";
import data from "../../test/fixtures/sample-data.mjs";
import { CANVAS_H, CANVAS_W, columns, dateLabel, numbered, runIfMain, total } from "./kit.mjs";

const T = {
  bg: "#faf7f0",
  ink: "#16130f",
  muted: "#7a7266",
  hair: "rgba(22,19,15,0.28)",
  font: "Didone",
  sans: "Banzuke Sans",
};
const MARGIN = 34;
const MAST_H = 154;
const FOOT_H = 30;
const GUTTER = 18;

const INNER_W = CANVAS_W - 2 * MARGIN;

const smallcaps = (text, size, color = T.ink, weight = 600) =>
  `<div style="font-family:'${T.sans}';font-size:${size}px;font-weight:${weight};letter-spacing:${size * 0.2}px;color:${color};line-height:1.4">${esc(text.toUpperCase())}</div>`;

export default async function build() {
  const tiers = numbered(data);
  const listed = tiers.filter((t) => t.layout !== "wall");
  const walls = tiers.filter((t) => t.layout === "wall");

  // Walls run along the bottom as classified-style blocks.
  const wallSpec = [
    { tier: walls[0], size: 15, cols: 4 },
    { tier: walls[1], size: 14, cols: 4 },
    { tier: walls[2], size: 12, cols: 5 },
  ];
  const wallLine = (size) => Math.round(size * 1.5);
  const wallH = (w) => 24 + Math.ceil(w.tier.items.length / w.cols) * wallLine(w.size) + 12;
  const wallsH = wallSpec.reduce((s, w) => s + wallH(w), 0);

  const bodyH = CANVAS_H - 2 * MARGIN - MAST_H - wallsH - FOOT_H;
  // Chrome between the three columns: 4 gutters (outer col has one side, middle has two) plus
  // the two hairline rules. Under-counting it here is what silently clips the long titles.
  const colW = (INNER_W - 4 * GUTTER - 2) / 3;

  // One tier per column, so each column sets its own rhythm — as a newspaper would.
  const cols = await Promise.all(
    listed.map(async (tier, ci) => {
      const rowH = (bodyH - 34) / tier.items.length;
      const size = Math.min(29, rowH * 0.46);
      const numW = Math.round(size * 1.35);
      const rows = await Promise.all(
        tier.items.map(async ({ title, rank }, i) => {
          const span = await fitSpan(title, {
            size,
            avail: colW - numW - 16,
            weight: 500,
            family: T.font,
            stretch: 1,
          });
          const bb = i === tier.items.length - 1 ? "" : `border-bottom:1px solid ${T.hair};`;
          return `<div style="height:${rowH}px;flex:none;display:flex;align-items:center;overflow:hidden;${bb}">
            <div style="width:${numW}px;flex:none;font-family:'${T.sans}';font-size:${Math.round(size * 0.52)}px;font-weight:600;color:${T.muted};line-height:1.3">${rank}</div>
            <div style="flex:1;min-width:0;overflow:hidden;padding-right:10px;line-height:1.35">${span}</div>
          </div>`;
        }),
      );
      const rule = ci > 0 ? `border-left:1px solid ${T.hair};padding-left:${GUTTER}px;` : "";
      const pr = ci < 2 ? `padding-right:${GUTTER}px;` : "";
      return `<div style="flex:1;min-width:0;display:flex;flex-direction:column;${rule}${pr}">
        <div style="height:34px;flex:none;display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid ${T.ink}">
          ${smallcaps(tier.name, 12)}
          ${smallcaps(String(tier.items.length), 12, T.muted)}
        </div>
        ${rows.join("")}
      </div>`;
    }),
  );

  const wallBlocks = await Promise.all(
    wallSpec.map(async ({ tier, size, cols: n }) => {
      const w = INNER_W / n;
      const blocks = await Promise.all(
        columns(tier.items, n).map(async (chunk, c) => {
          const lines = await Promise.all(
            chunk.map(async ({ title }) => {
              const span = await fitSpan(title, {
                size,
                avail: w - 30,
                weight: 400,
                family: T.font,
                stretch: 1,
              });
              return `<div style="height:${wallLine(size)}px;display:flex;align-items:center;overflow:hidden;line-height:1.4">${span}</div>`;
            }),
          );
          const rule = c > 0 ? `border-left:1px solid ${T.hair};padding-left:14px;` : "";
          return `<div style="flex:1;min-width:0;padding-right:14px;${rule}">${lines.join("")}</div>`;
        }),
      );
      return `<div style="flex:none">
        <div style="height:24px;display:flex;align-items:center;border-top:1px solid ${T.hair}">
          ${smallcaps(`${tier.name} · ${tier.items.length}`, 11, T.muted)}
        </div>
        <div style="display:flex;padding-bottom:12px">${blocks.join("")}</div>
      </div>`;
    }),
  );

  return `<div style="flex:1;display:flex;flex-direction:column;background:${T.bg};padding:${MARGIN}px;font-family:'${T.font}';color:${T.ink}">
    <div style="height:${MAST_H}px;flex:none;display:flex;flex-direction:column;justify-content:center;border-bottom:3px solid ${T.ink}">
      <div style="height:4px;background:${T.ink};margin-bottom:14px"></div>
      <div style="display:flex;align-items:baseline;justify-content:center">
        <div style="font-size:72px;font-weight:600;letter-spacing:-1px;line-height:1.2">The ${esc(data.title)}</div>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;padding-top:12px">
        ${smallcaps(dateLabel(), 12, T.muted)}
        ${smallcaps("Ranked by the editor", 12, T.muted, 500)}
        ${smallcaps(`${total(data)} ${data.unit}`, 12, T.muted)}
      </div>
    </div>
    <div style="height:${bodyH}px;flex:none;display:flex;padding-top:14px">${cols.join("")}</div>
    ${wallBlocks.join("")}
    <div style="flex:1;display:flex;align-items:center;justify-content:center;border-top:3px solid ${T.ink}">
      ${smallcaps("banzuke", 11, T.muted)}
    </div>
  </div>`;
}

export const FAMILIES = ["Didone"];

await runIfMain(import.meta, "gazette", build, FAMILIES);
