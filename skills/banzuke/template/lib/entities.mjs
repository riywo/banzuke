// takumi's fromHtml (@takumi-rs/helpers 2.5.4) decodes HTML entities in attribute values but
// not in text nodes. Without this, the `&#39;` and friends that esc() below produces would be
// drawn literally, so we undo them here just before rendering
// (NAMED must cover every entity esc() can emit).
//
// Scope: esc()'s output plus numeric references only. The full WHATWG named entity set
// (&mdash; etc.) is out of scope — in a raw HTML string passed to renderPng those render as
// literal text. Case is significant, per the HTML spec (&Amp; is invalid, so leave it alone).
const NAMED = {
  amp: "&",
  AMP: "&",
  lt: "<",
  LT: "<",
  gt: ">",
  GT: ">",
  quot: '"',
  QUOT: '"',
  apos: "'",
  nbsp: " ",
};

/** Escape text for embedding in HTML. Always use it in templates. */
export const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export function decodeHtmlEntities(s) {
  return s.replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body) => {
    if (body[0] === "#") {
      const hex = body[1] === "x" || body[1] === "X";
      const cp = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (Number.isNaN(cp)) return match;
      // HTML's character reference substitution rules: NUL, surrogates and out-of-range → U+FFFD
      if (cp === 0 || (cp >= 0xd800 && cp <= 0xdfff) || cp > 0x10ffff) return "�";
      return String.fromCodePoint(cp);
    }
    return NAMED[body] ?? match;
  });
}

/** Decode every text node in a takumi node tree, in place. */
export function decodeTextEntities(node) {
  if (typeof node.text === "string") node.text = decodeHtmlEntities(node.text);
  if (Array.isArray(node.children)) {
    for (const child of node.children) decodeTextEntities(child);
  }
  return node;
}
