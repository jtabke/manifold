/** Guarded authored operations; Apply is separate from computation and one Undo step. */
import * as f from "@manifold/foundation";
import { canvasSchemas } from "./app/canvasDocument.ts";
import type { RegionSession, Point } from "./document.ts";
import {
  inspectModel,
  modelReference,
  setModelInput,
} from "./modelCommands.ts";
import { AUTHORED_MODEL } from "./authoredModels.ts";
import {
  MODEL_OPTIMIZATION,
  isOptimizationSchema,
  OPTIMIZATION_RENDERER,
  optimizationRequest,
  optimizationSpec,
  type OptimizationRequest,
  type OptimizationSpec,
  type Backend,
  type OptimizationOutput,
} from "./modelOptimization.ts";
import { modelOptimizations } from "./foundationModels.ts";
import type { OptimizationInput } from "./modelOptimization.ts";
import { responseRequest, type ResponseRequest } from "./modelAnalysis.ts";
import { optimizationConvert } from "./optimizationQuantities.ts";

/** Bind authored and imported response annotations to independently checked retained evidence. */
export function validateOptimizationResponses(
  document: f.Document,
  receipts: { get(id: string): f.Receipt | undefined },
) {
  const same = (a: unknown, b: unknown) =>
    f.canonical(a as f.Json) === f.canonical(b as f.Json);
  for (const [, revision] of document.revisions.entries()) {
    if (revision.schema !== "canvas-model-response@1") continue;
    responseRequest(revision.body);
    const body = revision.body;
    const receipt = receipts.get(body.receipt);
    f.assert(
      receipt?.kind === "typed@1" && receipt.outcome.status === "success",
      "Response optimization evidence unavailable",
    );
    f.assert(
      f.methodKey(receipt.snapshot.method) ===
        f.methodKey(modelOptimizations.method.requirements) &&
        body.source.document === document.document &&
        body.source.document === receipt.snapshot.origin.document &&
        body.source.item === receipt.snapshot.origin.item &&
        body.source.selection.kind === "pin" &&
        body.source.selection.revision === receipt.snapshot.origin.revision &&
        same(body.source.selector, receipt.snapshot.origin.selector),
      "Response source differs from optimization evidence",
    );
    const source = f.resolve(document, body.source);
    f.assert(
      source.status === "resolved" &&
        isOptimizationSchema(source.revision.schema),
      "Response optimization source unavailable",
    );
    modelOptimizations.validateOutput(
      receipt.snapshot.input.body,
      receipt.outcome.output.body,
    );
    const capture = receipt.snapshot.input.body as unknown as OptimizationInput;
    const output = receipt.outcome.output.body as unknown as OptimizationOutput;
    f.assert(
      same(body.capture, { ...capture.scalar, points: body.capture.points }) &&
        body.target === capture.request.target &&
        body.current === capture.scalar.inputs[capture.scalar.x.port]!.value &&
        body.candidate === (output.candidate?.x ?? null),
      "Response capture or markers differ from optimization evidence",
    );
  }
}

/** Explicit sampling authors an immutable capture request, then uses the session scheduler. */
export function computeOptimizationResponse(
  session: RegionSession,
  view: f.View,
  receipt: f.TypedReceipt,
  points = 41,
) {
  f.assert(
    session.document.views.get(view.id) === view &&
      !session.foundation.preview(),
    "Close preview before computing a response",
  );
  f.assert(
    [...session.foundation.evidence().entries()].some(
      ([, r]) => r === receipt,
    ) &&
      receipt.snapshot.origin.item === view.reference.item &&
      receipt.outcome.status === "success",
    "Reviewed optimization evidence unavailable",
  );
  f.assert(
    receipt.snapshot.origin.document === view.reference.document &&
      f.methodKey(receipt.snapshot.method) ===
        f.methodKey(modelOptimizations.method.requirements),
    "Wrong optimization response source",
  );
  modelOptimizations.validateOutput(
    receipt.snapshot.input.body,
    receipt.outcome.output.body,
  );
  const capture = receipt.snapshot.input.body as unknown as OptimizationInput;
  const output = receipt.outcome.output.body as unknown as OptimizationOutput;
  const item = uid();
  const body: ResponseRequest = {
    source: {
      ...view.reference,
      selection: { kind: "pin", revision: receipt.snapshot.origin.revision },
    },
    receipt: receipt.id,
    capture: { ...capture.scalar, points },
    target: capture.request.target,
    current: capture.scalar.inputs[capture.scalar.x.port]!.value,
    candidate: output.candidate?.x ?? null,
  };
  responseRequest(body);
  const existing = [...session.document.items.entries()].find(([id]) => {
    const r = f.current(session.document, id);
    return (
      r?.schema === "canvas-model-response@1" &&
      f.canonical(r.body) === f.canonical(body as unknown as f.Json)
    );
  });
  if (existing)
    return {
      item: existing[0],
      job: session.compute(
        modelReference(session.document, existing[0]),
        "baseline",
      ),
    };
  session.applyCommands(
    [
      {
        kind: "create",
        item,
        label: "Checked optimization response",
        revision: {
          item,
          id: uid(),
          schema: "canvas-model-response@1",
          required: true,
          body: body as unknown as f.Json,
        },
      },
    ],
    session.document,
  );
  return {
    item,
    job: session.compute(modelReference(session.document, item), "baseline"),
  };
}

