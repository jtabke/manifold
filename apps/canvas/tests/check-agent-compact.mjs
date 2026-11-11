import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { json } from "@manifold/foundation";
import { openHeadlessWorkspace } from "manifold-canvas/headless";
import {
  inspectWorkspace,
  summarizeWorkspace,
  summarizeWorksheet,
  agentCapabilities,
} from "manifold-canvas/agent";

const baseline = new URL(
  "./fixtures/agent-spring/baseline.manifold",
  import.meta.url,
);
const text = await readFile(baseline, "utf8");
const workspace = await openHeadlessWorkspace(text);
const cli = fileURLToPath(new URL("../tools/manifold.mjs", import.meta.url));
function run(args, status = 0) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    timeout: 30000,
  });
  assert.equal(result.status, status, result.stderr);
  assert.equal(status === 0 ? result.stderr : result.stdout, "");
  return JSON.parse(status === 0 ? result.stdout : result.stderr);
}
function assertJson(value) {
  json(value);
  assert.deepEqual(JSON.parse(JSON.stringify(value)), value);
}
try {
  assert.equal(agentCapabilities().discovery.default, "full");
  const full = inspectWorkspace(workspace),
    before = workspace.export();
  const compact = summarizeWorkspace(workspace);
  assertJson(compact);
  assert(Object.isFrozen(compact.models[0].inputs));
  assert.equal(compact.view, "compact");
  assert.equal(compact.documentId, full.documentId);
  assert.equal(
    workspace.export(),
    before,
    "Compact discovery does not publish state or execute",
  );
  assert.deepEqual(
    run(["inspect", fileURLToPath(baseline)]),
    full,
    "Default full JSON remains unchanged",
  );
  assert.deepEqual(
    run(["inspect", fileURLToPath(baseline), "--compact"]),
    compact,
  );
  assert(
    JSON.stringify(compact).length < JSON.stringify(full).length / 2,
    "Fixture compact response removes most provenance noise",
  );
  for (const model of compact.models) {
    const original = full.models.find((item) => item.id === model.id);
    assert.equal(model.documentId, original.documentId);
    assert.deepEqual(
      model.inputs.map((input) => [
        input.id,
        input.unit,
        input.binding,
        input.numericEdit,
      ]),
      original.inputs.map((input) => [
        input.id,
        input.unit,
        input.binding,
        input.numericEdit,
      ]),
    );
    assert.deepEqual(model.outputs[0].projection, {
      status: "resolved",
      type: "scalar",
      value: original.outputs[0].projection.projection.value.value,
      unit: "N",
    });
    const result = model.requests[0].result;
    assert.equal(result.status, original.requests[0].result.status);
    assert.equal(result.receipt.id, original.requests[0].result.receipt.id);
    assert.equal(result.receipt.outcome.status, "success");
    assert(!Object.hasOwn(result.receipt, "key"));
    const detail = run(["model", fileURLToPath(baseline), "--model", model.id]);
    assert(detail.outputs[0].reference.selector);
    assert(detail.requests[0].result.receipt.key);
    assert.deepEqual(
      run(["model", fileURLToPath(baseline), "--model", model.id, "--compact"]),
      { protocolVersion: 1, view: "compact", ...model },
    );
  }
  assert.deepEqual(
    run(["models", fileURLToPath(baseline), "--compact"]).models,
    compact.models,
  );
  const region = full.worksheet.regions.find(
    (region) => region.kind === "constraint",
  );
  assert.deepEqual(
    run(["worksheet", fileURLToPath(baseline), "--region", region.id]).regions,
    [region],
  );
  const smallRegion = compact.worksheet.regions.find(
    (item) => item.id === region.id,
  );
  assert.equal(smallRegion.constraint.pass, true);
  assert.deepEqual(
    run([
      "worksheet",
      fileURLToPath(baseline),
      "--region",
      region.id,
      "--compact",
    ]).regions,
    [smallRegion],
  );
  assert.equal(
    run(["worksheet", fileURLToPath(baseline), "--region", "absent"], 2).error
      .code,
    "ITEM_NOT_FOUND",
  );
  for (const args of [
    ["capabilities", "--compact"],
    ["inspect", fileURLToPath(baseline), "--compact", "--compact"],
    ["models", fileURLToPath(baseline), "--region", region.id],
  ])
    run(args, 2);

  const spring = compact.models.find((model) =>
    model.inputs.some((input) => input.id === "displacement"),
  );
  workspace.setModelInput(spring.id, "displacement", 4, workspace.read().id);
  assert.equal(
    summarizeWorkspace(workspace).models.find((model) => model.id === spring.id)
      .requests[0].result.status,
    "ready",
  );
  const reference = workspace.reference(spring.requests[0].id);
  const job = workspace.compute(reference);
  assert.equal(
    summarizeWorkspace(workspace).models.find((model) => model.id === spring.id)
      .requests[0].result.status,
    "pending",
  );
  job.cancel();
  await job.completion;
  const failed = summarizeWorkspace(workspace).models.find(
    (model) => model.id === spring.id,
  ).requests[0].result;
  assert.equal(failed.status, "failed");
  assert.equal(failed.receipt.outcome.status, "failed");
  assert(failed.receipt.outcome.reason);
  assertJson(failed);
  workspace.createEquation("unfinished =", workspace.read().id);
  const diagnostic = summarizeWorksheet(workspace).regions.find(
    (region) => region.kind === "draft",
  );
  assert.equal(diagnostic.quantity, null);
  assert(diagnostic.diagnostic);
  assertJson(diagnostic);
  assert.equal(
    inspectWorkspace(workspace).models.find((model) => model.id === spring.id)
      .requests[0].result.receipt.key.length > 0,
    true,
  );
  workspace.dispose();
  assert.throws(
    () => summarizeWorkspace(workspace),
    (error) => error.code === "WORKSPACE_CLOSED",
  );
  assert.throws(
    () => summarizeWorksheet(workspace),
    (error) => error.code === "WORKSPACE_CLOSED",
  );
  console.log(
    "Compact discovery: opt-in compatibility, JSON facts, units, diagnostics, evidence currency/failure, full details, region filtering and no implicit effects passed.",
  );
} finally {
  workspace.dispose();
}
