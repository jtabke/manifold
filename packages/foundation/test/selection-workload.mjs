/** Compare the preserved 0.9 capture/preview-guard algorithm with the shared engine on the same roots. */
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { cpus, platform, release, arch } from "node:os";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import * as f from "../src/index.ts";
import { captureSelection, guardSelection } from "../src/selection.ts";
// Algorithm from document.ts/runtime.ts at foundation 0.9 digest aa60d4...; not runtime code.
function legacyCapture(doc, target, schemas, work) {
  let heads = f.SharedMap.empty(),
    revisions = f.SharedMap.empty();
  const queue = [target];
  let count = 0;
  while (queue.length) {
    assert(++count <= 100000);
    const ref = queue.pop();
    if (ref.document !== doc.document) continue;
    if (ref.selection.kind === "follow")
      heads = heads.set(
        ref.item,
        doc.items.get(ref.item)?.revision ?? null,
        work,
      );
    const got = f.resolve(doc, ref);
    if (got.status !== "resolved" || revisions.get(got.revision.id)) continue;
    revisions = revisions.set(got.revision.id, true, work);
    queue.push(
      ...(schemas.get(got.revision.schema)?.references(got.revision.body) ??
        []),
    );
  }
  return Object.freeze({ root: f.retained(target), heads, revisions });
}
function legacyGuard(baseline, before, candidate, target, schemas) {
  const contexts = [
      legacyCapture(before, target, schemas),
      legacyCapture(candidate, target, schemas),
    ],
    heads = Object.create(null),
    pins = Object.create(null);
  contexts.forEach((context, index) => {
    for (const [item] of context.heads.entries())
      heads[item] = baseline.items.get(item)?.revision ?? null;
    for (const [rid] of context.revisions.entries())
      for (const ref of schemas
        .get((index ? candidate : before).revisions.get(rid).schema)
        ?.references((index ? candidate : before).revisions.get(rid).body) ??
        [])
        if (ref.document === baseline.document && ref.selection.kind === "pin")
          pins[ref.selection.revision] = !!baseline.revisions.get(
            ref.selection.revision,
          );
  });
  return { heads, pins };
}
const stats = (xs) => {
  const a = [...xs].sort((a, b) => a - b);
  return {
    min: a[0],
    median: a[Math.floor(a.length / 2)],
    p95: a[Math.ceil(a.length * 0.95) - 1],
    max: a.at(-1),
  };
};
function measure(fn) {
  let value;
  const times = [];
  for (let i = 0; i < 35; i++) {
    const begin = performance.now();
    value = fn();
    if (i >= 5) times.push(performance.now() - begin);
  }
  return { ms: stats(times), value };
}
const rows = [];
for (const count of [10, 100, 1000, 10000]) {
  const document = "selection-cost-" + count,
    ref = (item) => f.reference(document, item),
    target = ref("root"),
    links = {
      id: "selection-workload@1",
      validate: (b) => assert(Array.isArray(b.refs)),
      references: (b) => b.refs,
      assets: () => [],
      project: (b) => ({ type: "links", value: b }),
    },
    schemas = f.createSchemas([links]);
  const commands = Array.from({ length: count }, (_, i) => ({
    kind: "create",
    item: "n" + i,
    label: "Node",
    revision: {
      id: "n" + i + "-r1",
      item: "n" + i,
      schema: "scalar@1",
      required: true,
      body: {
        value: i,
        unit: "N",
        subject: "system",
        frame: "world",
        condition: "nominal",
      },
    },
  }));
  commands.push({
    kind: "create",
    item: "root",
    label: "Root",
    revision: {
      id: "root-r1",
      item: "root",
      schema: links.id,
      required: true,
      body: { refs: Array.from({ length: count }, (_, i) => ref("n" + i)) },
    },
  });
  const doc = f.prepare(
      f.empty(document),
      "cost-root",
      commands,
      schemas,
    ).document,
    candidate = f.prepare(
      doc,
      "candidate",
      [
        {
          kind: "revise",
          item: "n0",
          revision: {
            ...f.current(doc, "n0"),
            id: "n0-r2",
            body: { ...f.current(doc, "n0").body, value: 10 },
          },
        },
      ],
      schemas,
    ).document;
  const old = measure(() => legacyCapture(doc, target, schemas)),
    next = measure(() => f.captureContext(doc, target, schemas));
  assert.deepEqual(f.contextToPlain(old.value), f.contextToPlain(next.value));
  const previousGuard = measure(() =>
      legacyGuard(doc, doc, candidate, target, schemas),
    ),
    currentGuard = measure(() =>
      guardSelection(
        doc,
        captureSelection(doc, target, schemas),
        captureSelection(candidate, target, schemas),
      ),
    );
  assert.deepEqual(previousGuard.value.heads, currentGuard.value.heads);
  assert.deepEqual(previousGuard.value.pins, currentGuard.value.pins);
  const validation = measure(() => f.validateContext(doc, next.value, schemas)),
    work = f.mapWork();
  legacyCapture(doc, target, schemas, work);
  let calls = 0;
  const counted = {
    get(id) {
      const schema = schemas.get(id);
      return schema
        ? {
            ...schema,
            references(body) {
              calls++;
              return schema.references(body);
            },
          }
        : undefined;
    },
  };
  legacyGuard(doc, doc, candidate, target, counted);
  const oldCalls = calls;
  calls = 0;
  guardSelection(
    doc,
    captureSelection(doc, target, counted),
    captureSelection(candidate, target, counted),
  );
  assert.equal(oldCalls, 4 * (count + 1));
  assert.equal(calls, 2 * (count + 1));
  rows.push({
    reachableRevisions: count + 1,
    heads: next.value.heads.size,
    capture30Ms: { legacy: old.ms, shared: next.ms },
    previewAndGuard30Ms: { legacy: previousGuard.ms, shared: currentGuard.ms },
    sharedValidation30Ms: validation.ms,
    legacyCapturePersistentMapWork: work,
    sharedCaptureBulkMapEntries:
      next.value.heads.size + next.value.revisions.size,
    previewReferenceDeclarations: { legacy: oldCalls, shared: calls },
  });
}
const report = {
  date: new Date().toISOString(),
  sourceDigest: execFileSync(
    process.execPath,
    ["packages/foundation/test/source-digest.mjs"],
    { encoding: "utf8" },
  ).trim(),
  baselineSourceDigest:
    "sha256:aa60d4a250fde7f08d73cbeb828bc8a95a4f700e20a0d9e773e0a1f0ff169f91",
  environment: {
    node: process.version,
    cpu: cpus()[0].model,
    platform: platform(),
    release: release(),
    arch: arch(),
  },
  method:
    "Same immutable wide reference graph, 10/100/1000/10000 scalar leaves. Preserved 0.9 selection/guard algorithms compared with shared engine; resolver reused unchanged. Five warmups +30 captures and preview-plus-guard constructions; exact logical contexts/guards must agree. Reference-declaration calls counted separately. Legacy AVL allocations instrumented; shared bulk entries count the entries built once by SharedMap.from, not process heap. Setup, UI, storage, resource parsing, opaque states, declaration side effects and native migration excluded. Root-pin fix separately covered by tests. Order/JIT/device diagnostics are not product latency/capacity acceptance.",
  rows,
};
writeFileSync(
  new URL(
    "../../../evidence/current/foundation/selection-results.json",
    import.meta.url,
  ),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
