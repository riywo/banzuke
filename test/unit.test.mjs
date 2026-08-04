import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeHtmlEntities,
  esc,
  FONT_FAMILY,
  fit,
  fitSpan,
  measureWidth,
  registerFontPackage,
  renderPng,
} from "../skills/banzuke/template/lib/index.mjs";

// The library bundles no font, so these tests supply their own — the same two-subset setup the
// scaffold's Typeface block uses. Everything below measures against it.
await Promise.all([
  registerFontPackage(
    FONT_FAMILY,
    "@fontsource-variable/archivo/files/archivo-latin-wght-normal.woff2",
  ),
  registerFontPackage(
    `${FONT_FAMILY} Ext`,
    "@fontsource-variable/archivo/files/archivo-latin-ext-wght-normal.woff2",
  ),
]);

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
  assert.match(span, /transform:scaleX\(0\.\d+\)/);
  assert.match(span, /font-size:20px/);
  assert.match(span, /font-family:'Banzuke Sans'/);
  assert.match(span, /letter-spacing:0px/);
  // the text is escaped
  const esced = await fitSpan("A&B", { size: 20, avail: 500 });
  assert.match(esced, />A&amp;B</);
});

test("renderPng: with emoji: from-font, emoji render without network access", async () => {
  const png = await renderPng(
    `<div style="width:200px;padding:10px;font-family:'Banzuke Sans';font-size:20px;font-weight:700">ramen 🍜 yum</div>`,
    { devicePixelRatio: 1, emoji: "from-font" },
  );
  assert.deepEqual([...png.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
});

test("renderPng: renders an HTML string containing entities", async () => {
  const png = await renderPng(
    `<div style="width:200px;padding:10px;font-family:'Banzuke Sans';font-size:20px;font-weight:700">A&amp;B &#39;q&#39;</div>`,
    { devicePixelRatio: 1 },
  );
  assert.ok(png.length > 200, `png too small: ${png.length}`);
  assert.deepEqual([...png.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
});
