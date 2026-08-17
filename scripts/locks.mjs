// Regenerate the template's three lockfiles from its single package.json.
//
// The scaffold ships one lock per runtime, because the runtimes do not read each other's: bun
// migrates package-lock.json only when bun.lock is missing, and deno ignores it outright and
// re-resolves from the registry. A lock nobody regenerated is a lock that pins last year's
// takumi, so this is the one command that keeps all three in step.
//
//   node scripts/locks.mjs           rewrite template/{package-lock.json,bun.lock,deno.lock}
//   node scripts/locks.mjs --check   regenerate in a temp copy and compare what the locks pin,
//                                    version by version rather than byte by byte (CI drift gate)
//
// Every generator here is lockfile-only: none of them leaves node_modules in the template.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { RUNTIMES, template } from "./runtimes.mjs";

const LOCKS = Object.values(RUNTIMES);
const names = LOCKS.map(({ lock }) => lock).join(", ");
const read = (dir, file) => readFileSync(path.join(dir, file), "utf8");

/**
 * What a lock pins, as a sorted `name@version` set — see `pins` in scripts/runtimes.mjs.
 * A set because the formats disagree about repetition: bun keys nested copies by path, so one
 * version can be listed twice where npm hoists it to a single entry. Which versions are pinned
 * is the question; how many times each is written down is the lockfile's own business.
 */
const pinsOf = (dir, { lock, pins }) => [...new Set(pins(read(dir, lock)))].sort();

/** Run every generator in `dir`, then sanity-check that each lock came out non-empty. */
function generate(dir) {
  for (const runtime of LOCKS) {
    const {
      lock,
      lockgen: [cmd, args],
    } = runtime;
    try {
      execFileSync(cmd, args, { cwd: dir, stdio: "inherit" });
    } catch (cause) {
      throw new Error(
        `${cmd} failed while generating ${lock} — is ${cmd} installed? (the nix devShell carries all three)`,
        { cause },
      );
    }
    // A generator that quietly stops writing would otherwise pass --check: the copy it was told
    // to rewrite still holds the committed lock, so the diff below finds nothing to report. Read
    // it back through the same `pins` the check compares with, so a reader that stops finding
    // anything fails here rather than passing --check on two empty lists.
    assert.ok(
      pinsOf(dir, runtime).some((pin) => pin.startsWith("takumi-js@")),
      `${lock} does not pin takumi`,
    );
  }
}

if (process.argv.includes("--check")) {
  // Regenerate in a scratch copy, so a drifted repo is reported rather than silently fixed.
  const dir = mkdtempSync(path.join(tmpdir(), "banzuke-locks-"));
  cpSync(template, dir, { recursive: true });
  generate(dir);
  const drifted = LOCKS.flatMap((runtime) => {
    const fresh = pinsOf(dir, runtime);
    const committed = pinsOf(template, runtime);
    const changed = [
      ...committed.filter((pin) => !fresh.includes(pin)).map((pin) => `-${pin}`),
      ...fresh.filter((pin) => !committed.includes(pin)).map((pin) => `+${pin}`),
    ];
    return changed.length ? [`${runtime.lock} (${changed.join(" ")})`] : [];
  });
  assert.deepEqual(drifted, [], "out of date with package.json — run `npm run locks` to fix");
  console.log(`locks ok: ${names} all pin what package.json resolves to`);
} else {
  generate(template);
  console.log(`regenerated ${names} in ${template}`);
}
