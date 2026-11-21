/** One step of worksheet dataflow in the active projection. The renderer expands
 * each binding to its actual authored occurrences; neither layer creates links. */
import {
  quantityLiteral,
  references,
  type Quantity,
} from "../notebook/math.ts";
import type { Page, Projection } from "./document.ts";

export type TracePort = {
  id: string;
  name: string;
  value: Quantity;
  editable: boolean;
};
export type TraceRow = {
  definition?: TracePort;
  active?: string;
  terms: Record<string, TracePort>;
};
export type TraceRequest = {
  root: string;
  context: string;
  source?: string;
  /** Opening from a term keeps that exact name, even if its binding is broken. */
  symbol?: string;
  uses?: boolean;
  values: boolean;
};
export function worksheetTrace(
  page: Page,
  p: Projection,
  request: TraceRequest,
) {
  const root = request.root,
    statement = p.statements.get(root);
  if (page.active !== request.context || !statement) return;
  const ports = new Map<string, TracePort>();
  function port(id: string | undefined) {
    if (!id) return;
    const cached = ports.get(id);
    if (cached) return cached;
    const s = p.statements.get(id);
    if (
      !s ||
      s.relation !== "=" ||
      p.errors.has(id) ||
      p.sources[s.name]?.length !== 1 ||
      p.sources[s.name][0] !== id
    )
      return;
    const value = p.solved.values.get(s.name);
    if (!value) return;
    const result = {
      id,
      name: s.name,
      value,
      editable:
        p.kinds[id] === "quantity" &&
        quantityLiteral(s.expression) &&
        !page.regions.find((r) => r.id === id)?.source,
    };
    ports.set(id, result);
    return result;
  }
  const rows = new Map<string, TraceRow>();
  function row(id: string) {
    let r = rows.get(id);
    if (!r) {
      r = { terms: Object.create(null) };
      rows.set(id, r);
    }
    return r;
  }
  const inputs: TracePort[] = [],
    missing: string[] = [],
    edges: { from: TracePort; to: string }[] = [];
  const link = (from: TracePort, to: string) => {
    row(to).active = from.id;
    row(to).terms[from.name] = from;
    edges.push({ from, to });
  };
  for (const name of new Set([
    ...references(statement.expression),
    ...(statement.relation === "=" ? [] : [statement.name]),
  ])) {
    const source = port(p.bindings[root]?.[name]);
    if (source?.name === name) inputs.push(source);
    else missing.push(name);
  }
  const own = port(root);
  const rootRow = row(root);
  for (const input of inputs) rootRow.terms[input.name] = input;
  const source =
    request.source === root
      ? own
      : request.source !== undefined
        ? inputs.find((input) => input.id === request.source)
        : request.symbol !== undefined
          ? (inputs.find((input) => input.name === request.symbol) ??
            (own?.name === request.symbol ? own : undefined))
          : (inputs[0] ?? own);
  const uses = !!source && (source.id === root || !!request.uses);
  if (source) {
    row(source.id).definition = source;
    if (uses) {
      for (const [to, bindings] of Object.entries(p.bindings))
        if (bindings[source.name] === source.id) link(source, to);
    } else link(source, root);
  }
  return {
    root,
    values: request.values,
    uses,
    name: statement.anonymous ? "expression" : statement.name,
    source,
    inputs,
    missing,
    own,
    rows,
    edges,
    error: p.errors.get(root),
  };
}
export type WorksheetTrace = NonNullable<ReturnType<typeof worksheetTrace>>;
