import test from "node:test";
import assert from "node:assert/strict";
import * as f from "../src/index.ts";
const pin = (item, revision, document = "doc") => ({
  document,
  item,
  selection: { kind: "pin", revision },
  selector: null,
});
test("application evidence roots protect a pinned transitive closure without authoring or losing identity", async () => {
  const schemas = f.createSchemas([
    {
      id: "linked@1",
      validate(v) {
        f.assert(f.object(v), "Invalid");
        if (v.ref) f.validateReference(v.ref);
      },
      references: (v) => (v.ref ? [v.ref] : []),
      assets: () => [],
      project: (v) => ({ type: "linked", value: v }),
    },
  ]);
  const w = f.createWorkspace(
    {
      document: f.empty("doc"),
      receipts: [],
      resources: await f.MemoryResources.verify([], f.webHash),
    },
    { schemas, namespace: "owner", historyLimit: 0 },
  );
  let root = 0;
  const apply = (commands) => {
    const r = w.owner.apply(w.reader.stamp(), "root-" + ++root, commands);
    assert.equal(r.ok, true, r.error);
  };
  apply([
    {
      kind: "create",
      item: "source",
      label: "Source",
      revision: {
        id: "source-v1",
        item: "source",
        schema: "note@1",
        required: true,
        body: { text: "old", mode: "note" },
      },
    },
  ]);
  apply([
    {
      kind: "create",
      item: "link",
      label: "Link",
      revision: {
        id: "link-v1",
        item: "link",
        schema: "linked@1",
        required: true,
        body: { ref: pin("source", "source-v1") },
      },
    },
  ]);
  apply([
    { kind: "delete", item: "link" },
    {
      kind: "revise",
      item: "source",
      revision: {
        id: "source-v2",
        item: "source",
        schema: "note@1",
        required: true,
        body: { text: "new", mode: "note" },
      },
    },
  ]);
  const without = w.reader.reviewCompaction({ evidence: "all" });
  assert.equal(without.after.revisions, 1);
  const keepReferences = [pin("link", "link-v1")],
    reviewed = w.reader.reviewCompaction({ evidence: "all", keepReferences });
  keepReferences.length = 0;
  assert.equal(reviewed.after.revisions, 3);
  assert.equal(reviewed.policy.keepReferences.length, 1);
  const out = w.owner.compact(w.reader.stamp(), "cleaned", reviewed);
  assert.equal(out.ok, true, out.error);
  assert.equal(
    f.resolve(w.reader.read(), pin("source", "source-v1")).status,
    "resolved",
  );
  for (const reference of [
    pin("link", "missing"),
    pin("link", "link-v1", "foreign"),
    { ...pin("link", "link-v1"), selection: { kind: "follow" } },
  ])
    assert.throws(
      () =>
        w.reader.reviewCompaction({
          evidence: "all",
          keepReferences: [reference],
        }),
      /unavailable|local pinned/,
    );
});
