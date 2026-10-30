import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as f from "../src/index.ts";
import {
  workspace,
  initial,
  schemas,
  methods,
  hash,
  calculate,
  ref,
  meta,
  revision,
  current,
  apply,
  force,
  preview,
  keep,
  undo,
  compute,
  serialized,
  controlled,
  id,
} from "./helpers.mjs";
const review = (w, evidence = "reachable", keepReceipts = []) =>
  w.reader.reviewCompaction({ evidence, keepReceipts });
function commit(w, r, resources) {
  const result = w.owner.compact(
    w.reader.stamp(),
    id("compacted-root"),
    r,
    resources,
  );
  assert.equal(result.ok, true, result.error);
  return result.value;
}
function cite(w, rid, item = id("conclusion")) {
  apply(w, [
    {
      kind: "create",
      item,
      label: "Retained conclusion",
      revision: revision(id("conclusion-rev"), item, "conclusion@1", {
        text: "Review this recorded result",
        receipts: [rid],
      }),
    },
  ]);
  return item;
}
test("duplicate attempts compact to latest plus cited evidence; receipt clock and retired IDs survive reopen", async () => {
  const w = await workspace();
  for (let i = 0; i < 5; i++) await compute(w);
  const oldest = [...w.reader.evidence().entries()]
    .map(([, r]) => r)
    .sort((a, b) => a.order - b.order)[0];
  cite(w, oldest.id);
  await compute(w);
  const before = w.reader.stamp(),
    history = w.diagnostics().undoSteps,
    r = review(w);
  assert.equal(r.before.receipts, 6);
  assert.equal(r.after.receipts, 2);
  assert.equal(r.removedReceipts.length, 4);
  commit(w, r);
  assert.equal(w.reader.stamp().evidence, before.evidence + 1);
  assert.equal(w.diagnostics().undoSteps, history);
  assert.equal(w.reader.evidence().get(oldest.id).id, oldest.id);
  assert.equal(w.reader.result(ref("pressure")).status, "current");
  const reopened = await workspace(
    undefined,
    await f.decode(serialized(w), schemas, methods, hash),
  );
  assert.equal(reopened.reader.stamp().evidence, w.reader.stamp().evidence);
  const removed = new Set(r.removedReceipts);
  const next = await compute(reopened);
  assert.equal(removed.has(next.receipt.id), false);
  assert.equal(next.receipt.order, before.evidence + 2);
  const backend = f.memoryBackend(),
    io = f.storage(backend, schemas, methods, hash),
    ticket = {
      request: "compacted-save",
      stamp: w.reader.stamp(),
      document: w.reader.read().document,
      expectedGeneration: 0,
      native: serialized(w),
    };
  const head = await io.save(ticket);
  assert.equal(f.acknowledgementApplies(head, ticket, w.reader.stamp()), true);
  assert.equal(
    (await io.reopen()).loaded.document.evidenceSequence,
    w.reader.stamp().evidence,
  );
});
test("current heads, independent pinned views and every retained Undo selection survive collection", async () => {
  const w = await workspace(undefined, await initial(), { historyLimit: 2 });
  apply(w, [
    {
      kind: "view",
      view: {
        id: "old-force-view",
        reference: {
          ...ref("force"),
          selection: { kind: "pin", revision: "force-r1" },
        },
        renderer: "scalar@1",
        x: 0,
        y: 0,
        alternative: null,
      },
    },
  ]);
  for (let i = 1; i <= 12; i++) force(w, i);
  const selected = current(w.reader.read(), "force").id,
    r = review(w, "all");
  assert.ok(r.removedRevisions.length >= 9);
  assert.equal(r.removedRevisions.includes("force-r1"), false);
  assert.equal(r.removedRevisions.includes(selected), false);
  commit(w, r);
  assert.equal(
    f.project(
      w.reader.read(),
      { ...ref("force"), selection: { kind: "pin", revision: "force-r1" } },
      schemas,
      w.reader.resources(),
    ).projection.value.value,
    100,
  );
  undo(w);
  assert.equal(current(w.reader.read(), "force").body.value, 11);
  undo(w);
  assert.equal(current(w.reader.read(), "force").body.value, 10);
  const retired = r.removedRevisions[0];
  assert.equal(
    w.owner.apply(w.reader.stamp(), id("reuse-root"), [
      {
        kind: "revise",
        item: "force",
        revision: revision(retired, "force", "scalar@1", {
          value: 999,
          unit: "N",
          ...meta,
        }),
      },
    ]).ok,
    false,
  );
});
test("undone item/revision IDs and removed view/alternative IDs cannot be recycled after native handoff", async () => {
  const w = await workspace(undefined, await initial(), { historyLimit: 0 });
  apply(w, [
    {
      kind: "create",
      item: "retired-item",
      label: "Temporary",
      revision: revision("retired-revision", "retired-item", "note@1", {
        text: "old",
        mode: "note",
      }),
    },
    {
      kind: "view",
      view: {
        id: "retired-view",
        reference: ref("draft"),
        renderer: "note@1",
        x: 0,
        y: 0,
        alternative: null,
      },
    },
  ]);
  apply(w, [
    { kind: "delete", item: "retired-item" },
    { kind: "removeView", id: "retired-view" },
  ]);
  preview(w, 200);
  const a = keep(w);
  apply(w, [
    { kind: "removeView", id: a.view },
    { kind: "removeAlternative", id: a.alternative },
  ]);
  const r = review(w);
  assert.ok(r.removedRevisions.includes("retired-revision"));
  commit(w, r);
  const reopened = await workspace(
    undefined,
    await f.decode(serialized(w), schemas, methods, hash),
    { historyLimit: 0 },
  );
  assert.equal(
    reopened.owner.apply(reopened.reader.stamp(), id("reuse"), [
      {
        kind: "create",
        item: "retired-item",
        label: "New",
        revision: revision(id("new"), "retired-item", "note@1", {
          text: "new",
          mode: "note",
        }),
      },
    ]).ok,
    false,
  );
  assert.equal(
    reopened.owner.apply(reopened.reader.stamp(), id("reuse"), [
      {
        kind: "revise",
        item: "draft",
        revision: revision("retired-revision", "draft", "note@1", {
          text: "new",
          mode: "note",
        }),
      },
    ]).ok,
    false,
  );
  assert.equal(
    reopened.owner.apply(reopened.reader.stamp(), id("reuse"), [
      {
        kind: "view",
        view: {
          id: "retired-view",
          reference: ref("draft"),
          renderer: "note@1",
          x: 1,
          y: 2,
          alternative: null,
        },
      },
    ]).ok,
    false,
  );
  preview(reopened, 300);
  assert.equal(
    reopened.owner.keep(
      reopened.reader.stamp(),
      id("reuse"),
      a.alternative,
      "Recycled",
      {
        id: id("view"),
        reference: ref("pressure"),
        renderer: "result@1",
        x: 0,
        y: 0,
        alternative: a.alternative,
      },
    ).ok,
    false,
  );
});
test("preview closure stays protected without becoming authored, and Keep still succeeds after maintenance", async () => {
  const w = await workspace(undefined, await initial(), { historyLimit: 0 });
  for (let i = 0; i < 10; i++) force(w, 100 + i);
  const p = preview(w, 200),
    newId = current(p.document, "force").id,
    r = review(w);
  assert.equal(w.reader.read().revisions.get(newId), undefined);
  assert.ok(r.removedRevisions.length > 0);
  commit(w, r);
  assert.equal(w.reader.read().revisions.get(newId), undefined);
  const kept = keep(w);
  await compute(w, ref("pressure"), { alternative: kept.alternative });
  assert.equal(
    w.reader.result(ref("pressure"), { alternative: kept.alternative }).receipt
      .outcome.output.value,
    0.08,
  );
});
test("in-flight jobs protect their actual inputs until settlement; late evidence remains historical", async () => {
  const e = controlled(),
    w = await workspace(e.execute, await initial(), { historyLimit: 0 });
  force(w, 200);
  const sourceId = current(w.reader.read(), "force").id,
    j = w.owner.compute(w.reader.stamp(), ref("pressure"));
  await Promise.resolve();
  for (let i = 0; i < 10; i++) force(w, 300 + i);
  const r = review(w);
  assert.equal(r.removedRevisions.includes(sourceId), false);
  commit(w, r);
  e.calls[0].resolve(calculate(e.calls[0].snapshot));
  const completed = await j.value.completion;
  assert.equal(completed.status, "retained");
  assert.equal(w.reader.result(ref("pressure")).status, "ready");
  const after = review(w);
  assert.equal(after.removedReceipts.includes(completed.receipt.id), true);
  assert.equal(after.removedRevisions.includes(sourceId), true);
});
test("a review becomes stale after an edit, evidence arrival, preview change or job start", async () => {
  const e = controlled(),
    w = await workspace(e.execute);
  let r = review(w),
    before = w.reader.stamp();
  force(w, 200);
  assert.equal(w.owner.compact(w.reader.stamp(), id("stale"), r).ok, false);
  r = review(w);
  preview(w, 300);
  assert.equal(w.owner.compact(w.reader.stamp(), id("stale"), r).ok, false);
  w.owner.cancelPreview(w.reader.stamp());
  r = review(w);
  const j = w.owner.compute(w.reader.stamp(), ref("pressure"));
  assert.equal(w.owner.compact(w.reader.stamp(), id("stale"), r).ok, false);
  await Promise.resolve();
  r = review(w);
  e.calls[0].resolve(calculate(e.calls[0].snapshot));
  await j.value.completion;
  assert.equal(w.owner.compact(w.reader.stamp(), id("stale"), r).ok, false);
  assert.equal(w.owner.compact(before, id("stale"), review(w)).ok, false);
  const other = await workspace();
  assert.equal(
    other.owner.compact(other.reader.stamp(), id("forged"), review(w)).ok,
    false,
  );
  assert.equal(
    w.owner.compact(w.reader.stamp(), id("forged"), { ...review(w) }).ok,
    false,
  );
});
async function area(w, value) {
  const bytes = JSON.stringify([[value]]),
    a = await f.asset(bytes, hash),
    resources = await w.reader.resources().add(a, bytes, hash),
    rid = id("area");
  const commands = [
    {
      kind: "revise",
      item: "area",
      revision: revision(rid, "area", "source@1", {
        ...current(w.reader.read(), "area").body,
        asset: a,
      }),
    },
  ];
  for (const name of ["pressure", "required-force"]) {
    const old = current(w.reader.read(), name).body;
    commands.push({
      kind: "revise",
      item: name,
      revision: revision(id(name), name, "request@1", {
        ...old,
        inputs: {
          ...old.inputs,
          area: {
            ...old.inputs.area,
            selector: { ...old.inputs.area.selector, revision: rid },
          },
        },
      }),
    });
  }
  apply(w, commands, resources);
  return a;
}
test("reachable policy reclaims stale source payloads but keeps kept alternatives and cited provenance", async () => {
  const w = await workspace(undefined, await initial(), { historyLimit: 0 });
  preview(w, 200);
  const kept = keep(w);
  await compute(w, ref("pressure"), { alternative: kept.alternative });
  const first = [...w.reader.evidence().entries()][0][1];
  cite(w, first.id);
  await area(w, 5000);
  await compute(w);
  await area(w, 10000);
  await compute(w);
  const before = w.reader.resources().diagnostics(),
    r = review(w);
  assert.equal(r.after.includedAssets, 2);
  assert.equal(r.before.includedAssets, 3);
  assert.ok(r.removedReceipts.length >= 1);
  const retained = w.reader.resources().retain(r.assets);
  commit(w, r, retained);
  assert.ok(retained.diagnostics().bytes < before.bytes);
  assert.equal(
    w.reader.result(ref("pressure")).receipt.outcome.output.value,
    0.01,
  );
  assert.equal(
    w.reader.result(ref("pressure"), { alternative: kept.alternative }).receipt
      .outcome.output.value,
    0.08,
  );
  assert.equal(w.reader.evidence().get(first.id).id, first.id);
  const copy = await workspace(
    undefined,
    await f.decode(serialized(w), schemas, methods, hash),
  );
  assert.equal(
    copy.reader.result(ref("pressure"), { alternative: kept.alternative })
      .receipt.outcome.output.value,
    0.08,
  );
});
test("source-selector anchors remain retained even when a following cell is ambiguous", async () => {
  const w = await workspace(undefined, await initial(), { historyLimit: 0 }),
    old = current(w.reader.read(), "area");
  apply(w, [
    { kind: "revise", item: "area", revision: { ...old, id: id("reimport") } },
  ]);
  assert.equal(w.reader.result(ref("pressure")).status, "blocked");
  const r = review(w);
  assert.equal(r.removedRevisions.includes("area-r1"), false);
  commit(w, r);
  assert.equal(w.reader.result(ref("pressure")).status, "blocked");
});
test("all/latest/reachable policies expose different evidence retention without executing jobs", async () => {
  let calls = 0;
  const w = await workspace(
    async (s) => {
      calls++;
      return calculate(s);
    },
    await initial(),
    { historyLimit: 0 },
  );
  await compute(w);
  await compute(w);
  force(w, 200);
  await compute(w);
  const ids = [...w.reader.evidence().entries()].map(([id]) => id);
  assert.equal(review(w, "all").after.receipts, 3);
  assert.equal(review(w, "latest-per-input").after.receipts, 2);
  assert.equal(review(w).after.receipts, 1);
  assert.equal(review(w, "reachable", [ids[0]]).after.receipts, 2);
  assert.equal(calls, 3);
  assert.throws(
    () => review(w, "reachable", ["missing-receipt"]),
    /unavailable/,
  );
});
test("typed evidence links must resolve before a conclusion/preview can be accepted", async () => {
  const w = await workspace(),
    before = w.reader.stamp(),
    body = { text: "Unproven", receipts: ["missing-receipt"] };
  assert.equal(
    w.owner.apply(before, id("bad-conclusion"), [
      {
        kind: "create",
        item: "bad",
        label: "bad",
        revision: revision(id("bad"), "bad", "conclusion@1", body),
      },
    ]).ok,
    false,
  );
  assert.deepEqual(w.reader.stamp(), before);
  apply(w, [
    {
      kind: "create",
      item: "conclusion",
      label: "Draft",
      revision: revision(id("conclusion"), "conclusion", "conclusion@1", {
        text: "Draft conclusion",
        receipts: [],
      }),
    },
  ]);
  assert.equal(
    w.owner.preview(w.reader.stamp(), ref("conclusion"), [
      {
        item: "conclusion",
        revision: revision(
          id("bad-preview"),
          "conclusion",
          "conclusion@1",
          body,
        ),
      },
    ]).ok,
    false,
  );
});
test("v1 files migrate forward and v2 lifecycle data rejects missing/corrupt identity or sequence metadata", async () => {
  const legacy = await readFile(
      new URL("portable.fixture.json", import.meta.url),
      "utf8",
    ),
    loaded = await f.decode(legacy, schemas, methods, hash),
    w = await workspace(undefined, loaded);
  assert.equal(
    w.reader.result(ref("pressure")).receipt.outcome.output.value,
    0.12,
  );
  assert.equal(w.reader.stamp().evidence, 2);
  assert.equal(JSON.parse(serialized(w)).version, 2);
  const text = serialized(w);
  for (const mutate of [
    (e) => delete e.document.identities,
    (e) => e.document.identities.revisions.pop(),
    (e) => (e.document.identities.receipts = []),
    (e) => (e.document.evidenceSequence = 0),
  ]) {
    const e = JSON.parse(text);
    mutate(e);
    await assert.rejects(f.decode(JSON.stringify(e), schemas, methods, hash));
  }
});
test("opaque packages refuse compaction and retain original unknown payloads", async () => {
  const w = await workspace(),
    e = JSON.parse(serialized(w));
  e.document.revisions["draft-r1"].schema = "future@9";
  e.document.revisions["draft-r1"].required = false;
  const text = JSON.stringify(e),
    loaded = await f.decode(text, schemas, methods, hash),
    ro = await workspace(undefined, loaded);
  assert.throws(() => review(ro), /opaque|read-only/);
  assert.equal(serialized(ro), text);
});
test("physical byte deduplication preserves different declared source media and engineering identities", async () => {
  const raw = {
      id: "raw-text@1",
      validate(b) {
        assert.ok(b && b.asset);
      },
      references: () => [],
      assets: (b) => [b.asset],
      project(b, s, resources) {
        const read = resources.read(b.asset);
        return read.status === "ready"
          ? { type: "text", value: read.data }
          : read;
      },
    },
    registry = f.createSchemas([raw]),
    loaded = await initial(),
    source = current(loaded.document, "area").body.asset;
  const w = f.createWorkspace(loaded, {
    schemas: registry,
    methods,
    namespace: "media",
  });
  const added = w.owner.apply(w.reader.stamp(), "media-root", [
    {
      kind: "create",
      item: "raw-source",
      label: "Raw text",
      revision: revision("raw-source-r1", "raw-source", "raw-text@1", {
        asset: { ...source, mediaType: "text/plain" },
      }),
    },
  ]);
  assert.equal(added.ok, true, added.error);
  const review = w.reader.reviewCompaction({ evidence: "all" });
  assert.equal(review.after.includedAssets, 1);
  const native = f.encode(w.reader.read(), [], w.reader.resources(), registry),
    copy = await f.decode(native, registry, methods, hash);
  assert.equal(Object.keys(JSON.parse(native).assets).length, 1);
  assert.equal(
    current(copy.document, "raw-source").body.asset.mediaType,
    "text/plain",
  );
  assert.equal(
    current(copy.document, "area").body.asset.mediaType,
    "application/json",
  );
  assert.equal(
    f.project(copy.document, ref("raw-source"), registry, copy.resources)
      .projection.value,
    "[[2500]]",
  );
});
test("unpublished preview source bytes stay protected through compaction and later Keep", async () => {
  const w = await workspace(undefined, await initial(), { historyLimit: 0 }),
    bytes = "[[5000]]",
    a = await f.asset(bytes, hash),
    provider = await w.reader.resources().add(a, bytes, hash);
  apply(w, [], provider);
  const sourceId = "preview-area-only",
    requestId = "preview-pressure-only",
    old = current(w.reader.read(), "pressure").body;
  const p = w.owner.preview(w.reader.stamp(), ref("pressure"), [
    {
      item: "area",
      revision: revision(sourceId, "area", "source@1", {
        asset: a,
        rows: 1,
        columns: 1,
        interpretation: [{ unit: "mm2", ...meta }],
      }),
    },
    {
      item: "pressure",
      revision: revision(requestId, "pressure", "request@1", {
        ...old,
        inputs: {
          ...old.inputs,
          area: {
            ...old.inputs.area,
            selector: { ...old.inputs.area.selector, revision: sourceId },
          },
        },
      }),
    },
  ]);
  assert.equal(p.ok, true, p.error);
  const r = review(w);
  assert.equal(r.before.includedAssets, 2);
  assert.equal(r.after.includedAssets, 2);
  assert.equal(w.reader.read().revisions.get(sourceId), undefined);
  const retained = provider.retain(r.assets);
  commit(w, r, retained);
  const kept = keep(w);
  await compute(w, ref("pressure"), { alternative: kept.alternative });
  assert.equal(
    w.reader.result(ref("pressure"), { alternative: kept.alternative }).receipt
      .outcome.output.value,
    0.02,
  );
  assert.equal(retained.diagnostics().assets, 2);
});
