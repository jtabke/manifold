/** One accepted record owner; Page is a read-only compatibility projection for the current renderer. */
import { drawingSchema, validateDrawingDocument } from "../drawing.ts";
import { analysisMethodRef } from "../modelAnalysis.ts";
import { validateAnalysisViews } from "../modelAnalysisCommands.ts";
import {
  modelOutputsExecutor,
  modelOutputsMethodRef,
} from "../modelResults.ts";
import { sameJson as same } from "../immutableJson.ts";
import * as f from "@manifold/foundation";
import {
  sceneSchemas,
  validateSceneDocument,
  prepareSceneLoaded,
} from "../sceneRecords.ts";
import type { Page, Region } from "../document.ts";
import { validateWorkspaceData, type Artifact } from "../artifacts.ts";
import { validateArtifactRecords } from "../artifactRecords.ts";
import { samplingHistorySchema } from "../samplingMigration.ts";
import { positions } from "../pageLayout.ts";
import {
  samplingExecutor,
  indexSamplingObservation,
  samplingObservationKey,
  samplingReceipt,
} from "../samplingExecution.ts";
import type { ArtifactExecutor } from "../artifactComputations.ts";
import {
  validateKeptCalculation,
  validateWorksheetSources,
} from "../worksheetHistory.ts";
import {
  CanvasStorageBudget,
  MAX_CANVAS_RECEIPTS,
} from "./canvasStorageBudget.ts";
import {
  samplingPlanSchema,
  compileSamplingPlan,
  validateSamplingPlans,
  samplingReference,
} from "../samplingPlans.ts";
import {
  modelAnalyses,
  canvasContentSchemas,
  canvasMethods,
  canvasExecutor,
  validateModelViews,
} from "../foundationModels.ts";
export { canvasMethods } from "../foundationModels.ts";
const ownedSchemas = new Set([
  "canvas-page@1",
  "canvas-workspace@1",
  "canvas-workspace@2",
  "canvas-record@1",
  "canvas-artifact@1",
  "canvas-artifact@2",
  "canvas-sampling-plan@1",
  "canvas-calculation@1",
]);
const ownedRenderer = (renderer: string) =>
  ["canvas-region@1", "canvas-layout@1", "canvas-artifact-view@1"].includes(
    renderer,
  );
const ownedItem = (doc: f.Document, item: string) => {
  const revision = f.current(doc, item);
  return !!revision && ownedSchemas.has(revision.schema);
};
const META = "canvas";
const groups = [
  "regions",
  "contexts",
  "plots",
  "models",
  "dataRelations",
  "calculations",
] as const;
type Group = (typeof groups)[number];
const kinds: Record<Group, string> = {
  regions: "region",
  contexts: "context",
  plots: "plot",
  models: "model",
  dataRelations: "relation",
  calculations: "calculation",
};
const itemId = (group: Group, id: string) => kinds[group] + ":" + id;
const uid = (prefix: string) => prefix + ":" + crypto.randomUUID();
const reference = (
  document: string,
  item: string,
  selector: f.Json = null,
): f.Reference => ({ document, item, selection: { kind: "follow" }, selector });
const resources: f.Resources = Object.freeze({
  read: () => ({
    status: "unavailable" as const,
    reason: "Canvas sources are retained inline by this compatibility adapter",
  }),
});
/** Legacy optional undefined fields are omitted; all other non-JSON values reject. */
function plain(value: unknown, ancestors = new Set<object>()): f.Json {
  if (value === null || typeof value !== "object") {
    f.json(value);
    return value;
  }
  f.assert(
    !ancestors.has(value) && ancestors.size < 100,
    "Cyclic or deeply nested canvas value",
  );
  const nextAncestors = new Set(ancestors).add(value);
  const proto = Object.getPrototypeOf(value);
  f.assert(
    Array.isArray(value) || proto === Object.prototype || proto === null,
    "Non-JSON canvas value",
  );
  if (Array.isArray(value)) return value.map((v) => plain(v, nextAncestors));
  const result: Record<string, f.Json> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    f.assert(typeof key === "string", "Symbol canvas field");
    const d = Object.getOwnPropertyDescriptor(value, key)!;
    f.assert(d.enumerable && "value" in d, "Accessor canvas field");
    if (d.value !== undefined) result[key] = plain(d.value, nextAncestors);
  }
  return result;
}

