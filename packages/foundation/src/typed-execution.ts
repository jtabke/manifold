/** Typed request adapter over the same selected references and receipt lifecycle as scalar execution. */
import {
  assert,
  object,
  fields,
  identity,
  json,
  retained,
  canonical,
  type Json,
} from "./value.ts";
import { validateAsset } from "./content.ts";
import { project, resolve, type Document, type Context } from "./document.ts";
import { byteLength } from "./resources.ts";
import { declaredResources, resourceAssets } from "./execution-resources.ts";
import type {
  Asset,
  ExecutionIO,
  MethodRef,
  Methods,
  ProjectionOrigin,
  Projection,
  Resources,
  Schemas,
  TypedMethod,
  TypedRequest,
  TypedValue,
} from "./contracts.ts";
export type TypedSnapshot = Readonly<{
  kind: "typed@1";
  method: MethodRef;
  input: TypedValue;
  origin: ProjectionOrigin;
  dependencies: readonly ProjectionOrigin[];
  assets: readonly Asset[];
  output: string;
}>;
export type TypedOutcome = Readonly<
  | { status: "success"; output: TypedValue; assets: readonly Asset[] }
  | { status: "failed"; reason: string }
>;
export type TypedReceipt = Readonly<{
  kind: "typed@1";
  id: string;
  order: number;
  time: string;
  context: Context;
  requestRevision: string;
  key: string;
  snapshot: TypedSnapshot;
  outcome: TypedOutcome;
  physicalValidity: "not-assessed";
}>;
export type TypedExecutor = (
  snapshot: TypedSnapshot,
  signal: AbortSignal,
  io: ExecutionIO,
) => Promise<unknown>;
const stable = (value: unknown) => canonical(value as Json);
function immediate<T>(value: T): T {
  if (value && typeof (value as { then?: unknown }).then === "function") {
    void Promise.resolve(value).catch(() => {});
    throw Error("Execution validation must be synchronous");
  }
  return value;
}
export function typedValue(value: unknown): asserts value is TypedValue {
  assert(object(value), "Invalid typed execution value");
  fields(value, ["schema", "body"]);
  assert(
    typeof value.schema === "string" &&
      value.schema.length > 0 &&
      value.schema.length <= 160,
    "Invalid execution value schema",
  );
  json(value.body);
  assert(
    byteLength(stable(value)) <= 128 * 1024,
    "Execution value metadata budget exceeded",
  );
}
function invocation(value: unknown): asserts value is TypedRequest {
  assert(object(value), "Invalid typed request");
  fields(value, ["method", "input", "output"]);
  assert(object(value.method), "Invalid typed method identity");
  fields(value.method, ["id", "version", "runtime"]);
  for (const id of [
    value.method.id,
    value.method.version,
    value.method.runtime,
    value.output,
  ])
    assert(
      typeof id === "string" && id.length > 0 && id.length <= 160,
      "Invalid typed method/output identity",
    );
  typedValue(value.input);
}
function declared(method: TypedMethod, body: Json, role: "input" | "output") {
  const assets = resourceAssets(immediate(method.assets?.(body, role) ?? [])),
    unique = new Map(assets.map((asset) => [asset.digest, asset.size]));
  assert(
    [...unique.values()].reduce((sum, size) => sum + size, 0) <=
      method.limits[(role + "Bytes") as "inputBytes" | "outputBytes"],
    "Execution asset byte budget exceeded",
  );
  return assets;
}
export function typedInputAssets(method: TypedMethod, input: Json) {
  immediate(method.validateInput(input));
  return declared(method, input, "input");
}
export function validateTypedInputResources(
  method: TypedMethod,
  input: Json,
  assets: readonly Asset[],
  resources: Resources,
) {
  for (const asset of assets)
    assert(
      resources.read(asset).status === "ready",
      "Execution input bytes unavailable",
    );
  assert(
    !assets.length || method.validateInputResources,
    "Asset methods must validate input content",
  );
  immediate(
    method.validateInputResources?.(
      input,
      declaredResources(assets, resources),
    ),
  );
}
export function captureTyped(
  projection: Projection,
  context: Context,
  methods: Methods,
  resources: Resources,
) {
  try {
    const got = { projection };
    assert(
      got.projection.type === "typed-request@1",
      "Target is not a typed calculation request",
    );
    invocation(got.projection.value);
    const request = got.projection.value,
      method = methods.typed?.get(request.method);
    assert(method, "Unsupported method/version/runtime");
    assert(
      request.input.schema === method.input && request.output === method.output,
      "Typed method input/output contract mismatch",
    );
    const assets = typedInputAssets(method, request.input.body);
    validateTypedInputResources(method, request.input.body, assets, resources);
    const snapshot = retained({
      kind: "typed@1",
      method: request.method,
      input: request.input,
      origin: {
        document: got.projection.document,
        item: got.projection.item,
        revision: got.projection.revision,
        selector: got.projection.selector,
      },
      dependencies: got.projection.dependencies ?? [],
      assets,
      output: request.output,
    } as unknown as Json) as unknown as TypedSnapshot;
    assert(
      byteLength(stable(snapshot)) <= 128 * 1024,
      "Execution capture metadata budget exceeded",
    );
    return {
      ok: true as const,
      context,
      requestRevision: got.projection.revision,
      snapshot,
      key: stable(snapshot),
    };
  } catch (error) {
    return { ok: false as const, error: String(error) };
  }
}
export function validateTypedOutput(
  method: TypedMethod,
  snapshot: TypedSnapshot,
  raw: unknown,
) {
  const body = immediate(method.validateOutput(snapshot.input.body, raw));
  json(body);
  const output = retained({
    schema: method.output,
    body,
  } as Json) as TypedValue;
  typedValue(output);
  return { output, assets: declared(method, output.body, "output") };
}
export function validateTypedOutputResources(
  method: TypedMethod,
  snapshot: TypedSnapshot,
  output: TypedValue,
  assets: readonly Asset[],
  resources: Resources,
) {
  for (const asset of assets)
    assert(
      resources.read(asset).status === "ready",
      "Output references unverified execution bytes",
    );
  assert(
    !assets.length || method.validateOutputResources,
    "Asset methods must validate output content",
  );
  immediate(
    method.validateOutputResources?.(
      snapshot.input.body,
      output.body,
      declaredResources([...snapshot.assets, ...assets], resources),
    ),
  );
}
function origin(value: unknown): asserts value is ProjectionOrigin {
  assert(object(value), "Invalid typed input origin");
  fields(value, ["document", "item", "revision", "selector"]);
  identity(value.document);
  identity(value.item);
  identity(value.revision);
  json(value.selector);
}
/** Header/context ownership is checked by the common receipt validator before this adapter. */
export function validateTypedReceipt(
  doc: Document,
  receipt: TypedReceipt,
  schemas: Schemas,
  methods: Methods,
  resources: Resources,
) {
  assert(
    receipt.kind === "typed@1" &&
      typeof receipt.time === "string" &&
      Number.isFinite(Date.parse(receipt.time)),
    "Invalid typed receipt time/kind",
  );
  const snapshot = receipt.snapshot;
  assert(object(snapshot), "Invalid typed snapshot");
  fields(snapshot, [
    "kind",
    "method",
    "input",
    "origin",
    "dependencies",
    "assets",
    "output",
  ]);
  assert(snapshot.kind === "typed@1", "Typed snapshot kind mismatch");
  origin(snapshot.origin);
  typedValue(snapshot.input);
  const root = receipt.context.root;
  assert(
    stable(snapshot.origin) ===
      stable({
        document: root.document,
        item: root.item,
        revision: receipt.requestRevision,
        selector: root.selector,
      }),
    "Typed receipt root origin mismatch",
  );
  invocation({
    method: snapshot.method,
    input: snapshot.input,
    output: snapshot.output,
  });
  assert(
    Array.isArray(snapshot.dependencies) &&
      snapshot.dependencies.length <= 4096 &&
      Array.isArray(snapshot.assets),
    "Invalid typed dependencies/assets",
  );
  let previous = "";
  for (const dependency of snapshot.dependencies) {
    origin(dependency);
    const key = stable(dependency);
    assert(key > previous, "Duplicate or unordered typed provenance");
    previous = key;
    assert(
      resolve(
        doc,
        {
          ...dependency,
          selection: { kind: "pin", revision: dependency.revision },
        },
        receipt.context,
      ).status === "resolved",
      "Typed dependency revision missing",
    );
  }
  const assets = resourceAssets(snapshot.assets);
  assert(
    stable(assets) === stable(snapshot.assets),
    "Noncanonical typed input assets",
  );
  const projected = project(
    doc,
    receipt.context.root,
    schemas,
    resources,
    receipt.context,
  );
  if (projected.status === "resolved") {
    assert(
      projected.projection.type === "typed-request@1",
      "Typed receipt request mismatch",
    );
    invocation(projected.projection.value);
    const request = projected.projection.value;
    assert(
      stable(request.method) === stable(snapshot.method) &&
        stable(request.input) === stable(snapshot.input) &&
        request.output === snapshot.output &&
        stable(projected.projection.dependencies ?? []) ===
          stable(snapshot.dependencies) &&
        stable(snapshot.origin) ===
          stable({
            document: projected.projection.document,
            item: projected.projection.item,
            revision: projected.projection.revision,
            selector: projected.projection.selector,
          }),
      "Typed receipt input/origin mismatch",
    );
  } else
    assert(
      ["unavailable", "loading", "unsupported"].includes(projected.status),
      "Typed receipt source invalid: " + projected.status,
    );
  assert(
    receipt.key === stable(snapshot) && byteLength(receipt.key) <= 128 * 1024,
    "Typed receipt snapshot/key mismatch",
  );
  const method = methods.typed?.get(snapshot.method);
  if (method) {
    assert(
      snapshot.input.schema === method.input &&
        snapshot.output === method.output,
      "Typed receipt method contract mismatch",
    );
    assert(
      stable(typedInputAssets(method, snapshot.input.body)) === stable(assets),
      "Typed input asset declarations differ",
    );
    if (assets.every((asset) => resources.read(asset).status === "ready"))
      validateTypedInputResources(
        method,
        snapshot.input.body,
        assets,
        resources,
      );
  }
  assert(object(receipt.outcome), "Invalid typed outcome");
  if (receipt.outcome.status === "success") {
    fields(receipt.outcome, ["status", "output", "assets"]);
    typedValue(receipt.outcome.output);
    assert(
      receipt.outcome.output.schema === snapshot.output,
      "Typed output schema mismatch",
    );
    const declaredAssets = resourceAssets(receipt.outcome.assets);
    assert(
      stable(declaredAssets) === stable(receipt.outcome.assets),
      "Noncanonical typed output assets",
    );
    if (method) {
      const checked = validateTypedOutput(
        method,
        snapshot,
        receipt.outcome.output.body,
      );
      assert(
        stable(checked.output) === stable(receipt.outcome.output) &&
          stable(checked.assets) === stable(declaredAssets),
        "Typed output/asset mismatch",
      );
      if (
        [...assets, ...declaredAssets].every(
          (asset) => resources.read(asset).status === "ready",
        )
      )
        validateTypedOutputResources(
          method,
          snapshot,
          receipt.outcome.output,
          declaredAssets,
          resources,
        );
    }
    for (const asset of declaredAssets) {
      validateAsset(asset);
      if (asset.disposition === "included")
        assert(
          resources.read(asset).status === "ready",
          "Missing included output bytes",
        );
    }
  } else {
    fields(receipt.outcome, ["status", "reason"]);
    assert(
      receipt.outcome.status === "failed" &&
        typeof receipt.outcome.reason === "string" &&
        receipt.outcome.reason.length <= 2000,
      "Invalid typed failure",
    );
  }
}
