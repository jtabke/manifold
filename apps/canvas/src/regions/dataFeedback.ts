/** Presentation of existing row-wise results; no additional evaluation semantics. */
import { display, type Quantity } from "../notebook/math.ts";
import { project, type Page, type Point } from "./document.ts";
import { readCsv } from "./dataSources.ts";
import type { DatasetComputation, DataRecord } from "./datasetModel.ts";
import type { CanvasFrame } from "./selection.ts";
export type DataSelection = {
  dataset: string;
  rows: number[];
  columns: number[];
  kind?: "cell" | "record" | "series";
  relation?: string;
  view?: string;
  detail?: "calculation" | "requirement";
};
export const selectionKind = (s: DataSelection) =>
  s.kind ||
  (s.rows.length ? (s.columns.length === 1 ? "cell" : "record") : "series");
export function observationLabel(page: Page, dataset: string, row: number) {
  const data = page.regions.find((r) => r.id === dataset)?.data;
  if (!data) return `Row ${row + 1}`;
  const table = readCsv(data),
    fields = table.headers
      .map((h, i) => ({ h, value: table.rows[row]?.[i] }))
      .filter(
        ({ h, value }) =>
          value &&
          /^(?:id|sample|run|test|time|timestamp|condition)(?:\b|_)/i.test(h),
      );
  return `Row ${row + 1}${
    fields.length
      ? " · " +
        fields
          .slice(0, 2)
          .map((f) => f.value)
          .join(" · ")
      : ""
  }`;
}
export function recordFeedback(
  page: Page,
  relation: DatasetComputation,
  record: DataRecord,
) {
  const p = project(page),
    s = p.statements.get(relation.output)!;
  const rhs = s.raw
    .replace(/^[^=]*=\s*/, "")
    .replace(/\b[A-Za-z_][A-Za-z_0-9]*\b/g, (name) => {
      const q = record.inputs[name];
      return q
        ? Number(
            (q.absolute ? q.value - 273.15 : q.value).toPrecision(6),
          ).toString()
        : name;
    })
    .replaceAll("*", " × ");
  return {
    observation: observationLabel(page, relation.dataset, record.row),
    expression: `${s.name} = ${rhs} = ${display(record.value)}`,
    inputs: Object.entries(record.inputs).map(([name, value]) => {
      const binding = relation.bindings.find(
        (b) =>
          (b.quantity ? p.statements.get(b.quantity)?.name : b.symbol) === name,
      );
      const data = page.regions.find((r) => r.id === relation.dataset)?.data;
      const raw =
        data && binding
          ? readCsv(data).rows[record.row]?.[binding.column]
          : undefined;
      return {
        name,
        value:
          raw !== undefined && binding
            ? `${Number(raw)}${binding.unit && binding.unit !== "1" ? ` ${binding.unit}` : ""}`
            : display(value),
      };
    }),
    checks: Object.entries(record.limits).map(
      ([id, { bound, relation: comparison }]) => {
        const margin =
            comparison === "<="
              ? bound.value - record.value.value
              : record.value.value - bound.value,
          pass = record.conditions[id];
        const interval: Quantity = {
          ...record.value,
          value: Math.abs(margin),
          absolute: false,
        };
        return {
          id,
          pass,
          bound,
          comparison,
          text:
            margin === 0
              ? "At limit"
              : pass
                ? `${display(interval)} ${comparison === "<=" ? "below" : "above"} limit`
                : `${comparison === "<=" ? "Exceeds" : "Below"} limit by ${display(interval)}`,
        };
      },
    ),
  };
}
export function placeDataResult(
  anchor: CanvasFrame,
  frames: CanvasFrame[],
  viewportWidth: number,
): Point {
  const width = 550,
    height = 470,
    gap = 28;
  const clear = (p: Point) =>
    frames.every(
      (f) =>
        p.x + width + gap <= f.x ||
        p.x >= f.x + f.width + gap ||
        p.y + height + gap <= f.y ||
        p.y >= f.y + f.height + gap,
    );
  const below = {
    x: Math.max(24, anchor.x - 24),
    y: anchor.y + anchor.height + gap,
  };
  // Keep nearby content in place; only choose where the new presentation goes.
  for (const f of [...frames].sort((a, b) => a.y - b.y))
    if (
      below.x + width + gap > f.x &&
      below.x < f.x + f.width + gap &&
      below.y + height + gap > f.y &&
      below.y < f.y + f.height + gap
    )
      below.y = f.y + f.height + gap;
  // A narrow equation can sit above a wider dataset. Consider the edge of
  // that entire occupied column before sending the result below all the work.
  const columnRight = Math.max(
    anchor.x + anchor.width,
    ...frames
      .filter(
        (f) =>
          f.y < anchor.y + height + gap &&
          f.y + f.height > anchor.y - gap &&
          f.x < anchor.x + width,
      )
      .map((f) => f.x + f.width),
  );
  const candidates = [
    { x: anchor.x + anchor.width + gap, y: anchor.y },
    { x: columnRight + gap, y: anchor.y },
    { x: anchor.x - width - gap, y: anchor.y },
    below,
  ].filter((p) => p.x >= 24 && clear(p));
  const cost = (p: Point) =>
    Math.hypot(p.x - anchor.x, p.y - anchor.y) +
    Math.max(0, p.x + width - viewportWidth) * 4;
  return candidates.sort((a, b) => cost(a) - cost(b))[0] || below;
}
