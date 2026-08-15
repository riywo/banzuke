// Regenerate the template's three lockfiles from its single package.json.
//
// The scaffold ships one lock per runtime, because the runtimes do not read each other's: bun
// migrates package-lock.json only when bun.lock is missing, and deno ignores it outright and
// re-resolves from the registry. A lock nobody regenerated is a lock that pins last year's
// takumi, so this is the one command that keeps all three in step.
//
//   node scripts/locks.mjs           rewrite template/{package-lock.json,bun.lock,deno.lock}
//   node scripts/locks.mjs --check   regenerate in a temp copy and diff (CI drift gate)
//
// Every generator here is lockfile-only: none of them leaves node_modules in the template.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { RUNTIMES, template } from "./runtimes.mjs";

const LOCKS = Object.values(RUNTIMES).map(({ lock, lockgen }) => [lock, lockgen]);
const names = LOCKS.map(([lock]) => lock).join(", ");
const read = (dir, file) => readFileSync(path.join(dir, file), "utf8");

/** Run every generator in `dir`, then sanity-check that each lock came out non-empty. */
function generate(dir) {
  for (const [lock, [cmd, args]] of LOCKS) {
    try {
      execFileSync(cmd, args, { cwd: dir, stdio: "inherit" });
    } catch (cause) {
      throw new Error(
        `${cmd} failed while generating ${lock} — is ${cmd} installed? (the nix devShell carries all three)`,
        { cause },
      );
    }
    // A generator that quietly stops writing would otherwise pass --check: the copy it was told
    // to rewrite still holds the committed lock, so the diff below finds nothing to report.
    assert.match(read(dir, lock), /takumi/, `${lock} does not pin takumi`);
  }
}

if (process.argv.includes("--check")) {
  // Regenerate in a scratch copy, so a drifted repo is reported rather than silently fixed.
  const dir = mkdtempSync(path.join(tmpdir(), "banzuke-locks-"));
  cpSync(template, dir, { recursive: true });
  generate(dir);
  const drifted = LOCKS.map(([lock]) => lock).filter(
    (lock) => read(dir, lock) !== read(template, lock),
  );
  assert.deepEqual(
    drifted,
    [],
    `out of date with package.json: ${drifted.join(", ")} — run \`npm run locks\` and commit the result`,
  );
  console.log(`locks ok: ${names} all match package.json`);
} else {
  generate(template);
  console.log(`regenerated ${names} in ${template}`);
}
