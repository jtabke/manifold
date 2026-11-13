/** Trusted Math.js operations only. No expression parser, mutable imports or library objects in documents. */
import {
  create,
  unitDependencies,
  addDependencies,
  subtractDependencies,
  multiplyDependencies,
  divideDependencies,
  powDependencies,
  sqrtDependencies,
  absDependencies,
  sinDependencies,
  cosDependencies,
  tanDependencies,
  expDependencies,
  logDependencies,
  log10Dependencies,
  minDependencies,
  maxDependencies,
  atan2Dependencies,
  asinDependencies,
  acosDependencies,
  atanDependencies,
  sinhDependencies,
  coshDependencies,
  tanhDependencies,
  floorDependencies,
  ceilDependencies,
  roundDependencies,
  cbrtDependencies,
  isUnit,
  type Unit,
} from "mathjs";
import type { Dimension, Quantity } from "./math.ts";
const math = create(
  {
    unitDependencies,
    addDependencies,
    subtractDependencies,
    multiplyDependencies,
    divideDependencies,
    powDependencies,
    sqrtDependencies,
    absDependencies,
    sinDependencies,
    cosDependencies,
    tanDependencies,
    expDependencies,
    logDependencies,
    log10Dependencies,
    minDependencies,
    maxDependencies,
    atan2Dependencies,
    asinDependencies,
    acosDependencies,
    atanDependencies,
    sinhDependencies,
    coshDependencies,
    tanhDependencies,
    floorDependencies,
    ceilDependencies,
    roundDependencies,
    cbrtDependencies,
  },
  { number: "number", predictable: true, matrix: "Array" },
);

/** First four entries preserve the historical plain-data quantity contract; trailing zeros are omitted. */
const bases = ["kg", "m", "s", "K", "A", "mol", "cd", "rad"] as const;
const indices = bases.map((name) =>
  math.unit(1, name).dimensions.findIndex((n) => n === 1),
);
export const scientificUnits = new Set([
  "W",
  "kW",
  "N",
  "J",
  "Pa",
  "MPa",
  "GPa",
  "Wh",
  "m",
  "cm",
  "mm",
  "s",
  "kg",
  "K",
  "rad",
  "deg",
  "in",
  "ft",
  "lbf",
  "Hz",
  "ms",
  "min",
  "h",
  "g",
  "A",
  "V",
  "ohm",
  "mol",
  "cd",
]);
export const scientificFunctions: Readonly<
  Record<string, readonly [number, number]>
> = Object.freeze({
  sqrt: [1, 1],
  abs: [1, 1],
  sin: [1, 1],
  cos: [1, 1],
  tan: [1, 1],
  exp: [1, 1],
  ln: [1, 1],
  log10: [1, 1],
  min: [2, 16],
  max: [2, 16],
  atan2: [2, 2],
});
export const v3ScalarFunctions = Object.freeze({
  asin: true,
  acos: true,
  atan: true,
  sinh: true,
  cosh: true,
  tanh: true,
  floor: true,
  ceil: true,
  round: true,
  cbrt: true,
});

export const scientificConstants: Readonly<Record<string, number>> =
  Object.freeze({ pi: Math.PI, e: Math.E });
