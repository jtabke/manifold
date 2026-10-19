/** Hierarchy is containment and an explicit interface over existing identities.
 * Evaluation continues to use the worksheet's existing bindings and contexts. */
import { project, type Page } from "./document.ts";
export const MODEL_ICONS = [
  "box",
  "clock",
  "layers",
  "fan",
  "battery",
  "scale",
  "workflow",
] as const;
export const MODEL_SHAPES = [
  "plain",
  "pill",
  "stack",
  "frame",
  "slant",
  "double",
  "band",
] as const;
export const MODEL_EXTERIORS = [
  "interface",
  "equation",
  "response",
  "artifact",
] as const;
export type ModelExterior = {
  kind: (typeof MODEL_EXTERIORS)[number];
  /** A view reference, never ownership or a computational dependency. */
  source?: string;
};
export type ModelAppearancePatch = Pick<
  NonNullable<NestedModel["presentation"]>,
  "icon" | "shape" | "exterior"
>;
export type NestedModel = {
  id: string;
  name: string;
  members: string[];
  inputs: string[];
  outputs: string[];
  /** Optional visual annotations. They never classify physics or establish bindings. */
  presentation?: {
    icon?: (typeof MODEL_ICONS)[number];
    shape?: (typeof MODEL_SHAPES)[number];
    description?: string;
    at?: { x: number; y: number };
    primaryOutput?: string;
    exploreInput?: string;
    exterior?: ModelExterior;
  };
};
export type ModelRepresentation = {
  id: string;
  input?: string;
  output?: string;
};
export const modelParent = (page: Page, id: string) =>
  page.models?.find((m) => m.members.includes(id))?.id;
