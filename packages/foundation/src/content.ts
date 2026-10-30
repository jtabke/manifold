import {
  assert,
  object,
  fields,
  identity,
  freeze,
  type Json,
} from "./value.ts";
import type {
  Asset,
  Reference,
  Schema,
  Schemas,
  Scalar,
  Request,
  Method,
  MethodRef,
  Methods,
} from "./contracts.ts";
export function validateReference(v: unknown): asserts v is Reference {
  assert(object(v), "Invalid reference");
  fields(v, ["document", "item", "selection", "selector"]);
  identity(v.document);
  identity(v.item);
  assert(object(v.selection), "Invalid reference selection");
  fields(
    v.selection,
    v.selection.kind === "pin" ? ["kind", "revision"] : ["kind"],
  );
  assert(
    v.selection.kind === "follow" || v.selection.kind === "pin",
    "Invalid reference policy",
  );
  if (v.selection.kind === "pin") identity(v.selection.revision);
  assert(v.selector !== undefined, "Missing selector");
}
export function validateAsset(a: unknown): asserts a is Asset {
  assert(object(a), "Invalid asset");
  fields(a, ["digest", "size", "mediaType", "disposition"]);
  assert(
    typeof a.digest === "string" &&
      /^sha256:[a-f0-9]{64}$/.test(a.digest) &&
      Number.isSafeInteger(a.size) &&
      Number(a.size) >= 0 &&
      typeof a.mediaType === "string" &&
      a.mediaType.length > 0 &&
      (a.disposition === "included" || a.disposition === "linked"),
    "Invalid asset declaration",
  );
}
export function scalar(v: unknown): asserts v is Scalar {
  assert(object(v), "Expected scalar");
  fields(v, ["value", "unit", "subject", "frame", "condition"]);
  assert(
    typeof v.value === "number" &&
      Number.isFinite(v.value) &&
      [v.unit, v.subject, v.frame, v.condition].every(
        (x) => typeof x === "string" && x.length > 0,
      ),
    "Invalid scalar/interpretation",
  );
}
export function request(v: unknown): asserts v is Request {
  assert(object(v), "Expected request");
  fields(v, ["method", "inputs", "output", "subject", "frame", "condition"]);
  assert(object(v.method), "Missing method requirements");
  fields(v.method, ["id", "version", "runtime"]);
  assert(
    Object.keys(v.method).length === 3 &&
      Object.values(v.method).every(
        (x) => typeof x === "string" && x.length > 0 && x.length < 200,
      ),
    "Invalid method requirements",
  );
  assert(
    object(v.inputs) &&
      Object.keys(v.inputs).length > 0 &&
      Object.keys(v.inputs).length <= 64,
    "Bounded inputs required",
  );
  for (const [k, ref] of Object.entries(v.inputs)) {
    identity(k);
    validateReference(ref);
  }
  assert(
    [v.output, v.subject, v.frame, v.condition].every(
      (x) => typeof x === "string" && x.length > 0,
    ),
    "Invalid request interpretation",
  );
}
const noRefs = () => [],
  noAssets = () => [];
const whole = (s: Json) =>
  object(s) &&
  s.kind === "whole" &&
  s.version === 1 &&
  Object.keys(s).length === 2;
export const wholeSelector = freeze({ kind: "whole", version: 1 });
export const reference = (
  document: string,
  item: string,
  revision?: string,
): Reference =>
  freeze({
    document,
    item,
    selection: revision ? { kind: "pin", revision } : { kind: "follow" },
    selector: wholeSelector,
  });