export function canonicalUnit(dimension: Dimension): string {
  return (
    bases
      .map((name, i) => {
        const exponent = dimension[i] || 0;
        return exponent === 0
          ? ""
          : exponent === 1
            ? name
            : `${name}^${exponent}`;
      })
      .filter(Boolean)
      .join("*") || "1"
  );
}
function finite(n: number) {
  if (!Number.isFinite(n))
    throw Error("The result is not a finite real number.");
  return n;
}
function plain(value: unknown): Quantity {
  if (typeof value === "number")
    return { value: finite(value), dimension: [0, 0, 0, 0] };
  if (!isUnit(value))
    throw Error("Only finite real scalar results are supported.");
  if (
    value.dimensions.some(
      (n, i) => !Number.isFinite(n) || (n !== 0 && !indices.includes(i)),
    )
  )
    throw Error("This unit dimension is not supported.");
  const dimension = indices.map((i) => value.dimensions[i]);
  while (dimension.length > 4 && dimension.at(-1) === 0) dimension.pop();
  return {
    value: finite(value.value),
    dimension: dimension as unknown as Dimension,
  };
}
function operand(q: Quantity): number | Unit {
  const unit = canonicalUnit(q.dimension);
  return unit === "1" ? q.value : math.unit(q.value, unit);
}
export function scientificUnit(name: string): Quantity {
  if (!scientificUnits.has(name)) throw Error("Unsupported engineering unit.");
  return plain(math.unit(1, name));
}
/** Drawing-only unit lookup; does not extend the persisted worksheet unit namespace. */
export function scientificLengthUnit(name: string): number {
  if (!/^[A-Za-zµμ]{1,24}$/.test(name))
    throw Error("Enter a supported length unit name.");
  const q = plain(math.unit(1, name));
  if (q.dimension.some((n, i) => n !== (i === 1 ? 1 : 0)))
    throw Error("Choose a length unit, not an angle, mass or other dimension.");
  return q.value;
}
export function scientificQuantity(value: number, unit: string): Quantity {
  if (unit === "1") return plain(value);
  if (
    unit.length > 80 ||
    [...unit.matchAll(/[A-Za-z_][A-Za-z_0-9]*/g)].some(
      ([name]) => !scientificUnits.has(name),
    )
  )
    throw Error("Unsupported engineering unit.");
  return plain(math.unit(value, unit));
}
export function scientificBinary(
  op: string,
  a: Quantity,
  b: Quantity,
): Quantity {
  const left = operand(a),
    right = operand(b);
  if (op === "+") return plain(math.add(left, right));
  if (op === "-") return plain(math.subtract(left, right));
  if (op === "*") return plain(math.multiply(left, right));
  if (op === "/") {
    if (b.value === 0) throw Error("Division by zero.");
    return plain(math.divide(left, right));
  }
  if (op === "^") {
    if (b.dimension.some((n) => n !== 0) || Math.abs(b.value) > 12)
      throw Error("Powers need a dimensionless exponent from −12 to 12.");
    return plain(math.pow(left, b.value));
  }
  throw Error("Unsupported arithmetic operation.");
}
export function scientificScalarCall(
  name: keyof typeof v3ScalarFunctions,
  argument: Quantity,
): Quantity {
  if (!Object.hasOwn(v3ScalarFunctions, name))
    throw Error("Unsupported scalar function.");
  if (argument.absolute)
    throw Error(
      "Use temperature differences in functions, not absolute Celsius temperatures.",
    );
  finite(argument.value);
  if (name === "cbrt") return plain(math.cbrt(operand(argument)));
  if (argument.dimension.some((n) => n !== 0))
    throw Error(`${name} needs a dimensionless argument.`);
  const n = argument.value;
  if ((name === "asin" || name === "acos") && (n < -1 || n > 1))
    throw Error(`${name} needs an argument from −1 to 1.`);
  const call = math[name] as unknown as (value: number) => unknown;
  const result = plain(call(n));
  return name === "asin" || name === "acos" || name === "atan"
    ? plain(math.unit(result.value, "rad"))
    : result;
}

export function scientificCall(
  name: string,
  args: readonly Quantity[],
  version: 2 | 3 = 2,
): Quantity {
  const functions = functionsForVersion(version);
  const arity = functions[name];
  if (
    !Object.hasOwn(functions, name) ||
    args.length < arity[0] ||
    args.length > arity[1]
  )
    throw Error(
      `Use ${arity?.[0] === arity?.[1] ? arity?.[0] : "2–16"} arguments for ${name}.`,
    );
  if (version === 3 && Object.hasOwn(v3ScalarFunctions, name))
    return scientificScalarCall(
      name as keyof typeof v3ScalarFunctions,
      args[0],
    );
  if (args.some((q) => q.absolute))
    throw Error(
      "Use temperature differences in functions, not absolute Celsius temperatures.",
    );
  const bare = (q: Quantity) => {
    if (q.dimension.some((n) => n !== 0))
      throw Error(`${name} needs a dimensionless argument.`);
    return q.value;
  };
  if (name === "ln" || name === "log10") {
    const n = bare(args[0]);
    if (n <= 0) throw Error(`${name} needs a positive argument.`);
    return plain(name === "ln" ? math.log(n) : math.log10(n));
  }
  if (name === "exp") return plain(math.exp(bare(args[0])));
  if (name === "atan2") {
    const [a, b] = args;
    if (
      !indices.every((_, i) => (a.dimension[i] || 0) === (b.dimension[i] || 0))
    )
      throw Error("atan2 needs arguments with compatible units.");
    if (a.value === 0 && b.value === 0)
      throw Error("atan2 is undefined when both arguments are zero.");
    return plain(math.unit(math.atan2(a.value, b.value), "rad"));
  }
  const call = math[name as "sqrt"] as unknown as (
    ...values: (number | Unit)[]
  ) => unknown;
  return plain(call(...args.map(operand)));
}

/** v2 remains frozen: names added in v3 must not rebind saved juxtaposition. */
const v3Functions = Object.freeze({
  ...scientificFunctions,
  ...Object.fromEntries(
    Object.keys(v3ScalarFunctions).map((name) => [name, [1, 1] as const]),
  ),
});
export const functionsForVersion = (
  version: number,
): typeof scientificFunctions =>
  version >= 3 ? v3Functions : scientificFunctions;
