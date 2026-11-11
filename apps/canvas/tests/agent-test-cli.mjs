/** Real-process JSON/channel assertions shared by acceptance scenarios, not a CLI replacement. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
export function runJson(script, args, status = 0, { cwd } = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 30000,
  });
  assert.equal(result.error, undefined);
  assert.equal(
    result.status,
    status,
    `${args.join(" ")}\n${result.stdout}\n${result.stderr}`,
  );
  const report = status === 0 || status === 3;
  assert.equal(report ? result.stderr : result.stdout, "");
  return JSON.parse(report ? result.stdout : result.stderr);
}
