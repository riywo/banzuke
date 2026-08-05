// Verifies what an agent run of the skill left behind: a self-contained project whose PNG
// actually contains the user's data. Run as `node e2e/check.mjs <workspace-dir>`,
// where the workspace is the directory the agent worked in (it holds transcript.jsonl too).
//
// The assertions are deliberately coarse — an agent run is not deterministic, and the design it
// lands on is its own business. What has to hold every time is: the project is complete and
// reproducible, the user's titles are all on the sheet, and the PNG got looked at afterwards.
import assert from "node:assert/strict";
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import templateData from "../skills/banzuke/template/data.mjs";
import { TITLES } from "./task.mjs";

const work = path.resolve(process.argv[2] ?? ".");
const notes = [];
const note = (line) => {
  notes.push(line);
  console.log(line);
};

// ---------- locate the project the agent scaffolded ----------

function findProjects(root, depth = 0) {
  if (depth > 3) return [];
  const found = [];
  if (existsSync(path.join(root, "banzuke.mjs")) && existsSync(path.join(root, "data.mjs"))) {
    found.push(root);
  }
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (e.name === "node_modules" || e.name === ".claude" || e.name === ".git") continue;
    found.push(...findProjects(path.join(root, e.name), depth + 1));
  }
  return found;
}

const candidates = findProjects(work);
assert.ok(
  candidates.length > 0,
  `no scaffolded project (banzuke.mjs + data.mjs) found under ${work}`,
);
const rendered = candidates.filter((d) => existsSync(path.join(d, "banzuke.png")));
assert.ok(
  rendered.length > 0,
  `found ${candidates.length} project(s) but none rendered a banzuke.png: ${candidates.join(", ")}`,
);
const project = rendered[0];
note(`project: ${path.relative(work, project) || "."}`);

// ---------- the project is complete and self-contained ----------

// banzuke.png is not in this list: `rendered` above already selected on it.
for (const f of [
  "package.json",
  "package-lock.json",
  "data.mjs",
  "banzuke.mjs",
  "lib/index.mjs",
  "banzuke.html",
]) {
  assert.ok(existsSync(path.join(project, f)), `missing from the project: ${f}`);
}

const pkg = JSON.parse(readFileSync(path.join(project, "package.json"), "utf8"));
assert.ok(pkg.dependencies?.["takumi-js"], "package.json does not depend on takumi-js");
// The skill ships no font, so a working project must have installed one of its own.
const fonts = Object.keys(pkg.dependencies).filter((d) => d !== "takumi-js");
assert.ok(fonts.length > 0, "no font package installed — the sheet would render as tofu");
note(`fonts: ${fonts.join(", ")}`);

// The project's own lib/ has to be importable, which is the self-contained promise in miniature.
// Only pngSize is taken from it: SKILL.md's documented lib API covers that name, so an agent
// editing lib/ (which SKILL.md invites) has a reason to keep it.
const { pngSize } = await import(pathToFileURL(path.join(project, "lib/index.mjs")).href);

// ---------- the PNG is a real sheet ----------

const png = readFileSync(path.join(project, "banzuke.png"));
const { width, height } = pngSize(png);
assert.ok(width >= 1000, `PNG is only ${width}px wide`);
assert.ok(height >= 500, `PNG is only ${height}px tall`);
assert.ok(png.length > 20_000, `PNG is suspiciously small (${png.length} bytes)`);
note(`png: ${width}×${height} px, ${Math.round(png.length / 1024)} KiB`);

// ---------- the sheet carries the user's data ----------

// Checker-owned decoder rather than the lib's: no decoder appears in SKILL.md's documented API,
// so an agent could legitimately refactor one away and leave this file crashing on an
// undefined import instead of failing with one of its own messages. esc() emits only these five
// named entities; the numeric forms are covered for anything a rewritten template might produce.
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decodeEntities = (s) =>
  s.replace(/&(?:(amp|lt|gt|quot|apos)|#(\d+)|#[xX]([0-9a-fA-F]+));/g, (_, name, dec, hex) =>
    name ? ENTITIES[name] : String.fromCodePoint(Number.parseInt(dec ?? hex, dec ? 10 : 16)),
  );

const html = decodeEntities(readFileSync(path.join(project, "banzuke.html"), "utf8")).normalize(
  "NFC",
);

const missing = TITLES.filter((t) => !html.includes(t.normalize("NFC")));
assert.deepEqual(missing, [], `titles missing from the sheet: ${missing.join(", ")}`);

// Taken from the template itself rather than hand-copied, so rewording the scaffold's sample
// data cannot silently turn this into a check that matches nothing and always passes.
const samples = templateData.tiers.flatMap((t) =>
  t.items.map((i) => (typeof i === "string" ? i : i.title)),
);
const placeholders = samples.filter((t) => html.includes(t));
assert.deepEqual(
  placeholders,
  [],
  `the template's placeholder data is still on the sheet: ${placeholders}`,
);

// SKILL.md requires the generation date on every sheet, however the layout gets rewritten.
assert.match(html, /\d{4}-\d{2}-\d{2} edition/, "no 'YYYY-MM-DD edition' label on the sheet");

// ---------- the transcript shows the PNG was looked at ----------
//
// That the skill itself was reached is settled elsewhere and more cheaply: the workflow's
// `copilot skill list` preflight proves it is discoverable, and the project above is built out
// of the skill's own lib/ — whose API this file just imported — which no agent improvises.

// The workflow always tees one out, so a missing transcript means the run itself broke rather
// than that there is nothing to check — fail instead of quietly dropping the assertion below.
const transcript = path.join(work, "transcript.jsonl");
assert.ok(existsSync(transcript), `no transcript.jsonl in ${work} — the agent step did not run`);

const events = readFileSync(transcript, "utf8")
  .split("\n")
  .filter(Boolean)
  .flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });

// Copilot CLI's `--output-format json` emits tool_call_requested / tool_call_completed entries.
// Match on the serialized event rather than named fields, so a schema change surfaces as a clear
// failure here instead of a silent pass.
const calls = events.filter((e) => String(e.type ?? "").includes("tool_call"));
assert.ok(calls.length > 0, `the transcript (${events.length} events) records no tool calls`);

// Only the requesting half of a call: the completed half carries the tool's *output*, and
// reading SKILL.md would pull "banzuke.png" in with it as a false positive.
const requests = calls
  .filter((e) => e.type !== "tool_call_completed")
  .map((e) => JSON.stringify(e));
assert.ok(
  requests.some((json) => json.includes(".png")),
  "no tool call touched the PNG — the eyeball step in SKILL.md was skipped",
);

// SKILL.md offers bun and deno alongside node, so do not count only one of them.
const renders = requests.filter((j) => /\b(node|bun|deno)\s+\S*banzuke[\w-]*\.mjs/.test(j)).length;
note(`transcript: ${events.length} events, ${calls.length} tool calls, ${renders} renders`);

// ---------- report ----------

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `project=${project}\n`);
}
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### Agent e2e passed\n\n${notes.map((n) => `- ${n}`).join("\n")}\n- titles on sheet: ${TITLES.length}\n`,
  );
}
console.log(`\nOK — all ${TITLES.length} titles on a ${width}×${height} sheet.`);