/** Never turn a result-local Undo into an unrelated global Undo. */
export function undoOptimizationApply(
  session: RegionSession,
  applied: f.Document,
) {
  f.assert(
    session.document === applied &&
      session.canUndo &&
      !session.foundation.preview(),
    "Later work exists. Use global Undo to review history instead.",
  );
  session.undo();
}
const uid = () => "optimization-" + crypto.randomUUID();
function bodyFor(
  session: RegionSession,
  instance: string,
  spec: OptimizationSpec,
  backend: Backend | null,
): OptimizationRequest {
  optimizationSpec(spec);
  const { definition, definitionRevision } = inspectModel(session, instance);
  f.assert(
    definitionRevision.schema === AUTHORED_MODEL &&
      !Object.keys(definition.children).length &&
      definition.inputs[spec.input] &&
      definition.outputs[spec.output],
    "Select public ports of a self-contained authored model",
  );
  if (spec.displayUnits) {
    const inputNode = definition.nodes[definition.inputs[spec.input]!.node];
    f.assert(inputNode?.kind === "input", "Input unavailable");
    optimizationConvert(1, inputNode.unit, spec.displayUnits.input);
    const got = f.project(
      session.document,
      modelReference(session.document, instance, f.modelPort(spec.output)),
      canvasSchemas,
      session.foundation.resources(),
    );
    f.assert(
      got.status === "resolved",
      "Output units unavailable; view the model",
    );
    f.scalar(got.projection.value);
    optimizationConvert(1, got.projection.value.unit, spec.displayUnits.output);
  }
  return {
    input: spec.input,
    output: spec.output,
    low: spec.low,
    high: spec.high,
    mode: spec.mode,
    target: spec.target,
    xTolerance: spec.xTolerance,
    residualTolerance: spec.residualTolerance,
    ...(spec.displayUnits ? { displayUnits: spec.displayUnits } : {}),
    backend,
    instance: modelReference(session.document, instance),
    inputs: Object.fromEntries(
      Object.entries(definition.inputs).map(([port, input]) => [
        port,
        modelReference(session.document, instance, f.modelNode([], input.node)),
      ]),
    ),
  };
}
const revision = (item: string, body: OptimizationRequest): f.Revision => ({
  item,
  id: uid(),
  schema: MODEL_OPTIMIZATION,
  required: true,
  body: body as unknown as f.Json,
});
export function createModelOptimization(
  session: RegionSession,
  instance: string,
  spec: OptimizationSpec,
  at: Point,
) {
  const expected = session.document,
    item = uid();
  session.applyCommands(
    [
      {
        kind: "create",
        item,
        label:
          (expected.items.get(instance)?.label || "Model") + " optimization",
        revision: revision(item, bodyFor(session, instance, spec, null)),
      },
      {
        kind: "view",
        view: {
          id: item + ":view",
          reference: modelReference(expected, item),
          renderer: OPTIMIZATION_RENDERER,
          alternative: null,
          ...at,
        },
      },
    ],
    expected,
  );
  return item;
}
export function reviseModelOptimization(
  session: RegionSession,
  item: string,
  spec: OptimizationSpec,
  expected = session.document,
  backend: Backend | null = null,
) {
  f.assert(
    session.document === expected && !session.foundation.preview(),
    "Work changed or preview active; reopen optimization settings",
  );
  const selected = f.current(expected, item);
  f.assert(
    selected && isOptimizationSchema(selected.schema),
    "Optimization unavailable",
  );
  optimizationRequest(selected.body);
  session.applyCommands(
    [
      {
        kind: "revise",
        item,
        revision: revision(
          item,
          bodyFor(session, selected.body.instance.item, spec, backend),
        ),
      },
    ],
    expected,
  );
}
/** Explicit Run setup freezes the reviewed backend in authored data; projection never probes it. */
export function reviewOptimizationRuntime(
  session: RegionSession,
  item: string,
  backend: Backend,
  expected: f.Document,
) {
  f.assert(
    session.document === expected,
    "Work changed during runtime review; Run again",
  );
  const selected = f.current(expected, item);
  f.assert(
    selected && isOptimizationSchema(selected.schema),
    "Optimization unavailable",
  );
  optimizationRequest(selected.body);
  if (
    f.canonical(selected.body.backend as unknown as f.Json) !==
    f.canonical(backend as unknown as f.Json)
  )
    reviseModelOptimization(session, item, selected.body, expected, backend);
}
export function applyOptimizationCandidate(
  session: RegionSession,
  view: f.View,
  receipt: f.TypedReceipt,
  expected: f.Document,
) {
  f.assert(
    session.document === expected &&
      expected.views.get(view.id) === view &&
      view.renderer === OPTIMIZATION_RENDERER &&
      !view.alternative &&
      !session.foundation.preview(),
    "Apply requires the exact reviewed baseline document and view, with no preview",
  );
  const selected = f.current(expected, view.reference.item);
  f.assert(
    selected && isOptimizationSchema(selected.schema),
    "Optimization deleted",
  );
  optimizationRequest(selected.body);
  const result = session.foundation.result(view.reference, "baseline");
  f.assert(
    result.status === "current" &&
      "receipt" in result &&
      result.receipt === receipt &&
      receipt.kind === "typed@1" &&
      receipt.outcome.status === "success",
    "Apply requires the same current reviewed baseline receipt",
  );
  f.assert(
    f.methodKey(receipt.snapshot.method) ===
      f.methodKey(modelOptimizations.method.requirements),
    "Wrong optimization receipt",
  );
  const checked = modelOptimizations.validateOutput(
    receipt.snapshot.input.body,
    receipt.outcome.output.body,
  ) as unknown as OptimizationOutput;
  f.assert(
    checked.success && checked.code === "converged" && checked.candidate,
    "Only checked successful convergence can be applied",
  );
  const input = receipt.snapshot.input
    .body as unknown as import("./modelOptimization.ts").OptimizationInput;
  f.assert(
    input.scalar.x.port === selected.body.input &&
      input.scalar.y.port === selected.body.output &&
      input.request.backend.source_sha256 ===
        selected.body.backend?.source_sha256,
    "Reviewed optimization interface/runtime changed",
  );
  setModelInput(
    session,
    selected.body.instance.item,
    selected.body.input,
    checked.candidate.x,
    expected,
  );
}
export const optimizationViews = (document: f.Document) =>
  [...document.views.entries()]
    .map(([, v]) => v)
    .filter((v) => v.renderer === OPTIMIZATION_RENDERER);
