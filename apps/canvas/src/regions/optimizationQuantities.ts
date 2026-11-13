/** Literal-only entry using the worksheet's trusted unit grammar, never model references. */
import { same } from "../notebook/math.ts";
import { measurementUnit, parseLiteralQuantity } from "./dataSources.ts";
function finite(value: number) {
  if (!Number.isFinite(value)) throw Error("Enter a finite real quantity.");
  return value;
}
function linearUnit(unit: string) {
  const scale = measurementUnit(unit);
  if (scale.absolute)
    throw Error(
      "Use temperature differences, not absolute Celsius temperatures.",
    );
  return scale;
}
export function optimizationQuantity(text: string, unit: string): number {
  const q = parseLiteralQuantity(text),
    scale = linearUnit(unit);
  if (q.absolute)
    throw Error(
      "Use temperature differences, not absolute Celsius temperatures.",
    );
  // A plain number is in the displayed unit. Explicit quantities must match dimensions.
  const bare = /^[+−-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+−-]?\d+)?$/i.test(
    text.trim(),
  );
  if (bare) return finite(Number(text.replaceAll("−", "-")));
  if (!same(q.dimension, scale.dimension))
    throw Error(`Use units compatible with ${unit}.`);
  return finite(q.value / scale.value);
}
export function optimizationConvert(
  value: number,
  from: string,
  to: string,
): number {
  const a = linearUnit(from),
    b = linearUnit(to);
  if (!same(a.dimension, b.dimension))
    throw Error(`Use units compatible with ${from}.`);
  return finite(finite(finite(value) * a.value) / b.value);
}
