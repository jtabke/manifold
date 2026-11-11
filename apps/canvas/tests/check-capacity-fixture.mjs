import assert from "node:assert/strict";
import * as f from "@manifold/foundation";
import { legacyCapacitySnapshot } from "./capacity-fixture.mjs";
import {
  canvasSchemas,
  canvasMethods,
} from "../src/regions/app/canvasDocument.ts";
import { canvasExecutor } from "../src/regions/foundationModels.ts";
import { CanvasStorageBudget } from "../src/regions/app/canvasStorageBudget.ts";

const config = {
  schemas: canvasSchemas,
  methods: canvasMethods,
  executor: canvasExecutor,
  namespace: "legacy-capacity",
};
const receiptId = (order) => `legacy-capacity:job:${order}:receipt`;
// Compare portable data; decode intentionally replaces null-prototype objects.
const data = (receipts) =>
  [...receipts]
    .sort((a, b) => a.order - b.order)
    .map((receipt) => JSON.parse(JSON.stringify(f.receiptData(receipt))));
const native = (loaded) =>
  f.encode(loaded.document, loaded.receipts, loaded.resources, canvasSchemas);
async function reopen(old) {
  return (
    await f
      .incrementalStorage(old.backend, canvasSchemas, canvasMethods, f.webHash)
      .reopenSnapshot(old.snapshot)
  ).loaded;
}
async function compute(workspace, target) {
  const task = workspace.owner.compute(workspace.reader.stamp(), target);
  assert.equal(task.ok, true, task.error);
  const result = await task.value.completion;
  assert.equal(result.status, "retained", result.reason);
  return result.receipt;
}
function checkReceipts(loaded, count) {
  const receipts = [...loaded.receipts].sort((a, b) => a.order - b.order),
    first = receipts[0];
  assert.equal(receipts.length, count);
  assert.equal(loaded.document.evidenceSequence, count);
  assert.equal(loaded.document.allocated.receipts.size, count);
  assert.equal(first.outcome.status, "success");
  assert.equal(first.outcome.output.value, 20);
  assert.equal(first.outcome.output.unit, "N");
  for (const [index, receipt] of receipts.entries()) {
    assert.equal(receipt.id, receiptId(index + 1));
    assert.equal(receipt.order, index + 1);
    assert.equal(loaded.document.allocated.receipts.get(receipt.id), true);
    assert.equal(f.isScalarReceipt(receipt), true);
    assert.equal(receipt.physicalValidity, "not-assessed");
    assert.equal(receipt.key, f.snapshotKey(receipt.snapshot));
    assert.deepEqual(receipt.snapshot, first.snapshot);
    assert.deepEqual(receipt.outcome, first.outcome);
    assert.deepEqual(
      f.contextToPlain(receipt.context),
      f.contextToPlain(first.context),
    );
    assert.equal(receipt.requestRevision, first.requestRevision);
  }
  assert.equal(
    [...loaded.document.revisions.entries()].some(([, revision]) =>
      revision.schema.startsWith("canvas-scene-"),
    ),
    false,
    "the saved fixture must retain the pre-scene format",
  );
}

// Test-local reference retains the old implementation's genuine repeated jobs.
// Reuse the generated model document so UUIDs cannot mask semantic differences.
for (const count of [1, 4]) {
  const old = await legacyCapacitySnapshot(count),
    loaded = await reopen(old),
    plain = f.toPlain(loaded.document),
    reference = f.createWorkspace(
      {
        document: f.fromPlain(
          {
            ...plain,
            evidenceSequence: 0,
            identities: { ...plain.identities, receipts: [] },
          },
          canvasSchemas,
        ),
        receipts: [],
        resources: loaded.resources,
      },
      { ...config, maxReceipts: count },
    );
  try {
    const target = loaded.receipts[0].context.root;
    for (let index = 0; index < count; index++)
      await compute(reference, target);
    const capture = reference.reader.capture();
    assert.deepEqual(f.toPlain(capture.document), f.toPlain(loaded.document));
    assert.deepEqual(
      data([...capture.receipts.entries()].map(([, receipt]) => receipt)),
      data(loaded.receipts),
      "expanded receipts must exactly match genuine repeated computation",
    );
    const decoded = await f.decode(
      native(loaded),
      canvasSchemas,
      canvasMethods,
      f.webHash,
    );
    checkReceipts(decoded, count);
    const budget = new CanvasStorageBudget();
    budget.check(
      {
        ...loaded,
        receipts: f.SharedMap.from(loaded.receipts.map((r) => [r.id, r])),
      },
      canvasSchemas,
    );
    assert.equal(reference.reader.result(target).receipt.id, receiptId(count));
  } finally {
    reference.owner.dispose();
  }

  // Allocated IDs remain retired after compaction and native roundtrip. A new
  // owner's serial starts at zero, so only the ledger prevents ID reuse.
  const workspace = f.createWorkspace(loaded, config);
  let compacted;
  try {
    assert.equal(
      workspace.reader.result(loaded.receipts[0].context.root).receipt.id,
      receiptId(count),
    );
    const review = workspace.reader.reviewCompaction({ evidence: "reachable" });
    assert.equal(review.removedReceipts.length, count - 1);
    const result = workspace.owner.compact(
      workspace.reader.stamp(),
      "capacity-retired-root",
      review,
    );
    assert.equal(result.ok, true, result.error);
    compacted = await f.decode(
      f.encode(
        workspace.reader.read(),
        [...workspace.reader.evidence().entries()].map(([, r]) => r),
        loaded.resources,
        canvasSchemas,
      ),
      canvasSchemas,
      canvasMethods,
      f.webHash,
    );
  } finally {
    workspace.owner.dispose();
  }
  assert.equal(compacted.receipts.length, 1);
  assert.deepEqual(
    f.toPlain(compacted.document).identities.receipts,
    plain.identities.receipts,
  );
  const resumed = f.createWorkspace(compacted, config);
  try {
    const receipt = await compute(resumed, loaded.receipts[0].context.root);
    assert.equal(receipt.id, receiptId(count + 1));
    assert.equal(receipt.order, count + 2, "compaction also advances evidence");
  } finally {
    resumed.owner.dispose();
  }
}

console.log(
  "Capacity fixture: small genuine-computation equivalence, production decoding, public receipt/ledger contracts and retired-ID protection pass; full MAX+1 rescue remains in check-canvas-capacity.",
);
