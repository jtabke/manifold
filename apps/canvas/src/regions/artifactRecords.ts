/** Native artifact validation without execution or UI dependencies. */
import { validateReference } from "@manifold/foundation";
import type { Artifact } from "./artifacts.ts";
import type { Page } from "./document.ts";
export type ArtifactResult = Readonly<{
  artifact: string;
  receipt: NonNullable<Artifact["receipt"]>;
}>;
export function validateArtifactRecords(
  page: Page,
  artifacts: readonly Artifact[],
) {
  const id = (s: unknown) =>
    typeof s === "string" &&
    /^[a-z][a-z0-9-]{0,99}$/.test(s) &&
    s !== "constructor";
  const point = (p: Artifact["at"]) =>
    p && Number.isFinite(p.x + p.y) && Math.abs(p.x) + Math.abs(p.y) < 1e12;
  const region = new Set(page.regions.map((r) => r.id));
  const ids = new Set([
    ...region,
    ...page.plots.map((p) => p.id),
    ...(page.models || []).map((m) => m.id),
    ...(page.dataRelations || []).map((r) => r.id),
  ]);
  const presentation = (
    v: Artifact | NonNullable<Artifact["views"]>[number],
  ) => {
    if (
      !id(v.id) ||
      ids.has(v.id) ||
      !["plot", "table"].includes(v.renderer) ||
      !point(v.at) ||
      !Number.isFinite(v.width + v.height) ||
      v.width < 320 ||
      v.width > 1100 ||
      v.height < 240 ||
      v.height > 750
    )
      throw Error("Invalid or duplicate artifact presentation");
    ids.add(v.id);
  };
  if (artifacts.length > 16)
    throw Error("This workspace supports up to 16 artifacts");
  for (const a of artifacts) {
    if (
      !region.has(a.input) ||
      !region.has(a.output) ||
      a.source !== "model-derived-python" ||
      !Number.isFinite(a.low + a.high) ||
      a.low >= a.high ||
      typeof a.request !== "string" ||
      a.request.length > 4000 ||
      (a.code !== undefined &&
        (typeof a.code !== "string" || a.code.length > 4000)) ||
      (a.compareContext !== undefined &&
        !page.contexts.some((c) => c.id === a.compareContext)) ||
      (a.comparing !== undefined && typeof a.comparing !== "boolean") ||
      (a.requirement !== undefined && !region.has(a.requirement)) ||
      (a.views !== undefined && (!Array.isArray(a.views) || a.views.length > 4))
    )
      throw Error("Invalid artifact definition or comparison target");
    presentation(a);
    for (const view of a.views || []) presentation(view);
  }
}

export function validArtifactReceipt(
  raw: unknown,
): raw is NonNullable<Artifact["receipt"]> {
  const object = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === "object" && !Array.isArray(v);
  const id = (v: unknown) => {
    if (
      typeof v !== "string" ||
      !/^[a-z][a-z0-9-]{0,99}$/.test(v) ||
      v === "constructor"
    )
      return false;
    const match = v.match(/^(?:region|plot|alternative|data-relation)-(\d+)$/);
    return !match || Number(match[1]) < 100_000_000;
  };
  if (!object(raw)) return false;
  const r = raw;
  return (
    Object.keys(r).every((k) =>
      [
        "points",
        "code_sha256",
        "runtime",
        "key",
        "context",
        "code",
        "inputs",
        "definitions",
        "time",
        "bindings",
        "snapshot",
        "dependencies",
        "sources",
      ].includes(k),
    ) &&
    ((r.snapshot === undefined &&
      r.sources === undefined &&
      r.dependencies === undefined) ||
      (r.snapshot === 2 &&
        object(r.dependencies) &&
        Object.values(r.dependencies).every(
          (v) => object(v) && Object.values(v).every(id),
        ) &&
        Array.isArray(r.sources) &&
        r.sources.length <= 256 &&
        r.sources.every((v) => {
          if (
            !object(v) ||
            Object.keys(v).some(
              (k) =>
                ![
                  "region",
                  "reference",
                  "row",
                  "column",
                  "raw",
                  "unit",
                ].includes(k),
            ) ||
            !id(v.region) ||
            !Number.isInteger(v.row) ||
            Number(v.row) < 0 ||
            Number(v.row) >= 10000 ||
            !Number.isInteger(v.column) ||
            Number(v.column) < 0 ||
            Number(v.column) >= 12 ||
            typeof v.raw !== "string" ||
            v.raw.length > 200 ||
            typeof v.unit !== "string" ||
            v.unit.length > 80
          )
            return false;
          try {
            validateReference(v.reference);
            return (
              v.reference.selection.kind === "pin" &&
              v.reference.selector === null
            );
          } catch {
            return false;
          }
        }) &&
        Array.isArray(r.definitions) &&
        r.definitions.every(
          (v) =>
            object(v) &&
            Object.keys(v).every((k) => ["id", "text"].includes(k)),
        ))) &&
    (r.snapshot !== 2 ||
      (Array.isArray(r.definitions) &&
        object(r.dependencies) &&
        new Set(r.definitions.map((v) => (object(v) ? v.id : undefined)))
          .size === r.definitions.length &&
        Object.keys(r.dependencies).length === r.definitions.length &&
        r.definitions.every(
          (v) =>
            object(v) &&
            Object.hasOwn(r.dependencies as object, v.id as string),
        ) &&
        Array.isArray(r.sources) &&
        r.sources.every(
          (source) =>
            object(source) &&
            (r.definitions as unknown[]).some(
              (v) => object(v) && v.id === source.region,
            ),
        ))) &&
    typeof r.key === "string" &&
    r.key.length <= 1_000_000 &&
    typeof r.context === "string" &&
    typeof r.code === "string" &&
    r.code.length <= 4000 &&
    typeof r.time === "string" &&
    Number.isFinite(Date.parse(r.time)) &&
    typeof r.code_sha256 === "string" &&
    /^[a-f0-9]{64}$/.test(r.code_sha256) &&
    object(r.runtime) &&
    r.runtime.adapter === "bounded-python-sampler/1" &&
    typeof r.runtime.python === "string" &&
    r.runtime.python.length <= 200 &&
    object(r.inputs) &&
    Object.values(r.inputs).every(
      (v) => typeof v === "number" && Number.isFinite(v),
    ) &&
    object(r.bindings) &&
    Object.values(r.bindings).every(id) &&
    Array.isArray(r.definitions) &&
    r.definitions.length <= 2000 &&
    r.definitions.every(
      (v) =>
        object(v) &&
        id(v.id) &&
        typeof v.text === "string" &&
        v.text.length <= 5000,
    ) &&
    Array.isArray(r.points) &&
    r.points.length >= 2 &&
    r.points.length <= 501 &&
    r.points.every(
      (v) =>
        Array.isArray(v) &&
        v.length === 2 &&
        v.every((n) => typeof n === "number" && Number.isFinite(n)),
    )
  );
}
