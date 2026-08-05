import assert from "node:assert/strict";
import { readFile, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
// decodeTextEntities is internal (renderPng's own pre-pass), so it is not on index.mjs
import { decodeTextEntities } from "../skills/banzuke/template/lib/entities.mjs";
import {
  decodeHtmlEntities,
  esc,
  FONT_FAMILY,
  fit,
  fitSpan,
  getRenderer,
  measureWidth,
  pngSize,
  registerFont,
  registerFontPackage,
  renderFile,
  renderPng,
} from "../skills/banzuke/template/lib/index.mjs";
import { tmp } from "./helpers/scaffold.mjs";

// The library bundles no font, so these tests supply their own — the same two-subset setup the
// scaffold's Typeface block uses. Everything below measures against it.
const FONT_FILES = {
  [FONT_FAMILY]: "@fontsource-variable/archivo/files/archivo-latin-wght-normal.woff2",
  [`${FONT_FAMILY} Ext`]: "@fontsource-variable/archivo/files/archivo-latin-ext-wght-normal.woff2",
};
await Promise.all(
  Object.entries(FONT_FILES).map(([name, spec]) => registerFontPackage(name, spec)),
);

/** An auto-fitting box in the registered family: the input for every render below. */
const box = (text, style = "") =>
  `<div style="font-family:'${FONT_FAMILY}';font-size:20px;font-weight:700;${style}">${text}</div>`;

const assertIsPng = (bytes) =>
  assert.deepEqual([...bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], "not a PNG");

test("esc: escapes HTML special characters", () => {
  assert.equal(esc(`A&B <div> "q" 'a'`), "A&amp;B &lt;div&gt; &quot;q&quot; &#39;a&#39;");
  assert.equal(esc(123), "123");
});

test("decodeHtmlEntities: restores named and numeric entities", () => {
  assert.equal(decodeHtmlEntities("A&amp;B"), "A&B");
  assert.equal(decodeHtmlEntities("it&#39;s"), "it's");
  assert.equal(decodeHtmlEntities("&lt;div&gt;"), "<div>");
  assert.equal(decodeHtmlEntities("&#x2014;"), "—");
  assert.equal(decodeHtmlEntities("&quot;q&quot;"), '"q"');
  // unknown entities are left alone
  assert.equal(decodeHtmlEntities("&unknown; &"), "&unknown; &");
  // case is significant, per the HTML spec (&Amp; is an invalid entity, so it survives)
  assert.equal(decodeHtmlEntities("&Amp; &AMP;"), "&Amp; &");
  // NUL, surrogates and out-of-range numeric references become U+FFFD
  assert.equal(decodeHtmlEntities("&#0;&#xD800;&#x110000;"), "���");
});

test("esc → decode round-trips to the identity", () => {
  const s = `banzuke & <b>"title"</b> 'q'`;
  assert.equal(decodeHtmlEntities(esc(s)), s);
});

// Asserted by codepoint rather than against a literal: &nbsp; has to yield a real U+00A0, which
// holds where a plain space would collapse, and the two are indistinguishable in source.
test("decodeHtmlEntities: &nbsp; becomes U+00A0", () => {
  const codes = [...decodeHtmlEntities("a&nbsp;b")].map((c) => c.codePointAt(0));
  assert.deepEqual(codes, [0x61, 0xa0, 0x62]);
});

test("decodeHtmlEntities: leaves entities outside its scope alone", () => {
  // the full WHATWG named set is deliberately out of scope
  assert.equal(decodeHtmlEntities("&mdash;&hellip;"), "&mdash;&hellip;");
  // malformed references are not entities
  assert.equal(decodeHtmlEntities("&amp &#; &#x;"), "&amp &#; &#x;");
  assert.equal(decodeHtmlEntities(""), "");
});

// renderPng's pre-pass: takumi's fromHtml leaves entities in text nodes, so the whole node tree
// gets walked. Only observable through renderPng otherwise, hence the direct test.
test("decodeTextEntities: decodes every text node in the tree, in place", () => {
  const tree = {
    text: "root &amp; co",
    children: [
      { text: "&lt;a&gt;" },
      { style: { color: "red" } }, // a node with no text survives untouched
      { children: [{ text: "deep &#39;q&#39;" }, { text: "no entities here" }] },
    ],
  };
  const returned = decodeTextEntities(tree);
  assert.equal(returned, tree, "the same object is returned, mutated in place");
  assert.equal(tree.text, "root & co");
  assert.equal(tree.children[0].text, "<a>");
  assert.deepEqual(tree.children[1], { style: { color: "red" } });
  assert.equal(tree.children[2].children[0].text, "deep 'q'");
  assert.equal(tree.children[2].children[1].text, "no entities here");
});

test("decodeTextEntities: tolerates leaf nodes and empty children", () => {
  assert.deepEqual(decodeTextEntities({}), {});
  assert.deepEqual(decodeTextEntities({ children: [] }), { children: [] });
  // a non-string text field is left alone rather than coerced
  assert.deepEqual(decodeTextEntities({ text: 42 }), { text: 42 });
});

// The default family ships as two unicode subsets (latin + latin-ext) registered under separate
// family names, relying on takumi to fall back between them. A glyph no registered font has gets
// a uniform notdef advance, so "measures like a real glyph" is the check that the stitching works.
const M = { size: 100, weight: 800 };
const NOTDEF = ""; // private use area: present in no font

test("fallback stitches latin-ext onto the primary subset", async () => {
  const missing = await measureWidth(NOTDEF, M);
  const narrow = await measureWidth("řř", M);
  const wide = await measureWidth("ňň", M);
  assert.notEqual(narrow, wide, "latin-ext glyphs should each have their own advance");
  assert.notEqual(narrow, missing, `ř measured as notdef (${narrow})`);
  assert.notEqual(wide, missing, `ň measured as notdef (${wide})`);
});

// Guards the template staying Latin-only: covering another script is registerFont()'s job, and
// this is the tofu signature an agent should recognise when it forgets.
test("a script with no registered font measures as notdef", async () => {
  assert.equal(await measureWidth("ああ", M), await measureWidth(NOTDEF, M));
});

test("fit: long text shrinks", async () => {
  const f = await fit("a very long title that goes on and on right here", { size: 20, avail: 100 });
  assert.ok(f.scale < 1, `got ${f.scale}`);
  assert.equal(f.weight, 800);
});

test("fit: stretches up to stretch× and corrects the weight", async () => {
  const f = await fit("a", { size: 20, avail: 1000, stretch: 2 });
  assert.equal(f.scale, 2);
  assert.ok(f.weight >= 500 && f.weight < 800, `got ${f.weight}`);
});

test("fit: an exact fit is left alone", async () => {
  const natural = await measureWidth("abc", { size: 20, weight: 800 });
  const f = await fit("abc", { size: 20, avail: natural });
  assert.equal(f.scale, 1);
  assert.equal(f.weight, 800);
});

test("fit: stretch < 1 does not shrink (treated as 1)", async () => {
  const natural = await measureWidth("abcde", { size: 20, weight: 800 });
  const f = await fit("abcde", { size: 20, avail: natural, stretch: 0.5 });
  assert.equal(f.scale, 1);
});

test("fit: avail <= 0 throws an explicit error", async () => {
  await assert.rejects(() => fit("a", { size: 20, avail: 0 }), /avail/);
  await assert.rejects(() => fit("a", { size: 20, avail: -50 }), /avail/);
  // NaN avail is not positive either, so it takes the same guard rather than dividing by it
  await assert.rejects(() => fit("a", { size: 20, avail: Number.NaN }), /avail/);
});

test("fit: text with no width is left alone instead of dividing by zero", async () => {
  assert.equal(await measureWidth("", { size: 20 }), 0);
  assert.deepEqual(await fit("", { size: 20, avail: 100 }), { scale: 1, weight: 800 });
  // the requested weight is preserved on the way out
  assert.deepEqual(await fit("", { size: 20, avail: 100, weight: 600 }), { scale: 1, weight: 600 });
  // with stretch on, avail/0 would otherwise stretch nothing to the cap and lighten it
  assert.deepEqual(await fit("", { size: 20, avail: 100, stretch: 2 }), { scale: 1, weight: 800 });
});

// The interesting stretch path: with room left under the cap, the lighter weight is re-measured,
// so the settled scale overshoots what the base weight implied (narrower glyphs, more room).
test("fit: stretching under the cap re-measures at the lighter weight", async () => {
  const title = "Attack on Titan";
  const natural = await measureWidth(title, { size: 20, weight: 800 });
  const avail = natural * 1.5;
  const f = await fit(title, { size: 20, avail, stretch: 5 });
  assert.ok(f.weight >= 500 && f.weight < 800, `weight ${f.weight}`);
  assert.ok(f.scale > 1.5, `scale ${f.scale} should exceed the 1.5 implied at weight 800`);
  assert.ok(f.scale < 5, `scale ${f.scale} stays under the cap`);
});

test("fit: the weight correction floors at 500", async () => {
  const f = await fit("a", { size: 20, avail: 5000, stretch: 50 });
  assert.equal(f.weight, 500, "never lighter than 500, however far it stretches");
  assert.equal(f.scale, 50, "and the scale is pinned to the cap");
});

// fit's whole contract: drawing the text at the weight and scaleX it returns must not overflow
// avail. Cover shrink, exact, capped stretch and re-measured stretch in one sweep.
test("fit: the returned weight × scale never overflows avail", async () => {
  const title = "Puella Magi Madoka Magica";
  const natural = await measureWidth(title, { size: 20, weight: 800 });
  const cases = [
    { avail: natural * 0.4, stretch: 1 },
    { avail: natural, stretch: 1 },
    { avail: natural * 3, stretch: 1 }, // shrink-only: stays at scale 1
    { avail: natural * 1.2, stretch: 2 }, // re-measured
    { avail: natural * 1.8, stretch: 4 }, // re-measured
    { avail: natural * 10, stretch: 2 }, // capped
  ];
  for (const { avail, stretch } of cases) {
    const f = await fit(title, { size: 20, avail, stretch });
    const drawn = (await measureWidth(title, { size: 20, weight: f.weight })) * f.scale;
    assert.ok(
      drawn <= avail + 0.01,
      `avail=${avail} stretch=${stretch} drew ${drawn} (${f.scale})`,
    );
  }
});

test("measureWidth: content is coerced to a string", async () => {
  assert.equal(await measureWidth(123, { size: 20 }), await measureWidth("123", { size: 20 }));
});

test("measureWidth: width tracks the font size", async () => {
  const small = await measureWidth("banzuke", { size: 20 });
  const big = await measureWidth("banzuke", { size: 40 });
  assert.ok(big > small * 1.9 && big < small * 2.1, `${small} → ${big}`);
});

test("fit/measureWidth: letterSpacing affects the measurement", async () => {
  const plain = await measureWidth("abcde", { size: 20, weight: 800 });
  const spaced = await measureWidth("abcde", { size: 20, weight: 800, letterSpacing: 4 });
  assert.ok(spaced > plain + 10, `plain=${plain} spaced=${spaced}`);
  const f = await fit("abcde", { size: 20, avail: plain, letterSpacing: 4 });
  assert.ok(f.scale < 1, `got ${f.scale}`);
});

test("fitSpan: returns a span string with the measured conditions baked in", async () => {
  const span = await fitSpan("a long title squeezed into a narrow width", { size: 20, avail: 120 });
  assert.match(span, /^<span style="/);
  // inline-block + nowrap are what give scaleX something to act on
  assert.match(span, /display:inline-block/);
  assert.match(span, /white-space:nowrap/);
  assert.match(span, /transform:scaleX\(0\.\d+\)/);
  assert.match(span, /font-size:20px/);
  assert.match(span, /font-family:'Banzuke Sans'/);
  assert.match(span, /letter-spacing:0px/);
  // the text is escaped
  const esced = await fitSpan("A&B", { size: 20, avail: 500 });
  assert.match(esced, />A&amp;B</);
});

test("fitSpan: no transform is emitted when the text already fits", async () => {
  const span = await fitSpan("hi", { size: 20, avail: 500 });
  assert.doesNotMatch(span, /transform:scaleX/);
  assert.match(span, /transform-origin:left center/); // the origin is still stated
  assert.match(span, /font-weight:800/); // and the weight is uncorrected
});

// The template's tracking knob is a string ("0.04em"), so this is the production path.
// The span has to be drawn at the *corrected* weight, not the requested one: it was measured
// lighter, so drawing it at 800 would overflow the width the scaleX was computed for.
test("fitSpan: a stretched span carries the lightened weight, not the requested one", async () => {
  const span = await fitSpan("hi", { size: 20, avail: 300, stretch: 3, weight: 800 });
  assert.match(span, /transform:scaleX\([1-9][\d.]*\)/);
  const weight = Number(span.match(/font-weight:(\d+)/)[1]);
  assert.ok(weight >= 500 && weight < 800, `font-weight:${weight} should be the correction`);
});

test("fitSpan: a string letterSpacing is passed through verbatim", async () => {
  const span = await fitSpan("hi", { size: 20, avail: 500, letterSpacing: "0.04em" });
  assert.match(span, /letter-spacing:0\.04em;/);
});

test("fitSpan: origin, style, family and weight overrides land in the style attribute", async () => {
  const span = await fitSpan("hi", {
    size: 18,
    avail: 500,
    weight: 600,
    family: "Banzuke Sans Ext",
    origin: "right center",
    style: "color:red;",
  });
  assert.match(span, /transform-origin:right center/);
  assert.match(span, /font-size:18px/);
  assert.match(span, /font-weight:600/);
  assert.match(span, /font-family:'Banzuke Sans Ext'/);
  assert.match(span, /color:red;">hi<\/span>$/); // extra CSS goes last, before the text
});

test("renderPng: with emoji: from-font, emoji render without network access", async () => {
  const png = await renderPng(box("ramen 🍜 yum", "width:200px;padding:10px;"), {
    devicePixelRatio: 1,
    emoji: "from-font",
  });
  assertIsPng(png);
});

test("renderPng: renders an HTML string containing entities", async () => {
  const png = await renderPng(box("A&amp;B &#39;q&#39;", "width:200px;padding:10px;"), {
    devicePixelRatio: 1,
  });
  assert.ok(png.length > 200, `png too small: ${png.length}`);
  assertIsPng(png);
});

// takumi's fromHtml leaves entities in text nodes, so renderPng decodes them before drawing.
// An auto-fitted box is exactly as wide as its text, which makes the decode observable from
// outside: drawn width has to match the *decoded* string, not the entity soup esc() produced.
test("renderPng: entities in text draw as the characters they stand for", async () => {
  for (const [entities, decoded] of [
    ["A&amp;B", "A&B"],
    ["it&#39;s", "it's"],
    ["&lt;tag&gt;", "<tag>"], // the one case with no literal spelling in HTML text
  ]) {
    const { width } = pngSize(await renderPng(box(entities), { devicePixelRatio: 1 }));
    const wanted = await measureWidth(decoded, { size: 20, weight: 700 });
    assert.ok(Math.abs(width - wanted) <= 1, `${entities} drew ${width}px, wanted ${wanted}px`);
  }
});

const BOX = box("hi", "width:150px;height:20px;");

// takumi's own width option is in *device* pixels; renderPng takes CSS px and multiplies by dpr.
// Getting this backwards halves or doubles the sheet, so pin it across ratios and at the default.
test("renderPng: width is CSS px, scaled by devicePixelRatio", async () => {
  for (const dpr of [1, 2, 3]) {
    const { width } = pngSize(await renderPng(BOX, { width: 300, devicePixelRatio: dpr }));
    assert.equal(width, 300 * dpr, `dpr ${dpr}`);
  }
  // fractional ratios are rounded to whole device pixels
  assert.equal(pngSize(await renderPng(BOX, { width: 101, devicePixelRatio: 1.5 })).width, 152);
  // and the ratio defaults to 2
  assert.equal(pngSize(await renderPng(BOX, { width: 100 })).width, 200);
});

test("renderPng: omitting width auto-fits the content", async () => {
  const { width } = pngSize(await renderPng(BOX, { devicePixelRatio: 1 }));
  assert.equal(width, 150, "the box's own width, not a viewport default");
});

// The template builds inline styles only, but fromHtml also collects <style> blocks and renderPng
// forwards them — so a hand-written HTML string with a stylesheet is not silently ignored.
test("renderPng: head <style> blocks are forwarded to the renderer", async () => {
  const styled = `<style>.k{width:321px;height:40px}</style><div class="k">hi</div>`;
  assert.deepEqual(pngSize(await renderPng(styled, { devicePixelRatio: 1 })), {
    width: 321,
    height: 40,
  });
  // without the stylesheet the same markup collapses to its content
  const bare = pngSize(await renderPng(`<div class="k">hi</div>`, { devicePixelRatio: 1 }));
  assert.ok(bare.width < 321, `got ${bare.width}`);
});

// renderPng returns a pooled Buffer, whose byteOffset into its ArrayBuffer is usually non-zero —
// so pngSize's DataView has to be built with the offset, not over the whole pool.
test("pngSize: reads IHDR through a byte-offset view", async () => {
  const png = await renderPng(BOX, { width: 128, devicePixelRatio: 1 });
  assert.deepEqual(pngSize(png), { width: 128, height: 20 });
  const padded = new Uint8Array(png.length + 7);
  padded.set(png, 7);
  assert.deepEqual(pngSize(padded.subarray(7)), { width: 128, height: 20 });
});

const outDir = path.join(tmp, "render-file");
const out = (...parts) => path.join(outDir, ...parts);

test("renderFile: writes the PNG, creates missing directories and reports what it wrote", async (t) => {
  t.after(() => rm(outDir, { recursive: true, force: true }));
  const png = out("deep/nested/sheet.png");
  const result = await renderFile(BOX, png, { width: 150, devicePixelRatio: 2 });
  assert.equal(result.path, png);
  assert.equal(result.width, 300); // device px, as reported by pngSize
  assert.equal(result.height, 40);
  assert.ok(typeof result.ms === "number" && result.ms >= 0, `ms ${result.ms}`);
  const written = await readFile(png);
  assert.equal(result.bytes, written.length);
  assertIsPng(written);
});

test("renderFile: the html sidecar is written only when asked for", async (t) => {
  t.after(() => rm(outDir, { recursive: true, force: true }));
  await renderFile(BOX, out("with/sheet.png"), { html: out("side/sheet.html") });
  assert.equal(await readFile(out("side/sheet.html"), "utf8"), BOX, "the input HTML, unmodified");
  await renderFile(BOX, out("without/sheet.png"));
  await assert.rejects(() => stat(out("without/sheet.html")), { code: "ENOENT" });
});

test("getRenderer: the renderer is created once per process", async () => {
  assert.equal(await getRenderer(), await getRenderer());
});

test("registerFont: raw bytes register under the given family name", async () => {
  const file = createRequire(import.meta.url).resolve(FONT_FILES[FONT_FAMILY]);
  await registerFont({ name: "Raw Bytes Face", data: await readFile(file) });
  const raw = { ...M, family: "Raw Bytes Face" };
  // the same file as the default family, so the advances have to agree
  assert.equal(
    await measureWidth("abc", raw),
    await measureWidth("abc", { ...M, family: FONT_FAMILY }),
  );
  assert.notEqual(await measureWidth("abc", raw), await measureWidth(NOTDEF, raw));
});

test("registerFontPackage: a missing package fails with the npm command that fixes it", async () => {
  // the package name is derived from the specifier: two segments when scoped, one otherwise
  await assert.rejects(() => registerFontPackage("X", "@nope/font/files/x.woff2"), {
    message: "Font not installed: @nope/font/files/x.woff2\n  run: npm i @nope/font",
  });
  await assert.rejects(() => registerFontPackage("X", "nope-font/files/x.woff2"), {
    message: "Font not installed: nope-font/files/x.woff2\n  run: npm i nope-font",
  });
  await assert.rejects(() => registerFontPackage("X", "nope-font"), {
    message: "Font not installed: nope-font\n  run: npm i nope-font",
  });
});
