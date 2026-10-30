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
  for (let index = 0; index < count; index++) {
    const task = w.owner.compute(
      w.reader.stamp(),
      modelReference(w.reader.read(), modelRequest(instance)),
    );
    if (!task.ok) throw Error(task.error);
    const result = await task.value.completion;
    if (result.status !== "retained") throw Error(result.reason);
  }
  const backend = f.memoryBackend(),
    io = f.incrementalStorage(backend, canvasSchemas, canvasMethods, f.webHash),
    capture = w.reader.capture();
  await io.save({
    request: "legacy-capacity",
    document: capture.document.document,
    expectedGeneration: 0,
    stamp: capture.stamp,
    capture,
  });
  w.owner.dispose();
  return { backend, snapshot: await backend.snapshot(), count };
}
