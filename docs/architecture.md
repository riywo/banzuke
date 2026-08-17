# How banzuke works

A tour of the moving parts, for anyone curious about what happens between "I want to make a
banzuke" and a PNG. Nothing here is needed to *use* the skill.

## The one idea

**The skill ships instructions plus a project scaffold. The agent is the runtime.**

There is no banzuke server, CLI or API — installing it drops a directory of Markdown and a
copyable template that your agent reads and edits on your disk. That has two consequences worth
knowing:

- **The deliverable is the project, not the image.** The agent leaves behind a folder with the
  data, the sheet's code, a lockfile and the rendered PNG. You keep it, edit it, re-render it
  years later. Updating the skill does not touch it — everything it needs was copied in.
- **The loop is visual, not mechanical.** A render that exits 0 says nothing about whether the
  sheet looks right, so SKILL.md makes the agent open the PNG as an image and walk a checklist
  (density, alignment, hierarchy, glyphs) before it is allowed to call the job done.

## What's in the repo

```
skills/banzuke/          ← the product; everything below this line is shipped to users
  SKILL.md                 the instructions the agent reads: workflow, eyeball checklist,
                           tuning-knob guide, font rules, takumi's CSS limits
  template/                the project that gets copied into the user's directory
  triage.html              a standalone drag-and-drop UI for tiering a long list
  agents/openai.yaml       extra metadata for agents that want it

samples/                 the six themed sheets in the README, each a plain script
test/ · scripts/ · e2e/  what keeps the shipped half honest (see Testing below)
.github/workflows/       CI, the agent e2e run, and the rolling banzuke.zip release
```

`skills/banzuke/` imports nothing from the rest of the repo — it is copied out and has to stand
alone. That is why `SKILL.md` restates the runtime commands that `scripts/runtimes.mjs` also
encodes, and why a test asserts the two still agree.

## The template project

`cp -r template my-banzuke` and you have this:

```
my-banzuke/
  data.mjs        the banzuke: tiers (name, color, layout) and items in rank order
  banzuke.mjs     the sheet design — tuning knobs at the top, then HTML-building functions
  lib/            the rendering engine, bundled
  package.json + one lockfile
  banzuke.html    the HTML that was rendered (written out for debugging)
  banzuke.png     the sheet
```

`data.mjs` is *what* is ranked; `banzuke.mjs` is *how it looks*. Most fixes are one of the two:
re-tier the data, or move one constant in the tuning-knob block at the top of `banzuke.mjs` and
re-run. Both files are meant to be edited — rebuilding the layout from scratch is a supported
outcome, not a hack.

Three tier layouts compose one sheet: `featured` (the big left column), `ranked` (numbered
two-column blocks on the right) and `wall` (a dense unnumbered block at the bottom).

## The render pipeline

```
data.mjs ──▶ banzuke.mjs ──▶ HTML string ──▶ takumi (Rust) ──▶ banzuke.png
                  │                              ▲
                  └── fitSpan(): measure ────────┘
                      the text first, bake
                      scaleX into the span
```

