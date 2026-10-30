import {
  assert,
  object,
  fields,
  identity,
  freeze,
  canonical,
  json,
  type Json,
} from "./value.ts";
import { scalar, request, methodKey } from "./content.ts";
import {
  captureContext,
  resolve,
  project,
  validateContext,
  type Document,
  type Context,
} from "./document.ts";
import type {
  Schemas,
  Resources,
  Methods,
  Reference,
  MethodRef,
  Scalar,
  ProjectionOrigin,
  ProjectionResult,
} from "./contracts.ts";
import {
  captureTyped,
  validateTypedReceipt,
  type TypedSnapshot,
  type TypedReceipt,
} from "./typed-execution.ts";
export type CapturedInput = Readonly<{
  scalar: Scalar;
  dependencies?: readonly ProjectionOrigin[];
  origin: Readonly<{
    document: string;
    item: string;
    revision: string;
    selector: Json;
  }>;
}>;
export type Snapshot = Readonly<{
  method: MethodRef;
  inputs: Readonly<Record<string, CapturedInput>>;
  output: string;
  subject: string;
  frame: string;
  condition: string;
}>;
export type Outcome = Readonly<
  { status: "success"; output: Scalar } | { status: "failed"; reason: string }
>;
export type ScalarReceipt = Readonly<{
  kind?: never;
  id: string;
  order: number;
  context: Context;
  requestRevision: string;
  key: string;
  snapshot: Snapshot;
  outcome: Outcome;
  physicalValidity: "not-assessed";
}>;
export type Receipt = ScalarReceipt | TypedReceipt;
export type ExecutionSnapshot = Snapshot | TypedSnapshot;
export const isTypedSnapshot = (
  snapshot: ExecutionSnapshot,
): snapshot is TypedSnapshot => "kind" in snapshot;
export const isScalarReceipt = (receipt: Receipt): receipt is ScalarReceipt =>
  receipt.kind !== "typed@1";
export const receiptAssets = (receipt: Receipt) =>
  receipt.kind === "typed@1"
    ? [
        ...receipt.snapshot.assets,
        ...(receipt.outcome.status === "success" ? receipt.outcome.assets : []),
      ]
    : [];
export type Executor = (
  snapshot: Snapshot,
  signal: AbortSignal,
) => Promise<unknown>;
export const snapshotKey = (s: ExecutionSnapshot) =>
  canonical(s as unknown as Json);
