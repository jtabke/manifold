/** 10,000-receipt rows explicitly configure count admission; the ordinary default remains 4,096. */
import { performance } from "node:perf_hooks";
import { cpus, platform, release, arch } from "node:os";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import * as f from "../src/index.ts";
import {
  initial,
  schemas,
  methods,
  hash,
  calculate,
  ref,
  meta,
  revision,
} from "./helpers.mjs";
const stats = (xs) => {
  const a = [...xs].sort((a, b) => a - b);
  return {
    min: a[0],
    median: a[Math.floor(a.length / 2)],
    p95: a[Math.ceil(a.length * 0.95) - 1],
    max: a.at(-1),
  };
};
const measured = (fn, n = 30) => {
  const ms = [];
  let value;
  for (let i = 0; i < n + 5; i++) {
    const begin = performance.now();
    value = fn(i);
    if (i >= 5) ms.push(performance.now() - begin);
  }
  return { ms: stats(ms), value };
};
const seed = await initial(),
  plain = f.toPlain(seed.document),
  rows = [];
for (const count of [100, 1000, 10000]) {
  const p = structuredClone(plain);
  for (let i = 0; i < count; i++) {
    const item = "independent-" + String(i).padStart(5, "0"),
      r = revision(item + "-r1", item, "scalar@1", {
        value: i,
        unit: "N",
        ...meta,
      });
    p.items[item] = { id: item, label: "Independent", revision: r.id };
    p.revisions[r.id] = r;
    p.identities.items.push(item);
    p.identities.revisions.push(r.id);
  }
  const doc = f.fromPlain(p, schemas),
    first = "independent-00000";
  const edit = measured((i) =>
    f.prepare(
      doc,
      "edit-" + i,
      [
        {
          kind: "revise",
          item: first,
          revision: revision("edited-" + i, first, "scalar@1", {
            value: i,
            unit: "N",
            ...meta,
          }),
        },
      ],
      schemas,
    ),
  );
  const view = measured((i) =>
    f.prepare(
      doc,
      "view-" + i,
      [{ kind: "view", view: { ...doc.views.get("draft-view"), x: i, y: i } }],
      schemas,
    ),
  );
  assert.equal(view.value.document.revisions, doc.revisions);
  assert.deepEqual(view.value.changes.affected, []);
  const capture = measured(() =>
    f.captureContext(doc, ref("pressure"), schemas),
  );
  assert.equal(capture.value.revisions.size, 3);
  const encoded = f.encode(doc, [], seed.resources, schemas),
    decode = [];
  for (let i = 0; i < 6; i++) {
    const begin = performance.now();
    await f.decode(encoded, schemas, methods, hash);
    if (i) decode.push(performance.now() - begin);
  }
  rows.push({
    independentDefinitions: count,
    localEdit: {
      ms: edit.ms,
      map: edit.value.cost,
      affected: edit.value.changes.affected.length,
    },
    viewMove: {
      ms: view.ms,
      map: view.value.cost,
      retainedRevisionMapUnchanged:
        view.value.document.revisions === doc.revisions,
    },
    contextCapture: {
      ms: capture.ms,
      reachableRevisions: capture.value.revisions.size,
      selectedHeads: capture.value.heads.size,
    },
    nativeBytes: f.byteLength(encoded),
    fullDecode5Ms: stats(decode),
  });
}
const fanout = [];
for (const count of [100, 1000, 10000]) {
  const p = structuredClone(plain);
  for (let i = 0; i < count; i++) {
    const item = "dependent-" + i,
      r = revision(item + "-r1", item, "relation@1", {
        role: "compares",
        from: ref("force"),
        to: ref("observation"),
      });
    p.items[item] = { id: item, label: item, revision: r.id };
    p.revisions[r.id] = r;
    p.identities.items.push(item);
    p.identities.revisions.push(r.id);
  }
  const doc = f.fromPlain(p, schemas),
    run = measured((i) =>
      f.prepare(
        doc,
        "fanout-" + i,
        [
          {
            kind: "revise",
            item: "force",
            revision: revision("fanout-force-" + i, "force", "scalar@1", {
              value: i,
              unit: "N",
              ...meta,
            }),
          },
        ],
        schemas,
      ),
    );
  assert.equal(run.value.changes.affected.length, count + 2);
  fanout.push({
    dependents: count,
    sourceEdit30Ms: run.ms,
    affected: run.value.changes.affected.length,
    map: run.value.cost,
  });
}
// A wide supported request makes changed-definition count independent of total workspace size.
const widePlain = structuredClone(plain),
  inputs = {};
for (let i = 0; i < 50; i++) {
  const item = "parameter-" + i,
    r = revision(item + "-r1", item, "scalar@1", {
      value: i + 1,
      unit: "N",
      ...meta,
    });
  widePlain.items[item] = { id: item, label: item, revision: r.id };
  widePlain.revisions[r.id] = r;
  widePlain.identities.items.push(item);
  widePlain.identities.revisions.push(r.id);
  inputs["input-" + i] = ref(item);
}
const wide = revision("wide-r1", "wide", "request@1", {
  method: { id: "sum", version: "1", runtime: "scalar-js@1" },
  inputs,
  output: "N",
  ...meta,
});
widePlain.items.wide = { id: "wide", label: "Wide request", revision: wide.id };
widePlain.revisions[wide.id] = wide;
widePlain.identities.items.push(wide.item);
widePlain.identities.revisions.push(wide.id);
const wideDoc = f.fromPlain(widePlain, schemas),
  alternatives = [];
