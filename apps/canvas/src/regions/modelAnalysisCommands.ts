/** Analysis commands share the accepted document, preview, Keep and Undo protocols. */
import * as f from "@manifold/foundation";
import {
  ANALYSIS_RENDERER,
  MODEL_ANALYSIS,
  analysisRequest,
  sweep,
  type AnalysisRequest,
  type Sweep,
} from "./modelAnalysis.ts";
import { inspectModel, modelReference } from "./modelCommands.ts";
import type { RegionSession, Point } from "./document.ts";
const uid = () => "analysis-" + crypto.randomUUID();
function bodyFor(
  session: RegionSession,
  instance: string,
  spec: Sweep,
): AnalysisRequest {
  sweep(spec);
  const { definition } = inspectModel(session, instance);
  f.assert(
    Object.keys(definition.children).length === 0 &&
      definition.inputs[spec.input] &&
      definition.outputs[spec.output],
    "Choose public ports of a self-contained model",
  );
  return {
    ...spec,
    instance: modelReference(session.document, instance),
    inputs: Object.fromEntries(
      Object.entries(definition.inputs).map(([port, input]) => [
        port,
        modelReference(session.document, instance, f.modelNode([], input.node)),
      ]),
    ),
  };
}
const revision = (item: string, body: AnalysisRequest): f.Revision => ({
  item,
  id: uid(),
  schema: MODEL_ANALYSIS,
  required: true,
  body: body as unknown as f.Json,
});
export function createModelAnalysis(
  session: RegionSession,
  instance: string,
  spec: Sweep,
  at: Point,
) {
  const document = session.document,
    item = uid();
  const label = (document.items.get(instance)?.label || "Model") + " analysis";
  session.applyCommands(
    [
      {
        kind: "create",
        item,
        label,
        revision: revision(item, bodyFor(session, instance, spec)),
      },
      {
        kind: "view",
        view: {
          id: item + ":view",
          reference: modelReference(document, item),
          renderer: ANALYSIS_RENDERER,
          ...at,
          alternative: null,
        },
      },
    ],
    document,
  );
  return item;
}
export function reviseModelAnalysis(
  session: RegionSession,
  item: string,
  spec: Sweep,
  preview = false,
  expected = session.document,
) {
  f.assert(
    session.document === expected,
    "Work changed; reopen analysis settings before applying",
  );
  const current = f.current(expected, item);
  f.assert(current?.schema === MODEL_ANALYSIS, "Model analysis unavailable");
  analysisRequest(current.body);
  const value = revision(
    item,
    bodyFor(session, current.body.instance.item, spec),
  );
  if (preview)
    return session.preview(modelReference(expected, item), [
      { item, revision: value },
    ]);
  session.applyCommands([{ kind: "revise", item, revision: value }], expected);
}
export function keepModelAnalysis(
  session: RegionSession,
  item: string,
  label: string,
  at: Point,
) {
  const target = modelReference(session.document, item),
    preview = session.foundation.preview();
  if (preview)
    f.assert(
      preview.context.root.item === item,
      "Finish the other preview first",
    );
  else session.preview(target, []);
  return session.keepPreview(label, {
    id: uid(),
    reference: target,
    renderer: ANALYSIS_RENDERER,
    ...at,
  });
}
export function analysisViews(document: f.Document) {
  return [...document.views.entries()]
    .map(([, v]) => v)
    .filter((v) => v.renderer === ANALYSIS_RENDERER);
}
export function validateAnalysisViews(document: f.Document) {
  const views = analysisViews(document);
  f.assert(
    views.length <= 16,
    "The canvas supports up to 16 model analysis views",
  );
  for (const view of views) {
    const context = view.alternative
      ? document.alternatives.get(view.alternative)?.context
      : undefined;
    const got = f.resolve(document, view.reference, context);
    f.assert(
      got.status === "resolved" &&
        got.revision.schema === MODEL_ANALYSIS &&
        f.canonical(view.reference.selector) === f.canonical(f.wholeSelector) &&
        view.reference.selection.kind === "follow",
      "Invalid model analysis view",
    );
    analysisRequest(got.revision.body);
  }
}

export function removeModelAnalysis(session: RegionSession, view: f.View) {
  f.assert(
    session.document.views.get(view.id) === view &&
      view.renderer === ANALYSIS_RENDERER,
    "Analysis view changed",
  );
  const commands: f.Command[] = [{ kind: "removeView", id: view.id }];
  if (view.alternative) {
    if (
      analysisViews(session.document).filter(
        (v) => v.alternative === view.alternative,
      ).length === 1
    )
      commands.push({ kind: "removeAlternative", id: view.alternative });
  } else commands.push({ kind: "delete", item: view.reference.item });
  session.applyCommands(commands);
}
