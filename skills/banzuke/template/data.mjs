// Banzuke data — edit this freely.
//   - The number of tiers, their names, colors and layouts are all yours to change
//     layout: "featured" (the big single column on the left; only the first one counts)
//             "ranked"   (two-column blocks stacked on the right)
//             "wall"     (a packed wall at the bottom, no rank numbers)
//   - items are in rank order, top first. featured / ranked tiers get running numbers
//   - An item is either a string or { title, year }. year is not displayed by default
//     (edit banzuke.mjs if you want it)
//   - row: tiers sharing a row stand side by side in the band; tiers with no row are each
//          their own row, stacked top to bottom (the default). A "wall" tier can carry a
//          row too — that moves it into the band with the wall's own packing instead of the
//          foot, which is what makes a long tail tier cheap. Ignored on the featured tier,
//          which always takes the left-hand column
//   - column: within a shared row, tiers sharing a column stack on top of each other in one cell.
//          A stack has to be all "wall" or all ranked — mixing them throws, because a wall packs
//          one line per item off its own size: and a ranked tier divides the row into numbered
//          rows, and one cell cannot do both
//   - row: / column: numbers are *labels*, not an order. Tiers are grouped by the value and the
//          groups come out in the order they are declared here, so `column: 2` written first
//          renders on the left. Reorder the tiers to reorder the sheet
//   - cols: how many columns a tier deals its own items into, overriding the count the sheet
//          picked. Works on ranked tiers and on walls, in the band and at the foot; clamped to
//          the tier's item count and to what the width can hold at MIN_COL_W a column
//   - numbers: false (a ranked tier laid out by rank but shown with no numbers, and left out
//              of the running count)
//   - size: font size for a "wall" tier. A band wall (one with a row:) takes it directly; a foot
//           wall is sized by WALL.sizes in banzuke.mjs instead. Ignored on a ranked tier, whose
//           type comes from its row height and TYPE.ranked

export default {
  /** Title across the top of the sheet */
  title: "Anime Banzuke",
  /** Unit for the item count (e.g. "75 titles") */
  unit: "titles",
  tiers: [
    {
      name: "Hall of Fame",
      layout: "featured",
      color: "#d62828",
      items: ["Title A", "Title B", "Title C", "Title D"],
    },
    {
      name: "Love it",
      layout: "ranked",
      color: "#1b50a8",
      items: ["Title E", "Title F", "Title G", "Title H", "Title I", "Title J"],
    },
    {
      name: "Favorites",
      layout: "ranked",
      color: "#f4c20d",
      items: [
        "Title K",
        "Title L",
        "Title M",
        "Title N",
        "Title O",
        "Title P",
        "Title Q",
        "Title R",
      ],
    },
    {
      name: "Good",
      layout: "wall",
      items: ["Title S", "Title T", "Title U", "Title V", "Title W", "Title X"],
    },
    {
      name: "So-so",
      layout: "wall",
      items: ["Title Y", "Title Z", "Title AA", "Title AB", "Title AC"],
    },
  ],
};