export function modelPath(page: Page, id?: string): NestedModel[] {
  const result: NestedModel[] = [],
    seen = new Set<string>();
  while (id && !seen.has(id)) {
    seen.add(id);
    const m = page.models?.find((m) => m.id === id);
    if (!m) break;
    result.unshift(m);
    id = modelParent(page, id);
  }
  return result;
}
export function modelContents(page: Page, members: string[]): Set<string> {
  const found = new Set<string>();
  const visit = (id: string) => {
    if (found.has(id)) return;
    found.add(id);
    page.models?.find((m) => m.id === id)?.members.forEach(visit);
  };
  members.forEach(visit);
  return found;
}
export function modelBoundary(
  page: Page,
  members: string[],
  representations: ModelRepresentation[] = [],
) {
  const inside = modelContents(page, members),
    p = project(page);
  const incoming = new Set<string>(),
    outgoing = new Set<string>();
  const edges: {
    source: string;
    target: string;
    kind: "computation" | "evidence" | "representation";
  }[] = [];
  for (const [target, bindings] of Object.entries(p.bindings))
    for (const source of Object.values(bindings))
      edges.push({ source, target, kind: "computation" });
  for (const region of page.regions)
    if (region.source)
      edges.push({
        source: region.source.dataset,
        target: region.id,
        kind: "evidence",
      });
  for (const r of page.dataRelations || [])
    edges.push(
      { source: r.dataset, target: r.id, kind: "evidence" },
      { source: r.output, target: r.id, kind: "computation" },
    );
  for (const r of [...page.plots, ...representations])
    for (const source of [r.input, r.output])
      if (source) edges.push({ source, target: r.id, kind: "representation" });
  const crossing = edges.filter(
    (e) => inside.has(e.source) !== inside.has(e.target),
  );
  for (const e of crossing) {
    if (inside.has(e.source)) outgoing.add(e.source);
    else {
      const s = p.statements.get(e.target);
      // An assigned input replaced by a reviewed alias keeps its own port.
      incoming.add(
        s?.relation === "=" && s.expression.kind === "name"
          ? e.target
          : e.source,
      );
    }
  }
  const assigned = [...inside].filter(
    (id) =>
      p.kinds[id] === "quantity" ||
      !!page.regions.find((r) => r.id === id)?.data,
  );
  const results = [...inside].filter(
    (id) =>
      p.kinds[id] === "equation" ||
      page.dataRelations?.some((r) => r.id === id),
  );
  return {
    inside,
    crossing,
    requiredInputs: [...incoming],
    requiredOutputs: [...outgoing],
    inputs: [...new Set([...incoming, ...assigned])],
    outputs: [...new Set([...outgoing, ...results, ...assigned])],
  };
}
export function validateModels(page: Page, representationIds: string[] = []) {
  const models = page.models;
  if (models === undefined) return;
  if (!Array.isArray(models) || models.length > 32)
    throw Error("Invalid model hierarchy.");
  const safe = (id: unknown): id is string =>
    typeof id === "string" &&
    /^[a-z][a-z0-9-]{0,99}$/.test(id) &&
    !["constructor", "prototype"].includes(id);
  const known = new Set([
    ...page.regions.map((r) => r.id),
    ...page.plots.map((r) => r.id),
    ...(page.dataRelations || []).map((r) => r.id),
    ...representationIds,
  ]);
  for (const m of models) {
    if (
      !m ||
      !safe(m.id) ||
      known.has(m.id) ||
      typeof m.name !== "string" ||
      !m.name.trim() ||
      m.name.length > 80
    )
      throw Error("Invalid model identity.");
    known.add(m.id);
  }
  const owned = new Set<string>();
  for (const m of models) {
    for (const list of [m.members, m.inputs, m.outputs])
      if (
        !Array.isArray(list) ||
        list.length > 256 ||
        new Set(list).size !== list.length ||
        !list.every((id) => safe(id) && known.has(id))
      )
        throw Error("Invalid model references.");
    for (const id of m.members) {
      if (owned.has(id) || id === m.id)
        throw Error("Content can belong to only one model.");
      owned.add(id);
    }
    const visit = (id: string, path: Set<string>) => {
      if (path.has(id))
        throw Error("Model containment cannot contain a cycle.");
      const child = models.find((m) => m.id === id);
      if (child)
        for (const member of child.members)
          visit(member, new Set([...path, id]));
    };
    visit(m.id, new Set());
    const inside = modelContents(page, m.members);
    if (m.outputs.some((id) => !inside.has(id)))
      throw Error("Model outputs must belong to its contents.");
    validateModelPresentation(m);
    for (const id of [...m.inputs, ...m.outputs])
      if (
        models.some((m) => m.id === id) ||
        page.plots.some((p) => p.id === id) ||
        representationIds.includes(id)
      )
        throw Error("Expose engineering objects, not display views.");
  }
}

/** Validate display annotations independently of external artifact membership. */
export function validateModelPresentation(m: NestedModel) {
  const visual = m.presentation;
  if (
    visual !== undefined &&
    (!visual ||
      typeof visual !== "object" ||
      Array.isArray(visual) ||
      (visual.icon !== undefined && !MODEL_ICONS.includes(visual.icon)) ||
      (visual.shape !== undefined && !MODEL_SHAPES.includes(visual.shape)) ||
      (visual.exterior !== undefined &&
        (!visual.exterior ||
          typeof visual.exterior !== "object" ||
          Array.isArray(visual.exterior) ||
          !MODEL_EXTERIORS.includes(visual.exterior.kind) ||
          (visual.exterior.source !== undefined &&
            (typeof visual.exterior.source !== "string" ||
              !/^[a-z][a-z0-9-]{0,99}$/.test(visual.exterior.source) ||
              ["constructor", "prototype"].includes(
                visual.exterior.source,
              ))))) ||
      (visual.description !== undefined &&
        (typeof visual.description !== "string" ||
          visual.description.length > 160)) ||
      (visual.at !== undefined &&
        (!visual.at ||
          !Number.isFinite(visual.at.x) ||
          !Number.isFinite(visual.at.y) ||
          Math.abs(visual.at.x) + Math.abs(visual.at.y) > 1e6)) ||
      (visual.primaryOutput !== undefined &&
        !m.outputs.includes(visual.primaryOutput)) ||
      (visual.exploreInput !== undefined &&
        !m.inputs.includes(visual.exploreInput)))
  )
    throw Error("Invalid model presentation.");
}
