/** One cold import boundary for superseded sampler results. Live execution never calls this. */
import * as f from "@manifold/foundation";
import {
  canvasSchemas,
  canvasMethods,
  canvasPage,
  canvasArtifacts,
  normalizeCanvasLoaded,
} from "./app/canvasDocument.ts";
import {
  prepare,
  receiptMatchesJob,
  samplingKey,
  type Artifact,
} from "./artifacts.ts";
import { semanticKey, type Page, type Region } from "./document.ts";
import { samplingJob, samplingReference } from "./samplingPlans.ts";
import { validateSourceEvidence } from "./resultSnapshot.ts";
import {
  samplingInput,
  samplingInvocation,
  samplingMethod,
  outputFromSamplingData,
  type SamplingInput,
} from "./samplingExecution.ts";
import type { ArtifactResult } from "./artifactRecords.ts";
const json = (value: unknown) => value as f.Json;
const uid = () => "sampling-import:" + crypto.randomUUID();
export const samplingHistorySchema: f.Schema = {
  id: "canvas-sampling-history@1",
  validate: samplingInput,
  references(body) {
    samplingInput(body);
    return body.capture.sources.map((source) => source.reference);
  },
  assets: () => [],
  project(body, selector, _resources, _revision, reader) {
    if (f.canonical(selector) !== f.canonical(f.wholeSelector))
      return {
        status: "unsupported",
        reason: "Historical sampling selector version",
      };
    samplingInput(body);
    const selected = new Map<string, f.Revision>();
    for (const source of body.capture.sources) {
      const got = reader.read(source.reference);
      f.assert(
        got.status === "resolved",
        got.status === "resolved" ? "" : got.reason,
      );
      f.assert(
        got.projection.type === "canvas-record",
        "Unsupported historical sampler source",
      );
      selected.set(got.projection.revision, {
        id: got.projection.revision,
        item: got.projection.item,
        schema: "canvas-record@1",
        required: true,
        body: {
          document: source.reference.document,
          kind: "region",
          value: got.projection.value,
        },
      });
    }
    validateSourceEvidence(
      {
        document: body.capture.sources[0]?.reference.document ?? _revision.item,
        current: (item) => [...selected.values()].find((r) => r.item === item),
        revision: (id) => selected.get(id),
      },
      body.capture.sources,
    );
    return { type: "typed-request@1", value: json(samplingInvocation(body)) };
  },
};
/** Import may restore a historical payload without selecting it as an authored head. */
function append(document: f.Document, revision: f.Revision) {
  const plain = f.toPlain(document),
    identities = plain.identities!;
  return f.fromPlain(
    {
      ...plain,
      items: {
        ...plain.items,
        ...(plain.items[revision.item]
          ? {}
          : {
              [revision.item]: {
                id: revision.item,
                label: "Imported historical selection",
                revision: null,
              },
            }),
      },
      revisions: { ...plain.revisions, [revision.id]: revision },
      identities: {
        ...identities,
        items: [...new Set([...identities.items, revision.item])].sort(),
        revisions: [...identities.revisions, revision.id].sort(),
      },
    },
    canvasSchemas,
  );
}
function historical(
  document: f.Document,
  artifact: string,
  receipt: NonNullable<Artifact["receipt"]>,
) {
  const key: unknown = JSON.parse(receipt.key);
  f.assert(Array.isArray(key), "Invalid historical sampler key");
  let request: SamplingInput["request"], capture: SamplingInput["capture"];
  if (receipt.snapshot === 2) {
    f.assert(key.length === 11 && key[0] === 2, "Invalid captured sampler key");
    request = { input: key[5], output: key[6], low: key[7], high: key[8] };
    const {
      key: _,
      time: _time,
      points: _points,
      code_sha256: _digest,
      runtime: _runtime,
      ...data
    } = receipt;
    capture = data as SamplingInput["capture"];
    f.assert(
      samplingKey(request, capture) === receipt.key,
      "Historical sampler capture/key differs",
    );
    validateSourceEvidence(document, capture.sources);
  } else {
    f.assert(
      key.length === 8 && typeof key[1] === "string",
      "Invalid legacy sampler key",
    );
    request = { input: key[2], output: key[3], low: key[4], high: key[5] };
    const semantics: unknown = JSON.parse(key[1]);
    f.assert(Array.isArray(semantics), "Invalid legacy sampler semantics");
    const links = Object.fromEntries(
        semantics
          .filter((row) => Array.isArray(row) && row.length === 6)
          .map((row) => [row[0], Object.fromEntries(row[5])]),
      ),
      regions = structuredClone(receipt.definitions) as Region[],
      page: Page = {
        regions,
        contexts: [
          {
            id: receipt.context,
            label: "Imported selection",
            base: {},
            overrides: {},
          },
        ],
        active: receipt.context,
        links,
        plots: [],
        layout: {},
        origin: { x: 0, y: 0 },
      },
      selected = new Map<string, f.Revision>();
    f.assert(
      semanticKey(page) === key[1],
      "Legacy source snapshot differs from captured semantics",
    );
    for (const region of regions.filter((region) => region.source)) {
      const dataset = regions.find(
        (value) => value.id === region.source!.dataset,
      );
      f.assert(dataset?.data, "Legacy captured measurement is unavailable");
      const item = "region:" + dataset.id,
        existing = [...document.revisions.entries()].find(
          ([, revision]) =>
            revision.item === item &&
            f.object(revision.body) &&
            f.object(revision.body.value) &&
            f.canonical(json(revision.body.value.data)) ===
              f.canonical(json(dataset.data)),
        )?.[1];
      const revision = existing ?? {
        id: uid(),
        item,
        schema: "canvas-record@1",
        required: true,
        body: {
          document: document.document,
          kind: "region",
          value: json(dataset),
        },
      };
      if (!existing) document = append(document, revision);
      selected.set(item, revision);
    }
    const job = prepare(
      page,
      { ...request, id: artifact, code: receipt.code } as Artifact,
      {
        document: document.document,
        current: (item) => selected.get(item),
        revision: (id) =>
          [...selected.values()].find((value) => value.id === id),
      },
    );
    f.assert(
      receiptMatchesJob(receipt, job),
      "Legacy sampler data differs from its captured request",
    );
    const { key: _, legacy: _legacy, ...data } = job;
    capture = data;
  }
  const input = { artifact, request, capture };
  samplingInput(input);
  return { document, input };
}
export async function migrateSamplingResults(
  initial: f.Loaded,
  results: Iterable<ArtifactResult>,
  evidenceFloor = initial.document.evidenceSequence,
): Promise<f.Loaded> {
  initial = normalizeCanvasLoaded(initial);
  const entries = [...results];
  f.assert(
    Number.isSafeInteger(evidenceFloor) && evidenceFloor >= 0,
    "Invalid legacy evidence clock",
  );
  if (!entries.length && evidenceFloor <= initial.document.evidenceSequence)
    return initial;
  let document = initial.document,
    resources = initial.resources;
  const receipts = [...initial.receipts],
    page = canvasPage(document),
    artifacts = canvasArtifacts(document);
  let order = Math.max(
    document.evidenceSequence,
    evidenceFloor,
    ...receipts.map((receipt) => receipt.order),
  );
  for (const entry of entries) {
    let captured:
      | Extract<ReturnType<typeof f.captureExecution>, { ok: true }>
      | undefined;
    const artifact = artifacts.find(
        (artifact) => artifact.id === entry.artifact,
      ),
      old = entry.receipt;
    if (
      artifact &&
      page.contexts.some((context) => context.id === old.context)
    ) {
      try {
        const current =
          old.snapshot === 2
            ? samplingJob(document, entry.artifact, old.context)
            : prepare({ ...page, active: old.context }, artifact, document);
        if (receiptMatchesJob(old, current)) {
          const selected = f.captureExecution(
            document,
            samplingReference(document, entry.artifact, old.context),
            canvasSchemas,
            canvasMethods,
            resources,
          );
          f.assert(selected.ok, selected.ok ? "" : selected.error);
          captured = selected;
        }
      } catch {
        /* A blocked current request must not reinterpret or discard its historical result. */
      }
    }
    if (!captured) {
      const history = historical(document, entry.artifact, old);
      document = history.document;
      const revision = {
        id: uid(),
        item: uid(),
        schema: samplingHistorySchema.id,
        required: true,
        body: json(history.input),
      };
      document = append(document, revision);
      const selected = f.captureExecution(
        document,
        f.reference(document.document, revision.item, revision.id),
        canvasSchemas,
        canvasMethods,
        resources,
      );
      f.assert(selected.ok, selected.ok ? "" : selected.error);
      captured = selected;
    }
    f.assert(
      f.isTypedSnapshot(captured.snapshot),
      "Sampling import requires typed evidence",
    );
    const input = captured.snapshot.input.body as unknown as SamplingInput,
      output = outputFromSamplingData(input, {
        points: old.points,
        runtime: old.runtime,
        code_sha256: old.code_sha256,
      });
    if (!(resources instanceof f.MemoryResources)) {
      const assets = [
        ...f.assets(document, canvasSchemas, receipts).values(),
      ].filter((asset) => asset.disposition === "included");
      resources = await f.MemoryResources.verify(
        assets.map((asset) => {
          const read = resources.read(asset);
          f.assert(read.status === "ready", "Missing imported asset");
          return [asset.digest, read.data] as const;
        }),
        f.webHash,
      );
    }
    f.assert(
      resources instanceof f.MemoryResources,
      "Imported resources must be verified",
    );
    resources = await resources.add(
      output.source,
      input.capture.code,
      f.webHash,
    );
    const checked = samplingMethod.validateOutput(json(input), output),
      receipt: f.TypedReceipt = f.freeze({
        kind: "typed@1",
        id: uid(),
        order: ++order,
        time: old.time,
        context: captured.context,
        requestRevision: captured.requestRevision,
        key: captured.key,
        snapshot: captured.snapshot,
        outcome: {
          status: "success",
          output: { schema: samplingMethod.output, body: checked },
          assets: [output.source],
        },
        physicalValidity: "not-assessed",
      });
    f.validateReceipt(
      document,
      receipt,
      canvasSchemas,
      canvasMethods,
      resources,
    );
    receipts.push(receipt);
  }
  return Object.freeze({
    ...initial,
    document: Object.freeze({
      ...document,
      id: uid(),
      sequence: document.sequence + 1,
      evidenceSequence: order,
    }),
    receipts: Object.freeze(receipts),
    resources,
    original: undefined,
  });
}
