// Rebuild every README sample: `npm run samples`.
// The six themed sheets render onto the same canvas, so the images line up in the README grid.
import { emit, summarize } from "./kit.mjs";

const SAMPLES = [
  ["anime", "./bauhaus.mjs"],
  ["crt", "./crt.mjs"],
  ["board", "./board.mjs"],
  ["tiles", "./tiles.mjs"],
  ["sumo", "./sumo.mjs"],
  ["gazette", "./gazette.mjs"],
];

// The six sheets are independent, and takumi renders on a threadpool — running them together is
// about twice as fast. Log after the fact so the output still reads in list order.
const lines = await Promise.all(
  SAMPLES.map(async ([name, mod]) => {
    const { default: build, FAMILIES } = await import(mod);
    return summarize(name, await emit(name, build, FAMILIES));
  }),
);
console.log(lines.join("\n"));