/** Cell anchors identify source interpretation/provenance as well as the selected value. */
function withAnchors(refs: readonly Reference[]): readonly Reference[] {
  const out: Reference[] = [];
  for (const ref of refs) {
    out.push(ref);
    if (
      object(ref.selector) &&
      ref.selector.kind === "cell" &&
      ref.selector.version === 1 &&
      typeof ref.selector.revision === "string"
    ) {
      identity(ref.selector.revision);
      out.push({
        ...ref,
        selection: { kind: "pin", revision: ref.selector.revision },
        selector: wholeSelector,
      });
    }
  }
  return out;
}
export function createSchemas(
  additional: readonly Schema[] = [],
  options: Readonly<{
    sourceCacheBytes?: number;
    maxSourceCells?: number;
  }> = {},
): Schemas & {
  diagnostics(): Readonly<{
    sourceCacheEntries: number;
    sourceCacheWeight: number;
    sourceParses: number;
  }>;
} {
  const cacheLimit = options.sourceCacheBytes ?? 8 * 1024 * 1024,
    cellLimit = options.maxSourceCells ?? 1000000;
  assert(
    Number.isSafeInteger(cacheLimit) &&
      cacheLimit >= 0 &&
      Number.isSafeInteger(cellLimit) &&
      cellLimit > 0,
    "Invalid source limits",
  );
  const cache = new Map<string, { data: number[][]; weight: number }>();
  let cacheWeight = 0,
    sourceParses = 0;

  const schemas: Schema[] = [
    {
      id: "note@1",
      validate(b) {
        assert(object(b), "Invalid note");
        fields(b, ["text", "mode"]);
        assert(
          typeof b.text === "string" &&
            (b.mode === "draft" || b.mode === "note"),
          "Invalid note",
        );
      },
      references: noRefs,
      assets: noAssets,
      project(b, s) {
        return whole(s)
          ? { type: "text", value: (b as { text: string }).text }
          : { status: "unsupported", reason: "Note selector version" };
      },
    },
    {
      id: "scalar@1",
      validate: scalar,
      references: noRefs,
      assets: noAssets,
      project(b, s) {
        return whole(s)
          ? { type: "scalar", value: b }
          : { status: "unsupported", reason: "Scalar selector version" };
      },
    },
    {
      id: "request@1",
      validate: request,
      references(b) {
        request(b);
        return withAnchors(Object.values(b.inputs));
      },
      assets: noAssets,
      project(b, s) {
        return whole(s)
          ? { type: "request", value: b }
          : { status: "unsupported", reason: "Request selector version" };
      },
    },
    {
      id: "source@1",
      validate(b) {
        assert(object(b), "Invalid source");
        fields(b, ["asset", "rows", "columns", "interpretation"]);
        validateAsset(b.asset);
        assert(
          Number.isSafeInteger(b.rows) &&
            Number(b.rows) > 0 &&
            Number.isSafeInteger(b.columns) &&
            Number(b.columns) > 0,
          "Invalid source shape",
        );
        assert(
          Array.isArray(b.interpretation) &&
            b.interpretation.length === b.columns,
          "Missing column interpretation",
        );
        for (const meta of b.interpretation) {
          assert(object(meta), "Invalid column");
          fields(meta, ["unit", "subject", "frame", "condition"]);
          scalar({ ...meta, value: 0 });
        }
      },
      references: noRefs,
      assets(b) {
        assert(object(b), "Invalid source");
        return [b.asset as Asset];
      },
      project(b, s, resources, revision) {
        assert(object(b), "Invalid source");
        if (whole(s)) return { type: "source", value: b };
        if (
          !object(s) ||
          s.kind !== "cell" ||
          s.version !== 1 ||
          !Number.isSafeInteger(s.row) ||
          !Number.isSafeInteger(s.column)
        )
          return { status: "unsupported", reason: "Source cell selector" };
        if (
          !Number.isInteger(s.row) ||
          Number(s.row) < 0 ||
          Number(s.row) >= Number(b.rows) ||
          Number(s.column) < 0 ||
          Number(s.column) >= Number(b.columns)
        )
          return { status: "missing", reason: "Cell outside declared shape" };
        if (s.revision !== revision.id)
          return {
            status: "ambiguous",
            reason:
              "Cell anchor changed; explicitly rebind the source revision",
          };
        const cells = Number(b.rows) * Number(b.columns);
        if (!Number.isSafeInteger(cells) || cells > cellLimit)
          return {
            status: "unsupported",
            reason:
              "Source exceeds the eager cell budget; use a windowed source adapter",
          };
        const read = resources.read(b.asset as Asset);
        if (read.status !== "ready") return read;
        try {
          const key = JSON.stringify([
            (b.asset as Asset).digest,
            b.rows,
            b.columns,
          ]);
          const hit = cache.get(key);
          let data: unknown;
          if (hit) {
            cache.delete(key);
            cache.set(key, hit);
            data = hit.data;
          } else {
            data = JSON.parse(read.data);
            sourceParses++;
            assert(
              Array.isArray(data) &&
                data.length === b.rows &&
                data.every(
                  (row) =>
                    Array.isArray(row) &&
                    row.length === b.columns &&
                    row.every(
                      (n) => typeof n === "number" && Number.isFinite(n),
                    ),
                ),
              "Invalid source shape/numbers",
            );
            const weight = cells * 8 + Number(b.rows) * 24;
            if (weight <= cacheLimit) {
              while (cache.size >= 16 || cacheWeight + weight > cacheLimit) {
                const oldest = cache.entries().next().value!;
                cache.delete(oldest[0]);
                cacheWeight -= oldest[1].weight;
              }
              cache.set(key, { data: data as number[][], weight });
              cacheWeight += weight;
            }
          }
          const meta = (b.interpretation as Json[])[Number(s.column)];
          assert(object(meta), "Missing interpretation");
          return {
            type: "scalar",
            value: {
              ...meta,
              value: (data as number[][])[Number(s.row)]![Number(s.column)]!,
            } as Json,
          };
        } catch (e) {
          return { status: "corrupt", reason: String(e) };
        }
      },
    },
    {
      id: "relation@1",
      validate(b) {
        assert(object(b), "Invalid relation");
        fields(b, ["role", "from", "to"]);
        assert(
          typeof b.role === "string" && b.role.length > 0,
          "Missing relation role",
        );
        validateReference(b.from);
        validateReference(b.to);
      },
      references(b) {
        assert(object(b), "Invalid relation");
        return withAnchors([b.from as Reference, b.to as Reference]);
      },
      assets: noAssets,
      project(b, s) {
        return whole(s)
          ? { type: "relation", value: b }
          : { status: "unsupported", reason: "Relation selector version" };
      },
    },
    {
      id: "conclusion@1",
      validate(b) {
        assert(object(b), "Invalid conclusion");
        fields(b, ["text", "receipts"]);
        assert(
          typeof b.text === "string" && Array.isArray(b.receipts),
          "Invalid conclusion",
        );
        for (const id of b.receipts) identity(id);
      },
      references: noRefs,
      assets: noAssets,
      evidence(b) {
        assert(object(b) && Array.isArray(b.receipts), "Invalid conclusion");
        return b.receipts as string[];
      },
      project(b, s) {
        assert(object(b), "Invalid conclusion");
        return whole(s)
          ? { type: "text", value: b.text as Json }
          : { status: "unsupported", reason: "Conclusion selector" };
      },
    },
    ...additional,
  ];
  const map = new Map<string, Schema>();
  for (const s of schemas) {
    assert(
      s.id.includes("@") && !map.has(s.id),
      "Duplicate/unversioned schema",
    );
    map.set(s.id, Object.freeze({ ...s }));
  }
  return Object.freeze({
    get: (id: string) => map.get(id),
    diagnostics: () => ({
      sourceCacheEntries: cache.size,
      sourceCacheWeight: cacheWeight,
      sourceParses,
    }),
  });
}
export const methodKey = (m: MethodRef) =>
  JSON.stringify([m.id, m.version, m.runtime]);
