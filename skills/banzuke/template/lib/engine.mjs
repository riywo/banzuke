/**
 * Family name the sheet's typeface is registered under.
 *
 * **No font ships with this library.** The renderer starts empty and banzuke.mjs registers a
 * font under this name — see the Typeface block at the top of that file. Choosing the face is
 * a per-project decision: it has to suit the design *and* cover every script in the data, and
 * a glyph no registered font has renders as tofu (□).
 */
export const FONT_FAMILY = "Banzuke Sans";

/** Language tag for CJK glyph selection. Measuring and drawing must agree, so both default here. */
export const DEFAULT_LANG = "ja";

// The 8 MiB default thrashes the glyph cache once a large font is in play (takumi docs).
const GLYPH_CACHE_BYTES = 32 * 1024 * 1024;

let rendererPromise;

async function createRenderer() {
  let renderer;
  try {
    const core = await import("takumi-js/node");
    core.setGlyphCacheMaxBytes(GLYPH_CACHE_BYTES);
    renderer = new core.Renderer();
  } catch (nativeError) {
    // wasm fallback for platforms without a napi binary (self-initializing entry).
    // takumi-js depends on @takumi-rs/wasm, but package.json names it too, and must keep doing
    // so: deno refuses to import a bare specifier the project does not itself declare, which
    // left this fallback unreachable there.
    try {
      const wasm = await import("@takumi-rs/wasm/node");
      wasm.setGlyphCacheMaxBytes?.(GLYPH_CACHE_BYTES);
      renderer = new wasm.Renderer();
    } catch (wasmError) {
      throw new AggregateError(
        [nativeError, wasmError],
        "cannot initialize takumi (both native and wasm failed)",
      );
    }
  }
  return renderer;
}

/** Process-wide takumi Renderer. Starts with no fonts — register what the sheet needs. */
export function getRenderer() {
  rendererPromise ??= createRenderer();
  return rendererPromise;
}

/**
 * Register a font: `{ name, data }` (data is the font file's bytes).
 * Use the registered name as the CSS font-family. Registering a font also makes it a
 * fallback for glyphs the primary family is missing.
 */
export async function registerFont(font) {
  return (await getRenderer()).registerFont(font);
}

/**
 * The command that adds an npm package under whichever runtime is running this project.
 * Handing a bun user `npm i` is not just noise: it would install against the wrong lockfile
 * and leave the project with two disagreeing dependency sets.
 */
function addPackageCommand(pkg) {
  if (globalThis.Deno) return `deno add npm:${pkg}`;
  if (globalThis.process?.versions?.bun) return `bun add ${pkg}`;
  return `npm i ${pkg}`;
}

/**
 * Register a font file from an installed npm package, e.g.
 * `registerFontPackage(FONT_FAMILY, "@fontsource-variable/archivo/files/archivo-latin-wght-normal.woff2")`.
 *
 * Resolution is relative to this project, and a package that is not installed fails with the
 * command that fixes it rather than a bare module-not-found.
 */
export async function registerFontPackage(name, specifier) {
  const { createRequire } = await import("node:module");
  const { readFile } = await import("node:fs/promises");
  let file;
  try {
    file = createRequire(import.meta.url).resolve(specifier);
  } catch {
    const pkg = specifier
      .split("/")
      .slice(0, specifier.startsWith("@") ? 2 : 1)
      .join("/");
    throw new Error(`Font not installed: ${specifier}\n  run: ${addPackageCommand(pkg)}`);
  }
  return registerFont({ name, data: await readFile(file) });
}
