/** One application snapshot is the foundation capture. Superseded result bundles are read only. */
import * as f from "@manifold/foundation";
import { indexedBackend } from "@manifold/foundation/indexed-db";
import {
  canvasPage,
  canvasSerial,
  canvasObservedArtifacts,
  canvasSchemas,
  canvasMethods,
  validateCanvasDocument,
  type CanvasRecovery,
} from "./canvasDocument.ts";
import {
  validArtifactReceipt,
  type ArtifactResult,
} from "../artifactRecords.ts";
import { validateSourceEvidence } from "../resultSnapshot.ts";
import { migrateSamplingResults } from "../samplingMigration.ts";
import { prepareSceneLoaded } from "../sceneRecords.ts";
import {
  MAX_CANVAS_LOCAL_BYTES,
  CanvasStorageBudget,
} from "./canvasStorageBudget.ts";
import { archiveLoaded } from "./workspaceCodec.ts";
import type { RegionSession } from "../document.ts";
type Capture = ReturnType<RegionSession["capture"]>;
type Backend = f.RecordBackend & { close?: () => void };
const isDigest = (value: unknown): value is string =>
  typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
export async function canvasDatabaseName(key: string) {
  return "manifold-foundation-canvas-" + (await f.webHash(key)).slice(7);
}
export async function openCanvasStore(key: string) {
  return canvasLocalStore(await indexedBackend(await canvasDatabaseName(key)));
}
/** Only a freshly created unpublished destination may be discarded. */
export async function discardStagedCanvas(key: string) {
  const name = await canvasDatabaseName(key);
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(Error("Staged canvas cleanup is blocked"));
  });
}
export function canvasLocalStore(backend: Backend, hash: f.Hash = f.webHash) {
  let generation = 0,
    ready = false,
    boundDocument: string | undefined,
    closed = false,
    recovered: CanvasRecovery | undefined,
    recoveredRoot: string | undefined,
    tail: Promise<unknown> = Promise.resolve();
  const reviews = new WeakSet<object>(),
    core = f.incrementalStorage(backend, canvasSchemas, canvasMethods, hash);
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(() => {
      f.assert(!closed, "Canvas storage is closed");
      return operation();
    });
    tail = result.catch(() => {});
    return result;
  }
  async function read(
    snapshot: f.ReadSnapshot,
    limits: f.SnapshotLimits = {},
    legacyScene?: string,
  ) {
    const head = snapshot.state.head;
    f.assert(head, "No saved canvas");
    const reader = f.recordReader(snapshot, hash, limits),
      top = await reader.node(head.package);
    let foundation: f.Loaded,
      evidenceFloor = 0;
    const results: ArtifactResult[] = [];
    if (top.kind === "bundle") {
      f.assert(
        top.schema === "manifold-canvas-local" &&
          top.version === 1 &&
          f.object(top.metadata) &&
          f.object(top.roots),
        "Unsupported saved canvas bundle",
      );
      f.fields(top.metadata, ["document", "root", "evidence"]);
      f.fields(top.roots, ["foundation", "results"]);
      f.assert(
        top.metadata.document === head.document &&
          top.metadata.root === head.root &&
          Number.isSafeInteger(top.metadata.evidence) &&
          (top.metadata.evidence as number) >= 0 &&
          isDigest(top.roots.foundation),
        "Saved canvas head mismatch",
      );
      evidenceFloor = top.metadata.evidence as number;
      const nestedHead = { ...head, package: top.roots.foundation },
        nested: f.ReadSnapshot = Object.freeze({
          ...snapshot,
          state: Object.freeze({ ...snapshot.state, head: nestedHead }),
          head: async () => nestedHead,
        });
      foundation = (await core.reopenSnapshot(nested, limits)).loaded;
      const records = await reader.map(top.roots.results, reader.value);
      for (const [id, raw] of Object.entries(records)) {
        f.assert(f.object(raw), "Invalid saved sampler result");
        f.fields(raw, ["artifact", "receipt"]);
        f.assert(
          raw.artifact === id &&
            foundation.document.known.get("artifact:" + id) &&
            validArtifactReceipt(raw.receipt),
          "Invalid saved sampler target or data",
        );
        if (raw.receipt.snapshot === 2)
          validateSourceEvidence(foundation.document, raw.receipt.sources!);
        results.push(raw as unknown as ArtifactResult);
      }
    } else foundation = (await core.reopenSnapshot(snapshot, limits)).loaded;
    validateCanvasDocument(foundation.document, true);
    foundation = await migrateSamplingResults(
      foundation,
      results,
      evidenceFloor,
    );
    const preparedScene = prepareSceneLoaded(
      foundation,
      canvasSchemas,
      legacyScene,
    );
    foundation = preparedScene.loaded;
    validateCanvasDocument(foundation.document);
    canvasSerial(foundation.document);
    const recovery: CanvasRecovery = Object.freeze({ foundation });
    return {
      head,
      recovery,
      page: canvasPage(foundation.document),
      artifacts: canvasObservedArtifacts(foundation),
      document: foundation.document,
      ...(preparedScene.sceneError
        ? { sceneError: preparedScene.sceneError }
        : {}),
    };
  }
  return Object.freeze({
    load: (limits: f.SnapshotLimits = {}, legacyScene?: string) =>
      serial(async () => {
        ready = false;
        recovered = undefined;
        recoveredRoot = undefined;
        const snapshot = await backend.snapshot(limits);
        if (!snapshot.state.head) {
          f.assert(
            snapshot.state.revision === 0 && snapshot.state.epoch === 0,
            "Saved canvas head is missing",
          );
          generation = 0;
          boundDocument = undefined;
          recovered = undefined;
          recoveredRoot = undefined;
          core.resetCache();
          ready = true;
          return undefined;
        }
        const data = await read(snapshot, limits, legacyScene);
        const state = data.recovery.foundation;
        new CanvasStorageBudget().check(
          {
            ...state,
            receipts: f.SharedMap.from(
              state.receipts.map((receipt) => [receipt.id, receipt]),
            ),
          },
          canvasSchemas,
        );
        generation = data.head.generation;
        boundDocument = data.document.document;
        recovered = data.recovery;
        recoveredRoot = data.head.root;
        ready = true;
        return data;
      }),
    /** Validated saved bytes, independent of live adoption, ACK or write readiness. */
    exportSaved: (legacyScene?: string) =>
      serial(async () => {
        const limits = { maxBytes: MAX_CANVAS_LOCAL_BYTES },
          snapshot = await backend.snapshot(limits),
          data = await read(snapshot, limits, legacyScene),
          state = data.recovery.foundation;
        return archiveLoaded(state, canvasSchemas);
      }),
    acknowledgeRecovery(session: RegionSession) {
      if (!ready || !recovered) return false;
      const capture = session.capture();
      return (
        capture.document.id === recoveredRoot &&
        capture.document.id === recovered.foundation.document.id &&
        capture.evidence === recovered.foundation.document.evidenceSequence &&
        session.acknowledge(capture)
      );
    },
    save(
      session: RegionSession,
      capture: Capture = session.capture(),
      fault: f.Fault = "none",
      beforePublish?: () => Promise<void>,
    ) {
      session.checkCapture(capture);
      f.assert(
        Number.isSafeInteger(capture.storageUpperBytes) &&
          capture.storageUpperBytes <= MAX_CANVAS_LOCAL_BYTES,
        "Local snapshot exceeds its recovery budget; export current work or clean up retained history",
      );
      f.assert(capture.foundation, "A staging candidate cannot be saved");
      return serial(async () => {
        f.assert(ready, "Open and validate the saved canvas before saving");
        f.assert(
          !boundDocument || boundDocument === capture.document.document,
          "Save conflict: a different saved document is bound",
        );
        const result = await core.save(
          {
            request: "canvas-save:" + crypto.randomUUID(),
            stamp: capture.foundation!.stamp,
            document: capture.document.document,
            expectedGeneration: generation,
            capture: capture.foundation!,
          },
          fault,
          beforePublish,
        );
        generation = result.head.generation;
        boundDocument = capture.document.document;
        return Object.freeze({
          ...result,
          current: session.acknowledge(capture),
        });
      });
    },
    async inspect(limits: f.SnapshotLimits = {}) {
      await tail;
      const inspection = await backend.inspect(limits);
      if (inspection.snapshot.state.head)
        await read(inspection.snapshot, limits);
      reviews.add(inspection);
      return inspection;
    },
    reclaim(
      inspection: Awaited<ReturnType<Backend["inspect"]>>,
      abort = false,
    ) {
      return serial(async () => {
        f.assert(reviews.has(inspection), "Unrecognized canvas storage review");
        const result = await backend.reclaim(inspection, abort);
        reviews.delete(inspection);
        core.resetCache();
        return result;
      });
    },
    close() {
      closed = true;
      backend.close?.();
    },
    get generation() {
      return generation;
    },
  });
}
export type CanvasLocalStore = ReturnType<typeof canvasLocalStore>;