for (const count of [1, 10, 100])
  for (const changed of [1, 10, 50]) {
    const w = f.createWorkspace(
      { ...seed, document: wideDoc },
      {
        schemas,
        methods,
        executor: async (s) => calculate(s),
        namespace: "measure",
      },
    );
    let serial = 0;
    const next = (p) => p + ":" + ++serial;
    function keepOne() {
      const edits = Array.from({ length: changed }, (_, i) => {
        const item = "parameter-" + i;
        return {
          item,
          revision: revision(next("parameter"), item, "scalar@1", {
            value: 100 + i,
            unit: "N",
            ...meta,
          }),
        };
      });
      const preview = w.owner.preview(w.reader.stamp(), ref("wide"), edits);
      assert.equal(preview.ok, true, preview.error);
      const id = next("alt"),
        kept = w.owner.keep(w.reader.stamp(), next("kept-root"), id, "Option", {
          id: next("view"),
          reference: ref("wide"),
          renderer: "result@1",
          x: 0,
          y: 0,
          alternative: id,
        });
      assert.equal(kept.ok, true, kept.error);
      return kept.value;
    }
    for (let i = 0; i < count; i++) keepOne();
    const timings = [],
      undoTimes = [];
    let last;
    for (let i = 0; i < 35; i++) {
      const begin = performance.now();
      last = keepOne();
      if (i >= 5) timings.push(performance.now() - begin);
      const undoBegin = performance.now(),
        u = w.owner.undo(w.reader.stamp(), next("undo"));
      assert.equal(u.ok, true);
      if (i >= 5) undoTimes.push(performance.now() - undoBegin);
    }
    const doc = w.reader.read(),
      bytes = f.encode(doc, [], seed.resources, schemas);
    assert.equal(doc.alternatives.size, count);
    assert.equal(f.assets(doc, schemas).size, 1);
    alternatives.push({
      liveAlternatives: count,
      changedDefinitionsPerPreview: changed,
      reachableRevisionsPerAlternative: 51,
      previewAndKeep30Ms: stats(timings),
      undo30Ms: stats(undoTimes),
      lastKeepMap: last.cost,
      retainedRevisions: doc.revisions.size,
      sharedAssets: f.assets(doc, schemas).size,
      nativeBytes: f.byteLength(bytes),
      undoSteps: w.diagnostics().undoSteps,
    });
  }
const sources = [];
for (const rows of [1000, 10000, 100000]) {
  const text = JSON.stringify(Array.from({ length: rows }, (_, i) => [i + 1])),
    a = await f.asset(text, hash),
    resources = await f.MemoryResources.verify([[a.digest, text]], hash),
    registry = f.createSchemas(),
    body = {
      asset: a,
      rows,
      columns: 1,
      interpretation: [{ unit: "mm2", ...meta }],
    },
    r = revision("table-r1", "table", "source@1", body),
    doc = f.prepare(
      f.empty("foundation-demo"),
      "source-root",
      [{ kind: "create", item: "table", label: "Table", revision: r }],
      registry,
    ).document,
    target = {
      ...ref("table"),
      selector: {
        kind: "cell",
        version: 1,
        revision: r.id,
        row: rows - 1,
        column: 0,
      },
    };
  const cold = [];
  for (let i = 0; i < 5; i++) {
    const coldRegistry = f.createSchemas(),
      begin = performance.now();
    assert.equal(
      f.project(doc, target, coldRegistry, resources).status,
      "resolved",
    );
    cold.push(performance.now() - begin);
  }
  const cached = measured(() => f.project(doc, target, registry, resources));
  assert.equal(registry.diagnostics().sourceParses, 1);
  sources.push({
    rows,
    nativeSourceBytes: f.byteLength(text),
    coldDecode5Ms: stats(cold),
    cachedProjection30Ms: cached.ms,
    cache: registry.diagnostics(),
  });
}
const receiptRows = [];
for (const count of [100, 1000, 10000]) {
  const w = f.createWorkspace(seed, {
    schemas,
    methods,
    executor: async (s) => calculate(s),
    namespace: "receipts",
    maxReceipts: count,
  });
  const times = [];
  for (let i = 0; i < count; i++) {
    const begin = performance.now(),
      job = w.owner.compute(w.reader.stamp(), ref("pressure"));
    assert.equal(job.ok, true, job.error);
    await job.value.completion;
    if (i >= count - 30) times.push(performance.now() - begin);
  }
  const lookup = measured(() => w.reader.result(ref("pressure")));
  assert.equal(lookup.value.status, "current");
  const begin = performance.now(),
    native = f.encode(
      w.reader.read(),
      [...w.reader.evidence().entries()].map(([, r]) => r),
      w.reader.resources(),
      schemas,
    ),
    encodeMs = performance.now() - begin,
    start = performance.now();
  await f.decode(native, schemas, methods, hash);
  receiptRows.push({
    receipts: count,
    appendLast30Ms: stats(times),
    currentLookup30Ms: lookup.ms,
    nativeBytes: f.byteLength(native),
    fullEncodeMs: encodeMs,
    fullDecodeMs: performance.now() - start,
    undoSteps: w.diagnostics().undoSteps,
  });
}
const result = {
  date: new Date().toISOString(),
  sourceDigest: execFileSync(
    process.execPath,
    ["packages/foundation/test/source-digest.mjs"],
    { encoding: "utf8" },
  ).trim(),
  environment: {
    node: process.version,
    cpu: cpus()[0]?.model,
    platform: platform(),
    release: release(),
    arch: arch(),
  },
  method:
    "5 warmups then 30 measured operations; full decode/cold source 5 trials. Alternatives keep existing live count fixed by Undo after each measured Keep; retained revisions accumulate intentionally. Source cache weight is a logical estimate, not measured heap. No product capacity/latency claim.",
  rows,
  alternatives,
  fanout,
  sources,
  receiptRows,
};
writeFileSync(
  new URL(
    "../../../evidence/current/foundation/growth-results.json",
    import.meta.url,
  ),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result, null, 2));
