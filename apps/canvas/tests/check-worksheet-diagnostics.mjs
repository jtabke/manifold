/** Clean-checkout diagnostics need public source only; historical reports stay untouched. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { timingDistribution } from "./worksheet-timing.mjs";

const directory = mkdtempSync(join(tmpdir(), "manifold-worksheet-diagnostic-")),
  tool = fileURLToPath(
    new URL("../tools/measure-worksheet-evaluation.mjs", import.meta.url),
  ),
  preload = join(directory, "no-history.mjs");
try {
  // An attempted historical read fails even on machines which happen to retain that file.
  writeFileSync(
    preload,
    `import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const read = fs.readFileSync;
fs.readFileSync = function (path, ...args) {
  if (String(path).replaceAll("\\\\", "/").includes("/evidence/"))
    throw Error("Diagnostics must not read ignored historical reports");
  return read.call(this, path, ...args);
};
syncBuiltinESMExports();
`,
  );
  const run = (...args) =>
    spawnSync(process.execPath, ["--import", preload, tool, ...args], {
      cwd: directory,
      encoding: "utf8",
      timeout: 60000,
      maxBuffer: 4 * 1024 * 1024,
    });
  const output = join(directory, "fresh", "nested", "profile.json"),
    child = run("--output", output);
  assert.equal(child.status, 0, child.stderr);
  const report = JSON.parse(readFileSync(output, "utf8"));
  assert.deepEqual(JSON.parse(child.stdout), report);
  assert.equal(report.rows.length, 6);
  assert.deepEqual(
    [...new Set(report.rows.map((row) => row.regions))],
    [64, 256],
  );
  assert.equal(Object.hasOwn(report, "baselineSourceDigest"), false);
  assert.equal(Object.hasOwn(report, "baseline"), false);
  for (const row of report.rows) {
    assert.equal(row.maxSparseParses, 1);
    assert(Number.isFinite(row.editP95Ms) && row.editP95Ms >= 0);
  }
  const baseline = join(directory, "explicit-baseline.json"),
    sourceDigest = "sha256:" + "a".repeat(64),
    comparison = join(directory, "comparison", "profile.json");
  writeFileSync(baseline, JSON.stringify({ sourceDigest }));
  const explicit = run("--baseline", baseline, "--output", comparison);
  assert.equal(explicit.status, 0, explicit.stderr);
  const compared = JSON.parse(readFileSync(comparison, "utf8"));
  assert.equal(compared.baselineSourceDigest, sourceDigest);
  assert.deepEqual(compared.baseline, { path: baseline, sourceDigest });
  const rejected = join(directory, "must-not-exist", "profile.json");
  const missing = run(
    "--baseline",
    join(directory, "missing.json"),
    "--output",
    rejected,
  );
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /ENOENT/);
  assert.equal(existsSync(rejected), false);
  writeFileSync(baseline, "{}");
  const malformed = run("--baseline", baseline, "--output", rejected);
  assert.notEqual(malformed.status, 0);
  assert.match(malformed.stderr, /sourceDigest/);
  assert.equal(existsSync(rejected), false);
  for (const samples of [[], [NaN], [Infinity], [-1]])
    assert.throws(() => timingDistribution(samples));
  console.log(
    "Worksheet diagnostics: no historical report dependency, new output directories, explicit optional baseline metadata and finite timing observations pass.",
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
