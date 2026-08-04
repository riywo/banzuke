import { text } from "takumi-js/helpers";
import { DEFAULT_LANG, FONT_FAMILY, getRenderer } from "./engine.mjs";

/**
 * Natural width (px) of a single line of text, via takumi's measure.
 * When measuring in a context that uses letterSpacing, always pass the same value
 * (otherwise the measurement drifts from what gets drawn).
 */
export async function measureWidth(
  content,
  { size, weight = 800, family = FONT_FAMILY, lang = DEFAULT_LANG, letterSpacing },
) {
  const renderer = await getRenderer();
  const node = text(String(content), {
    fontFamily: family,
    fontSize: size,
    fontWeight: weight,
    lineHeight: 1,
    whiteSpace: "nowrap",
    ...(letterSpacing !== undefined ? { letterSpacing } : {}),
  });
  return (await renderer.measure(node, { lang })).width;
}

/**
 * FitText's math: pre-computes the scaleX and weight for a given avail width.
 * Shrinking is unconditional; stretching goes up to `stretch`× (stretch < 1 is treated
 * as 1 = shrink only). When stretching, the glyphs are lightened by √scale (floor 500),
 * then re-measured at the lighter weight to settle the scale.
 */
export async function fit(
  content,
  { size, avail, stretch = 1, weight = 800, family, lang, letterSpacing },
) {
  if (!(avail > 0)) {
    throw new Error(
      `fit: avail must be positive (got ${avail}, text: ${JSON.stringify(String(content))}) — revisit the layout's width math`,
    );
  }
  const cap = Math.max(1, stretch);
  let w = weight;
  const natural = await measureWidth(content, { size, weight: w, family, lang, letterSpacing });
  if (natural <= 0) return { scale: 1, weight: w };
  const raw = avail / natural;
  let scale = Math.min(cap, raw);
  if (scale - 1 > 0.01) {
    const lighter = Math.max(500, Math.round(weight / Math.sqrt(scale)));
    if (lighter < w) {
      w = lighter;
      // Re-measuring only matters while the scale is still free to move. Once `raw` is at or past
      // `cap` the lighter weight can only widen the gap, and Math.min pins the result to `cap`.
      if (raw < cap) {
        const lighterWidth = await measureWidth(content, {
          size,
          weight: w,
          family,
          lang,
          letterSpacing,
        });
        scale = Math.min(cap, avail / lighterWidth);
      }
    }
  }
  if (scale >= 1 && scale - 1 <= 0.01) scale = 1;
  return { scale, weight: w };
}
