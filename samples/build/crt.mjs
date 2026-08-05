// Sample 2 — CRT terminal: monospace, phosphor green on near-black, output of a fake CLI run.
import { esc, fitSpan } from "../../skills/banzuke/template/lib/index.mjs";
import data from "./data-langs.mjs";
import { CANVAS_H, CANVAS_W, columns, dateLabel, numbered, runIfMain, total } from "./kit.mjs";

const T = {
  bg: "#050a06",
  pane: "#08120a",
  green: "#3ff07a",
  dim: "#2f7a4a",
  amber: "#e8b13a",
  edge: "#1f4d2a",
  font: "Mono",
};
const MARGIN = 16;
const BAR_H = 40;
const PAD = 26;
const RULE_H = 26;
const HEAD_H = 56;
const PROMPT_H = 34;
// Rows are dealt into this many columns per tier, and weighted so the top tier reads loudest.
const SPEC = [
  { cols: 2, weight: 1.6, dot: false },
  { cols: 3, weight: 1.15, dot: false },
  { cols: 3, weight: 1.15, dot: false },
  { cols: 4, weight: 0.8, dot: true },
  { cols: 4, weight: 0.8, dot: true },
];

// Trailing slack keeps the closing prompt off the bottom edge; the flex spacer soaks it up.
const BODY_H = CANVAS_H - 2 * MARGIN - 2 - BAR_H - 2 * PAD - 24;
const BODY_W = CANVAS_W - 2 * MARGIN - 2 - 2 * PAD;

export default async function build() {
  const tiers = numbered(data);
  const plan = tiers.map((t, i) => ({
    ...t,
    ...SPEC[i],
    rows: Math.ceil(t.items.length / SPEC[i].cols),
  }));

  const free = BODY_H - HEAD_H - PROMPT_H - plan.length * RULE_H;
  const unit = free / plan.reduce((s, p) => s + p.rows * p.weight, 0);

  const blocks = [];
  for (const p of plan) {
    const rowH = p.rows * p.weight * unit;
    const size = Math.round(Math.min(46, (rowH / p.rows) * 0.55) * 10) / 10;
    const numW = p.dot ? 14 : Math.round(size * 2.4);
    const colW = BODY_W / p.cols;

    const cols = await Promise.all(
      columns(p.items, p.cols).map(async (chunk) => {
        const lines = await Promise.all(
          chunk.map(async ({ title, rank }) => {
            const span = await fitSpan(title, {
              size,
              avail: colW - numW - 18,
              weight: p.dot ? 500 : 700,
              family: T.font,
              stretch: 1,
            });
            const marker = p.dot
              ? `<span style="color:${T.dim}">·</span>`
              : `<span style="color:${T.dim}">[${String(rank).padStart(2, " ")}]</span>`;
            return `<div style="display:flex;align-items:center;height:${rowH / p.rows}px;overflow:hidden">
              <div style="width:${numW}px;flex:none;font-size:${size}px;line-height:1.3;font-family:'${T.font}';font-weight:500;white-space:pre">${marker}</div>
              <div style="flex:1;min-width:0;overflow:hidden;padding-left:8px;line-height:1.3;color:${T.green}">${span}</div>
            </div>`;
          }),
        );
        return `<div style="flex:1;min-width:0;display:flex;flex-direction:column">${lines.join("")}</div>`;
      }),
    );

    blocks.push(`<div style="flex:none">
      <div style="height:${RULE_H}px;display:flex;align-items:center;color:${T.amber};font-size:15px;font-weight:700;line-height:1.3">
        <span style="width:20px;flex:none;height:1px;background:${T.amber};opacity:0.45"></span>
        <span style="padding:0 10px">${esc(p.name)} (${p.items.length})</span>
        <span style="flex:1;height:1px;background:${T.amber};opacity:0.45"></span>
      </div>
      <div style="display:flex">${cols.join("")}</div>
    </div>`);
  }

  const line = (content, color = T.dim, size = 17) =>
    `<div style="height:28px;display:flex;align-items:center;font-size:${size}px;line-height:1.3;color:${color};white-space:pre">${content}</div>`;

  return `<div style="flex:1;background:${T.bg};padding:${MARGIN}px;font-family:'${T.font}';font-weight:500">
    <div style="flex:1;display:flex;flex-direction:column;border:1px solid ${T.edge};background:${T.pane}">
      <div style="height:${BAR_H}px;flex:none;display:flex;align-items:center;padding:0 ${PAD}px;border-bottom:1px solid ${T.edge}">
        <div style="width:11px;height:11px;background:#ef5f56;margin-right:8px"></div>
        <div style="width:11px;height:11px;background:${T.amber};margin-right:8px"></div>
        <div style="width:11px;height:11px;background:${T.green}"></div>
        <div style="margin-left:auto;font-size:14px;color:${T.dim};letter-spacing:2px">banzuke — 96×32</div>
      </div>
      <div style="flex:1;display:flex;flex-direction:column;padding:${PAD}px">
        ${line(`<span style="color:${T.green}">riywo@banzuke</span>:~$ banzuke rank --list "${esc(data.title)}"`, T.green, 17)}
        ${line(`resolving ${total(data)} ${esc(data.unit)} … done (0.33s) · ${esc(dateLabel())}`)}
        ${blocks.join("")}
        <div style="flex:1"></div>
        <div style="height:${PROMPT_H}px;flex:none;display:flex;align-items:center;font-size:17px;line-height:1.3;color:${T.green}">
          <span>riywo@banzuke</span><span style="color:${T.dim}">:~$ </span>
          <span style="width:11px;height:20px;background:${T.green};margin-left:6px"></span>
        </div>
      </div>
    </div>
  </div>`;
}

export const FAMILIES = ["Mono"];

await runIfMain(import.meta, "crt", build, FAMILIES);