export function validateOptimizationViews(document: f.Document) {
  const views = optimizationViews(document);
  f.assert(
    views.length <= 16,
    "The canvas supports up to 16 optimization views",
  );
  for (const view of views) {
    const context = view.alternative
      ? document.alternatives.get(view.alternative)?.context
      : undefined;
    const got = f.resolve(document, view.reference, context);
    f.assert(
      got.status === "resolved" &&
        isOptimizationSchema(got.revision.schema) &&
        view.reference.selection.kind === "follow" &&
        f.canonical(view.reference.selector) === f.canonical(f.wholeSelector),
      "Invalid optimization view",
    );
    optimizationRequest(got.revision.body);
  }
}
export function keepModelOptimization(
  session: RegionSession,
  view: f.View,
  at: Point,
) {
  f.assert(
    !view.alternative && !session.foundation.preview(),
    "Keep the baseline optimization",
  );
  session.preview(view.reference, []);
  return session.keepPreview("Kept optimization", {
    id: uid(),
    reference: view.reference,
    renderer: OPTIMIZATION_RENDERER,
    ...at,
  });
}
export function removeModelOptimization(session: RegionSession, view: f.View) {
  f.assert(
    session.document.views.get(view.id) === view &&
      view.renderer === OPTIMIZATION_RENDERER,
    "Optimization view changed",
  );
  const commands: f.Command[] = [{ kind: "removeView", id: view.id }];
  if (!view.alternative)
    commands.push({ kind: "delete", item: view.reference.item });
  else if (
    optimizationViews(session.document).filter(
      (v) => v.alternative === view.alternative,
    ).length === 1
  )
    commands.push({ kind: "removeAlternative", id: view.alternative });
  session.applyCommands(commands, session.document);
}
