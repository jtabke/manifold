/** View-local proposals: existing arithmetic, no writes or evaluation receipts. */
import { unitLabel, type Quantity } from "../notebook/math.ts";
import {
  project,
  semanticKey,
  ancestors,
  type Page,
  type Plot,
} from "./document.ts";
export type Exploration = {
  input: string;
  context: string;
  key: string;
  text: string;
  value: number;
};
export type VariationRange = { low: number; high: number; step: number };
export function variationRange(q: Quantity): VariationRange {
  const shown = q.absolute ? q.value - 273.15 : q.value;
  const step = Math.abs(shown) / 100 || 0.01;
  const span = Math.abs(shown) * 0.65 || 1;
  return { low: q.value - span, high: q.value + span, step };
}
/** Bounds constrain exploration only; they are not physical requirements. */
export function boundedValue(value: number, range: VariationRange): number {
  if (
    ![value, range.low, range.high, range.step].every(Number.isFinite) ||
    range.low >= range.high ||
    range.step <= 0
  )
    throw Error("Use a finite minimum below the maximum and a positive step.");
  return Math.max(range.low, Math.min(range.high, value));
}
export function proposeValue(
  page: Page,
  input: string,
  value: number,
): Exploration {
  const p = project(page),
    s = p.statements.get(input),
    q = s && p.solved.values.get(s.name);
  if (
    !s ||
    !q ||
    p.kinds[input] !== "quantity" ||
    p.errors.has(input) ||
    !Number.isFinite(value)
  )
    throw Error("Choose a resolved assigned quantity to explore.");
  const shown = q.absolute ? value - 273.15 : value;
  const text =
    value === q.value
      ? p.texts[input]
      : `${s.name} := ${Number(shown.toPrecision(7))} ${unitLabel(q)}`.trim();
  return { input, context: page.active, key: semanticKey(page), text, value };
}
/** Layout changes preserve proposals; scenario or semantic changes make them stale. */
export function isCurrentExploration(
  page: Page,
  proposal?: Exploration,
): proposal is Exploration {
  return (
    !!proposal &&
    proposal.context === page.active &&
    proposal.key === semanticKey(page)
  );
}
export function previewPage(page: Page, proposal?: Exploration): Page {
  if (!isCurrentExploration(page, proposal)) return page;
  return {
    ...page,
    contexts: page.contexts.map((c) =>
      c.id === proposal.context
        ? {
            ...c,
            overrides: { ...c.overrides, [proposal.input]: proposal.text },
          }
        : c,
    ),
  };
}
export function responseFor(
  page: Page,
  focus: string,
  symbol?: string,
): Plot | undefined {
  const p = project(page),
    source =
      symbol && p.sources[symbol]?.length === 1 ? p.sources[symbol][0] : focus;
  const input =
    p.kinds[source] === "quantity"
      ? source
      : ancestors(p, focus)
          .filter((id) => p.kinds[id] === "quantity")
          .sort((a, b) =>
            (p.statements.get(a)?.name || "").localeCompare(
              p.statements.get(b)?.name || "",
            ),
          )[0];
  const output =
    p.kinds[focus] === "equation" && ancestors(p, focus).includes(input)
      ? focus
      : page.regions.find(
          (r) =>
            p.kinds[r.id] === "equation" && ancestors(p, r.id).includes(input),
        )?.id;
  const s = p.statements.get(input),
    q = s && p.solved.values.get(s.name);
  if (!output || !input || !q || p.errors.has(input) || p.errors.has(output))
    return;
  const delta = Math.abs(q.absolute ? q.value - 273.15 : q.value) * 0.65 || 1;
  return {
    id: "contextual-response",
    input,
    output,
    low: q.value - delta,
    high: q.value + delta,
    width: 440,
    height: 120,
  };
}
