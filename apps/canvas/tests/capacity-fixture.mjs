/** A valid pre-policy local head; only the fixture host overrides the product receipt limit. */
import * as f from "@manifold/foundation";
import { RegionSession } from "../src/regions/document.ts";
import {
  canvasSchemas,
  canvasMethods,
} from "../src/regions/app/canvasDocument.ts";
import { canvasExecutor } from "../src/regions/foundationModels.ts";
import {
  insertModel,
  modelReference,
  modelRequest,
} from "../src/regions/modelCommands.ts";
import { MAX_CANVAS_RECEIPTS } from "../src/regions/app/canvasStorageBudget.ts";
/** Reconstruct the pre-scene format so current factories cannot silently modernize a legacy fixture. */
export function withoutScene(document) {
  const plain = f.toPlain(document);
  const revisions = new Set(
    Object.values(plain.revisions)
      .filter((r) => r.schema.startsWith("canvas-scene-"))
      .map((r) => r.id),
  );
  const items = new Set([...revisions].map((id) => plain.revisions[id].item));
  plain.revisions = Object.fromEntries(
    Object.entries(plain.revisions).filter(([id]) => !revisions.has(id)),
  );
  plain.items = Object.fromEntries(
    Object.entries(plain.items).filter(([id]) => !items.has(id)),
  );
  plain.identities.items = plain.identities.items.filter(
    (id) => !items.has(id),
  );
  plain.identities.revisions = plain.identities.revisions.filter(
    (id) => !revisions.has(id),
  );
  return f.fromPlain(plain, canvasSchemas);
}
export async function legacyCapacitySnapshot(count = MAX_CANVAS_RECEIPTS + 1) {
  f.assert(
    Number.isSafeInteger(count) && count > 0 && count <= 100000,
    "Invalid legacy receipt count",
  );
  const session = new RegionSession();
  let templateOwner, expanded;
  try {
    const instance = insertModel(session, "spring", { x: 100, y: 100 });
    const base = session.capture().foundation;
    const options = {
      schemas: canvasSchemas,
      methods: canvasMethods,
      executor: canvasExecutor,
      namespace: "legacy-capacity",
      maxReceipts: count,
    };
    templateOwner = f.createWorkspace(
      {
        document: withoutScene(base.document),
        receipts: [],
        resources: base.resources,
      },
      options,
    );
    // One real execution establishes the method, snapshot, context and checked outcome.
    const task = templateOwner.owner.compute(
      templateOwner.reader.stamp(),
      modelReference(templateOwner.reader.read(), modelRequest(instance)),
    );
    f.assert(task.ok, task.error);
    const reservation = templateOwner.diagnostics().reservedEvidenceBytes;
    const result = await task.value.completion;
    f.assert(result.status === "retained", result.reason);
    const template = result.receipt;
    f.assert(
      f.isScalarReceipt(template) &&
        template.order === 1 &&
        template.outcome.status === "success",
      "Expected a successful scalar template",
    );
    const receipts = Array.from({ length: count }, (_, i) =>
      Object.freeze({
        ...template,
        id: `legacy-capacity:job:${i + 1}:receipt`,
        order: i + 1,
      }),
    );
    const weights = receipts.map((receipt) =>
      f.byteLength(f.canonical(f.receiptData(receipt))),
    );
    const bytes = weights.reduce((sum, n) => sum + n, 0);
    f.assert(
      bytes <= 64 * 1024 * 1024 &&
        bytes - weights.at(-1) + reservation <= 64 * 1024 * 1024,
      "Legacy fixture exceeds execution evidence budget",
    );
    const capture = templateOwner.reader.capture(),
      plain = f.toPlain(capture.document);
    // Extend only public Loaded/Document contracts, not persistent graph-record internals.
    const document = f.fromPlain(
      {
        ...plain,
        evidenceSequence: count,
        identities: {
          ...plain.identities,
          receipts: receipts.map((receipt) => receipt.id),
        },
      },
      canvasSchemas,
    );
    expanded = f.createWorkspace(
      { document, receipts, resources: capture.resources },
      options,
    );
    const backend = f.memoryBackend();
    const io = f.incrementalStorage(
      backend,
      canvasSchemas,
      canvasMethods,
      f.webHash,
    );
    const ready = expanded.reader.capture();
    await io.save({
      request: "legacy-capacity",
      document: ready.document.document,
      expectedGeneration: 0,
      stamp: ready.stamp,
      capture: ready,
    });
    return { backend, snapshot: await backend.snapshot(), count };
  } finally {
    expanded?.owner.dispose();
    templateOwner?.owner.dispose();
    session.dispose();
  }
}
