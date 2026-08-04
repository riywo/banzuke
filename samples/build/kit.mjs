// Shared plumbing for the README sample sheets.
//
// Every sample renders onto the SAME canvas (CANVAS_W × CANVAS_H CSS px) so the images line up
// in the README grid. Each theme therefore has to fill a fixed height rather than grow to fit
// its content — which is just flex:1 in the right places.
import { pathToFileURL } from "node:url";
import {
  FONT_FAMILY,
  registerFontPackage,
  renderFile,
} from "../../skills/banzuke/template/lib/index.mjs";

export const CANVAS_W = 1072;
export const CANVAS_H = 1072;

/**
 * Every typeface the samples can draw with, declared in samples/package.json. The skill template
 * ships no font, so this is the same registerFontPackage() route a real project takes.
 *
 * A family a theme names must be registered, or takumi silently falls back to another registered
 * font — it still renders, just in the wrong face and with every measured width wrong.
 */
const FONTS = {
  [FONT_FAMILY]: "@fontsource-variable/archivo/files/archivo-latin-wght-normal.woff2",
  [`${FONT_FAMILY} Ext`]: "@fontsource-variable/archivo/files/archivo-latin-ext-wght-normal.woff2",
  Mono: "@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2",
  Condensed: "@fontsource-variable/oswald/files/oswald-latin-wght-normal.woff2",
  Didone: "@fontsource-variable/bodoni-moda/files/bodoni-moda-latin-wght-normal.woff2",
  Gothic: "@fontpkg/source-han-sans-jp-vf/SourceHanSansJP-VF.ttf.woff2",
};

// Archivo is the default family every theme measures against; the rest load on request, because
// Gothic alone is 4.2MB and reading it costs more than rendering a whole sheet.
const BASE = [FONT_FAMILY, `${FONT_FAMILY} Ext`];
const loaded = new Map();

export function fonts(families = []) {
  return Promise.all(
    [...BASE, ...families].map((name) => {
      if (!loaded.has(name)) loaded.set(name, registerFontPackage(name, FONTS[name]));
      return loaded.get(name);
    }),
  );
}

/**
 * Register the theme's fonts, run its builder, and write samples/<name>.png on the shared canvas.
 * The builder is passed in rather than awaited by the caller for a reason: fitSpan measures at
 * build time, so a theme that measures before its typeface is registered gets the wrong widths
 * and never shrinks its long titles.
 */
export async function emit(name, build, families = []) {
  await fonts(families);
  const inner = await build();
  const html = `<div style="width:${CANVAS_W}px;height:${CANVAS_H}px;display:flex;flex-direction:column;overflow:hidden">${inner}</div>`;
  const out = await renderFile(html, new URL(`../${name}.png`, import.meta.url).pathname, {
    width: CANVAS_W,
    devicePixelRatio: 2,
  });
  return out;
}

/** One-line summary of an emit() result, for the build log. */
export const summarize = (name, out) =>
  `${name.padEnd(8)} ${out.width}×${out.height}  ${out.ms}ms  ${(out.bytes / 1024) | 0}KB`;

/** Render this theme only when its file is the one being run, not when all.mjs imports it. */
export async function runIfMain(meta, name, build, families = []) {
  if (!process.argv[1] || meta.url !== pathToFileURL(process.argv[1]).href) return;
  console.log(summarize(name, await emit(name, build, families)));
}

/** Flatten tiers into [{ rank, title, tier }] with running numbers over the non-wall tiers. */
export function numbered(data) {
  let n = 0;
  return data.tiers.map((t) => ({
    ...t,
    items: t.items.map((item) => {
      const title = typeof item === "string" ? item : item.title;
      return t.layout === "wall" ? { title, rank: null } : { title, rank: ++n };
    }),
  }));
}

export const total = (data) => data.tiers.reduce((s, t) => s + t.items.length, 0);

/** "2026-08-03 edition" — every sheet carries the date it was generated. */
export function dateLabel(now = new Date()) {
  const p = (v) => String(v).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} edition`;
}

/** Deal items column-major into `cols` columns. */
export function columns(items, cols) {
  const per = Math.ceil(items.length / cols);
  return Array.from({ length: cols }, (_, c) => items.slice(c * per, (c + 1) * per));
}
