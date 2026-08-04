// Banzuke data — edit this freely.
//   - The number of tiers, their names, colors and layouts are all yours to change
//     layout: "featured" (the big single column on the left; only the first one counts)
//             "ranked"   (two-column blocks stacked on the right)
//             "wall"     (a packed wall at the bottom, no rank numbers)
//   - items are in rank order, top first. featured / ranked tiers get running numbers
//   - An item is either a string or { title, year }. year is not displayed by default
//     (edit banzuke.mjs if you want it)

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
