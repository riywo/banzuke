/**
 * Family name the sheet's typeface is registered under. No font ships with this library —
 * banzuke.mjs registers one under this name.
 */
export declare const FONT_FAMILY: string;

/** Language tag for CJK glyph selection; the default for both measuring and drawing. */
export declare const DEFAULT_LANG: string;

export interface MeasureOptions {
  /** Font size (px) */
  size: number;
  /** Default 800 */
  weight?: number;
  /** Default FONT_FAMILY */
  family?: string;
  /** Default "ja" */
  lang?: string;
  /** Tracking (a number in px, or a string such as "0.04em"). Must match the drawing side exactly */
  letterSpacing?: number | string;
}

/** Natural width (px) of a single line of text. */
export declare function measureWidth(content: string, options: MeasureOptions): Promise<number>;

export interface FitOptions extends MeasureOptions {
  /** Available width (px). Throws unless positive */
  avail: number;
  /** Stretch ceiling. 1 = shrink only (default). Values below 1 are treated as 1 */
  stretch?: number;
}

export interface Fit {
  scale: number;
  weight: number;
}

/** fitSpan's math: pre-computes scaleX and the weight correction. */
export declare function fit(content: string, options: FitOptions): Promise<Fit>;

export interface FitSpanOptions extends FitOptions {
  /** transform-origin (default "left center"; use "right center" when squashing right-aligned text) */
  origin?: string;
  /** Extra CSS declarations to append to the span */
  style?: string;
}

/**
 * Pre-measured FitText: returns a <span> HTML string with scaleX (and, when stretching,
 * the weight correction) baked into its inline style.
 */
export declare function fitSpan(text: string, options: FitSpanOptions): Promise<string>;

/** Escape text for embedding in HTML. Always use it in templates. */
export declare function esc(s: unknown): string;

export interface RenderOptions {
  /** CSS px. Omit to auto-fit the content width */
  width?: number;
  /** Default 2 */
  devicePixelRatio?: number;
  /** Default "ja" */
  lang?: string;
  /**
   * Emoji source (takumi-js). The default, twemoji, fetches from a CDN, so switch to
   * "from-font" only when using emoji with no network
   */
  emoji?: string;
}

/** Turn an HTML string into a PNG. */
export declare function renderPng(html: string, options?: RenderOptions): Promise<Uint8Array>;

export interface RenderedFile {
  path: string;
  width: number;
  height: number;
  ms: number;
  bytes: number;
}

export interface RenderFileOptions extends RenderOptions {
  /** When set, the input HTML is also written to this path */
  html?: string;
}

/**
 * renderPng + writing the file out. The main entry point for scripts.
 * The output directory is created automatically.
 */
export declare function renderFile(
  html: string,
  outPath: string,
  options?: RenderFileOptions,
): Promise<RenderedFile>;

/** Read the dimensions out of PNG bytes (IHDR). */
export declare function pngSize(png: Uint8Array): { width: number; height: number };

/** Register a font. Use `name` as the CSS font-family; it also becomes a fallback for others. */
export declare function registerFont(font: {
  name?: string;
  data: Uint8Array;
  weight?: number;
  style?: string;
}): Promise<unknown>;

/**
 * Register a font file from an installed npm package. Throws with the `npm i` command to run
 * when the package is missing.
 */
export declare function registerFontPackage(name: string, specifier: string): Promise<unknown>;

/** Process-wide takumi Renderer. Starts with no fonts registered. */
export declare function getRenderer(): Promise<unknown>;

/**
 * Decodes the HTML entities takumi leaves behind (not normally called directly).
 * Scope is the basic five (plus nbsp) and numeric references only — the full WHATWG
 * named entity set is out of scope.
 */
export declare function decodeHtmlEntities(s: string): string;
