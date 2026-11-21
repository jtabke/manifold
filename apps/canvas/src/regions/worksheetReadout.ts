/** Read-only summaries for prose and watched results. Always read the requested
 * region in the supplied projection, never a last-known or similarly named value. */
import {
  display,
  relationGlyph,
  same,
  type Quantity,
} from "../notebook/math.ts";
import { ancestors, type Projection } from "./document.ts";

function summaryValue(q: Quantity) {
  // Readout units only: don't reserve L or change how old worksheet source parses.
  if (same(q.dimension, [0, 3, -1, 0]) && Number.isFinite(q.value * 1000))
    return `${Number((q.value * 1000).toPrecision(4))} L/s`;
  if (
    same(q.dimension, [1, -1, -2, 0]) &&
    Math.abs(q.value) >= 1000 &&
    Math.abs(q.value) < 1e6
  )
    return `${Number((q.value / 1000).toPrecision(6))} kPa`;
  return display(q);
}
export function worksheetReadout(p: Projection, id: string) {
  const s = p.statements.get(id);
  if (!s) return;
  const error = p.errors.get(id);
  if (s.relation !== "=") {
    const c = !error ? p.solved.constraints.get(id) : undefined;
    return {
      kind: "status" as const,
      name: s.name,
      label: c
        ? `${s.name} ${relationGlyph(s.relation)} ${summaryValue(c.bound)}`
        : p.texts[id],
      text: c ? (c.pass ? "met" : "not met") : "Unavailable",
      pass: c?.pass,
      available: !!c,
      detail: error ?? p.texts[id],
    };
  }
  const sources = p.sources[s.name],
    q =
      !error && sources?.length === 1 && sources[0] === id
        ? p.solved.values.get(s.name)
        : undefined;
  return {
    kind: "value" as const,
    name: s.anonymous ? "expression" : s.name,
    label: s.anonymous ? p.texts[id] : s.name,
    text: q ? summaryValue(q) : "Unavailable",
    available: !!q,
    detail: error ?? p.texts[id],
  };
}
export function isPreviewReading(p: Projection, id: string, input?: string) {
  return !!input && (input === id || ancestors(p, id).includes(input));
}
