/** Guarded authored operations; Apply is separate from computation and one Undo step. */
import * as f from "@manifold/foundation";
import type { RegionSession, Point } from "./document.ts";
import {
  inspectModel,
  modelReference,
  setModelInput,
} from "./modelCommands.ts";
import { AUTHORED_MODEL } from "./authoredModels.ts";
import {
  MODEL_OPTIMIZATION,
  OPTIMIZATION_RENDERER,
  optimizationRequest,
  optimizationSpec,
  type OptimizationRequest,
  type OptimizationSpec,
  type Backend,
  type OptimizationOutput,
} from "./modelOptimization.ts";
import { modelOptimizations } from "./foundationModels.ts";
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
  return {
    input: spec.input,
    output: spec.output,
    low: spec.low,
    high: spec.high,
    mode: spec.mode,
    target: spec.target,
    xTolerance: spec.xTolerance,
    residualTolerance: spec.residualTolerance,
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
  f.assert(selected?.schema === MODEL_OPTIMIZATION, "Optimization unavailable");
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
  f.assert(selected?.schema === MODEL_OPTIMIZATION, "Optimization unavailable");
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
  f.assert(selected?.schema === MODEL_OPTIMIZATION, "Optimization deleted");
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
        got.revision.schema === MODEL_OPTIMIZATION &&
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
