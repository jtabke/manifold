/** Source-backed exterior choices. These queries never change containment or bindings. */
import { project, type Page } from "./document.ts";
import {
  modelContents,
  type NestedModel,
  type ModelExterior,
} from "./models.ts";

export const exteriorLabels = {
  interface: "Label / interface",
  equation: "Equation preview",
  response: "Response preview",
  artifact: "Selected artifact",
};
export function exteriorSources(
  page: Page,
  model: NestedModel,
  kind: ModelExterior["kind"],
) {
  const p = project(page),
    inside = modelContents(page, model.members);
  const plots = page.plots.map((plot) => ({
    id: plot.id,
    label: `${p.statements.get(plot.output)?.name || "Unresolved output"} against ${p.statements.get(plot.input)?.name || "Unresolved input"}`,
  }));
  if (kind === "response")
    return plots.filter((plot) => {
      const definition = page.plots.find((p) => p.id === plot.id)!;
      return inside.has(definition.output);
    });
  if (kind === "equation")
    return page.regions
      .filter(
        (r) =>
          inside.has(r.id) &&
          ["equation", "quantity", "draft"].includes(p.kinds[r.id]),
      )
      .sort((a, b) => {
        const rank = (id: string) =>
          model.outputs.includes(id)
            ? 0
            : p.kinds[id] === "equation"
              ? 1
              : p.kinds[id] === "draft"
                ? 2
                : 3;
        return rank(a.id) - rank(b.id);
      })
      .map((r) => ({ id: r.id, label: r.label || p.texts[r.id] }));
  if (kind === "artifact")
    return [
      ...plots,
      ...page.regions
        .filter((r) => r.data || p.kinds[r.id] === "note")
        .map((r) => ({
          id: r.id,
          label: r.data?.name || r.label || p.texts[r.id].slice(0, 90),
        })),
    ];
  return [];
}
export function exteriorSource(page: Page, model: NestedModel) {
  const view = model.presentation?.exterior;
  if (!view || view.kind === "interface") return undefined;
  return exteriorSources(page, model, view.kind).find(
    (source) => source.id === view.source,
  );
}
