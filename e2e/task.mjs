// The request the agent gets in the e2e run, and the titles the checker looks for afterwards.
// `node e2e/task.mjs` prints the prompt — that is how the workflow feeds it to the agent.
//
// It is deliberately written the way a user would write it: it never names the skill, so the run
// also tests that the SKILL.md description is enough to trigger it.
import { pathToFileURL } from "node:url";

/** In ranking order, best first. Short and distinctive, so the checker can find them in the HTML. */
export const TITLES = [
  "Cowboy Bebop",
  "Monster",
  "Vinland Saga",
  "Mushishi",
  "Steins;Gate",
  "Planetes",
  "Shirobako",
  "Barakamon",
  "Chihayafuru",
  "Dennou Coil",
  "Gintama",
  "Hyouka",
  "Nichijou",
  "Kaiba",
  "Texhnolyze",
  "Bakemonogatari",
  "Durarara",
  "Baccano",
  "Katanagatari",
  "Kino's Journey",
  "Yuru Camp",
  "Sakamichi no Apollon",
  "Uchouten Kazoku",
  "Ghost Hound",
];

export const PROMPT = `I want a banzuke — a tier-ranking sheet — of my ${TITLES.length} favourite anime, as a PNG I can share.

Here they are, my favourite first:

${TITLES.map((t, i) => `${i + 1}. ${t}`).join("\n")}

A few things:

- Use exactly these titles, spelled exactly as written above. Do not shorten, translate or rename any of them, and do not add any I did not list.
- Group them into tiers yourself — the order above is my ranking.
- Build it in the current directory.
- I cannot answer questions during this run, so make the judgement calls yourself and keep going.

When you are done, tell me the path to the PNG.
`;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(PROMPT);
}
