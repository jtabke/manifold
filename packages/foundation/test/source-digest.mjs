import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
const hash = createHash("sha256");
for (const dir of ["src", "workbench", "test"]) {
  for (const name of readdirSync(new URL("../" + dir + "/", import.meta.url))
    .filter(
      (n) => /\.(ts|mjs|html|css)$/.test(n) || n.endsWith(".fixture.json"),
    )
    .sort()) {
    hash.update(dir + "/" + name + "\0");
    hash.update(
      readFileSync(new URL("../" + dir + "/" + name, import.meta.url)),
    );
    hash.update("\0");
  }
}
for (const name of [
  "package.json",
  "tsconfig.json",
  "vite.config.mjs",
  "../../package.json",
  "../../package-lock.json",
]) {
  hash.update(name + "\0");
  hash.update(readFileSync(new URL("../" + name, import.meta.url)));
  hash.update("\0");
}
console.log("sha256:" + hash.digest("hex"));
