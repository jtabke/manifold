import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  dependencyError,
  imports,
  ignoredTrackedFiles,
} from "./check_repo.mjs";

test("force-added private reports are rejected; ordinary source remains publishable", () => {
  const cwd = mkdtempSync(join(tmpdir(), "manifold-repo-policy-"));
  const git = (...args) => execFileSync("git", args, { cwd, stdio: "pipe" });
  try {
    git("init", "-q");
    writeFileSync(join(cwd, ".gitignore"), "private-report.json\n");
    writeFileSync(join(cwd, "private-report.json"), "{}\n");
    writeFileSync(join(cwd, "source.ts"), "export const value = 1;\n");
    assert.deepEqual(ignoredTrackedFiles(cwd), []);
    git("add", "source.ts");
    assert.deepEqual(ignoredTrackedFiles(cwd), []);
    git("add", "--force", "private-report.json");
    assert.deepEqual(ignoredTrackedFiles(cwd), ["private-report.json"]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("foundation source cannot acquire application, experiment, platform or UI dependencies", () => {
  const file = "packages/foundation/src/runtime.ts";
  for (const spec of [
    "react",
    "node:fs",
    "../../../experiments/f1/kernel.ts",
    "../../../apps/canvas/src/main.tsx",
  ])
    assert.ok(dependencyError(file, spec), spec);
  assert.equal(dependencyError(file, "./contracts.ts"), undefined);
});

test("canvas uses public package exports and renderers cannot reach storage implementations", () => {
  const file = "apps/canvas/src/regions/renderers/Plot.tsx";
  for (const spec of [
    "../../../../../packages/foundation/src/value.ts",
    "@manifold/foundation/src/value.ts",
    "../app/canvasLocalStore",
    "../app/workspaceCodec.ts",
    "@manifold/foundation/indexed-db",
  ])
    assert.ok(dependencyError(file, spec), spec);
  for (const spec of ["@manifold/foundation", "../app/useEditBuffer"])
    assert.equal(dependencyError(file, spec), undefined, spec);
});

test("application composition can install the declared IndexedDB adapter", () => {
  assert.equal(
    dependencyError(
      "apps/canvas/src/regions/app/canvasLocalStore.ts",
      "@manifold/foundation/indexed-db",
    ),
    undefined,
  );
});

test("type imports, reexports and dynamic imports cannot bypass the dependency guard", () => {
  assert.deepEqual(
    imports(
      `
    import type { Item } from "one";
    export { value } from "two";
    type T = import("three").T;
    const four = import("four");
    const five = require("five");
    // import("comment")
    const text = 'import("text")';
  `,
      "fixture.ts",
    ),
    ["one", "two", "three", "four", "five"],
  );
});