function meta(body: f.Json): asserts body is Record<string, f.Json> {
  f.assert(f.object(body), "Invalid canvas metadata");
  f.fields(body, [
    "document",
    "regions",
    "contexts",
    "plots",
    "models",
    "dataRelations",
    "active",
    "origin",
    "links",
    "extras",
    "artifacts",
    "calculations",
  ]);
  f.identity(body.document);
  f.assert(
    typeof body.active === "string" &&
      f.object(body.origin) &&
      Number.isFinite(body.origin.x) &&
      Number.isFinite(body.origin.y),
    "Invalid canvas metadata",
  );
  if (body.extras !== undefined) {
    f.assert(f.object(body.extras), "Invalid canvas extra fields");
    f.assert(
      Object.keys(body.extras).every(
        (key) =>
          ![...groups, "active", "origin", "layout", "links"].includes(
            key as Group,
          ),
      ),
      "Canvas extra fields shadow authored records",
    );
  }
  if (body.artifacts !== undefined)
    f.assert(
      Array.isArray(body.artifacts) &&
        body.artifacts.every((id) => typeof id === "string") &&
        new Set(body.artifacts).size === body.artifacts.length,
      "Invalid artifact collection",
    );
  for (const group of groups) {
    const ids = body[group];
    if (ids === undefined) {
      f.assert(
        group === "models" ||
          group === "dataRelations" ||
          group === "calculations",
        "Missing canvas collection",
      );
      continue;
    }
    f.assert(
      Array.isArray(ids) &&
        ids.every((id) => typeof id === "string") &&
        new Set(ids).size === ids.length,
      "Invalid canvas collection",
    );
  }
}
function record(body: f.Json): asserts body is Record<string, f.Json> {
  f.assert(f.object(body), "Invalid canvas record");
  f.fields(body, ["document", "kind", "value"]);
  f.identity(body.document);
  f.assert(
    body.kind !== "calculation" &&
      Object.values(kinds).includes(body.kind as string) &&
      f.object(body.value) &&
      typeof body.value.id === "string",
    "Invalid canvas record",
  );
}
function artifactRecord(body: f.Json) {
  f.assert(f.object(body), "Invalid artifact record");
  f.fields(body, ["document", "value", "plans"]);
  f.identity(body.document);
  f.assert(
    f.object(body.value) &&
      !["receipt", "at", "width", "height", "renderer", "views"].some((key) =>
        Object.hasOwn(body.value as object, key),
      ),
    "Artifact definitions cannot own output or presentation data",
  );
  f.assert(
    f.object(body.value) && typeof body.value.id === "string",
    "Invalid artifact definition",
  );
}
function calculationRecord(
  body: f.Json,
): asserts body is Record<string, f.Json> {
  f.assert(f.object(body), "Invalid kept calculation record");
  f.fields(body, ["document", "kind", "value"]);
  f.identity(body.document);
  f.assert(body.kind === "calculation", "Invalid calculation record kind");
  validateKeptCalculation(body.value);
  f.assert(
    body.value.snapshot.origin.document === body.document,
    "Calculation belongs to another document",
  );
}
function workspaceReferences(body: f.Json): f.Reference[] {
  meta(body);
  return [
    ...groups.flatMap((group) =>
      ((body[group] ?? []) as string[]).map((id) =>
        reference(body.document as string, itemId(group, id)),
      ),
    ),
    ...(body.artifacts as string[]).map((id) =>
      reference(body.document as string, "artifact:" + id),
    ),
  ];
}
function validateCalculationSources(document: f.Document) {
  for (const calculation of canvasPage(document).calculations ?? [])
    validateWorksheetSources(document, calculation.snapshot);
}
export const canvasSchemas = f.createSchemas([
  drawingSchema,
  ...sceneSchemas,
  samplingPlanSchema,
  samplingHistorySchema,
  ...canvasContentSchemas,
  {
    id: "canvas-workspace@1",
    validate(body) {
      meta(body);
      f.assert(
        Array.isArray(body.artifacts) && body.calculations === undefined,
        "Unsupported workspace collections",
      );
    },
    references: workspaceReferences,
    assets: () => [],
    project: (body) => ({ type: "canvas-workspace", value: body }),
  },
  {
    id: "canvas-workspace@2",
    validate(body) {
      meta(body);
      f.assert(
        Array.isArray(body.artifacts) && Array.isArray(body.calculations),
        "Missing workspace collections",
      );
    },
    references: workspaceReferences,
    assets: () => [],
    project: (body) => ({ type: "canvas-workspace", value: body }),
  },
  {
    id: "canvas-calculation@1",
    validate: calculationRecord,
    references(body) {
      calculationRecord(body);
      const v =
        body.value as unknown as import("../worksheetHistory.ts").KeptCalculation;
      return [
        reference(body.document as string, META),
        ...v.snapshot.sources.map((s) => s.reference),
      ];
    },
    assets: () => [],
    project: (body) => ({ type: "canvas-calculation", value: body }),
  },
  {
    id: "canvas-artifact@1",
    validate(body) {
      artifactRecord(body);
      f.assert(
        f.object(body) && body.plans === undefined,
        "Legacy artifact cannot declare plans",
      );
    },
    references(body) {
      artifactRecord(body);
      return [
        reference((body as Record<string, f.Json>).document as string, META),
      ];
    },
    assets: () => [],
    project: (body) => ({ type: "canvas-artifact", value: body }),
  },
  {
    id: "canvas-artifact@2",
    validate(body) {
      artifactRecord(body);
      f.assert(
        f.object(body) &&
          f.object(body.plans) &&
          Object.keys(body.plans).length <= 16,
        "Invalid sampling plan index",
      );
      for (const [context, reference] of Object.entries(body.plans)) {
        f.identity(context);
        f.validateReference(reference);
        f.assert(
          reference.document === body.document &&
            reference.selection.kind === "follow" &&
            f.canonical(reference.selector) === f.canonical(f.wholeSelector),
          "Invalid sampling plan reference",
        );
      }
    },
    references(body) {
      f.assert(
        f.object(body) && f.object(body.plans),
        "Invalid sampling plan index",
      );
      return Object.values(body.plans) as f.Reference[];
    },
    assets: () => [],
    project: (body) => ({ type: "canvas-artifact", value: body }),
  },
  {
    id: "canvas-page@1",
    validate(body) {
      meta(body);
      f.assert(
        body.artifacts === undefined && body.calculations === undefined,
        "Legacy canvas metadata cannot declare artifact records",
      );
    },
    references(body) {
      meta(body);
      return groups.flatMap((group) =>
        ((body[group] ?? []) as string[]).map((id) =>
          reference(body.document as string, itemId(group, id)),
        ),
      );
    },
    assets: () => [],
    project(body) {
      return { type: "canvas-page", value: body };
    },
  },
  {
    id: "canvas-record@1",
    validate: record,
    references(body) {
      record(body);
      // Metadata selects worksheet records; a pinned source must not retain the whole Page.
      return [];
    },
    assets: () => [],
    project(body) {
      record(body);
      return { type: "canvas-record", value: body.value! };
    },
  },
]);
const pageCache = new WeakMap<
  f.SharedMap<f.Item>,
  WeakMap<f.SharedMap<f.View>, Page>
