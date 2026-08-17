// The one table of what each supported runtime owns and how it is driven.
//
// node, bun and deno are equally first-class: template/ ships a lockfile for each, and the
// scaffold step in SKILL.md deletes the files belonging to the two the user did not pick. Three
// consumers need parts of that — scripts/locks.mjs regenerates the locks, scripts/smoke.mjs
// renders a sheet on each, e2e/check.mjs reads back which runtime an agent scaffolded for — and
// they have to agree on the filenames or the lock we regenerate is not the one we install from.
//
// SKILL.md keeps its own copy of these commands, on purpose: it is the product, and template/ is
// copied out of this repo, so neither can import anything from here. `docs match the runtime
// table` in test/project.test.mjs is what holds the two in step.
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The scaffold that gets copied into a user's project. */
export const template = fileURLToPath(new URL("../skills/banzuke/template", import.meta.url));

/**
 * Per runtime:
 * - `files`   what only this runtime uses — the scaffold deletes every other runtime's set.
 *             `package.json` is deliberately absent: all three read it, so it is never pruned
 * - `lock`    the lockfile within `files`, and the fingerprint of a scaffolded project
 * - `lockgen` regenerates `lock` alone, without materializing node_modules
 * - `pins`    the `name@version` list `lock` states, however that format spells it (see below)
 * - `install` the frozen form, which must fail rather than silently resolve fresh
 * - `add`     installs a package (fonts, in practice)
 * - `run`     renders the sheet
 *
 * `pins` is what scripts/locks.mjs diffs, rather than the file text. All three generators float
 * — CI installs bun `latest` and deno `v2.x`, and npm arrives with whichever node is on the box —
 * and they re-spell their own output between versions: npm 11.17 records a `libc` field for
 * platform packages that 11.6 and 10.9 leave out, so comparing bytes reports the toolchain
 * moving as if the repo had drifted. The versions are what "out of date with package.json"
 * actually claims, and they are stable across all of it.
 */
export const RUNTIMES = {
  node: {
    files: ["package-lock.json"],
    lock: "package-lock.json",
    lockgen: ["npm", ["install", "--package-lock-only"]],
    // `packages` is keyed by install path — "node_modules/x", nested as ".../node_modules/y" —
    // and "" is the project itself, which pins nothing.
    pins: (text) =>
      Object.entries(JSON.parse(text).packages)
        .filter(([at]) => at !== "")
        .map(([at, { version }]) => `${at.split("node_modules/").pop()}@${version}`),
    install: ["npm", ["ci"]],
    add: (pkg) => ["npm", ["i", pkg]],
    // process.execPath rather than "node", so each leg of the CI matrix renders on its own major.
    run: [process.execPath, ["banzuke.mjs"]],
    version: [process.execPath, ["--version"]],
  },
  bun: {
    files: ["bun.lock"],
    lock: "bun.lock",
    lockgen: ["bun", ["install", "--lockfile-only"]],
    // bun.lock is JSONC (trailing commas), which JSON.parse rejects, so this reads the text: every
    // entry under `packages` opens with the `name@version` it resolved to.
    pins: (text) => [...text.matchAll(/^\s*"[^"]+": \["([^"]+)",/gm)].map(([, pin]) => pin),
    install: ["bun", ["install", "--frozen-lockfile"]],
    add: (pkg) => ["bun", ["add", pkg]],
    run: ["bun", ["banzuke.mjs"]],
    version: ["bun", ["--version"]],
  },
  deno: {
    files: ["deno.lock", "deno.json"],
    lock: "deno.lock",
    // deno install otherwise insists on materializing node_modules as well.
    lockgen: ["deno", ["install", "--node-modules-dir=none"]],
    // `npm` is keyed by `name@version` already; `specifiers` holds the ranges, not the pins.
    pins: (text) => Object.keys(JSON.parse(text).npm ?? {}),
    install: ["deno", ["install", "--frozen"]],
    add: (pkg) => ["deno", ["add", `npm:${pkg}`]],
    // deno.json's task carries the permission flags, which is the whole reason that file ships.
    run: ["deno", ["task", "render"]],
    version: ["deno", ["--version"]],
  },
};

/** Every runtime-owned file, i.e. everything the scaffold prunes for one runtime or another. */
export const runtimeFiles = Object.values(RUNTIMES).flatMap((r) => r.files);

/** A command as it is written in the docs: `["npm", ["i", "x"]]` → `npm i x`. */
export const commandLine = ([file, args]) => [path.basename(file, ".exe"), ...args].join(" ");
