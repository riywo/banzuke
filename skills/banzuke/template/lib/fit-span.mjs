import { FONT_FAMILY } from "./engine.mjs";
import { esc } from "./entities.mjs";
import { fit } from "./measure.mjs";

/**
 * Pre-measured FitText: measures the natural width and returns a <span> HTML string with
 * scaleX (plus a weight correction when stretching) baked into its inline style.
 *
 * options: { size, avail, stretch?, weight?, family?, lang?, letterSpacing?, style? }
 *  - avail: available width (px). Compute it from the caller's layout and pass it in
 *  - stretch: stretch ceiling (1 = shrink only)
 *  - letterSpacing: tracking in px (default 0). Baked into the span so measuring and drawing agree
 *  - origin: transform-origin (default "left center"; use "right center" when squashing right-aligned text)
 *  - style: extra CSS declarations to append to the span
 *
 * font-size / font-weight / font-family / letter-spacing are all stated on the span itself
 * (never inherited from a parent) so the measured and drawn conditions cannot drift apart.
 *
 * scaleX shrinks what is *drawn*, not what is *laid out*: a squashed span still occupies its
 * natural width, so it can overflow the box you sized to `avail`. Give any box holding a fitSpan
 * an explicit height (or a flex context that fixes it) — left to size itself it can take a second
 * line box and push everything below it down.
 */
export async function fitSpan(
  text,
  {
    size,
    avail,
    stretch = 1,
    weight = 800,
    family = FONT_FAMILY,
    lang,
    letterSpacing = 0,
    origin = "left center",
    style = "",
  },
) {
  const f = await fit(text, { size, avail, stretch, weight, family, lang, letterSpacing });
  const ls = typeof letterSpacing === "number" ? `${letterSpacing}px` : letterSpacing;
  const tf = f.scale !== 1 ? `transform:scaleX(${f.scale.toFixed(4)});` : "";
  return (
    `<span style="display:inline-block;white-space:nowrap;transform-origin:${origin};` +
    `font-size:${size}px;font-weight:${f.weight};font-family:'${family}';letter-spacing:${ls};` +
    `${tf}${style}">${esc(text)}</span>`
  );
}
