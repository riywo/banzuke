// Stand up a "user project" the way the skill tells an agent to: copy template/ wholesale.
// Instead of npm ci, the repo's node_modules is symlinked in (the dependency set is identical).
import { cpSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../..", import.meta.url));

/** Gitignored scratch space. Everything a test writes goes under here. */
export const tmp = path.join(root, "test/.tmp");

/**
 * Copy template/ into test/.tmp/<name>. Pass `data` to replace the scaffold's data.mjs
 * (a plain object, serialized as the default export). Returns the project directory.
 */
export function scaffold(name, data) {
  const dir = path.join(tmp, name);
  rmSync(dir, { recursive: true, force: true });
  cpSync(path.join(root, "skills/banzuke/template"), dir, { recursive: true });
  symlinkSync(path.join(root, "node_modules"), path.join(dir, "node_modules"));
  if (data !== undefined) {
    writeFileSync(path.join(dir, "data.mjs"), `export default ${JSON.stringify(data, null, 2)};\n`);
  }
  return dir;
}
