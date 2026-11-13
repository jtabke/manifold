/** Local CSV evidence. Importing a table never creates computational bindings. */
import {
  calculate,
  evaluate,
  parse,
  quantityLiteral,
  same,
  type Expression,
  type Quantity,
} from "../notebook/math.ts";
import { canonicalUnit, scientificUnits } from "../notebook/scientific.ts";
export type CsvData = { name: string; csv: string };
const csvCache = new Map<string, { headers: string[]; rows: string[][] }>();
export function readCsv(data: CsvData) {
  if (
    !data ||
    typeof data.name !== "string" ||
    !data.name.trim() ||
    data.name.length > 160 ||
    typeof data.csv !== "string" ||
    data.csv.length > 1_000_000
  )
    throw Error("Use a named CSV under 1 MB.");
  const cached = csvCache.get(data.csv);
  if (cached) return cached;
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false;
  const text = data.csv.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (!quoted && cell.length) throw Error("Quote a whole CSV cell.");
      else {
        closed = quoted;
        quoted = !quoted;
      }
    } else if (!quoted && (c === "," || c === "\n")) {
      row.push(cell);
      cell = "";
      closed = false;
      if (c === "\n") {
        rows.push(row);
        row = [];
      }
    } else {
      if (closed && !quoted)
        throw Error("Unexpected text after a quoted CSV cell.");
      cell += c;
    }
  }
  if (quoted) throw Error("A CSV quote is not closed.");
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  while (rows.at(-1)?.every((v) => !v.trim())) rows.pop();
  const headers = rows.shift();
  if (
    !headers?.length ||
    headers.length > 12 ||
    !rows.length ||
    rows.length > 10000 ||
    rows.some((r) => r.length !== headers.length) ||
    headers.some((h) => !h.trim() || h.length > 100) ||
    new Set(headers).size !== headers.length
  )
    throw Error(
      "Use 1–12 distinct columns and 1–10,000 rows with matching column counts.",
    );
  const parsed = { headers, rows };
  rows.forEach(Object.freeze);
  Object.freeze(headers);
  Object.freeze(rows);
  Object.freeze(parsed);
  if (csvCache.size >= 4) csvCache.delete(csvCache.keys().next().value!);
  csvCache.set(data.csv, parsed);
  return parsed;
}
export const numericCell = (raw: string) =>
  raw.length <= 100 &&
  /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/.test(raw.trim()) &&
  Number.isFinite(Number(raw)) &&
  Math.abs(Number(raw)) <= 1e12;
export function csvQuantity(
  data: CsvData,
  row: number,
  column: number,
  name: string,
  unit: string,
) {
  const table = readCsv(data),
    raw = table.rows[row]?.[column];
  if (
    !Number.isInteger(row) ||
    !Number.isInteger(column) ||
    raw === undefined ||
    !numericCell(raw)
  )
    throw Error("Choose a numeric measurement cell.");
  if (
    !/^[A-Za-z_][A-Za-z_0-9]*$/.test(name) ||
    ["__proto__", "constructor", "prototype"].includes(name) ||
    unit.length > 80 ||
    /[\n:=<>]/.test(unit)
  )
    throw Error("Use a quantity name and supported units.");
  const text = measurementText(name, raw, unit);
  parse(text, undefined, 3);
  const result = calculate([{ id: "cell", text, x: 0, y: 0, mathVersion: 3 }]);
  if (result.errors.has("cell")) throw Error(result.errors.get("cell"));
  return { text, raw, unit: unit.trim() };
}

const unitError = () =>
  Error(
    "Use supported units, products, quotients and numeric powers; use °C only on its own.",
  );
const noReference = (): never => {
  throw unitError();
};
function prepareMeasurementUnit(unit: string) {
  if (unit.length > 80 || /[\n:=<>]/.test(unit)) throw unitError();
  // v2 can read unit names such as min without treating them as a bare v3
  // function. Only this strictly validated unit tree is admitted below.
  const expression = parse(
    `measurement_unit = ${unit.trim() || "1"}`,
    undefined,
    2,
  ).expression;
  return prepareUnitExpression(expression);
}
function prepareUnitExpression(expression: Expression) {
  if (
    (expression.kind === "name" || expression.kind === "unit") &&
    expression.name === "degC"
  )
    return {
      quantity: evaluate(
        {
          kind: "binary",
          op: "*",
          left: { kind: "number", value: 1 },
          right: expression,
        },
        noReference,
        2,
      ),
      suffix: "°C",
      tree: expression,
    };
  const exponent = (e: Expression): number => {
    if (e.kind === "number" && Number.isFinite(e.value)) return e.value;
    if (e.kind === "unary") return -exponent(e.expression);
    throw unitError();
  };
  const validate = (e: Expression): Expression => {
    if ((e.kind === "name" || e.kind === "unit") && scientificUnits.has(e.name))
      return { kind: "unit", name: e.name };
    if (e.kind === "number" && e.value === 1) return e;
    if (e.kind === "binary") {
      if (e.op === "*" || e.op === "/")
        return { ...e, left: validate(e.left), right: validate(e.right) };
      if (e.op === "^")
        return {
          ...e,
          left: validate(e.left),
          right: { kind: "number", value: exponent(e.right) },
        };
    }
    throw unitError();
  };
  const tree = validate(expression),
    quantity = evaluate(tree, noReference, 2);
  if (quantity.value <= 0) throw unitError();
  // Keep the suffix a unit-only tree so the existing parser marks all names as
  // units, including A and V. Reciprocal 1 becomes a negative unit power.
  const suffix = (e: Expression): string => {
    if (e.kind === "unit") return e.name;
    if (e.kind === "number") return "";
    if (e.kind !== "binary") throw unitError();
    const left = suffix(e.left);
    if (e.op === "^") return left ? `(${left})^(${exponent(e.right)})` : "";
    const right = suffix(e.right);
    if (!right) return left;
    if (!left) return e.op === "/" ? `(${right})^-1` : right;
    return `(${left}${e.op}${right})`;
  };
  return { quantity, suffix: suffix(tree), tree };
}

