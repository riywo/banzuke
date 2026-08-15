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
import { RUNTIMES, runtimeFiles, template } from "../scripts/runtimes.mjs";
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
for (const f of ["package.json", "data.mjs", "banzuke.mjs", "lib/index.mjs", "banzuke.html"]) {
  assert.ok(existsSync(path.join(project, f)), `missing from the project: ${f}`);
}

// Which runtime the agent scaffolded for, read off the runtime-specific files it kept. SKILL.md
// has it delete the other two runtimes' files, so exactly one runtime's set survives — anything
// else means the prune was skipped or half-done, and the leftovers go stale the moment a font
// is added (a stale package-lock.json then makes a later `npm ci` fail outright).
const kept = runtimeFiles.filter((f) => existsSync(path.join(project, f)));
const scaffolded = Object.entries(RUNTIMES).filter(([, r]) => kept.includes(r.lock));
assert.equal(
  scaffolded.length,
  1,
  `expected one runtime's files, found: ${kept.join(", ") || "no lockfile at all"}`,
);
const [runtime, { files }] = scaffolded[0];
assert.deepEqual(
  kept.filter((f) => !files.includes(f)),
  [],
  `${runtime} project, but another runtime's files were left behind: ${kept.join(", ")}`,
);
note(`runtime: ${runtime} (${kept.join(", ")})`);

const pkg = JSON.parse(readFileSync(path.join(project, "package.json"), "utf8"));
assert.ok(pkg.dependencies?.["takumi-js"], "package.json does not depend on takumi-js");
// The skill ships no font, so a working project must have installed one of its own. What counts
// as "not a font" is whatever the template already shipped — read rather than re-listed here, so
// that adding a dependency to the template cannot silently weaken this into a check that passes
// on a tofu sheet.
const shipped = JSON.parse(readFileSync(path.join(template, "package.json"), "utf8")).dependencies;
const fonts = Object.keys(pkg.dependencies).filter((d) => !shipped[d]);
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
  s.replace(/&(?:(amp|lt|gt|quot|apos)|#(\d+)|#[xX]([0-9a-fA-F]+));/g, (whole, name, dec, hex) => {
    if (name) return ENTITIES[name];
    const code = Number.parseInt(dec ?? hex, dec ? 10 : 16);
    // Out-of-range references would make fromCodePoint throw, and a RangeError here would
    // masquerade as a broken checker rather than as whatever produced the bad entity.
    return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });

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

// ---------- what the transcript says the agent actually did ----------

// The workflow always tees one out, so a missing transcript means the run itself broke rather
// than that there is nothing to check — fail instead of quietly dropping the assertions below.
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
const firstData = (type) => events.find((e) => e.type === type)?.data ?? {};

// Copilot CLI's `--output-format json` is a dotted-type event stream. `tool.execution_start` is
// the real invocation, carrying the tool name and its complete arguments. Do NOT match on a
// "tool_call" substring: `assistant.tool_call_delta` also matches, but each one holds a single
// streaming fragment of the arguments, so a path is smeared across hundreds of events and can
// never be found in any one of them.
const calls = events.filter((e) => e.type === "tool.execution_start").map((e) => e.data ?? {});
assert.ok(calls.length > 0, `the transcript (${events.length} events) records no tool executions`);
// String arguments of a tool call, optionally only those under path-shaped keys.
const argsOf = (c, keys) =>
  Object.entries(c.arguments ?? {})
    .filter(([k]) => !keys || keys.test(k))
    .map(([, v]) => v)
    .filter((v) => typeof v === "string");
const PATH_KEYS = /^(path|file_?path|file|filename)$/i;

// Report what the session was before asserting anything about it. A failure below is about the
// agent's behaviour, and the first question is always "which model, and what did it do?" — that
// has to be on stdout already, because an assertion throws before any later note can print.
// SKILL.md offers bun and deno alongside node, so do not count only one of them.
const renders = calls.filter((c) =>
  argsOf(c).some((v) => /\b(node|bun|deno)\s+\S*banzuke[\w-]*\.mjs/.test(v)),
).length;
note(`transcript: ${events.length} events, ${calls.length} tool calls, ${renders} renders`);
note(`tools: ${calls.map((c) => c.toolName).join(" → ")}`);

const result = events.findLast((e) => e.type === "result") ?? {};
// `auto` picks per session, so record which model this verdict actually describes.
const model = firstData("session.auto_mode_resolved").chosenModel ?? calls[0]?.model ?? "unknown";
const { premiumRequests, sessionDurationMs } = result.usage ?? {};
note(
  `session: ${model}, ${Math.round((sessionDurationMs ?? 0) / 1000)}s, ${premiumRequests ?? "?"} premium requests`,
);

if (result.exitCode !== undefined) {
  assert.equal(result.exitCode, 0, `the agent session exited ${result.exitCode}`);
}

// Discoverability is only half of it — the description also has to actually fire.
assert.ok(
  firstData("session.skills_loaded").skills?.some((s) => s.name === "banzuke"),
  "the banzuke skill never loaded into the session",
);
assert.ok(
  calls.some((c) => c.toolName === "skill" && JSON.stringify(c.arguments).includes("banzuke")),
  "the agent never invoked the banzuke skill — the SKILL.md description did not trigger",
);

// Only a *path-shaped* argument pointing at a rendered sheet counts. Matching any string argument
// ending in ".png" was not enough: the bash tool takes a free-text `description`, and one run
// passed this check on "…install deps and font, render banzuke.png" while never opening the image
// at all. Path-named keys exclude prose (`description`) and shell lines (`command`), and the
// basename pattern keeps some unrelated .png in the workspace from standing in for the sheet
// (variants are named banzuke-dark.png and the like, so match the family rather than one name).
assert.ok(
  calls.some((c) =>
    argsOf(c, PATH_KEYS).some((v) => /(^|\/)banzuke[\w-]*\.png$/.test(v.trimEnd())),
  ),
  "the agent never opened the PNG — the eyeball step in SKILL.md was skipped",
);

// ---------- report ----------

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `project=${project}\nruntime=${runtime}\n`);
}
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### Agent e2e passed\n\n${notes.map((n) => `- ${n}`).join("\n")}\n- titles on sheet: ${TITLES.length}\n`,
  );
}
console.log(`\nOK — all ${TITLES.length} titles on a ${width}×${height} sheet.`);
