# Pinned-aspect banzuke sheets

## Problem

The template fixes the sheet's width (`FRAME = 1024`) and lets height grow with the data. A
banzuke of a few hundred titles therefore comes out around 1:2 tall. X bounds the aspect ratio of
a single-image timeline preview and **center-crops** anything taller, taking a slice off the top
as well as the bottom — so the highest ranks, which are the entire point of a banzuke, are the
first thing to disappear. 16:9 landscape is the ratio that reliably displays uncropped on both
desktop and mobile.

Growing downward is a choice, not a constraint. The sheet's layout math is analytic — every tier
height comes from integer arithmetic — so the sheet can be solved onto a target canvas instead,
absorbing extra content sideways into more wall columns.

## Decision

Every sheet renders onto an exact target canvas whose ratio is a knob, defaulting to 16:9. The
canvas's absolute size is solved from the content: width grows with the data so type stays
comfortable, capped at 2048 CSS px (4096 device px at dpr 2, inside X's ceiling). Past the cap,
density absorbs the rest.

This is the inversion `samples/build/bauhaus.mjs` already performs by hand against a fixed
1072×1072 canvas: wall geometry is computed first, the top band takes whatever is left, and the
featured row height is *derived* from the band rather than given as an input. The change folds
that inversion back into the template and makes the canvas solved rather than hardcoded.

## Geometry solver

A pure-arithmetic pass, run before any markup is built. No rendering, no text measurement — wall
column counts and row counts are integer math — so the search costs nothing.

### Per-candidate-width formulas

For a candidate sheet width `W`:

```
H          = round(W / ASPECT)                        // 16:9 → W × 9/16
inner      = W - 2*GROUND - 2*BW
innerH     = H - 2*GROUND - 2*BW

wallsH     = Σ over wall tiers:  HDR_H + DIV + 8 + rows*(round(LINE*size) + 2) + 10 + DIV
             where cols = wallCols(n, size*WALL.em, inner), rows = ceil(n / cols)

bandBudget = innerH - (MAST_H + BW) - wallsH - FOOT_H
```

`FOOT_H = 34` (the footer's 10px padding plus its line box), matching the constant
`samples/build/bauhaus.mjs` already uses.

### The fit test

The band must clear both of its floors:

```
rankedFixed  = ranked.length*HDR_H + max(0, ranked.length - 1)*DIV
weightedRows = Σ rankedRows[i] * TIER_WEIGHT^(ranked.length - 1 - i)      // as today

bandMin = max(
  featRows > 0 ? HDR_H + featRows*FEAT_ROW_MIN : 0,
  rankedFixed + weightedRows*MIN_RANK_UNIT
)
```

`W` is accepted when `bandBudget >= bandMin`.

### The search

Walk `W` from `MIN_W` upward in `STEP` increments to `MAX_W`, and take the first accepted width.
The search always converges when a fitting width exists: `innerH` grows with `W`, while `wallsH`
shrinks as the walls gain columns and `bandMin` is non-increasing (its ranked term falls as
`RANK_COLS` resolves upward — see below — and its featured term does not move at all).

If no width in range is accepted, keep `MAX_W`, give the band exactly `bandMin`, and let the sheet
run past the target ratio rather than crushing its rows into it. Overflowing a little is harmless —
a 1.6:1 sheet still posts uncropped — so the render warns only when the result is still **taller
than square** (`SAFE_ASPECT`), which is the shape previews genuinely cut the top off. The warning
names the fix: move titles into a wall tier, or lower `WALL.sizes`.

### Deriving the layout

Given the solved `W`:

```
bandH    = bandBudget(W)                            // the band absorbs all slack
featRowH = (bandH - HDR_H) / featRows                // feeds tierSizes("featured", …)
unit     = (bandH - rankedFixed) / weightedRows      // feeds rankedHeights, as today
```

With no featured tier the ranked blocks stack and divide `bandH` by the same weights, which is
what removes the need for `LONE_ROW_H`.

## Width absorption

Widening the sheet without reflowing the numbered tiers would push their rows toward 500px+ each,
where `fitSpan` stretches short titles to its ceiling and leaves the rest as trailing whitespace —
the "stretched until it looks empty" failure the skill already warns about. Two column widths
therefore become width-aware:

- `RANK_COLS` accepts `"auto"` (the new default) alongside an integer. Auto wants
  `clamp(round(rightW / RANK_COL_W), 1, 4)` with `RANK_COL_W = 300`, **bounded by rank hierarchy**:
  splitting a tier into more columns leaves fewer rows sharing the same band, which makes each row
  *taller*, so an unbounded auto lets a ranked tier's first title out-type the featured tier's last
  one — the one thing the eyeball checklist will not accept. Auto therefore steps down from its
  preferred count until `unit ≤ featRowH × (featured.rowFill × featured.taper) ÷ (ranked.rowFill ×
  max weight)`, a ceiling derived from the type knobs rather than guessed. Gappy rows are the
  cheaper failure. Resolved inside the search loop, since it changes `rankedRows` and `weightedRows`.
- The featured column stops scaling linearly: `featW = min(round(inner * FEAT_SPLIT), FEAT_MAX_W)`
  with `FEAT_MAX_W = 620`. Whatever it gives up goes to the ranked side.

Both defaults are starting points to settle in the render-and-eyeball loop, not derived values.

## Template restructure

- A single `geometry(data)` returns `{ sheetW, sheetH, inner, bandH, featRowH, unit, rankCols,
  featW, wallPlan, clamped }` and is **exported**, so tests can assert the solve directly instead
  of parsing markup.
- `FRAME`, `INNER` and `SHEET_W` stop being module-level constants. The parts that read them today
  (`row`, `rankedTier`, `wallTier`, `wallCols`, the masthead measurement) take what they need as
  parameters — `wallCols(n, em, avail)` in particular.
- The sheet root carries an explicit `height` alongside its width, with the framed inner div on
  `flex:1`, exactly as `bauhaus.mjs` does.
- The entry point's log line reports the solved canvas and says so when the width was clamped.

## Knobs

| Knob | Change |
|---|---|
| `ASPECT` | new — target ratio, default `16/9` |
| `SAFE_ASPECT` | new — `1`; below this the render warns that the sheet is still croppable |
| `MIN_W` / `MAX_W` | new — 1024 / 2048 CSS px (the outer canvas, margins included) |
| `STEP` | new — 16px search granularity |
| `FOOT_H` | new — 34px; the footer gets an explicit height so the height math is exact |
| `FEAT_ROW_MIN` | new — 30px legibility floor for a featured row |
| `RANK_COL_W` / `FEAT_MAX_W` | new — 300 / 620, the width-absorption targets above |
| `RANK_COLS` | now accepts `"auto"` (default) as well as an integer |
| `FEAT_ROW_H` | **removed** — derived from the band |
| `LONE_ROW_H` | **removed** — derived from the band |
| `TYPE`, `WALL`, `TIER_WEIGHT`, `MIN_RANK_UNIT`, `FEAT_SPLIT` | unchanged |

## Documentation

`SKILL.md`:

- **Eyeball checklist §1 (Density)** is written for a grow-to-fit sheet and stops being true. The
  27/44/61/78/95% featured-fill table and "raise `FEAT_ROW_H`" both go. The replacement inverts
  the reading: the sheet always fills its canvas, so too little data shows up as *stretched* rows
  and over-large type, and the fixes are data (promote more titles) or a taller `ASPECT`.
- **Tips → Code side** lists the main knobs; swap `FEAT_ROW_H` for the new canvas knobs.
- A short new section explains why sheets are 16:9 — social previews center-crop taller images —
  and warns that changing `ASPECT` past roughly 1:1 reintroduces cropping on X.

`docs/architecture.md` gains a paragraph on the geometry solve, placed with the other
layout-math notes.

## Tests

In `test/layout.test.mjs`, which already calls the scaffolded `sheet()` in-process:

1. The solved canvas matches `ASPECT` (within rounding) for the shipped data and the 75-title
   fixture.
2. Sparse data stays at `MIN_W`; a new ~400-title fixture reaches `MAX_W`.
3. An over-dense fixture (one that cannot clear `bandMin` at `MAX_W`) still returns a sheet, sets
   `clamped`, and warns rather than emitting rows below the floor.
4. `RANK_COLS: "auto"` resolves upward as the sheet widens, and an explicit integer is honoured.
5. The existing contracts hold: one line per wall item, remainder spread across columns, a
   featured tier with no ranked tier still gets its band.

`test/project.test.mjs` keeps asserting that an untouched scaffold renders; its PNG dimensions now
also carry the ratio.

## Out of scope

- `samples/build/*` keeps its own square canvas. It exists so sample sheets line up in the
  README grid, not to be shareable.
- No companion share-card output. The sheet itself becomes postable, which is the point.
- No change to how the README embeds the PNG — the path is unchanged.

## Risks

- **Type gets smaller on dense sheets.** At the cap the band is shorter than today, so featured
  rows shrink: prototyped against ~390 titles, the featured tier sets at 30→20px against today's
  46→31px (ranked 19→15, walls 14/11/9.5 — still monotonic). The top of a big sheet reads less
  large than it does now. That is the trade for having it visible at all.
- **The absorption defaults are guesses.** `RANK_COL_W` and `FEAT_MAX_W` decide whether wide
  sheets look composed or gappy, and only rendering will tell. Budget a tuning pass.
- **Sparse sheets with no wall tier** have nothing to absorb slack, so the band stretches and the
  type caps stop it from filling. Documented as a data problem, not a knob.