`banzuke.mjs` builds one HTML string with inline styles and hands it to
[takumi](https://www.npmjs.com/package/takumi-js) — a Rust layout/raster engine, the successor to
satori — via `lib/render.mjs`. No browser, no headless Chrome, roughly 300 ms a sheet. That speed
is what makes the edit → render → look → tune loop practical.

The price is that takumi is not a browser. It implements a subset of CSS — flex and pre-computed
pixels, no `clamp()` or grid `fr` or `<style>` blocks — and SKILL.md carries the full list,
because the agent has to write within it.

### Why fitSpan exists

A browser has no way to shrink text to fit a box either, and takumi certainly doesn't. So the
template does it manually, before rendering: `fit()` asks takumi to *measure* the text, computes
the `scaleX` that would make it fit the available width, and `fitSpan()` returns a `<span>` with
that transform (and font size, weight, family and tracking) baked into its inline style. Stretched
text gets its weight lightened to compensate, so a widened title does not turn into a fat blob.

The subtle part, and the source of most layout bugs: `scaleX` changes what is *drawn*, not what
is *laid out*. A squashed span still occupies its natural width, so any box holding one needs a
fixed height or it can silently take a second line.

### Solving the canvas before the markup

The template solves its canvas before building markup. `geometry()` is pure integer arithmetic —
wall column counts, row counts, tier heights, no text measurement and no rendering — so searching
every candidate width between `MIN_W` and `MAX_W` costs nothing, and the sheet can be pinned to a
target aspect ratio instead of growing downward with the data. Everything the boxes need (the
canvas, the band height, the derived featured row height, per-tier ranked heights, the wall plan)
comes out of one call, which also makes the layout assertable in tests without a render.

### lib/ at a glance

| module | job |
|---|---|
| `engine.mjs` | one process-wide takumi renderer (native, wasm fallback); font registration, including resolving a font file out of an installed npm package |
| `measure.mjs` | `measureWidth()` and `fit()` — the scale/weight math |
| `fit-span.mjs` | `fitSpan()` — `fit()` plus the pre-measured `<span>` |
| `render.mjs` | HTML → takumi node tree → PNG → file, returning size and timing |
| `entities.mjs` | `esc()`, and the pre-pass that decodes entities in text nodes (takumi's `fromHtml` decodes them in attributes only) |
| `png.mjs` | PNG dimensions straight from the IHDR header, with no renderer loaded |

## Fonts: none bundled, one per project

The renderer starts with zero fonts. Each project installs its own from npm (Fontsource and
friends) and registers it in the Typeface block at the top of `banzuke.mjs`.
That is deliberate: the typeface carries most of a sheet's character, and it also has to cover
every script in the data — a glyph no registered font has renders as tofu (□).

One mechanism explains most font behavior: **a registered font is a fallback for every other
family**. Fontsource ships one file per unicode subset, so registering `latin` and `latin-ext`
under two names stitches the typeface back together — and registering a CJK face alongside a
Latin one is all it takes for Japanese titles to resolve.

## Three runtimes, three lockfiles

node, bun and deno are equally supported. The template carries one `package.json` and a lockfile
for each; the scaffold step deletes the two the user didn't pick, because the runtimes don't
maintain each other's locks and a stale `package-lock.json` breaks a later `npm ci` outright.

`scripts/runtimes.mjs` is the single table of what each runtime owns and how it is driven —
which files to prune, how to regenerate its lock, how to install frozen, how to add a package,
how to render. `scripts/locks.mjs --check` regenerates all three in a temp copy and compares
*what they pin* (name@version) rather than their bytes, so a new npm or bun spelling its own
output differently doesn't read as repo drift.

## Long lists: triage.html

Deciding tiers for 300 titles is not something to do through a chat interview. `triage.html` is a
single dependency-free page the agent fills with your titles and hands you to open: a fast
keyboard pass to sort items into tiers, then a kanban board to reorder and rename, then Export
spits out a `data.mjs` you paste back. Progress is saved in localStorage, so it survives being
done over several sittings.

## Testing

The unusual part of this project is that half the product is prose, so the tests come in layers:

- **`test/`** — the template's code: unit tests for the lib, layout tests that run `sheet()`
  against awkward data shapes (no featured tier, walls only, empty tiers), and project tests that
  scaffold a copy and render it end to end.
- **`scripts/smoke.mjs`** — the *deliverable*: copy the template, prune to one runtime, install
  from its own lockfile, add the font, render. CI runs it on all three runtimes, which is what
  keeps the bun and deno promises in SKILL.md honest.
- **`e2e/`** — the *instructions*: a real agent (Copilot CLI in Actions) gets a user-style request
  that never names the skill, and `e2e/check.mjs` verifies what it left behind — a complete
  project, every title on the sheet, and evidence the PNG was actually looked at.

## Distribution

`skills/banzuke/` is the unit of distribution, so every install route in the
[README](../README.md#install) is just a copy of that directory landing somewhere your agent
looks. The one piece with machinery behind it is the claude.ai zip: `release-skill.yml` rebuilds
it from `main` on every push with `git archive`, which also keeps untracked files out of it.