>();
const pageBranches = new WeakMap<
  f.SharedMap<f.Item>,
  Readonly<Record<string, unknown>>
>();
export function canvasPage(doc: f.Document): Page {
  let views = pageCache.get(doc.items);
  if (!views) {
    views = new WeakMap();
    pageCache.set(doc.items, views);
  }
  const cached = views.get(doc.views);
  if (cached) return cached;
  const head = f.current(doc, META);
  f.assert(
    (head?.schema === "canvas-page@1" ||
      head?.schema === "canvas-workspace@1" ||
      head?.schema === "canvas-workspace@2") &&
      !doc.readOnly,
    "Unsupported canvas document",
  );
  meta(head.body);
  const body = head.body;
  f.assert(body.document === doc.document, "Canvas document binding mismatch");
  const expected = new Set([META]),
    out: Record<string, unknown> = {
      ...(f.object(body.extras) ? body.extras : {}),
      active: body.active,
      origin: body.origin,
      layout: Object.create(null),
    };
  for (const group of groups) {
    if (body[group] === undefined) continue;
    const values = Object.freeze(
      (body[group] as string[]).map((id) => {
        const key = itemId(group, id),
          r = f.current(doc, key);
        expected.add(key);
        f.assert(
          r?.schema ===
            (group === "calculations"
              ? "canvas-calculation@1"
              : "canvas-record@1"),
          "Missing canvas record",
        );
        if (group === "calculations") calculationRecord(r.body);
        else record(r.body);
        const value = r.body.value as Record<string, f.Json>;
        f.assert(
          r.body.document === doc.document &&
            r.body.kind === kinds[group] &&
            value.id === id,
          "Canvas record binding mismatch",
        );
        return value;
      }),
    );
    out[group] = pageBranches.get(doc.items)?.[group] || values;
  }
  for (const id of (body.artifacts ?? []) as string[]) {
    expected.add("artifact:" + id);
    const artifact = f.current(doc, "artifact:" + id);
    if (
      artifact?.schema === "canvas-artifact@2" &&
      f.object(artifact.body) &&
      f.object(artifact.body.plans)
    )
      for (const ref of Object.values(artifact.body.plans)) {
        f.validateReference(ref);
        expected.add(ref.item);
      }
  }
  for (const [key, item] of doc.items.entries())
    f.assert(
      !item.revision || expected.has(key) || !ownedItem(doc, key),
      "Unexpected active canvas item",
    );
  const layout = out.layout as Record<string, { x: number; y: number }>,
    regionIds = new Set((out.regions as Region[]).map((r) => r.id)),
    seen = new Set<string>();
  for (const [, view] of doc.views.entries()) {
    if (
      !ownedRenderer(view.renderer) ||
      view.renderer === "canvas-artifact-view@1"
    )
      continue;
    f.assert(
      view.alternative === null &&
        view.reference.document === doc.document &&
        view.reference.selection.kind === "follow",
      "Unsupported canvas view",
    );
    let id: string,
      explicit = true;
    if (view.renderer === "canvas-region@1") {
      f.assert(
        view.reference.item.startsWith("region:"),
        "Invalid canvas region view",
      );
      id = view.reference.item.slice(7);
      f.assert(regionIds.has(id), "Missing view region");
      f.assert(
        f.object(view.reference.selector) &&
          typeof view.reference.selector.explicit === "boolean",
        "Invalid canvas region placement",
      );
      f.fields(view.reference.selector, ["explicit"]);
      explicit = view.reference.selector.explicit;
    } else {
      f.assert(
        view.renderer === "canvas-layout@1" &&
          view.reference.item === META &&
          f.object(view.reference.selector) &&
          typeof view.reference.selector.id === "string",
        "Unsupported canvas layout view",
      );
      id = view.reference.selector.id;
      f.fields(view.reference.selector, ["id"]);
      f.assert(!regionIds.has(id), "Unexpected layout view");
    }
    f.assert(!seen.has(id), "Duplicate canvas view slot");
    seen.add(id);
    if (explicit) layout[id] = Object.freeze({ x: view.x, y: view.y });
  }
  for (const id of regionIds) f.assert(seen.has(id), "Missing canvas view");
  if (body.links !== undefined) out.links = body.links;
  const page = Object.freeze({
    ...out,
    regions: Object.freeze(out.regions as unknown[]),
    contexts: Object.freeze(out.contexts as unknown[]),
    plots: Object.freeze(out.plots as unknown[]),
    layout: Object.freeze({ ...layout }),
  }) as unknown as Page;
  if (!pageBranches.has(doc.items))
    pageBranches.set(
      doc.items,
      Object.freeze(
        Object.fromEntries(groups.map((group) => [group, out[group]])),
      ),
    );
  views.set(doc.views, page);
  return page;
}
export function canvasArtifacts(doc: f.Document): Artifact[] {
  const head = f.current(doc, META);
  f.assert(head, "Missing canvas metadata");
  meta(head.body);
  const ids = (head.body.artifacts ?? []) as string[],
    page = canvasPage(doc);
  const artifacts = ids.map((id) => {
    const r = f.current(doc, "artifact:" + id);
    f.assert(
      r?.schema === "canvas-artifact@1" || r?.schema === "canvas-artifact@2",
      "Missing artifact record",
    );
    artifactRecord(r.body);
    const b = r.body as { document: string; value: Record<string, f.Json> };
    f.assert(
      b.document === doc.document && b.value.id === id,
      "Artifact binding mismatch",
    );
    const views = [...doc.views.entries()]
      .map(([, v]) => v)
      .filter(
        (v) =>
          v.renderer === "canvas-artifact-view@1" &&
          v.reference.item === "artifact:" + id,
      );
    const slots = views
      .map((v) => {
        const q = v.reference.selector;
        f.assert(
          v.alternative === null &&
            v.reference.document === doc.document &&
            v.reference.selection.kind === "follow" &&
            f.object(q),
          "Invalid artifact view",
        );
        f.fields(q, ["id", "renderer", "width", "height", "order"]);
        f.assert(
          typeof q.id === "string" &&
            typeof q.renderer === "string" &&
            typeof q.width === "number" &&
            typeof q.height === "number" &&
            Number.isSafeInteger(q.order),
          "Invalid artifact placement",
        );
        return {
          id: q.id,
          renderer: q.renderer as "plot" | "table",
          width: q.width,
          height: q.height,
          at: Object.freeze({ x: v.x, y: v.y }),
          order: q.order as number,
        };
      })
      .sort((a, b) => a.order - b.order);
    f.assert(
      slots.length > 0 &&
        slots[0]!.id === id &&
        slots.every((v, i) => v.order === i),
      "Incomplete artifact presentations",
    );
    const presentations = slots.map(({ order: _, ...v }) => Object.freeze(v));
    return Object.freeze({
      ...b.value,
      ...presentations[0],
      ...(presentations.length > 1
        ? { views: Object.freeze(presentations.slice(1)) }
        : {}),
    }) as unknown as Artifact;
  });
  const known = new Set(ids.map((id) => "artifact:" + id));
  for (const [, v] of doc.views.entries())
    if (v.renderer === "canvas-artifact-view@1")
      f.assert(known.has(v.reference.item), "Orphan artifact view");
  validateArtifactRecords(page, artifacts);
  return Object.freeze(artifacts) as Artifact[];
}
function desired(
  page: Page,
  document: string,
  artifacts: readonly Artifact[],
  previous?: f.Document,
) {
  const bodies = new Map<string, f.Json>(),
    metadata: Record<string, f.Json> = {
      document,
      active: page.active,
      origin: plain(page.origin),
      artifacts: artifacts.map((a) => a.id),
    };
  for (const group of groups) {
    const values = page[group];
    if (values === undefined) continue;
    metadata[group] = values.map((v) => v.id);
    for (const value of values) {
      const id = itemId(group, value.id),
        old = previous && f.current(previous, id)?.body;
      bodies.set(
        id,
        f.object(old) && old.value === value
          ? old
          : {
              document,
              kind: kinds[group],
              value: plain(value),
            },
      );
    }
  }
  if (page.links !== undefined) metadata.links = plain(page.links);
  const known = new Set<string>([
      ...groups,
      "active",
      "origin",
      "layout",
      "links",
    ]),
    extras = Object.fromEntries(
      Object.entries(page).filter(
        ([key, value]) => !known.has(key) && value !== undefined,
      ),
    );
  if (Object.keys(extras).length) metadata.extras = plain(extras);
  bodies.set(META, metadata);
  const at = positions(page),
    slots = new Map<
      string,
      { renderer: string; item: string; selector: f.Json; x: number; y: number }
    >();
  for (const region of page.regions)
    slots.set("page:" + region.id, {
      renderer: "canvas-region@1",
      item: itemId("regions", region.id),
      selector: { explicit: Object.hasOwn(page.layout, region.id) },
      ...at[region.id],
    });
  for (const [id, point] of Object.entries(page.layout))
    if (!slots.has("page:" + id))
      slots.set("page:" + id, {
        renderer: "canvas-layout@1",
        item: META,
        selector: { id },
        ...point,
      });
  validateArtifactRecords(page, artifacts);
  for (const artifact of artifacts) {
    const {
      receipt: _,
      at,
      width,
      height,
      renderer,
      views,
      ...definition
    } = artifact;
    const prior =
      previous &&
      (f.current(previous, "artifact:" + artifact.id) ??
        [...previous.revisions.entries()]
          .map(([, r]) => r)
          .find(
            (r) =>
              r.item === "artifact:" + artifact.id &&
              r.schema === "canvas-artifact@2" &&
              f.object(r.body) &&
              same(r.body.value as f.Json, plain(definition)),
          ));
    bodies.set("artifact:" + artifact.id, {
      document,
      value: plain(definition),
      ...(prior?.schema === "canvas-artifact@2" && f.object(prior.body)
        ? {
            plans: prior.body.plans as f.Json,
          }
        : {}),
    });
    if (
      prior?.schema === "canvas-artifact@2" &&
      f.object(prior.body) &&
      f.object(prior.body.plans)
    )
      for (const ref of Object.values(prior.body.plans)) {
        f.validateReference(ref);
        const plan =
          f.current(previous!, ref.item) ??
          [...previous!.revisions.entries()]
            .map(([, r]) => r)
            .find(
              (r) => r.item === ref.item && r.schema === samplingPlanSchema.id,
            );
        if (plan) bodies.set(ref.item, plan.body);
      }
    for (const [order, v] of [artifact, ...(views || [])].entries())
      slots.set("artifact-view:" + v.id, {
        renderer: "canvas-artifact-view@1",
        item: "artifact:" + artifact.id,
        selector: {
          id: v.id,
          renderer: v.renderer,
          width: v.width,
          height: v.height,
          order,
        },
        x: v.at.x,
        y: v.at.y,
      });
  }
  return { bodies, slots };
}
function commands(
  doc: f.Document,
  page: Page,
  artifacts: readonly Artifact[],
): f.Command[] {
  const next = desired(page, doc.document, artifacts, doc),
    result: f.Command[] = [],
    slotViews = new Map<string, f.View>();
  for (const [, v] of doc.views.entries()) {
    if (!ownedRenderer(v.renderer)) continue;
    const id =
      (v.renderer === "canvas-artifact-view@1" ? "artifact-view:" : "page:") +
      (v.renderer === "canvas-region@1"
        ? v.reference.item.slice(7)
        : (v.reference.selector as { id: string }).id);
    slotViews.set(id, v);
    if (!next.slots.has(id)) result.push({ kind: "removeView", id: v.id });
  }
  for (const [id, item] of doc.items.entries())
    if (item.revision && ownedItem(doc, id) && !next.bodies.has(id))
      result.push({ kind: "delete", item: id });
  for (const [id, body] of next.bodies) {
    const current = f.current(doc, id);
    if (
      current &&
      same(current.body, body) &&
      (id !== META ||
        current.schema ===
          (page.calculations ? "canvas-workspace@2" : "canvas-workspace@1"))
    )
      continue;
    if (!current && doc.known.get(id)) {
      const retained = [...doc.revisions.entries()].find(
        ([, r]) => r.item === id && same(r.body, body),
      );
      f.assert(
        retained,
        "Cannot repurpose a retired canvas identity; restore its retained definition or use a fresh ID",
      );
      result.push({
        kind: "restore",
        item: id,
        revision: retained[0],
        label: id,
      });
      continue;
    }
    const revision: f.Revision = {
      id: uid("revision"),
      item: id,
      schema:
        id === META
          ? page.calculations
            ? "canvas-workspace@2"
            : "canvas-workspace@1"
          : id.startsWith("calculation:")
            ? "canvas-calculation@1"
            : id.startsWith("artifact:")
              ? f.object(body) && body.plans
                ? "canvas-artifact@2"
                : "canvas-artifact@1"
              : id.startsWith("sampling:")
                ? samplingPlanSchema.id
                : "canvas-record@1",
      required: true,
      body,
    };
    result.push(
      current
        ? { kind: "revise", item: id, revision }
        : {
            kind: "create",
            item: id,
            label: id === META ? "Canvas" : id,
            revision,
          },
    );
  }
  // Compile against exact pending source revisions. The owner prepares/publishes this batch once.
  const pending = new Map<string, f.Revision | null>(),
    byRevision = new Map<string, f.Revision>();
  for (const edit of result) {
    if (edit.kind === "create" || edit.kind === "revise") {
      pending.set(edit.item, edit.revision);
      byRevision.set(edit.revision.id, edit.revision);
    } else if (edit.kind === "delete") pending.set(edit.item, null);
    else if (edit.kind === "restore")
      pending.set(edit.item, doc.revisions.get(edit.revision)!);
  }
  const selected = {
    document: doc.document,
    current: (item: string) =>
      pending.has(item)
        ? (pending.get(item) ?? undefined)
        : f.current(doc, item),
    revision: (id: string) => byRevision.get(id) ?? doc.revisions.get(id),
  };
  function upsert(item: string, schema: string, body: f.Json) {
    const old = selected.current(item);
    if (old?.schema === schema && same(old.body, body)) return;
    const index = result.findIndex(
        (c) => (c.kind === "create" || c.kind === "revise") && c.item === item,
      ),
      existing = result[index],
      revision: f.Revision = {
        id:
          existing && (existing.kind === "create" || existing.kind === "revise")
            ? existing.revision.id
            : uid("revision"),
        item,
        schema,
        required: true,
        body,
      };
    const command: f.Command =
      existing?.kind === "create"
        ? { ...existing, revision }
        : old
          ? { kind: "revise", item, revision }
          : { kind: "create", item, label: item, revision };
    if (index >= 0) result[index] = command;
    else result.push(command);
    pending.set(item, revision);
    byRevision.set(revision.id, revision);
  }
  for (const artifact of artifacts) {
    const item = "artifact:" + artifact.id,
      old = selected.current(item)!,
      body = old.body as Record<string, f.Json>,
      priorPlans = f.object(body.plans) ? body.plans : {},
      plans: Record<string, f.Json> = Object.create(null);
    for (const context of page.contexts) {
      const previous = priorPlans[context.id];
      if (previous !== undefined) f.validateReference(previous);
      const planItem = previous
        ? (previous as f.Reference).item
        : uid("sampling");
      plans[context.id] = reference(doc.document, planItem, f.wholeSelector);
      upsert(
        planItem,
        samplingPlanSchema.id,
        plain(compileSamplingPlan(page, artifact, context.id, selected)),
      );
    }
    for (const [context, ref] of Object.entries(priorPlans))
      if (!Object.hasOwn(plans, context)) {
        f.validateReference(ref);
        result.push({ kind: "delete", item: ref.item });
      }
    upsert(item, "canvas-artifact@2", { ...body, plans });
  }
  for (const [id, slot] of next.slots) {
    const old = slotViews.get(id),
      view: f.View = {
        id: old?.id ?? uid("view"),
        renderer: slot.renderer,
        reference: reference(doc.document, slot.item, slot.selector),
        x: slot.x,
        y: slot.y,
        alternative: null,
      };
    if (
      !old ||
      old.x !== view.x ||
      old.y !== view.y ||
      !same(
        old.reference as unknown as f.Json,
        view.reference as unknown as f.Json,
      )
    )
      result.push({ kind: "view", view });
  }
  return result;
}
export function canvasSerial(document: f.Document) {
  let max = 0;
  for (const [id] of document.known.entries()) {
    const match = id
      .slice(id.indexOf(":") + 1)
      .match(/^(?:region|plot|alternative|data-relation)-(\d+)$/);
    if (match) max = Math.max(max, Number(match[1]));
  }
  f.assert(
    Number.isSafeInteger(max) && max < 100_000_000,
    "Canvas identity allocation limit exceeded",
  );
  return max;
}
/** Imported data has no running jobs; use the common capture/key contract for its current observation. */
export function canvasObservedArtifacts(loaded: f.Loaded): Artifact[] {
  const artifacts = canvasArtifacts(loaded.document);
  if (!artifacts.length) return artifacts;
  const latest = new Map<string, f.Receipt>(),
    byKey = new Map<string, f.Receipt>(),
    context = canvasPage(loaded.document).active;
  for (const receipt of loaded.receipts) {
    indexSamplingObservation(latest, receipt);
    if (
      !byKey.has(receipt.key) ||
      byKey.get(receipt.key)!.order < receipt.order
    )
      byKey.set(receipt.key, receipt);
  }
  return artifacts.map((artifact) => {
    const captured = f.captureExecution(
        loaded.document,
        samplingReference(loaded.document, artifact.id, context),
        canvasSchemas,
        canvasMethods,
        loaded.resources,
      ),
      matching = captured.ok ? byKey.get(captured.key) : undefined,
      receipt =
        matching?.outcome.status === "success"
          ? matching
          : (latest.get(samplingObservationKey(artifact.id, context)) ??
            latest.get(artifact.id));
    return {
      ...artifact,
      ...(receipt ? { receipt: samplingReceipt(receipt) } : {}),
    };
  });
}
export type CanvasRecovery = Readonly<{
  foundation: f.Loaded;
}>;
export type CanvasRetentionReview = Readonly<{
  undoSteps: number;
  before: Readonly<{ revisions: number; results: number }>;
  after: Readonly<{ revisions: number; results: number }>;
}>;
/** The same domain gate protects initial/adopted work and every authored publication. */
export function validateCanvasDocument(
  document: f.Document,
  allowLegacy = false,
) {
  validateSceneDocument(document);
  validateDrawingDocument(document);
  validateModelViews(document);
  validateAnalysisViews(document);
  validateWorkspaceData(canvasPage(document), canvasArtifacts(document), false);
  validateCalculationSources(document);
  validateSamplingPlans(
    document,
    canvasPage(document),
    canvasArtifacts(document),
    allowLegacy,
  );
}
function normalizeCanvasDocument(
  document: f.Document,
  page = canvasPage(document),
  artifacts: readonly Artifact[] = canvasArtifacts(document),
) {
  if (
    f.current(document, META)?.schema !== "canvas-page@1" &&
    !canvasArtifacts(document).some(
      (artifact) =>
        f.current(document, "artifact:" + artifact.id)?.schema ===
        "canvas-artifact@1",
    )
  )
    return document;
  return f.prepare(
    document,
    uid("migration"),
    commands(document, page, artifacts),
    canvasSchemas,
  ).document;
}
export function normalizeCanvasLoaded(loaded: f.Loaded): f.Loaded {
  const document = normalizeCanvasDocument(loaded.document);
  if (document === loaded.document) return loaded;
  validateCanvasDocument(document);
  return { ...loaded, document };
}
function prepareCanvasDocument(
  page: Page,
  document: f.Document | undefined,
  artifacts: readonly Artifact[],
  initializeScene = true,
) {
  if (!document) {
    const empty = f.empty(uid("canvas"));
    document = f.prepare(
      empty,
      uid("root"),
      commands(empty, page, artifacts),
      canvasSchemas,
    ).document;
  }
  const normalized = normalizeCanvasDocument(
    document,
    page,
    artifacts.length ? artifacts : canvasArtifacts(document),
  );
  return initializeScene
    ? prepareSceneLoaded(
        { document: normalized, receipts: [], resources },
        canvasSchemas,
      ).loaded.document
    : normalized;
}
/** Cold legacy decoding does not allocate a live owner or require admission of the result. */
export function legacyCanvasLoaded(
  page: Page,
  document: f.Document | undefined,
  artifacts: readonly Artifact[],
): f.Loaded {
  const candidate = prepareCanvasDocument(page, document, artifacts, false);
  validateCanvasDocument(candidate);
  return { document: candidate, receipts: [], resources };
}
export class CanvasDocument {
  readonly #workspace?: ReturnType<typeof f.createWorkspace>;
  #draft?: f.Document;
  #staged: f.Command[] = [];
  readonly #storageBudget = new CanvasStorageBudget();
  #lastPage?: Page;
  #artifactCache?: {
    document: f.Document;
    value: Artifact[];
  };
  #resultIndex = new WeakMap<object, ReadonlyMap<string, f.Receipt>>();
  #captures = new WeakSet<object>();
  #reviews = new WeakMap<
    CanvasRetentionReview,
    {
      document: f.Document;
      evidence: number;
      core: ReturnType<
        ReturnType<typeof f.createWorkspace>["reader"]["reviewCompaction"]
      >;
    }
  >();
  #saved?: Readonly<{ root: string; evidence: number }>;
  constructor(
    page: Page,
    document?: f.Document,
    artifacts: readonly Artifact[] = [],
    draft = false,
    recovery?: CanvasRecovery,
    scheduler?: f.TaskScheduler,
    executor?: ArtifactExecutor | null,
  ) {
    f.assert(
      !recovery || recovery.foundation.document === document,
      "Invalid canvas recovery binding",
    );
    document = prepareCanvasDocument(page, document, artifacts);
    if (draft) {
      validateCanvasDocument(document);
      this.#draft = document;
    } else
      this.#workspace = f.createWorkspace(
        recovery
          ? recovery.foundation.document === document
            ? recovery.foundation
            : { ...recovery.foundation, document }
          : { document, receipts: [], resources },
        {
          schemas: canvasSchemas,
          namespace: uid("owner"),
          historyLimit: 256,
          maxReceipts: MAX_CANVAS_RECEIPTS,
          maxEvidenceBytes: 8 * 1024 * 1024,
          methods: canvasMethods,
          executor: canvasExecutor,
          typedExecutor: async (snapshot, signal, io) => {
            if (f.methodKey(snapshot.method) === f.methodKey(analysisMethodRef))
              return modelAnalyses.execute(snapshot, signal, io);
            if (
              f.methodKey(snapshot.method) ===
              f.methodKey(modelOutputsMethodRef)
            )
              return modelOutputsExecutor(snapshot, signal, io);
            const sampling = samplingExecutor(executor);
            f.assert(sampling, "Computation tool unavailable");
            return sampling(snapshot, signal, io);
          },
          scheduler,
          validateDocument: validateCanvasDocument,
          validateState: (state) => {
            this.#storageBudget.check(state, canvasSchemas);
          },
        },
      );
    const authored = canvasArtifacts(this.document);
    const definition = (a: Artifact) => {
      const { receipt: _, ...value } = a;
      if (!value.views?.length) delete value.views;
      return plain(value);
    };
    if (artifacts.length)
      f.assert(
        same(artifacts.map(definition), authored.map(definition)),
        "Artifact definitions do not match the supplied document",
      );
    f.assert(
      draft || recovery || !artifacts.some((a) => a.receipt),
      "Legacy results require async workspace import; recover core receipts with their capture",
    );
    canvasSerial(this.document);
  }
  get document() {
    return this.#draft ?? this.#workspace!.reader.read();
  }
  get reader() {
    f.assert(this.#workspace, "A staging owner has no live reader");
    return this.#workspace.reader;
  }
  dispose() {
    this.#workspace?.owner.dispose();
  }
  stagedCommands(): readonly f.Command[] {
    f.assert(this.#draft, "Only a staging owner has a command log");
    return Object.freeze([...this.#staged]);
  }
  applyCommands(
    edits: readonly f.Command[],
    expected = this.document,
    checkpoint = false,
  ) {
    f.assert(
      expected === this.document,
      "Workspace changed; review the operation again",
    );
    if (!edits.length && !checkpoint) return false;
    const root = uid("root");
    if (this.#draft) {
      const prepared = f.prepare(this.document, root, edits, canvasSchemas);
      validateCanvasDocument(prepared.document);
      this.#draft = prepared.document;
      this.#staged.push(
        ...(f.retained(
          edits as unknown as f.Json,
        ) as unknown as readonly f.Command[]),
      );
    } else {
      const result = this.#workspace!.owner.apply(
        this.reader.stamp(),
        root,
        edits,
      );
      f.assert(result.ok, result.ok ? "" : result.error);
    }
    return true;
  }
  compute(target: f.Reference, scope: f.Scope = "baseline") {
    f.assert(this.#workspace, "A staging owner cannot execute");
    const result = this.#workspace.owner.compute(
      this.reader.stamp(),
      target,
      scope,
    );
    f.assert(result.ok, result.ok ? "" : result.error);
    return result.value;
  }
  preview(
    target: f.Reference,
    overrides: readonly { item: string; revision: f.Revision }[],
  ) {
    f.assert(this.#workspace, "A staging owner cannot preview");
    const result = this.#workspace.owner.preview(
      this.reader.stamp(),
      target,
      overrides,
    );
    f.assert(result.ok, result.ok ? "" : result.error);
    return result.value;
  }
  cancelPreview() {
    f.assert(this.#workspace, "A staging owner cannot cancel previews");
    const result = this.#workspace.owner.cancelPreview(this.reader.stamp());
    f.assert(result.ok, result.ok ? "" : result.error);
  }
  keepPreview(label: string, view: Omit<f.View, "alternative">) {
    f.assert(this.#workspace, "A staging owner cannot Keep");
    const alternative = uid("alternative");
    const result = this.#workspace.owner.keep(
      this.reader.stamp(),
      uid("keep"),
      alternative,
      label,
      { ...view, alternative },
    );
    f.assert(result.ok, result.ok ? "" : result.error);
    return alternative;
  }
  get page() {
    const next = canvasPage(this.document);
    if (
      !this.#lastPage ||
      !same(this.#lastPage as unknown as f.Json, next as unknown as f.Json)
    )
      this.#lastPage = next;
    return this.#lastPage;
  }
  private latestResults() {
    const receipts =
      this.#workspace?.reader.evidence() ?? f.SharedMap.empty<f.Receipt>();
    return (
      receipts.fold<ReadonlyMap<string, f.Receipt>>(
        (_id, receipt, left, right) => {
          const values = new Map(left);
          for (const [id, receipt] of right ?? [])
            if (!values.has(id) || values.get(id)!.order < receipt.order)
              values.set(id, receipt);
          indexSamplingObservation(values, receipt);
          return values;
        },
        this.#resultIndex,
      ) ?? new Map<string, f.Receipt>()
    );
  }
  get artifacts(): Artifact[] {
    const document = this.document,
      cached = this.#artifactCache;
    if (cached?.document === document) return cached.value;
    const latest = this.latestResults(),
      context = canvasPage(document).active,
      value = canvasArtifacts(document).map((artifact) => {
        const selected = this.#workspace?.reader.result(
            samplingReference(document, artifact.id, context),
          ),
          receipt =
            selected?.status === "current"
              ? selected.receipt
              : (latest.get(samplingObservationKey(artifact.id, context)) ??
                latest.get(artifact.id));
        return Object.freeze({
          ...artifact,
          ...(receipt ? { receipt: samplingReceipt(receipt) } : {}),
        });
      });
    this.#artifactCache = {
      document,
      value: Object.freeze(value) as Artifact[],
    };
    return this.#artifactCache.value;
  }
  get evidenceSequence() {
    return this.document.evidenceSequence;
  }
  capture() {
    const foundation = this.#workspace?.reader.capture();
    const value = Object.freeze({
      document: this.document,
      page: this.page,
      artifacts: this.artifacts,
      evidence: this.document.evidenceSequence,
      storageUpperBytes: this.#storageBudget.estimate(
        this.document,
        foundation,
        canvasSchemas,
      ),
      foundation,
    });
    this.#captures.add(value);
    return value;
  }
  checkCapture(capture: ReturnType<CanvasDocument["capture"]>) {
    f.assert(this.#captures.has(capture), "Unowned save capture");
  }
  acknowledge(capture: ReturnType<CanvasDocument["capture"]>) {
    f.assert(this.#captures.has(capture), "Unowned save capture");
    if (
      capture.document !== this.document ||
      capture.evidence !== this.document.evidenceSequence
    )
      return false;
    this.#saved = Object.freeze({
      root: capture.document.id,
      evidence: capture.evidence,
    });
    return true;
  }
  get isSaved() {
    return (
      this.#saved?.root === this.document.id &&
      this.#saved.evidence === this.document.evidenceSequence
    );
  }
  get canUndo() {
    return (
      !!this.#workspace?.reader.preview() ||
      (this.#workspace?.diagnostics().undoSteps ?? 0) > 0
    );
  }
  get historySize() {
    return this.#workspace?.diagnostics().undoSteps ?? 0;
  }
  get canRedo() {
    return (
      !this.#workspace?.reader.preview() &&
      (this.#workspace?.diagnostics().redoSteps ?? 0) > 0
    );
  }
  reviewRetention(
    transientReferences: readonly f.Reference[] = [],
  ): CanvasRetentionReview {
    f.assert(this.#workspace, "A staging candidate cannot review cleanup");
    const preliminary = this.#workspace.reader.reviewCompaction({
        evidence: "reachable",
        keepReferences: transientReferences,
      }),
      removed = new Set(preliminary.removedRevisions),
      protectedArtifacts = new Set<string>();
    for (const [id, revision] of this.document.revisions.entries())
      if (
        !removed.has(id) &&
        ["canvas-artifact@1", "canvas-artifact@2"].includes(revision.schema)
      )
        protectedArtifacts.add(revision.item.slice("artifact:".length));
    const keepReceipts = [...this.latestResults()]
        .filter(([id]) => protectedArtifacts.has(id))
        .map(([, receipt]) => receipt.id),
      core = this.#workspace.reader.reviewCompaction({
        evidence: "reachable",
        keepReferences: transientReferences,
        keepReceipts,
      });
    const review = Object.freeze({
      undoSteps: this.historySize,
      before: Object.freeze({
        revisions: core.before.revisions,
        results: core.before.receipts,
      }),
      after: Object.freeze({
        revisions: core.after.revisions,
        results: core.after.receipts,
      }),
    });
    this.#reviews.set(review, {
      document: this.document,
      evidence: this.document.evidenceSequence,
      core,
    });
    return review;
  }
  compact(review: CanvasRetentionReview) {
    const state = this.#reviews.get(review);
    f.assert(
      this.#workspace &&
        state &&
        state.document === this.document &&
        state.evidence === this.document.evidenceSequence,
      "Cleanup review is stale or belongs to another workspace",
    );
    const result = this.#workspace.owner.compact(
      this.#workspace.reader.stamp(),
      uid("cleanup"),
      state.core,
    );
    f.assert(result.ok, result.ok ? "" : result.error);
    this.#reviews.delete(review);
  }
  apply(
    page: Page,
    checkpoint = false,
    artifacts: readonly Artifact[] = this.artifacts,
  ) {
    const edits = commands(this.document, page, artifacts);
    return this.applyCommands(edits, this.document, checkpoint);
  }
  undo() {
    f.assert(
      this.#workspace,
      "A staging candidate has no accepted Undo history",
    );
    const result = this.#workspace.owner.undo(
      this.#workspace.reader.stamp(),
      uid("undo"),
    );
    f.assert(result.ok, result.ok ? "" : result.error);
  }
  redo() {
    f.assert(
      this.#workspace,
      "A staging candidate has no accepted Redo history",
    );
    const result = this.#workspace.owner.redo(
      this.#workspace.reader.stamp(),
      uid("redo"),
    );
    f.assert(result.ok, result.ok ? "" : result.error);
  }
  native(capture?: ReturnType<CanvasDocument["capture"]>): f.Envelope {
    if (capture) f.assert(this.#captures.has(capture), "Unowned save capture");
    // App files capture current authored work, pinned source evidence and retired IDs; session Undo is not a file history.
    const foundation = capture?.foundation ?? this.#workspace?.reader.capture(),
      receipts = foundation?.receipts ?? f.SharedMap.empty<f.Receipt>(),
      document = capture?.document ?? this.document,
      revisions = f.compact(document, receipts, canvasSchemas, {
        evidence: "all",
      }).document.revisions;

    return f.encodeEnvelope(
      Object.freeze({ ...document, revisions }),
      [...receipts.entries()].map(([, receipt]) => receipt),
      foundation?.resources ?? resources,
      canvasSchemas,
    );
  }
}
export function readCanvasDocument(value: unknown): f.Document {
  f.assert(
    f.object(value) &&
      value.format === "manifold-foundation" &&
      value.version === 2 &&
      f.object(value.document),
    "Unsupported canvas foundation envelope",
  );
  f.fields(value, [
    "format",
    "version",
    "document",
    "contexts",
    "snapshots",
    "receipts",
    "assets",
  ]);
  for (const key of ["contexts", "snapshots", "assets"])
    f.assert(
      f.object(value[key]) && Object.keys(value[key]).length === 0,
      "Unsupported canvas transport records",
    );
  f.assert(
    Array.isArray(value.receipts) && value.receipts.length === 0,
    "Unsupported canvas execution receipts",
  );
  const doc = f.fromPlain(
    value.document as unknown as f.PlainDocument,
    canvasSchemas,
  );
  validateCanvasDocument(doc, true);
  canvasSerial(doc);
  return doc;
}
