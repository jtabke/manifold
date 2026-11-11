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
  const session = new RegionSession(),
    instance = insertModel(session, "spring", { x: 100, y: 100 });
  const base = session.capture().foundation;
  const w = f.createWorkspace(
    {
      document: withoutScene(base.document),
      receipts: [],
      resources: base.resources,
    },
    {
      schemas: canvasSchemas,
      methods: canvasMethods,
      executor: canvasExecutor,
      namespace: "legacy-capacity",
      maxReceipts: count,
    },
  );
  session.dispose();
  const backend = f.memoryBackend(),
    io = f.incrementalStorage(backend, canvasSchemas, canvasMethods, f.webHash);
  let template, reservation;
  try {
    // Run the real scalar path once: capture/projection, scheduler, executor,
    // output validation and retention establish every field except ID/order.
    const task = w.owner.compute(
      w.reader.stamp(),
      modelReference(w.reader.read(), modelRequest(instance)),
    );
    if (!task.ok) throw Error(task.error);
    reservation = w.diagnostics().reservedEvidenceBytes;
    const result = await task.value.completion;
    if (result.status !== "retained") throw Error(result.reason);
    const capture = w.reader.capture();
    template = await f.decode(
      f.encode(
        capture.document,
        [...capture.receipts.entries()].map(([, r]) => r),
        capture.resources,
        canvasSchemas,
      ),
      canvasSchemas,
      canvasMethods,
      f.webHash,
    );
    await io.save({
      request: "legacy-capacity-template",
      document: capture.document.document,
      expectedGeneration: 0,
      stamp: capture.stamp,
      capture,
    });
  } finally {
    w.owner.dispose();
  }
  const [receipt] = template.receipts;
  f.assert(
    template.receipts.length === 1 &&
      f.isScalarReceipt(receipt) &&
      receipt.id === "legacy-capacity:job:1:receipt" &&
      receipt.order === 1 &&
      receipt.outcome.status === "success",
    "Legacy fixture requires one successful first scalar receipt",
  );
  // Identical scalar jobs do not change selection, snapshots, contexts or
  // resources. Only retained identities/order and the never-reuse ledger grow.
  // Expand those public contracts using the production-written record template.
  // No recipe, context, snapshot, outcome or private graph layout is invented.
  const receipts = Array.from({ length: count }, (_, index) =>
    Object.freeze({
      ...receipt,
      id: `legacy-capacity:job:${index + 1}:receipt`,
      order: index + 1,
    }),
  );
  // Consumers validate contracts at admission. Preserve both execution byte
  // guards too: retained bytes and the last job's pre-execution reservation. Identical
  // snapshots/contexts reserve the same bytes on every iteration.
  const weights = receipts.map((r) =>
      f.byteLength(f.canonical(f.receiptData(r))),
    ),
    evidenceBytes = weights.reduce((sum, bytes) => sum + bytes, 0);
  f.assert(
    evidenceBytes <= 64 * 1024 * 1024 &&
      evidenceBytes - weights.at(-1) + reservation <= 64 * 1024 * 1024,
    "Legacy fixture exceeds execution evidence budget",
  );
  const saved = await backend.snapshot(),
    head = saved.state.head,
    reader = f.recordReader(saved, f.webHash),
    top = await reader.node(head.package),
    records = await reader.map(top.roots.receipts, (key) => reader.node(key)),
    record = records[receipt.id],
    ledger = await reader.node(top.roots["allocated:receipts"]);
  f.assert(
    top.kind === "workspace" &&
      record.kind === "receipt" &&
      record.data.id === receipt.id &&
      ledger.kind === "map" &&
      ledger.key === receipt.id &&
      ledger.left === null &&
      ledger.right === null,
    "Legacy fixture requires a single production receipt/ledger template",
  );
  // Preserve the same AVL insertion history as genuine sequential retention.
  let receiptMap = f.SharedMap.empty(),
    allocated = template.document.allocated.receipts;
  for (const r of receipts) {
    receiptMap = receiptMap.set(r.id, r);
    allocated = allocated.set(r.id, true);
  }
  const writer = f.recordWriter(new Map(), f.webHash),
    receiptRoot = await writer.map("receipts", receiptMap, (r) =>
      writer.pack(
        { ...record, data: { ...record.data, id: r.id, order: r.order } },
        [record.context, record.snapshot],
      ),
    ),
    ledgerRoot = await writer.map("ids", allocated, async () => ledger.value),
    roots = {
      ...top.roots,
      receipts: receiptRoot,
      "allocated:receipts": ledgerRoot,
    },
    root = await writer.pack(
      { ...top, evidenceSequence: count, roots },
      Object.values(roots),
    );
  await backend.commit(
    head.generation,
    {
      request: "legacy-capacity",
      root: head.root,
      document: head.document,
      package: root,
    },
    [...writer.chunks.values()],
    [],
    "none",
    saved.state.epoch,
  );
  // Consumers still run complete production graph/receipt validation before
  // budget admission or rescue. check-capacity-fixture also proves equivalence
  // to genuine computation, including exact receipt/ledger subgraph digests.
  return { backend, snapshot: await backend.snapshot(), count };
}
