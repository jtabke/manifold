/** Navigation and temporary composition over existing engineering identities. */
import { project, type Page, type Point } from "./document.ts";
import type { DatasetComputation } from "./datasetModel.ts";
import type { CanvasFrame } from "./selection.ts";
import type { DataSelection } from "./dataFeedback.ts";
export type RelationshipLocation = {
  kind:
    | "source"
    | "input"
    | "calculation"
    | "requirement"
    | "result"
    | "assumption";
  symbol?: string;
  requirement?: string;
  object?: string;
  row?: number;
};
export function relationshipObjects(page: Page, relation: DatasetComputation) {
  const p = project(page),
    output = p.statements.get(relation.output)?.name;
  const requirements = [...p.statements]
    .filter(([, s]) => s.relation !== "=" && s.name === output)
    .map(([id]) => id);
  const overridden = new Set(
    relation.bindings.map((b) => b.quantity).filter(Boolean),
  );
  // Frame direct inputs; reveal deeper ancestry by following their definitions.
  const assumptions = [
    ...new Set(Object.values(p.bindings[relation.output] || {})),
  ].filter((id) => !overridden.has(id));
  return {
    requirements,
    assumptions,
    ids: [
      relation.dataset,
      relation.output,
      relation.id,
      ...requirements,
      ...assumptions,
    ],
  };
}
export function relationshipArrangement(
  page: Page,
  relation: DatasetComputation,
  frames: CanvasFrame[],
  origin: Point,
): Record<string, Point> {
  const objects = relationshipObjects(page, relation),
    f = (id: string) => frames.find((f) => f.id === id),
    right = origin.x + Math.max(480, f(relation.dataset)?.width || 0) + 64;
  const positions: Record<string, Point> = {
    [relation.dataset]: origin,
    [relation.output]: { x: right, y: origin.y },
  };
  let y = origin.y + Math.max(220, f(relation.output)?.height || 0) + 24;
  for (const id of objects.requirements) {
    positions[id] = { x: right, y };
    y += (f(id)?.height || 60) + 24;
  }
  positions[relation.id] = { x: right, y: y + 18 };
  let leftY = origin.y + (f(relation.dataset)?.height || 250) + 48;
  for (const id of objects.assumptions) {
    positions[id] = { x: origin.x, y: leftY };
    leftY += (f(id)?.height || 65) + 24;
  }
  return positions;
}
export function relationshipDestination(
  page: Page,
  relation: DatasetComputation,
  location: RelationshipLocation,
  selection: DataSelection,
): DataSelection {
  const binding = relation.bindings.find(
    (b) =>
      b.symbol === location.symbol ||
      (b.quantity &&
        project(page).statements.get(b.quantity)?.name === location.symbol),
  );
  return {
    ...selection,
    rows:
      location.kind === "source"
        ? location.row !== undefined
          ? [location.row]
          : selection.rows.length
            ? [selection.rows[0]]
            : []
        : selection.rows,
    relation: relation.id,
    view:
      location.kind === "source"
        ? relation.dataset
        : location.kind === "result"
          ? relation.id
          : location.kind === "requirement"
            ? location.requirement ||
              relationshipObjects(page, relation).requirements[0]
            : location.kind === "assumption"
              ? location.object
              : relation.output,
    columns:
      location.kind === "input" && binding
        ? [binding.column]
        : location.kind === "source"
          ? []
          : selection.columns,
    kind:
      location.kind === "input"
        ? "series"
        : selection.rows.length
          ? "record"
          : "series",
    detail:
      location.kind === "calculation"
        ? "calculation"
        : location.kind === "requirement"
          ? "requirement"
          : undefined,
  };
}
