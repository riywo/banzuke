import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { render } from "takumi-js";
import { fromHtml } from "takumi-js/helpers/html";
import { DEFAULT_LANG, getRenderer } from "./engine.mjs";
import { decodeTextEntities } from "./entities.mjs";
import { pngSize } from "./png.mjs";

/**
 * Turn an HTML string into a PNG (Uint8Array).
 * - width: CSS px. Omit to auto-fit the content width
 *   (takumi's width option is in device pixels, so it is multiplied by dpr)
 * - devicePixelRatio: default 2 (high-resolution output)
 * - lang: default "ja" — required for CJK glyph selection (without it, Chinese shapes creep in)
 * - emoji: takumi-js's emoji source. The default (twemoji) fetches from a CDN, so switch to
 *   "from-font" only when using emoji with no network
 */
export async function renderPng(
  html,
  { width, devicePixelRatio = 2, lang = DEFAULT_LANG, emoji } = {},
) {
  const renderer = await getRenderer();
  const { node, stylesheets } = fromHtml(String(html));
  decodeTextEntities(node);
  const options = { renderer, format: "png", devicePixelRatio, lang };
  if (emoji !== undefined) options.emoji = emoji;
  if (width !== undefined) options.width = Math.round(width * devicePixelRatio);
  if (stylesheets.length > 0) options.stylesheets = stylesheets;
  return render(node, options);
}

/**
 * renderPng + writing the file out. The main entry point for scripts.
 * Takes the same options as renderPng plus { html }: pass a path and the input HTML is
 * written out too (for debugging). The output directory is created automatically.
 * Returns { path, width, height, ms, bytes }.
 */
export async function renderFile(html, outPath, { html: htmlOut, ...options } = {}) {
  const t0 = performance.now();
  if (htmlOut) {
    await mkdir(path.dirname(path.resolve(htmlOut)), { recursive: true });
    await writeFile(htmlOut, String(html));
  }
  const png = await renderPng(html, options);
  await mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
  await writeFile(outPath, png);
  const { width, height } = pngSize(png);
  return {
    path: outPath,
    width,
    height,
    ms: Math.round(performance.now() - t0),
    bytes: png.length,
  };
}