/** One validated unit conversion for scalar extraction and paired records. */
export function measurementUnit(unit: string): Quantity {
  return prepareMeasurementUnit(unit).quantity;
}

/** Numeric entry fields have a unit-only suffix, without worksheet bindings. */
export function parseLiteralQuantity(text: string): Quantity {
  const invalid = () =>
    Error("Enter a number with optional units, not a reference or function.");
  const expression = parse(`literal_value = ${text}`, undefined, 2).expression;
  const hasUnit = (e: Expression): boolean =>
    e.kind === "unit" ||
    e.kind === "name" ||
    (e.kind === "binary" && (hasUnit(e.left) || hasUnit(e.right)));
  const literal = (e: Expression): Expression => {
    if (e.kind === "number") return e;
    if (e.kind === "unary") return { ...e, expression: literal(e.expression) };
    if (e.kind === "binary" && (e.op === "*" || e.op === "/")) {
      if (
        !hasUnit(e.right) &&
        !(
          e.right.kind === "number" &&
          e.right.value === 1 &&
          hasUnit(expression)
        )
      )
        throw invalid();
      return {
        ...e,
        left: literal(e.left),
        right: prepareUnitExpression(e.right).tree,
      };
    }
    throw invalid();
  };
  return evaluate(literal(expression), noReference, 2);
}

function originalMeasurementBody(raw: string, unit: string) {
  const normalized = unit.trim().replace(/\bN\b/g, "(kg*m/s^2)");
  return `${Number(raw)}${normalized && normalized !== "1" ? ` ${normalized}` : ""}`;
}

function measurementValue(raw: string, one: Quantity) {
  const value = one.absolute
    ? Number(raw) + (one.value - 1)
    : Number(raw) * one.value;
  if (!Number.isFinite(value))
    throw Error("The measurement is not a finite real quantity.");
  return value;
}
function canonicalMeasurementBody(raw: string, one: Quantity) {
  const canonical = canonicalUnit(one.dimension),
    value = measurementValue(raw, one);
  return `${value}${canonical === "1" ? "" : ` (${canonical})`}`;
}

/** Unit aliases at the data adapter boundary; the arithmetic engine stays unchanged. */
export function measurementText(name: string, raw: string, unit: string) {
  if (
    !numericCell(raw) ||
    !/^[A-Za-z_][A-Za-z_0-9]*$/.test(name) ||
    ["__proto__", "constructor", "prototype"].includes(name) ||
    unit.length > 80 ||
    /[\n:=<>]/.test(unit)
  )
    throw Error(
      "Use a numeric measurement, quantity name and supported units.",
    );
  const prepared = prepareMeasurementUnit(unit),
    one = prepared.quantity,
    value = measurementValue(raw, one);
  const matches = (body: string) => {
    try {
      const expression = parse(
        `measurement_value = ${body}`,
        undefined,
        3,
      ).expression;
      if (!quantityLiteral(expression)) return false;
      const actual = evaluate(expression, noReference, 3);
      return (
        same(actual.dimension, one.dimension) &&
        !!actual.absolute === !!one.absolute &&
        Math.abs(actual.value - value) <=
          1e-12 * Math.max(Math.abs(actual.value), Math.abs(value))
      );
    } catch {
      return false;
    }
  };
  const original = originalMeasurementBody(raw, unit);
  if (matches(original)) return `${name} := ${original}`;
  const grouped = `${Number(raw)}${prepared.suffix ? ` (${prepared.suffix})` : ""}`;
  if (matches(grouped)) return `${name} := ${grouped}`;
  // Retain a finite literal even when the original suffix cannot be represented
  // directly, while preserving the original source unit separately.
  const fallback = canonicalMeasurementBody(raw, one);
  if (matches(fallback)) return `${name} := ${fallback}`;
  throw Error("These units cannot be represented as a finite measurement.");
}

/** Recognize imported source before and after unambiguous unit generation. */
export function matchesMeasurementText(
  text: string,
  name: string,
  raw: string,
  unit: string,
): boolean {
  const current = measurementText(name, raw, unit),
    one = measurementUnit(unit);
  return (
    text.trim() === current ||
    text.trim() === `${name} := ${originalMeasurementBody(raw, unit)}` ||
    (!one.absolute &&
      text.trim() === `${name} := ${canonicalMeasurementBody(raw, one)}`)
  );
}
