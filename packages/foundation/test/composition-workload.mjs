import { performance } from "node:perf_hooks";
import { cpus, platform, release, arch } from "node:os";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import * as f from "../src/index.ts";
import * as d from "../workbench/composition-demo.ts";
const stats = (xs) => {
  const a = [...xs].sort((a, b) => a - b);
  return {
    min: a[0],
    median: a[Math.floor(a.length / 2)],
    p95: a[Math.ceil(a.length * 0.95) - 1],
    max: a.at(-1),
  };
};
const measure = (fn, n = 30) => {
  const times = [];
  let value;
  for (let i = 0; i < n + 5; i++) {
    const begin = performance.now();
    value = fn(i);
    if (i >= 5) times.push(performance.now() - begin);
  }
  return { ms: stats(times), value };
};
const seed = await d.initial(),
  rows = [],
  fanout = [];
for (const [count, size] of [
  [100, 3],
  [1000, 3],
  [10000, 3],
  [100, 64],
  [100, 256],
]) {
  const definition = structuredClone(d.spring);
  for (let i = 3; i < size; i++)
    definition.nodes["unused" + i] = {
      kind: "constant",
      label: "Unrelated",
      unit: "1",
      value: i,
    };
  const template = "measured-template",
    commands = [d.create(template, "scalar-model-definition@1", definition)];
  for (let i = 0; i < count; i++)
    commands.push(
      d.create(
        "instance-" + i,
        "scalar-model-instance@1",
        d.instance(d.ref(template, f.wholeSelector, template + "-v1")),
      ),
    );
  const doc = f.prepare(
    seed.document,
    "measured",
    commands,
    d.schemas,
  ).document;
  assert.equal(doc.items.size - seed.document.items.size, count + 1);
  const old = f.current(doc, "instance-0"),
    before = d.models.diagnostics();
  const projection = measure(() =>
      f.project(
        doc,
        d.ref("instance-0", f.modelPort("force")),
        d.schemas,
        seed.resources,
      ),
    ),
    after = d.models.diagnostics();
  assert.equal(projection.value.status, "resolved");
  assert.equal(projection.value.projection.value.value, 10);
  assert.equal(after.nodeEvaluations - before.nodeEvaluations, 35 * 3);
  const edit = measure((i) =>
    f.prepare(
      doc,
      "edit-" + i,
      [
        {
          kind: "revise",
          item: old.item,
          revision: {
            ...old,
            id: "edit-instance-" + i,
            body: {
              ...old.body,
              inputs: {
                displacement: { kind: "value", unit: "mm", value: i + 1 },
              },
            },
          },
        },
      ],
      d.schemas,
    ),
  );
  assert.deepEqual(edit.value.changes.affected, ["instance-0"]);
  const context = measure(() =>
    f.captureContext(doc, d.ref("instance-0", f.modelPort("force")), d.schemas),
  );
  assert.equal(context.value.revisions.size, 2);
  const wire = f.encode(doc, [], seed.resources, d.schemas),
    decode = [];
  for (let i = 0; i < 6; i++) {
    const begin = performance.now();
    await f.decode(wire, d.schemas, d.methods, f.webHash);
    if (i) decode.push(performance.now() - begin);
  }
  const backend = f.memoryBackend(),
    local = f.incrementalStorage(backend, d.schemas, d.methods, f.webHash);
  const w = f.createWorkspace(
    { ...seed, document: doc },
    { schemas: d.schemas, methods: d.methods, namespace: "composition-cost" },
  );
  const first = w.reader.capture();
  const initialSave = await local.save({
    request: "initial",
    stamp: first.stamp,
    document: doc.document,
    expectedGeneration: 0,
    capture: first,
  });
  assert(
    w.owner.apply(w.reader.stamp(), "local-edit", [
      {
        kind: "revise",
        item: old.item,
        revision: {
          ...old,
          id: "local-instance-edit",
          body: {
            ...old.body,
            inputs: { displacement: { kind: "value", unit: "mm", value: 2 } },
          },
        },
      },
    ]).ok,
  );
  const capture = w.reader.capture(),
    begin = performance.now(),
    saved = await local.save({
      request: "edit",
      stamp: capture.stamp,
      document: doc.document,
      expectedGeneration: initialSave.head.generation,
      capture,
    });
  rows.push({
    instances: count,
    templateNodes: size,
    addedAuthoredItems: doc.items.size - seed.document.items.size,
    internalItemCopies: 0,
    portProjection: {
      ms: projection.ms,
      nodesEvaluatedPerRead: 3,
      instancesVisitedPerRead:
        (after.instancesVisited - before.instancesVisited) / 35,
      dependencyOrigins: projection.value.projection.dependencies.length,
    },
    instanceEdit: {
      ms: edit.ms,
      map: edit.value.cost,
      affected: edit.value.changes.affected.length,
    },
    contextCapture: { ms: context.ms, revisions: context.value.revisions.size },
    nativeBytes: f.byteLength(wire),
    fullDecode5Ms: stats(decode),
    incrementalEditSave: {
      ms: performance.now() - begin,
      writes: saved.writes,
    },
  });
}
for (const count of [100, 1000, 10000]) {
  const commands = Array.from({ length: count }, (_, i) =>
    d.create(
      "dependent-" + i,
      "scalar-model-instance@1",
      d.instance(d.ref("spring", f.wholeSelector, "spring-v1"), {
        stiffness: {
          kind: "reference",
          reference: d.ref("stiffness"),
          expected: d.expected("N/mm"),
        },
      }),
    ),
  );
  const doc = f.prepare(seed.document, "fanout", commands, d.schemas).document,
    old = f.current(doc, "stiffness");
  const changed = measure((i) =>
    f.prepare(
      doc,
      "fanout-" + i,
      [
        {
          kind: "revise",
          item: "stiffness",
          revision: {
            ...old,
            id: "fanout-source-" + i,
            body: { ...old.body, value: i + 1 },
          },
        },
      ],
      d.schemas,
    ),
  );
  assert.equal(
    changed.value.changes.affected.filter((x) => x.startsWith("dependent-"))
      .length,
    count,
  );
  fanout.push({
    boundInstances: count,
    sourceEdit30Ms: changed.ms,
    affected: changed.value.changes.affected.length,
    map: changed.value.cost,
  });
}
const report = {
  date: new Date().toISOString(),
  sourceDigest: execFileSync(
    process.execPath,
    ["packages/foundation/test/source-digest.mjs"],
    { encoding: "utf8" },
  ).trim(),
  environment: {
    node: process.version,
    cpu: cpus()[0].model,
    platform: platform(),
    release: release(),
    arch: arch(),
  },
  method:
    "Five warmups +30 synchronous port reads/independent edits/context captures from each immutable starting root; one warmup +five full native decodes. Shared template has 3 used nodes and optional unused constants. Port projection includes full output JSON validation of the selected template, so time may grow with template metadata even though only three math nodes evaluate. Separate real declared source fanout. One memory-backend incremental Save per shape after a full initial Save (not a timing distribution). No React, browser/IndexedDB latency, heap, executor containment, physical validity or capacity acceptance.",
  rows,
  fanout,
};
writeFileSync(
  new URL(
    "../../../evidence/current/foundation/composition-results.json",
    import.meta.url,
  ),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
