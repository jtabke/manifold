import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
export function canvasSourceDigest() {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const hash = createHash("sha256");
  function include(path) {
    hash.update(path + "\0");
    hash.update(readFileSync(root + path));
    hash.update("\0");
  }
  function walk(path) {
    for (const entry of readdirSync(root + path, { withFileTypes: true }).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      const p = path + "/" + entry.name;
      if (entry.isDirectory()) walk(p);
      else if (
        /\.(ts|tsx|css|mjs)$/.test(entry.name) ||
        entry.name.endsWith(".fixture.json")
      )
        include(p);
    }
  }
  for (const path of [
    "apps/canvas/src",
    "apps/canvas/tests",
    "apps/canvas/tools",
    "packages/foundation/src",
  ])
    walk(path);
  for (const path of [
    "package.json",
    "package-lock.json",
    "apps/canvas/package.json",
    "apps/canvas/tsconfig.json",
    "apps/canvas/vite.config.ts",
    "packages/foundation/package.json",
  ])
    include(path);
  return "sha256:" + hash.digest("hex");
}
