---
name: banzuke
license: MIT
description: Generate and update banzuke (tier-list ranking) PNG images. Use when the user says they want to build / update / turn into an image a banzuke or tier list (anime, books, games, movies — anything). Scaffolds a small self-contained node project, then edits the data/code and re-renders HTML/PNG browserlessly.
---

# banzuke — tier-list ranking PNG generator

Turn banzuke data (a list of titles split into tiers) into a shareable PNG sheet.
No browser needed and roughly 300ms per sheet, so run the loop — edit → render →
look at the PNG → fine-tune — until it actually looks good.

**A successful render is not a finished task.** The deliverable is a visual artifact, and
the exit status tells you nothing about whether it looks right — a first sheet is routinely
lopsided, half-empty, or mis-ranked while rendering perfectly. The task is done only once
you have **opened `banzuke.png` as an image**, walked the checklist below against what you
actually see, and fixed what it turned up. Reporting the sheet as done without having viewed
it is a failed run, however clean the output looked.

## Model — the deliverable is a self-contained project the user keeps

One scaffolded directory *is* the finished deliverable:

```
my-banzuke/
  package.json + one lockfile        dependencies (takumi + the font you pick), pinned by the lock
  data.mjs                           banzuke data (edit this)
  banzuke.mjs                        sheet design + entry point (edit this)
  lib/                               rendering engine (bundled copy; modify it if you need to)
  banzuke.html / banzuke.png         output
  README.md                          embeds banzuke.png (repo landing page / GitHub Pages index)
```

- The user stores it however they like: git / zip / just a folder / Google Drive. Anywhere with
  the runtime it was scaffolded for, a frozen install plus one command reproduces it
- To update it, edit data.mjs or the code and run it again
- Updating this skill does not affect existing projects (everything is bundled)

## Requirements

- One of **node >=22**, **bun >=1.2** or **deno >=2**. None is privileged: the template ships a
  lockfile for each, and CI renders a real sheet on all three. Probe `node -v`, then `bun -v`,
  then `deno -V`, and scaffold for the first one the user already has
