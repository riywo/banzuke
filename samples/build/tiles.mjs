// Sample 4 — periodic table: every entry is an element tile, coloured by tier, filled in rank
// order. The one sample that leads with colour rather than typography.
import { esc, fitSpan } from "../../skills/banzuke/template/lib/index.mjs";
import data from "./data-langs.mjs";
import { CANVAS_H, CANVAS_W, dateLabel, numbered, runIfMain, total } from "./kit.mjs";

const T = { bg: "#e7e9e4", ink: "#15171a", muted: "#6d7278", font: "Banzuke Sans" };
const MARGIN = 28;
const HEAD_H = 108;
const LEGEND_H = 92;
const COLS = 7;
const GAP = 8;
// Wall tiers carry no colour in the data, so the theme supplies one.
const WALL_COLORS = ["#2d8b5f", "#8d8378"];

const GRID_W = CANVAS_W - 2 * MARGIN;
const TILE_W = (GRID_W - (COLS - 1) * GAP) / COLS;

/** Pick black or white ink for a swatch, by relative luminance. */
function inkOn(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) > 0.42 ? "#15171a" : "#ffffff";
}

export default async function build() {
  let wall = 0;
  const tiers = numbered(data).map((t) => ({
    ...t,
    color: t.color ?? WALL_COLORS[wall++ % WALL_COLORS.length],
  }));

  // Ranks run over the numbered tiers only, so give the wall entries a sequence too.
  let seq = 0;
  const cells = tiers.flatMap((t) =>
    t.items.map((item) => ({ ...item, n: ++seq, color: t.color, tier: t.name })),
  );

  const rows = Math.ceil(cells.length / COLS);
  const tileH = (CANVAS_H - 2 * MARGIN - HEAD_H - LEGEND_H - (rows - 1) * GAP) / rows;

  // Every row inside a tile gets an explicit height. A fitted span still lays out at its natural
  // width (scaleX is visual only), so an auto-height box can grow on the long names and shove
  // the tier label off the bottom of the tile.
  const nameSize = Math.round(tileH * 0.235);
  const tierSize = Math.round(tileH * 0.088);
  const rankSize = Math.round(tileH * 0.15);
  const nameH = Math.round(nameSize * 1.3);
  const tierH = Math.round(tierSize * 1.5);

  const tiles = await Promise.all(
    cells.map(async (c) => {
      const ink = inkOn(c.color);
      const span = await fitSpan(c.title, {
        size: nameSize,
        avail: TILE_W - 18,
        weight: 800,
        family: T.font,
        stretch: 1,
      });
      return `<div style="width:${TILE_W}px;height:${tileH}px;display:flex;flex-direction:column;background:${c.color};color:${ink};padding:9px 9px 11px;overflow:hidden">
        <div style="height:${Math.round(rankSize * 1.25)}px;flex:none;font-size:${rankSize}px;font-weight:700;line-height:1.25;opacity:0.72;overflow:hidden">${c.n}</div>
        <div style="flex:1"></div>
        <div style="height:${nameH}px;flex:none;line-height:1.3;overflow:hidden">${span}</div>
        <div style="height:${tierH}px;flex:none;font-size:${tierSize}px;font-weight:600;letter-spacing:1.2px;line-height:1.5;opacity:0.66;overflow:hidden">${esc(c.tier.toUpperCase())}</div>
      </div>`;
    }),
  );

  const grid = Array.from({ length: rows }, (_, r) => {
    const slice = tiles.slice(r * COLS, (r + 1) * COLS);
    const mb = r < rows - 1 ? `margin-bottom:${GAP}px` : "";
    return `<div style="display:flex;gap:${GAP}px;${mb}">${slice.join("")}</div>`;
  }).join("");

  const legend = tiers
    .map(
      (t) =>
        `<div style="display:flex;align-items:center;padding-right:26px">
          <div style="width:18px;height:18px;background:${t.color};margin-right:9px"></div>
          <div style="font-size:14px;font-weight:700;letter-spacing:0.6px;line-height:1.3">${esc(t.name)}</div>
          <div style="font-size:14px;font-weight:500;color:${T.muted};padding-left:7px;line-height:1.3">${t.items.length}</div>
        </div>`,
    )
    .join("");

  return `<div style="flex:1;display:flex;flex-direction:column;background:${T.bg};padding:${MARGIN}px;font-family:'${T.font}';color:${T.ink}">
    <div style="height:${HEAD_H}px;flex:none;display:flex;align-items:flex-start;justify-content:space-between">
      <div style="display:flex;flex-direction:column">
        <div style="font-size:44px;font-weight:800;letter-spacing:-1.2px;line-height:1.2">${esc(data.title)}</div>
        <div style="font-size:15px;font-weight:600;letter-spacing:3.4px;color:${T.muted};line-height:1.4;padding-top:4px">PERIODIC TABLE EDITION</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;padding-top:6px">
        <div style="font-size:15px;font-weight:700;letter-spacing:2px;line-height:1.4">${total(data)} ${esc(data.unit)}</div>
        <div style="font-size:13px;font-weight:500;letter-spacing:1.4px;color:${T.muted};line-height:1.4">${esc(dateLabel())}</div>
      </div>
    </div>
    <div style="flex:none">${grid}</div>
    <div style="height:${LEGEND_H}px;flex:none;display:flex;align-items:flex-end">
      <div style="flex:1;display:flex;flex-wrap:wrap;align-items:center">${legend}</div>
      <div style="font-size:13px;font-weight:700;letter-spacing:2.6px;color:${T.muted};line-height:1.3">banzuke</div>
    </div>
  </div>`;
}

export const FAMILIES = [];

await runIfMain(import.meta, "tiles", build);
