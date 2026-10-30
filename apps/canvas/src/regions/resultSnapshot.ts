/** Typed sampler provenance. Source payloads live in immutable document revisions, never in receipts. */
import * as f from "@manifold/foundation";
import { readCsv } from "./dataSources.ts";
export type SourceEvidence = Readonly<{
  region: string;
  reference: f.Reference;
  row: number;
  column: number;
  raw: string;
  unit: string;
}>;
/** A compiler may select pending revisions without preparing/publishing a second document. */
export type SourceSelection = Readonly<{
  document: string;
  current: (item: string) => f.Revision | undefined;
  revision: (id: string) => f.Revision | undefined;
}>;
export function sourceSelection(
  source: f.Document | SourceSelection,
): SourceSelection {
  return "current" in source
    ? source
    : {
        document: source.document,
        current: (item) => f.current(source, item),
        revision: (id) => source.revisions.get(id),
      };
}
export function validateSourceEvidence(
  document: f.Document | SourceSelection,
  sources: readonly SourceEvidence[],
) {
  f.assert(sources.length <= 256, "Too many result source references");
  const seen = new Set<string>();
  for (const source of sources) {
    f.assert(!seen.has(source.region), "Duplicate result source target");
    seen.add(source.region);
    f.validateReference(source.reference);
    f.assert(
      source.reference.selection.kind === "pin" &&
        source.reference.selector === null,
      "Result source must pin a complete source revision",
    );
    const selected = sourceSelection(document),
      revision = selected.revision(source.reference.selection.revision);
    f.assert(
      source.reference.document === selected.document &&
        revision?.item === source.reference.item,
      "Result source revision is unavailable",
    );
    f.assert(
      revision.schema === "canvas-record@1" &&
        f.object(revision.body) &&
        revision.body.kind === "region" &&
        f.object(revision.body.value),
      "Unsupported result source revision",
    );
    const value = revision.body.value;
    f.assert(
      revision.item === "region:" + value.id &&
        f.object(value.data) &&
        typeof value.data.name === "string" &&
        typeof value.data.csv === "string",
      "Invalid result source binding",
    );
    f.assert(
      readCsv({ name: value.data.name, csv: value.data.csv }).rows[
        source.row
      ]?.[source.column] === source.raw,
      "Result source cell does not match its pinned revision",
    );
  }
}
