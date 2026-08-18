// The odd one out. The other six are hand-rolled themes on a shared square canvas, so they can
// sit in a README grid; this one runs the *shipped template* against a ~300-command dataset and
// keeps whatever canvas the solver picks. That is the point of it: it shows what the skill
// actually produces for data big enough that the band has to be arranged rather than just
// filled — `row:` and `column:` splitting the band into cells, and the long tail riding up there
// as a wall.
//
// It scaffolds the template into a temp directory the way a user would, rather than importing
// it, because banzuke.mjs reads its own ./data.mjs — swapping that file is how you feed it.
import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");

export default function build() {
  const dir = mkdtempSync(path.join(tmpdir(), "banzuke-grid-"));
  try {
    cpSync(path.join(repo, "skills/banzuke/template"), dir, { recursive: true });
    copyFileSync(path.join(here, "data-unix.mjs"), path.join(dir, "data.mjs"));
    // The suite symlinks the repo's node_modules the same way: the template's dependency set is
    // a subset of this repo's, and installing it per sample would dominate the build.
    symlinkSync(path.join(repo, "node_modules"), path.join(dir, "node_modules"));
    const log = execFileSync(process.execPath, [path.join(dir, "banzuke.mjs")], {
      encoding: "utf8",
    });
    const report = execFileSync(process.execPath, [path.join(dir, "banzuke.mjs"), "--report"], {
      encoding: "utf8",
    });
    copyFileSync(path.join(dir, "banzuke.png"), path.join(repo, "samples/grid.png"));
    return { log: log.split("\n")[0], report };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const { log, report } = build();
  console.log(log);
  console.log(report.trimEnd());
}