export function createMethods(
  methods: readonly Method[],
  typed: readonly import("./contracts.ts").TypedMethod[] = [],
): Methods {
  const map = new Map<string, Method>();
  for (const m of methods) {
    const key = methodKey(m.requirements);
    assert(!map.has(key), "Duplicate method");
    map.set(
      key,
      freeze({
        ...m,
        requirements: { ...m.requirements },
        inputs: { ...m.inputs },
      }),
    );
  }
  const extra = new Map<string, import("./contracts.ts").TypedMethod>();
  for (const method of typed) {
    assert(
      object(method.requirements) && object(method.limits),
      "Invalid typed method metadata",
    );
    fields(method.requirements, ["id", "version", "runtime"]);
    fields(method.limits, ["inputBytes", "outputBytes"]);
    assert(
      Object.keys(method.requirements).length === 3 &&
        [
          ...Object.values(method.requirements),
          method.input,
          method.output,
        ].every(
          (value) =>
            typeof value === "string" &&
            value.length > 0 &&
            value.length <= 160,
        ),
      "Invalid typed method identity/schema",
    );
    const key = methodKey(method.requirements);
    assert(!map.has(key) && !extra.has(key), "Duplicate method");
    for (const size of [method.limits.inputBytes, method.limits.outputBytes])
      assert(
        Number.isSafeInteger(size) && size >= 0 && size <= 64 * 1024 * 1024,
        "Invalid method resource limits",
      );
    assert(
      typeof method.input === "string" &&
        typeof method.output === "string" &&
        typeof method.validateInput === "function" &&
        typeof method.validateOutput === "function",
      "Invalid typed method",
    );
    extra.set(
      key,
      freeze({
        ...method,
        requirements: { ...method.requirements },
        limits: { ...method.limits },
      }),
    );
  }
  return Object.freeze({
    get: (m: MethodRef) => map.get(methodKey(m)),
    typed: Object.freeze({ get: (m: MethodRef) => extra.get(methodKey(m)) }),
  });
}
