// Sample 3 — station departure board: condensed caps, amber on black, ranked rows as departures
// and the unranked walls as the "also on the board" strip along the bottom.
import { esc, fitSpan } from "../../skills/banzuke/template/lib/index.mjs";
import data from "./data-langs.mjs";
import { CANVAS_H, CANVAS_W, columns, dateLabel, numbered, runIfMain, total } from "./kit.mjs";

const T = {
  bg: "#08080a",
  panel: "#0e0e12",
  amber: "#ffb000",
  dim: "#8a5f10",
  pale: "#ffe9b8",
  edge: "#241a06",
  font: "Condensed",
};
const MARGIN = 20;
const HEAD_H = 78;
const COLHEAD_H = 34;
const TICKER_PAD = 14;
const ROW_GAP = 2;

const INNER_W = CANVAS_W - 2 * MARGIN - 2 * 22;

const cell = (content, style = "") =>
  `<div style="display:flex;align-items:center;${style}">${content}</div>`;

export default async function build() {
  const tiers = numbered(data);
  const listed = tiers.filter((t) => t.layout !== "wall");
  const walls = tiers.filter((t) => t.layout === "wall");
  const departures = listed.flatMap((t) => t.items.map((it) => ({ ...it, tier: t })));

  // Bottom strip first — the rest of the height belongs to the board.
  const wallSize = 15;
  const wallRows = walls.map((t) => ({ tier: t, cols: 4, rows: Math.ceil(t.items.length / 4) }));
  const tickerH =
    wallRows.reduce((s, w) => s + 26 + w.rows * (wallSize * 1.35), 0) + 2 * TICKER_PAD + 12;

  // The panel's own border (2px × 2) and every row's gap have to come out of the budget too,
  // or the ticker gets pushed off the bottom of the canvas.
  const boardH = CANVAS_H - 2 * MARGIN - 4 - HEAD_H - COLHEAD_H - tickerH;
  const rowH = boardH / departures.length - ROW_GAP;
  const size = Math.min(30, rowH * 0.74);

  const rankW = 74;
  const tierW = 190;
  const titleAvail = INNER_W - rankW - tierW - 24;

  const rows = await Promise.all(
    departures.map(async (d, i) => {
      const span = await fitSpan(d.title.toUpperCase(), {
        size,
        avail: titleAvail,
        weight: 600,
        family: T.font,
        stretch: 1,
        letterSpacing: 1.5,
      });
      const bg = i % 2 === 0 ? "rgba(255,176,0,0.035)" : "transparent";
      return `<div style="height:${rowH}px;display:flex;align-items:center;overflow:hidden;background:${bg};margin-bottom:${ROW_GAP}px">
        ${cell(
          `<div style="font-size:${size * 0.82}px;font-weight:700;color:${T.bg};background:${d.tier.color};line-height:1.3;padding:1px 9px;letter-spacing:1px">${String(d.rank).padStart(2, "0")}</div>`,
          `width:${rankW}px;flex:none;padding-left:8px`,
        )}
        ${cell(span, `flex:1;min-width:0;overflow:hidden;padding-left:16px;line-height:1.3;color:${T.pale}`)}
        ${cell(
          `<div style="font-size:14px;font-weight:500;letter-spacing:2.4px;color:${T.amber};line-height:1.3">${esc(d.tier.name.toUpperCase())}</div>`,
          `width:${tierW}px;flex:none;justify-content:flex-end;padding-right:8px`,
        )}
      </div>`;
    }),
  );

  const strips = await Promise.all(
    wallRows.map(async ({ tier, cols }) => {
      const colW = INNER_W / cols;
      const blocks = await Promise.all(
        columns(tier.items, cols).map(async (chunk) => {
          const lines = await Promise.all(
            chunk.map(async ({ title }) => {
              const span = await fitSpan(title.toUpperCase(), {
                size: wallSize,
                avail: colW - 26,
                weight: 400,
                family: T.font,
                stretch: 1,
                letterSpacing: 1.2,
              });
              return `<div style="height:${wallSize * 1.35}px;display:flex;align-items:center;overflow:hidden;line-height:1.3;color:${T.dim}">${span}</div>`;
            }),
          );
          return `<div style="flex:1;min-width:0;padding-right:20px">${lines.join("")}</div>`;
        }),
      );
      return `<div>
        <div style="height:26px;display:flex;align-items:center;font-size:13px;font-weight:600;letter-spacing:3px;color:${T.amber};line-height:1.3">${esc(tier.name.toUpperCase())} <span style="color:${T.dim};padding-left:8px">· ${tier.items.length}</span></div>
        <div style="display:flex">${blocks.join("")}</div>
      </div>`;
    }),
  );

  return `<div style="flex:1;background:${T.bg};padding:${MARGIN}px;font-family:'${T.font}'">
    <div style="flex:1;display:flex;flex-direction:column;background:${T.panel};padding:0 22px;border:2px solid ${T.edge}">
      <div style="height:${HEAD_H}px;flex:none;display:flex;align-items:center;border-bottom:2px solid ${T.edge}">
        <div style="font-size:34px;font-weight:700;letter-spacing:7px;color:${T.amber};line-height:1.3">BANZUKE</div>
        <div style="margin-left:auto;display:flex;flex-direction:column;align-items:flex-end">
          <div style="font-size:17px;font-weight:600;letter-spacing:4px;color:${T.pale};line-height:1.3">${esc(data.title.toUpperCase())}</div>
          <div style="font-size:13px;font-weight:400;letter-spacing:2.6px;color:${T.dim};line-height:1.3">${total(data)} ${esc(data.unit.toUpperCase())} · ${esc(dateLabel().toUpperCase())}</div>
        </div>
      </div>
      <div style="height:${COLHEAD_H}px;flex:none;display:flex;align-items:center;font-size:12px;font-weight:500;letter-spacing:3.4px;color:${T.dim};line-height:1.3">
        <div style="width:${rankW}px;flex:none;padding-left:8px">RANK</div>
        <div style="flex:1;padding-left:16px">${esc(data.unit.toUpperCase())}</div>
        <div style="width:${tierW}px;flex:none;display:flex;justify-content:flex-end;padding-right:8px">TIER</div>
      </div>
      <div style="flex:none">${rows.join("")}</div>
      <div style="flex:1"></div>
      <div style="flex:none;padding:${TICKER_PAD}px 0;border-top:2px solid ${T.edge}">${strips.join("")}</div>
    </div>
  </div>`;
}

export const FAMILIES = ["Condensed"];

await runIfMain(import.meta, "board", build, FAMILIES);
