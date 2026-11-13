/** Literal-only entry using the worksheet's trusted unit grammar, never model references. */
import { parse, quantityLiteral, evaluate, same } from "../notebook/math.ts";
import { scientificQuantity } from "../notebook/scientific.ts";
export function optimizationQuantity(text: string, unit: string): number {
  const expression = parse(`value = ${text}`, undefined, 3).expression;
  if (!quantityLiteral(expression))
    throw Error(
      "Enter a number with optional units, not a reference or function.",
    );
  const q = evaluate(
    expression,
    () => {
      throw Error("References are not allowed.");
    },
    3,
  );
  // A plain number is in the displayed unit. Explicit quantities must match dimensions.
  const scale = scientificQuantity(1, unit);
  const bare = /^[+−-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+−-]?\d+)?$/i.test(
    text.trim(),
  );
  if (bare) return Number(text.replaceAll("−", "-"));
  if (!same(q.dimension, scale.dimension))
    throw Error(`Use units compatible with ${unit}.`);
  return q.value / scale.value;
}
export function optimizationConvert(
  value: number,
  from: string,
  to: string,
): number {
  const a = scientificQuantity(value, from),
    b = scientificQuantity(1, to);
  if (!same(a.dimension, b.dimension))
    throw Error(`Use units compatible with ${from}.`);
  return a.value / b.value;
}