- **Do not install a runtime on your own if none of them is there** — talk to the user about it
  first (macOS: `brew install node`, otherwise https://nodejs.org). Given one, nothing else is needed
- The skill itself needs **no** setup. Dependencies land per project on the first install
  (network: registry.npmjs.org only, pinned by the lock)

## Basic workflow

Below, `$BANZUKE` = the directory containing this SKILL.md.

1. **scaffold** (only when creating a new project):

   ```bash
   cp -r "$BANZUKE/template" my-banzuke
   cd my-banzuke
   ```

   The template carries a lockfile for all three runtimes. Use the row for the one you probed,
   starting with its **prune** — the runtimes do not maintain each other's lockfiles, so the ones
   you leave behind go stale the moment the font lands in `package.json`, and a stale
   `package-lock.json` makes a later `npm ci` fail outright:

   | runtime | prune | install | add a package | render |
   |---|---|---|---|---|
   | node | `rm bun.lock deno.lock deno.json` | `npm ci` | `npm i <pkg>` | `node banzuke.mjs` |
   | bun | `rm package-lock.json deno.lock deno.json` | `bun install --frozen-lockfile` | `bun add <pkg>` | `bun banzuke.mjs` |
   | deno | `rm package-lock.json bun.lock` | `deno install --frozen` | `deno add npm:<pkg>` | `deno task render` |

   No font is bundled (see Fonts below). The package to add is the one the template's Typeface
   block already names — `@fontsource-variable/archivo` — so on node the last two steps read
   `npm ci` then `npm i @fontsource-variable/archivo`. Swap Archivo for something that fits the
   design and covers the data's script before you get attached to it.

   On deno, `deno task render` stands in for `node banzuke.mjs` everywhere below: the task in
   `deno.json` carries the permission flags the renderer needs, and it forwards extra arguments
   (`deno task render --draft`).

2. **Edit the data**: `data.mjs` — the tier structure (count, names, colors, layout) and items (in rank order)
3. **Run** the render command for the runtime → `banzuke.html` and `banzuke.png`
4. **Look at the sheet — mandatory, every time.** Open `banzuke.png` itself as an image (not the
   HTML, not the console output) and walk the whole checklist below against what you see
5. Fix and re-run. Visual fixes normally mean the "tuning knobs" block at the top of `banzuke.mjs`.
   Expect at least one round of this: a first sheet that needs no correction is rare
6. **Write a `README.md`** in the project directory (new projects only — it never needs updating,
   the image path stays the same across re-renders). It holds the sheet and nothing else:

   ```markdown
   # <the banzuke's title>

   ![<the banzuke's title>](banzuke.png)
   ```

   No build notes, no data dump, no install instructions — just the heading and the image, so that
   the sheet *is* the page. GitHub renders it on the repo's landing page, and GitHub Pages serving
   the branch root has no `index.html` to prefer, so it renders the same README as the site's top
   page. Both rely on the relative `banzuke.png` sitting next to the README, and on the PNG being
   committed — the template's `.gitignore` covers only `node_modules/`, so leave it that way

## Building banzuke data from a list of hundreds (triage UI)

When the user has a list but has not decided tiers or order yet, do not interview them —
use the bundled **`$BANZUKE/triage.html`** (a dedicated drag-and-drop + keyboard UI):

1. Read `triage.html` and produce a copy with a JSON array of titles injected into the
   `const TITLES = /*__DATA__*/[]` array (array order = the order they get judged in;
   most important first works well)
2. Hand it to the user in a form they can open in their browser — in Claude Code publish it
   as an Artifact, on claude.ai an interactive artifact, otherwise write it to a file for them to open
3. The user triages (fast pass: mash Space, then Enter), reorders, renames and moves cards
   between tiers (kanban board), then hits "Export" and **copies the data.mjs into chat** →
   save it as the project's data.mjs and render

Progress auto-saves to localStorage, so the user can do it across several sittings.
Feel free to edit the HTML directly if the UI needs a change (single file, no dependencies).

## Eyeball checklist — you fix what is broken

Read the PNG after every run and check these in order. When something trips, adjust the
matching knob and re-run.

### 1. Density — is it packed?

A banzuke is supposed to be densely filled. The sheet is pinned to a canvas
(`ASPECT`, 16:9 by default), so it always *fills* — which means too little data shows up as
stretched rows and oversized type rather than as blank space at the bottom.

- **Too much space inside rows** → raise `TYPE.*.rowFill`, or shift height between tiers with
  `TIER_WEIGHT`
- **The featured column looks stretched, with one or two enormous rows** → **this is a data
  problem, and no knob fixes it.** The band's height comes from the canvas, and the featured tier
  divides it into however many rows it has, so a lone item gets the whole band. Aim for **4–6
  featured items**. `TYPE.featured.cap` holds the text size while the row keeps its height, so a
  short tier gives you tall, mostly empty boxes — promote more titles, or drop `layout: "featured"`
  and let #1 lead the top ranked tier
- **A ranked or wall tier looks stretched** → re-tier in the data: merge it with its neighbour,
  or move its tail into the wall
- **Wall columns end at ragged heights** → adjust `WALL.em` or the number of items
- **The rows are cramped and the render warned about the ratio** → the data cannot fit the canvas
  even at `MAX_W`. Move titles into a wall tier, lower `WALL.sizes`, or raise `FEAT_ROW_MIN` to
  protect the top band's rows at the cost of a taller sheet
- **Font too thin, sheet looks washed out** → raise `T.weight` (250–900, continuously variable)

### 2. Alignment — any inconsistent margin / padding?

- Vertical rhythm at the start of rows: are the spine → number → title left edges aligned within a tier?
- Are the tier header's left/right padding (`PAD`) and the wall gutters constant across every tier?
- Are the rule weights used as intended: outer frame `BW` (8) > section `DIV` (4) > row `SEP` (2)?
- Do the outer margin (`GROUND`) and the inner padding look balanced on all four sides?

### 3. Hierarchy — does rank read at a glance?

- Is **#1 the largest thing on the sheet**? Is the featured row the biggest, shrinking monotonically downward?
  (fix inversions with `TYPE.*.cap` / `taper`)
- Monotonic across tiers too: last featured row > first ranked row > … > wall.
  If the wall looks bigger than ranked, lower `WALL.sizes`
- Are the spine colors stronger toward the top (`color` in data.mjs)? Are the rank numbers legible?

### 4. fitSpan sanity

- **Squashed too far** (horizontally crushed, hard to read) → drop the font size, use fewer
  columns so `avail` grows, or suggest a shorter wording to the user
- **Stretched until it looks empty** → lower `stretch` there (default: rows 1.5 / wall 2)
- **Overflowing or clipped** → fitSpan's `avail` disagrees with the real layout width. Check that
  you subtracted padding, spine, number width and rules
- **A blank line appears after a squashed title, or a column ends taller than its neighbours** →
  scaleX shrinks what is *drawn*, not what is *laid out*, so a squashed span still occupies its
  natural width and its box can take a second line box. **Any box holding a fitSpan needs a fixed
  height** — an explicit `height` (the wall rows do this) or a flex context that pins it
  (`flex:1` + `min-height:0`, which the numbered rows do)
- To add tracking, **pass it to fitSpan's `letterSpacing` option**
  (inheriting it from an outer style desyncs it from the measurement, which is what causes squashing and overflow)

### 5. Glyph sanity

- Any tofu (□)? → a glyph none of the registered fonts has. In **data**, change the wording or
  register a font that covers it. In the sheet's **own chrome**, delete the character — a rule or
  bar wants a `div`. Look at the decoration too, not just the titles: a stray `──` is only a
  couple of small boxes and reads as part of the design until you zoom in
- **Are the descenders of g / y / p cut flat?** → the box has `overflow: hidden` and a line box
  shorter than the font's glyph box. Use `line-height: ${LINE}` on it — never a bare 1.05 or 0.9.
  A face with tall metrics (any CJK font) needs ~1.45
- Any suspiciously thin text? → font-weight not specified. Always state it
- Are CJK glyphs rendering with Chinese shapes? → check `lang` is `"ja"` (renderFile defaults to `"ja"`)
- Do the Latin and CJK glyphs in one title look like two different typefaces? → that is the
  fallback doing its job, and it is usually fine. If it jars, set the whole sheet in the CJK family

### 6. Overall balance

- Do the title, total count and footer sit at sensible positions and sizes?
- Are the wall columns too many / too few (2–10 rows per column is a good target)?
- Does the sheet read as landscape, close to 16:9? A ratio near 1:1 or taller means the data
  overflowed even `MAX_W` — see "The canvas" below

## Tips for fixing things

### Data side (data.mjs) — suspect this first

- Most density and hierarchy problems are cured by re-tiering: trim the top, drop the bottom
  into a wall, split or merge tiers
- Array order = rank. Only the first `featured` tier takes effect
- **Ask the user before shortening** a title that is too long (never rename their titles yourself)

### Code side (banzuke.mjs / lib)

- **One change per run.** Change one knob, run, and compare against the previous PNG.
  While fine-tuning you can loop with `--draft` (dpr 1, ~3× faster) appended to the render
  command, but **always do the final check on a normal run** (dpr 2)
- The main knobs are all in the block at the top: `T` (colors, font, weight) / `TYPE`
  (cap, rowFill, taper, stretch) / `ASPECT`, `MIN_W`, `MAX_W` (the canvas) / `FEAT_ROW_MIN`,
  `TIER_WEIGHT`, `MIN_RANK_UNIT` (height distribution) / `RANK_COLS`, `RANK_COL_W`, `FEAT_MAX_W`
  (how a wide canvas is filled) / `WALL` (sizes, em, stretch)
- It is a plain script on every runtime, so console.log and the debugger work normally. When you
  suspect the structure, read the generated `banzuke.html`
- Rebuilding the layout from scratch is fine. Pre-compute the px yourself
  (never ask the renderer for calc). lib/ is part of the project too — modify it if needed

## Fonts — the skill ships none, every project picks its own

**No font is bundled.** The renderer starts empty, and the **Typeface block at the top of
`banzuke.mjs`** installs and registers what the sheet uses. Treat this as a real design decision
per project, not boilerplate: the face carries most of the sheet's character, and it has to cover
every script in the data.

### Choosing one

Two questions, in this order:

1. **Which scripts are in `data.mjs`?** A glyph no registered font covers renders as tofu (□).
   Latin-only data is the easy case; Japanese/Chinese/Korean titles need a CJK face; accented
   Latin (café, Öl, Škoda) needs the `latin-ext` subset as well as `latin`
2. **What should it feel like?** Grotesque for a poster-like sheet, monospace for a terminal look,
   condensed for a board, didone for a broadsheet. Ask the user if they have a preference

Reach for a variable font where you can: the sheet leans on weight (`T.weight`, and fitSpan
lightens glyphs when it stretches them), so a continuous 100–900 axis beats a couple of statics.

### Installing and registering

Install into the project with the add command for its runtime (`npm i` / `bun add` /
`deno add npm:`), then name the file(s) in `FONT_FILES`:

```bash
npm i @fontsource-variable/archivo      # or oswald / jetbrains-mono / bodoni-moda / …
```

```js
const FONT_FILES = {
  [FONT_FAMILY]: "@fontsource-variable/archivo/files/archivo-latin-wght-normal.woff2",
  [`${FONT_FAMILY} Ext`]:
    "@fontsource-variable/archivo/files/archivo-latin-ext-wght-normal.woff2",
};
```

- **The npm registry is the way to get fonts** (all three runtimes install from it). Fontsource
  (`@fontsource-variable/*`) covers most Latin families; CJK faces are published too
  (e.g. `@fontpkg/source-han-sans-jp-vf`).
  **Never download a font from the internet yourself** — if npm has nothing suitable, ask the
  user to supply the file and read it with `readFile` + `registerFont({ name, data })` instead
- ttf / otf / ttc / woff / woff2 all work. `registerFontPackage(name, specifier)` resolves the
  file out of the project and, if it is not installed, fails with the add command to run
- **A family you name in a style must be one you registered.** takumi does not complain about an
  unknown family — it silently falls back to another registered font, so the sheet still renders,
  just in the wrong face and with every measured width wrong
- Check the licence covers redistribution before committing a font file into the project

### The subset rule

**A registered font is also a fallback for every other family** — takumi resolves a missing glyph
by trying all of them. Two consequences worth knowing:

- Fontsource ships **one file per unicode subset**. Register **each subset under its own family
  name** (`"X"`, `"X Ext"`, …) and the fallback stitches the typeface back together. Registering
  only `latin` is what turns é and ř into tofu
- **Those subsets cover text, not symbols.** A family is split into `latin`, `latin-ext`, `greek`,
  `cyrillic(-ext)` and `vietnamese` — box drawing (U+2500+), arrows, dingbats and geometric shapes
  sit in **none** of them, even for a coding face whose source TTF draws them. So there is no
  subset to register for those: draw the shape with a `div` instead of typing the character
- **Adding a script is just another registerFont.** Register a CJK face alongside the Latin one
  and Japanese titles resolve on their own — you never name it in `T.font`. The Latin and CJK
  glyphs will be two different typefaces, which usually reads fine; set the whole sheet in the
  CJK family if it jars

### After changing the typeface

- Every measurement changes, so re-render and walk the whole checklist again — density and
  fitSpan health especially
- Check `LINE`: a face with tall metrics (any CJK font) needs ~1.45 or clipped boxes crop the
  descenders of g / y / p
- Check the weight actually exists in the file. A static font ignores `T.weight: 800` and renders
  at whatever it has

## When you want to show several design options (optional)

Usually polishing one template is enough. Only when the user is torn on the design is it worth
mass-producing candidates for them to pick from:

- Copy `banzuke.mjs` (`banzuke-dark.mjs`, …), change the output filenames in the entry point,
  run them in turn and compare. At 300ms a sheet, make as many as you like
- Options land best when **the whole visual language and composition** differ (a sumo-banzuke
  style with a vertical title and east/west spread, a terminal look, a tile grid, a departure
  board — rewriting the layout wholesale is fine). Save color/weight micro-variants for the
  final polish once a direction is picked
- Eyeball them all yourself, cut the weak ones, and show the user **3–6 options** with a
  one-line note each. Delete the rejects and their output once a choice is made
- When a copy transforms the data, do it non-destructively (`data.tiers.map((t) => ({ ...t, … }))`)

## The canvas — why sheets are 16:9

The sheet is pinned to a target ratio rather than growing downward with the data. Social previews
(X in particular) **center-crop** anything much taller than landscape, and on a banzuke the first
thing cropped away is the top of the ranking — the whole point of the sheet.

So `geometry()` in `banzuke.mjs` solves the canvas before any markup is built: it walks candidate
widths from `MIN_W` to `MAX_W` and takes the narrowest one whose `ASPECT` height holds the data.
More titles means a *wider* sheet with more wall columns, not a longer one. The top band takes
whatever the masthead, walls and footer leave over, which is why the featured row height is
derived rather than set.

- Very dense data can miss the ratio even at `MAX_W`. The sheet then renders at the cap, slightly
  taller than the target, with the band at whichever of its two floors binds. A little over is
  fine — 1.7:1 still posts uncropped
- The render **warns** only when the result is still taller than square, which is genuinely
  croppable. Take that warning seriously: thin the walls or re-tier
- `ASPECT` is width ÷ height, so **lowering** it makes the sheet taller and brings the crop back:
  below about 1:1 you are croppable again. Raising it — a wider, shorter sheet — is always safe

A wide canvas is filled by splitting tiers into more columns, not by stretching rows. `RANK_COLS`
is `"auto"` for that reason — but note that more columns means *taller* rows, since fewer rows
share the same band. So auto stops short of any split that would let a ranked tier's first title
out-type the featured tier's last one. Rank has to read by size; a gappy row is the cheaper price.
Pin `RANK_COLS` to a number when you want to overrule that.

## Constraints — write for takumi's CSS subset

The renderer is takumi (written in Rust, successor to satori). It is not a browser, so:

- **Build with flex + pre-computed px only**. No `clamp()`, no CSS multicol (`columns:`),
  no pseudo-elements (`::before`), no `position: fixed`, no grid `fr`
- **Write inline styles.** No `<style>` blocks, no classes
- **Variable-length text goes through `fitSpan()`, plain text through `esc()`**
  (a missed escape shows up as broken or mangled output)
- **Always specify font-weight** (an unstated weight renders far lighter than you expect)
- **Draw rules, bars and dividers as a `div`** (`height:1px;background:…`), never as box-drawing
  characters (`──`, `│`, `├`). No Fontsource subset ships those glyphs, so they render as tofu
- **Any box that clips (`overflow: hidden`) needs an explicit `line-height`** — `LINE` in the
  template. A line box shorter than the font's glyph box crops descenders (g / y / p)
- **Always put the generation date "YYYY-MM-DD edition" somewhere on the sheet** (so the version
  is identifiable). The default template puts it in the top right of the masthead (below the item
  count) automatically. Keep the date even if you rebuild the layout from scratch
- Emoji work (takumi-js fetches twemoji from a CDN and renders them in color).
  With no network, a render containing emoji fails — pass `{ emoji: "from-font" }` to renderFile then
- Avoid rotate / writing-mode. For vertical text, stack one character per line

## lib/index.mjs API

```js
import {
  fitSpan, fit, measureWidth, esc,
  renderFile, renderPng, pngSize,
  registerFont, FONT_FAMILY,
} from "./lib/index.mjs";
```

- `renderFile(html, outPath, opts?)` → `{ path, width, height, ms, bytes }` —
  the main entry point. opts: `{ width?, devicePixelRatio?, lang?, html? }`
  (passing a path as `html` also writes out the input HTML)
- `fitSpan(text, { size, avail, stretch?, weight?, family?, letterSpacing?, origin?, style? })`
  → a pre-measured `<span>` string (`origin`: transform-origin. Defaults to "left center";
  use "right center" when squashing right-aligned text)
- `fit(text, opts)` → `{ scale, weight }` / `measureWidth(text, opts)` → natural width in px
- `esc(s)` — HTML escape
- `registerFontPackage(name, specifier)` / `registerFont({ name, data })` — the only way a glyph
  gets drawn; nothing is bundled. A package that is not installed throws with the add command
  for the runtime you are on
- `FONT_FAMILY` — the family name the template registers its typeface under

## Troubleshooting

- **A style has no effect / the layout is broken**: read the generated `banzuke.html` and check
  the values came through and the structure is what you intended. CSS takumi does not support
  shows up there
- **The run throws**: the stack points straight at the line in your own script. fitSpan throws
  an explicit error telling you to revisit the math when `avail` is <= 0
- **Dependencies will not install**: run the install command for the project's runtime
  (`npm ci` / `bun install --frozen-lockfile` / `deno install --frozen`) inside the project, and
  check its lockfile got copied along. "lock file out of sync" or a frozen-install failure
  usually means a package was added with a different runtime's tool than the one the project
  was scaffolded for
- **deno: `NotCapable: Requires … access`**: the run is missing a permission. Use `deno task render`
  rather than a bare `deno run` — the task in `deno.json` carries the full set
