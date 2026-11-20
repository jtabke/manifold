import {
  quantityLiteral,
  same,
  unitLabel,
  type Quantity,
  type Statement,
} from "../notebook/math.ts";
import { measurementUnit } from "./dataSources.ts";

/** Display units for an assigned worksheet input. Plot samples, limits and gestures stay in base units. */
export function worksheetInputUnit(
  statement: Statement | undefined,
  q: Quantity,
) {
  let label = unitLabel(q),
    scale = 1;
  const offset = q.absolute ? 273.15 : 0;
  let suffix =
    (statement?.mathVersion ?? 1) >= 2 && /[·*/]/.test(label)
      ? `(${label})`
      : label;
  // Keep only a checked literal suffix, never reinterpret a variable in a formula as a unit.
  const literal =
    statement &&
    quantityLiteral(statement.expression) &&
    statement.raw.match(
      /^\s*\w+\s*(?::=|=)\s*[+−-]?\s*(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\s*(.*?)\s*$/u,
    );
  if (literal && literal[1]) {
    const source = literal[1].trim();
    const unit = source.startsWith("/")
      ? `1${source}`
      : source.replace(/^[*·×]\s*/, "");
    try {
      const one = measurementUnit(unit);
      if (same(one.dimension, q.dimension) && !!one.absolute === !!q.absolute) {
        label = unit === "degC" ? "°C" : unit;
        scale = one.absolute ? 1 : one.value;
        suffix = source;
      }
    } catch {
      /* Arithmetic without a simple unit suffix uses its canonical unit. */
    }
  }
  const fromBase = (value: number) => (value - offset) / scale;
  return {
    label,
    suffix,
    scale,
    fromBase,
    toBase: (value: number) => value * scale + offset,
    format: (value: number) =>
      `${Number(fromBase(value).toPrecision(6))} ${label}`.trim(),
  };
}
