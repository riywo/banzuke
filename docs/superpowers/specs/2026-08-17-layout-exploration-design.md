# Layout exploration: a band grid the agent can rearrange, and a way to score the result

## Problem

The sheet's top band has one shape: a featured column on the left, ranked tiers stacked down the
right. Every other arrangement — two tiers side by side, a long tier packed as a wall inside the
band, a tier without rank numbers — requires rewriting `sheet()` by hand.

That matters because the interesting design question for a dense banzuke is exactly which
arrangement to use. Working a real 388-title sheet through this by hand, the same rearrangement
moved it from **0.53:1 (cropped by X)** to **1.78:1** while making the top ranks *larger*, not
smaller. None of that was reachable by turning the existing knobs.

The second half of the problem: the agent had no way to tell whether a candidate was actually
better. "Denser" and "the top stands out" were eyeballed from downscaled PNGs, and eyeballing got
two things wrong that measurement caught immediately:

- Compressing the two bottom tiers *felt* like it should raise density. Measured, it does not:
  ink coverage went 27.8% → 25.5% at a fixed width, because 65% of the characters live in those
  tiers. The saved height inflated row heights the type caps could not use.
- A cell whose content was shorter than its row left a blank strip that read as a rendering bug.
  It was invisible at thumbnail scale and obvious once the box was painted.

## Decision

Two changes, and they are a pair: layout primitives so rearranging is a data edit rather than a
rewrite, and a measurement mode so candidates are compared on numbers instead of impressions.

### 1. The band becomes a grid

The band's right side becomes rows stacked top to bottom; within a row, cells stand side by side;
within a cell, tiers stack. All three levels come from `data.mjs`:

| key | meaning |
|---|---|
| `row: N` | tiers sharing a row stand side by side; different rows stack. Default: each tier its own row — today's layout |
| `column: N` | within a row, tiers sharing a column stack inside one cell |
| `cols: N` | how many columns that tier deals its own items into |
| `numbers: false` | laid out by rank, but no rank numbers, and takes none from the running count |
| `size: N` | font size for a wall tier placed in the band |

A tier with `layout: "wall"` **and** a `row:` renders in the band with the wall's packing — no
rules between rows, no per-row floor, one line per item. This is the single highest-leverage
primitive: a ranked row cannot go below `MIN_RANK_UNIT` (22px), so 96 titles cost ≥2112px as
ranked and ~590px as a wall. It is what makes a three-column band possible at all.

Heights: a row is as tall as its hungriest cell. A cell of ranked tiers divides that height by
weight; a cell of walls takes exactly what its lines need. Rows that cannot use extra height
(all walls) keep their own; the rest share the slack in proportion to what they asked for.

### 2. `--report`: score a candidate

A new flag on the render prints what the eye cannot judge from a thumbnail:

- canvas, ratio, `clamped`, `cropRisk`
- **ink coverage**: Σ over every drawn span of `measureWidth(text) × scaleX × fontSize`, over the
  sheet's area. The one number that answers "is this denser?"
- **type ladder**: each tier's first→last size in sheet order, and whether the sequence descends.
  A break is named, since a ranked tier out-typing the featured tier is the one thing the sheet
  cannot do
- **slack**: per band cell, requested height vs the row's height. Anything over ~20px is the blank
  strip that reads as a bug
- **squeeze**: how many titles are at `scaleX < 1`, i.e. one step from wrapping and being clipped

This is exactly the instrumentation the session used by hand. Making it a flag is what lets the
next agent do in one command what took a dozen renders here.

### 3. SKILL.md teaches the loop

A new section on exploring layouts: generate 3-5 arrangements that differ *structurally*, run
`--report` on each, compare, then eyeball the winner. With the levers stated plainly:

- a long tier is cheap as a wall and expensive as a ranked tier
- the canvas solver takes the **narrowest** fitting width, so compressing content shrinks the
  sheet rather than freeing space — pin `MIN_W` to `MAX_W` when the extra room should go to the
  band instead
- density lives where the characters are; shrinking a tier that holds two thirds of them lowers
  the average even as it frees height
- balance a cell's natural height against its row, or the difference shows as a blank strip

## Non-goals

- No automatic search. The agent proposes arrangements; `--report` scores them. A solver over
  layouts is a much bigger idea and this does not preclude it.
- No change to the canvas solver's aspect logic, the border-box budget, or the crop warning.
- `samples/build/*` keeps its own hand-rolled layouts.

## Risks

- **`resolveRankCols` assumes one ranked stack.** Its hierarchy bound compares one `unit` against
  the featured row height; with cells there is a unit per cell. It must be re-derived against the
  densest cell, or the bound silently stops binding.
- **The grid is more rope.** A badly specified `row:`/`column:` can produce a legal but ugly
  sheet. `--report`'s slack and ladder checks are the guardrail, which is why they ship together.
- **Ink coverage is a proxy.** It counts drawn glyph boxes, not perceived density, and treats a
  squashed title as its drawn width. Good for comparing candidates on the same data; not an
  absolute quality score. SKILL.md should say so rather than implying a target number.

## Reference: what the 388-title sheet did

| arrangement | canvas | ratio |
|---|---|---|
| original (all three long tiers as walls at the foot) | 2144×4055 | 0.53:1 — cropped |
| 良い promoted to a ranked tier in the band | 2048×1287 | 1.59:1 |
| three cells: featured │ two tiers stacked │ 良い as a band wall | 4000×2250 | 1.78:1 |

The last one is denser *and* has a larger featured tier than the first.