export function captureExecution(
  doc: Document,
  target: Reference,
  schemas: Schemas,
  methods: Methods,
  resources: Resources,
  context = captureContext(doc, target, schemas),
) {
  const selected = project(doc, target, schemas, resources, context);
  return selected.status === "resolved" &&
    selected.projection.type === "typed-request@1"
    ? captureTyped(selected.projection, context, methods, resources)
    : captureScalar(doc, schemas, methods, resources, context, selected);
}
export function capture(
  doc: Document,
  target: Reference,
  schemas: Schemas,
  methods: Methods,
  resources: Resources,
  context = captureContext(doc, target, schemas),
) {
  return captureScalar(
    doc,
    schemas,
    methods,
    resources,
    context,
    project(doc, target, schemas, resources, context),
  );
}
function captureScalar(
  doc: Document,
  schemas: Schemas,
  methods: Methods,
  resources: Resources,
  context: Context,
  got: ProjectionResult,
) {
  try {
    assert(
      got.status === "resolved",
      got.status === "resolved" ? "" : got.reason,
    );
    assert(
      got.projection.type === "request",
      "Target is not a calculation request",
    );
    const body = got.projection.value;
    request(body);
    const method = methods.get(body.method);
    assert(method, "Unsupported method/version/runtime");
    assert(
      body.output === method.output &&
        Object.keys(body.inputs).sort().join() ===
          Object.keys(method.inputs).sort().join(),
      "Method input/output contract mismatch",
    );
    const inputs: Record<string, CapturedInput> = Object.create(null);
    for (const slot of Object.keys(body.inputs).sort()) {
      const ref = body.inputs[slot]!,
        input = project(doc, ref, schemas, resources, context);
      assert(
        input.status === "resolved",
        input.status === "resolved" ? "" : input.status + ": " + input.reason,
      );
      assert(input.projection.type === "scalar", "Expected scalar input");
      const v = input.projection.value;
      scalar(v);
      assert(v.unit === method.inputs[slot], "Input unit mismatch");
      assert(
        v.subject === body.subject &&
          v.frame === body.frame &&
          v.condition === body.condition,
        "Input interpretation differs",
      );
      inputs[slot] = {
        scalar: v,
        ...(input.projection.dependencies?.length
          ? { dependencies: input.projection.dependencies }
          : {}),
        origin: {
          document: ref.document,
          item: ref.item,
          revision: input.projection.revision,
          selector: ref.selector,
        },
      };
    }
    method.validateDomain?.(
      Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, v.scalar])),
    );
    const snapshot: Snapshot = freeze({
      method: { ...body.method },
      inputs,
      output: body.output,
      subject: body.subject,
      frame: body.frame,
      condition: body.condition,
    });
    return {
      ok: true as const,
      context,
      requestRevision: got.projection.revision,
      snapshot,
      key: snapshotKey(snapshot),
    };
  } catch (e) {
    return { ok: false as const, error: String(e) };
  }
}
export function validateOutput(s: Snapshot, v: unknown): Scalar {
  scalar(v);
  assert(
    v.unit === s.output &&
      v.subject === s.subject &&
      v.frame === s.frame &&
      v.condition === s.condition,
    "Output unit/interpretation mismatch",
  );
  return freeze(structuredClone(v));
}
/** Retained metadata can remain inspectable when a linked dependency/method is unavailable. It cannot establish currency. */
export function validateReceipt(
  doc: Document,
  r: Receipt,
  schemas: Schemas,
  methods: Methods,
  resources: Resources,
) {
  assert(object(r), "Invalid receipt");
  fields(r, [
    "id",
    "order",
    "context",
    "requestRevision",
    "key",
    "snapshot",
    "outcome",
    "physicalValidity",
    "kind",
    "time",
  ]);
  identity(r.id);
  identity(r.requestRevision);
  assert(
    Number.isSafeInteger(r.order) &&
      r.order > 0 &&
      r.physicalValidity === "not-assessed",
    "Invalid receipt order/validity",
  );
  validateContext(doc, r.context, schemas);
  const req = resolve(doc, r.context.root, r.context);
  assert(
    req.status === "resolved" && req.revision.id === r.requestRevision,
    "Receipt request revision missing",
  );
  if (r.kind === "typed@1")
    return validateTypedReceipt(doc, r, schemas, methods, resources);
  assert(
    !Object.hasOwn(r, "kind") && !Object.hasOwn(r, "time"),
    "Unknown scalar receipt fields",
  );
  const body = req.revision.body;
  request(body);
  const s = r.snapshot;
  assert(object(s), "Invalid snapshot");
  fields(s, ["method", "inputs", "output", "subject", "frame", "condition"]);
  assert(
    object(s.method) && object(s.inputs),
    "Invalid captured method/inputs",
  );
  fields(s.method, ["id", "version", "runtime"]);
  assert(
    methodKey(s.method) === methodKey(body.method) &&
      s.output === body.output &&
      s.subject === body.subject &&
      s.frame === body.frame &&
      s.condition === body.condition,
    "Receipt method/interpretation mismatch",
  );
  assert(
    Object.keys(s.inputs).sort().join() ===
      Object.keys(body.inputs).sort().join(),
    "Receipt slots mismatch",
  );
  let allAvailable = true;
  for (const [slot, input] of Object.entries(s.inputs)) {
    assert(object(input) && object(input.origin), "Invalid captured input");
    fields(input, ["scalar", "origin", "dependencies"]);
    if (input.dependencies !== undefined) {
      assert(
        Array.isArray(input.dependencies) &&
          input.dependencies.length > 0 &&
          input.dependencies.length <= 4096,
        "Invalid input provenance",
      );
      let previous = "";
      for (const dependency of input.dependencies) {
        assert(object(dependency), "Invalid dependency origin");
        fields(dependency, ["document", "item", "revision", "selector"]);
        identity(dependency.document);
        identity(dependency.item);
        identity(dependency.revision);
        json(dependency.selector);
        const key = canonical(dependency as Json);
        assert(key > previous, "Duplicate or unordered input provenance");
        previous = key;
        const got = resolve(
          doc,
          {
            document: dependency.document,
            item: dependency.item,
            selection: { kind: "pin", revision: dependency.revision },
            selector: dependency.selector,
          },
          r.context,
        );
        assert(
          got.status === "resolved",
          "Receipt dependency revision missing",
        );
      }
    }
    fields(input.origin, ["document", "item", "revision", "selector"]);
    scalar(input.scalar);
    assert(
      input.scalar.subject === s.subject &&
        input.scalar.frame === s.frame &&
        input.scalar.condition === s.condition,
      "Receipt input interpretation mismatch",
    );
    const ref = body.inputs[slot]!,
      resolved = resolve(doc, ref, r.context);
    assert(resolved.status === "resolved", "Receipt source revision missing");
    assert(
      canonical(input.origin as unknown as Json) ===
        canonical({
          document: ref.document,
          item: ref.item,
          revision: resolved.revision.id,
          selector: ref.selector,
        }),
      "Receipt input pin mismatch",
    );
    const got = project(doc, ref, schemas, resources, r.context);
    if (got.status === "resolved")
      assert(
        got.projection.type === "scalar" &&
          canonical(got.projection.value) ===
            canonical(input.scalar as unknown as Json) &&
          canonical((got.projection.dependencies ?? []) as unknown as Json) ===
            canonical((input.dependencies ?? []) as unknown as Json),
        "Receipt input value mismatch",
      );
    else {
      allAvailable = false;
      assert(
        got.status === "unavailable" ||
          got.status === "loading" ||
          got.status === "unsupported",
        "Receipt source invalid: " + got.status,
      );
    }
  }
  assert(r.key === snapshotKey(s), "Receipt snapshot/key mismatch");
  const exact = capture(
    doc,
    r.context.root,
    schemas,
    methods,
    resources,
    r.context,
  );
  if (methods.get(s.method) && allAvailable)
    assert(exact.ok, exact.ok ? "" : exact.error);
  if (exact.ok) assert(exact.key === r.key, "Receipt execution key mismatch");
  assert(object(r.outcome), "Invalid outcome");
  if (r.outcome.status === "success") {
    fields(r.outcome, ["status", "output"]);
    validateOutput(s, r.outcome.output);
  } else {
    fields(r.outcome, ["status", "reason"]);
    assert(
      r.outcome.status === "failed" && typeof r.outcome.reason === "string",
      "Invalid failed receipt",
    );
  }
}
