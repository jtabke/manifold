import { immutable, readMap } from "./immutable.ts";
import {
  scientificBinary,
  scientificCall,
  scientificUnit,
  scientificFunctions,
  scientificConstants,
} from "./scientific.ts";
import { parseScientific } from "./scientificParser.ts";
export type MathVersion = 1 | 2;
export type MathSource = { id: string; text: string; mathVersion?: 2 };
export const mathSource = ({
  id,
  text,
  mathVersion,
}: MathSource): MathSource => ({
  id,
  text,
  ...(mathVersion === 2 ? { mathVersion } : {}),
});
const work = { parses: 0, expressions: 0, assignments: 0, constraints: 0 };
export function evaluationWork() {
  return { ...work };
}
export function resetEvaluationWork() {
  for (const key of Object.keys(work) as (keyof typeof work)[]) work[key] = 0;
}
/** Bounded arithmetic worksheet, not a symbolic algebra engine. No dynamic code execution. */
export type Dimension = readonly [number, number, number, number, ...number[]]; // kg, m, s, K, A, mol, cd, rad
export type Quantity = Readonly<{
  value: number;
  dimension: Dimension;
  absolute?: boolean;
}>;
export type Expression = Readonly<
  | { kind: "number"; value: number }
  | { kind: "name"; name: string }
  | { kind: "unit"; name: string }
  | { kind: "constant"; name: string }
  | { kind: "call"; name: string; args: readonly Expression[] }
  | { kind: "unary"; expression: Expression }
  | { kind: "binary"; op: string; left: Expression; right: Expression }
>;
export type Statement = Readonly<{
  name: string;
  expression: Expression;
  raw: string;
  relation: "=" | "<=" | ">=" | "<" | ">";
  anonymous?: boolean;
  mathVersion?: 2;
}>;
const scalar: Dimension = [0, 0, 0, 0];
const temperature: Dimension = [0, 0, 0, 1];
const units: Record<string, Quantity> = {
  W: { value: 1, dimension: [1, 2, -3, 0] },
  kW: { value: 1000, dimension: [1, 2, -3, 0] },
  N: { value: 1, dimension: [1, 1, -2, 0] },
  J: { value: 1, dimension: [1, 2, -2, 0] },
  Pa: { value: 1, dimension: [1, -1, -2, 0] },
  MPa: { value: 1e6, dimension: [1, -1, -2, 0] },
  GPa: { value: 1e9, dimension: [1, -1, -2, 0] },
  Wh: { value: 3600, dimension: [1, 2, -2, 0] },
  m: { value: 1, dimension: [0, 1, 0, 0] },
  cm: { value: 0.01, dimension: [0, 1, 0, 0] },
  mm: { value: 0.001, dimension: [0, 1, 0, 0] },
  s: { value: 1, dimension: [0, 0, 1, 0] },
  kg: { value: 1, dimension: [1, 0, 0, 0] },
  K: { value: 1, dimension: temperature },
};
immutable(units);
immutable(scalar);
const mapDimension = (
  d: Dimension,
  map: (value: number, index: number) => number,
): Dimension => [map(d[0], 0), map(d[1], 1), map(d[2], 2), map(d[3], 3)];
export const same = (a: Dimension, b: Dimension) =>
  Array.from({ length: Math.max(a.length, b.length) }, (_, i) => i).every(
    (i) => Math.abs((a[i] ?? 0) - (b[i] ?? 0)) < 1e-12,
  );
/** Recognize worksheet expressions without interpreting ordinary prose as math.
 * A trailing equals sign requests evaluation; a named, unfinished x = stays a draft. */
export function expressionBody(
  text: string,
  mathVersion: MathVersion = 2,
): string | undefined {
  const value = text.trim();
  if (/^[A-Za-z_][A-Za-z_0-9]*\s*(?::=|<=|>=|<|>|=|≤|≥)/.test(value)) return;
  const explicit = value.endsWith("="),
    body = (explicit ? value.slice(0, -1) : value).trim();
  if (!body || /[=:<>≤≥]/.test(body)) return;
  if (explicit) return body;
  if (
    mathVersion === 2 &&
    new RegExp(
      `^(?:${Object.keys(scientificFunctions).join("|")})\\s*\\(`,
    ).test(body)
  )
    return body;
  if (!/^[\d.(+\-−]/.test(body)) return;
  if (!/^[A-Za-z_0-9\s.+*/^×·()−-]+$/.test(body)) return;
  // Adjacent prose words are not an implicit product. A trailing '=' can still
  // explicitly request mathematical interpretation of an ambiguous expression.
  for (const pair of body.matchAll(
    /([A-Za-z_][A-Za-z_0-9]*)\s+([A-Za-z_][A-Za-z_0-9]*)/g,
  ))
    if (![pair[1], pair[2]].every((name) => Object.hasOwn(units, name))) return;
  if (/[+*/^×·()−-]/.test(body)) return body;
  try {
    if (
      quantityLiteral(
        (mathVersion === 2 ? parseScientific : parseNamed)(`value = ${body}`)
          .expression,
      )
    )
      return body;
  } catch {
    /* Unmarked prose remains a thought. */
  }
}
export function parse(
  text: string,
  expressionId?: string,
  mathVersion: MathVersion = 1,
): Statement {
  work.parses++;
  const named = mathVersion === 2 ? parseScientific : parseNamed;
  const body = expressionBody(text, mathVersion);
  if (body !== undefined && expressionId !== undefined) {
    // Stable private identities allow several anonymous results to coexist.
    const name = `__expr_${Array.from(expressionId)
      .map((c) => c.codePointAt(0)!.toString(16))
      .join("_")}`;
    return { ...named(`${name} = ${body}`), raw: text, anonymous: true };
  }
  const statement = named(text);
  if (statement.name.startsWith("__expr_"))
    throw Error("That name is reserved for an unnamed expression.");
  return statement;
}
function parseNamed(text: string): Statement {
  const raw = text
    .trim()
    .replaceAll("≤", "<=")
    .replaceAll("≥", ">=")
    .replaceAll(":=", "=")
    .replaceAll("²", "^2")
    .replaceAll("³", "^3")
    .replaceAll("×", "*")
    .replaceAll("·", "*")
    .replaceAll("−", "-")
    .replaceAll("°C", "degC");
  if (raw.length > 1200)
    throw Error("Keep each calculation under 1,200 characters.");
  const statement = raw.match(
    /^([A-Za-z_][A-Za-z_0-9]*)\s*(<=|>=|<|>|=)\s*(.+)$/,
  );
  if (!statement)
    throw Error("Write a named equation, for example Q := 800 W.");
  const [, name, relation, body] = statement;
  if (name in units || name === "degC")
    throw Error(`${name} is reserved for a unit.`);
  const tokens: string[] = [];
  const pattern =
    /\s*(?:(\d*\.\d+|\d+(?:\.\d*)?)(?:[eE]([+-]?\d+))?|([A-Za-z_][A-Za-z_0-9]*)|([()+\-*/^]))/gy;
  let cursor = 0;
  while (cursor < body.length) {
    pattern.lastIndex = cursor;
    const match = pattern.exec(body);
    if (!match)
      throw Error(
        `Unrecognized notation near “${body.slice(cursor, cursor + 12)}”. Use + − * / ^ and parentheses.`,
      );
    tokens.push(
      match[1]
        ? match[1] + (match[2] ? "e" + match[2] : "")
        : match[3] || match[4],
    );
    cursor = pattern.lastIndex;
  }
  let i = 0;
  const primary = (): Expression => {
    const token = tokens[i++];
    if (token === "-") return { kind: "unary", expression: power() };
    if (token === "+") return primary();
    if (token === "(") {
      const value = sum();
      if (tokens[i++] !== ")") throw Error("A closing parenthesis is missing.");
      return value;
    }
    if (token && /^\d|^\./.test(token))
      return { kind: "number", value: Number(token) };
    if (token && /^[A-Za-z_]/.test(token)) return { kind: "name", name: token };
    throw Error("Expected a number, variable, or parenthesis.");
  };
  const power = (): Expression => {
    let left = primary();
    if (tokens[i] === "^") {
      i++;
      left = { kind: "binary", op: "^", left, right: power() };
    }
    return left;
  };
  const product = (): Expression => {
    let left = power();
    while (i < tokens.length) {
      let op = tokens[i];
      if (op === "*" || op === "/") i++;
      else if (op === "(" || /^[A-Za-z_\d.]/.test(op)) op = "*";
      else break;
      left = { kind: "binary", op, left, right: power() };
    }
    return left;
  };
  const sum = (): Expression => {
    let left = product();
    while (tokens[i] === "+" || tokens[i] === "-") {
      const op = tokens[i++];
      left = { kind: "binary", op, left, right: product() };
    }
    return left;
  };
  const expression = sum();
  if (i !== tokens.length)
    throw Error("Unexpected notation after the expression.");
  return {
    name,
    relation: relation as Statement["relation"],
    expression,
    raw: text,
  };
}
export function evaluate(
  expression: Expression,
  resolve: (name: string) => Quantity,
  mathVersion: MathVersion = 1,
): Quantity {
  work.expressions++;
  const child = (e: Expression) => evaluate(e, resolve, mathVersion);
  if (expression.kind === "unit") {
    if (mathVersion !== 2 || expression.name === "degC")
      throw Error("Write an absolute temperature as a number followed by °C.");
    return scientificUnit(expression.name);
  }
  if (expression.kind === "constant") {
    if (
      mathVersion !== 2 ||
      !Object.hasOwn(scientificConstants, expression.name)
    )
      throw Error("Unsupported scientific constant.");
    return { value: scientificConstants[expression.name], dimension: scalar };
  }
  if (expression.kind === "call") {
    if (mathVersion !== 2)
      throw Error("Scientific functions require mathematics version 2.");
    return scientificCall(expression.name, expression.args.map(child));
  }
  if (expression.kind === "number") {
    if (!Number.isFinite(expression.value))
      throw Error("The number is not finite.");
    return { value: expression.value, dimension: scalar };
  }
  if (expression.kind === "name") {
    if (expression.name === "degC")
      throw Error("Write an absolute temperature as a number followed by °C.");
    const quantity = Object.hasOwn(units, expression.name)
      ? mathVersion === 2
        ? scientificUnit(expression.name)
        : units[expression.name]
      : resolve(expression.name);
    if (mathVersion === 1 && quantity.dimension.slice(4).some((n) => n !== 0))
      throw Error(
        "Enable scientific math for this equation to use angles or additional SI dimensions.",
      );
    return quantity;
  }
  if (expression.kind === "unary") {
    const q = child(expression.expression);
    if (q.absolute) throw Error("Negate the Celsius number before its unit.");
    return { ...q, value: -q.value };
  }
  const { left, right, op } = expression;
  if (
    op === "*" &&
    (right.kind === "name" || right.kind === "unit") &&
    right.name === "degC"
  ) {
    const n = child(left);
    if (!same(n.dimension, scalar) || n.absolute)
      throw Error("°C needs a plain numeric value.");
    return { value: n.value + 273.15, dimension: temperature, absolute: true };
  }
  const a = child(left),
    b = child(right);
  let result: Quantity;
  if (op === "+" || op === "-") {
    if (!same(a.dimension, b.dimension))
      throw Error("Units do not match across addition or subtraction.");
    if (op === "+" && a.absolute && b.absolute)
      throw Error(
        "Adding two absolute Celsius temperatures is undefined. Use a temperature difference in K.",
      );
    if (op === "-" && !a.absolute && b.absolute)
      throw Error(
        "Subtract an absolute temperature from another absolute temperature.",
      );
    result = {
      value:
        mathVersion === 2
          ? scientificBinary(op, a, b).value
          : op === "+"
            ? a.value + b.value
            : a.value - b.value,
      dimension: a.dimension,
      absolute:
        op === "+" ? a.absolute || b.absolute : a.absolute && !b.absolute,
    };
  } else {
    if (a.absolute || b.absolute)
      throw Error(
        "Use temperature differences in K in products and quotients.",
      );
    if (mathVersion === 2) return scientificBinary(op, a, b);
    if (op === "^") {
      if (
        !same(b.dimension, scalar) ||
        !Number.isInteger(b.value * 2) ||
        !a.dimension.every((d) => Number.isInteger(d * b.value)) ||
        Math.abs(b.value) > 12
      )
        throw Error(
          "Powers must be dimensionless integers or half-integers from −12 to 12, with whole resulting unit dimensions.",
        );
      result = {
        value: a.value ** b.value,
        dimension: mapDimension(a.dimension, (d) => d * b.value),
      };
    } else {
      if (op === "/" && b.value === 0) throw Error("Division by zero.");
      result = {
        value: op === "*" ? a.value * b.value : a.value / b.value,
        dimension: mapDimension(
          a.dimension,
          (d, i) => d + (op === "*" ? b.dimension[i] : -b.dimension[i]),
        ),
      };
    }
  }
  if (!Number.isFinite(result.value)) throw Error("The result is not finite.");
  return result;
}
export type Calculation = {
  id: string;
  text: string;
  x: number;
  y: number;
  mathVersion?: 2;
};
/** Display assignments quietly; show the result of actual arithmetic, even
 * when it has no variable references (e.g. answer = 2 + 3). */
export function quantityLiteral(expression: Expression): boolean {
  const number = (e: Expression): boolean =>
    e.kind === "number" || (e.kind === "unary" && number(e.expression));
  const unit = (e: Expression): boolean =>
    e.kind === "unit" ||
    (e.kind === "name" &&
      (Object.hasOwn(units, e.name) || e.name === "degC")) ||
    (e.kind === "binary" &&
      (e.op === "^"
        ? unit(e.left) && number(e.right)
        : ["*", "/"].includes(e.op) && unit(e.left) && unit(e.right)));
  if (number(expression)) return true;
  if (expression.kind === "unary")
    return quantityLiteral(expression.expression);
  return (
    expression.kind === "binary" &&
    ["*", "/"].includes(expression.op) &&
    quantityLiteral(expression.left) &&
    unit(expression.right)
  );
}
export type Solved = Readonly<{
  statements: ReadonlyMap<string, Statement>;
  values: ReadonlyMap<string, Quantity>;
  errors: ReadonlyMap<string, string>;
  constraints: ReadonlyMap<
    string,
    Readonly<{ pass: boolean; bound: Quantity; statement: Statement }>
  >;
}>;
export type PreparedCalculation = Readonly<{
  id: string;
  text: string;
  statement?: Statement;
  error?: string;
  dependencies: readonly string[];
}>;
export function prepareCalculation(
  id: string,
  text: string,
  mathVersion: MathVersion = 1,
): PreparedCalculation {
  try {
    const statement = parse(text, id, mathVersion);
    return immutable({
      id,
      text,
      statement,
      dependencies: [
        ...new Set([
          ...references(statement.expression),
          ...(statement.relation === "=" ? [] : [statement.name]),
        ]),
      ],
    });
  } catch (error) {
    return immutable({
      id,
      text,
      error: (error as Error).message,
      dependencies: [],
    });
  }
}
export type CalculationState = Readonly<{
  rows: readonly PreparedCalculation[];
  overrides: Readonly<Record<string, Quantity>>;
  users: ReadonlyMap<string, readonly string[]>;
  solved: Solved;
}>;
const equalQuantity = (a?: Quantity, b?: Quantity) =>
  a === b ||
  (!!a &&
    !!b &&
    Object.is(a.value, b.value) &&
    a.absolute === b.absolute &&
    same(a.dimension, b.dimension));
/** One evaluator for cold calculations, incremental projections and sampled overrides. */
export function solvePrepared(
  rows: readonly PreparedCalculation[],
  overrides: Readonly<Record<string, Quantity>> = {},
  before?: CalculationState,
): CalculationState {
  const statements = new Map<string, Statement>(),
    byName = new Map<string, string>(),
    errors = new Map<string, string>(),
    users = new Map<string, string[]>();
  for (const row of rows) {
    const s = row.statement;
    if (!s) {
      errors.set(row.id, row.error!);
      continue;
    }
    statements.set(row.id, s);
    if (s.relation === "=") {
      if (byName.has(s.name)) {
        errors.set(row.id, `${s.name} is already defined.`);
        errors.set(byName.get(s.name)!, `${s.name} is defined twice.`);
      } else byName.set(s.name, row.id);
    }
    for (const name of row.dependencies) {
      const list = users.get(name) || [];
      list.push(row.id);
      users.set(name, list);
    }
  }
  // Error paths and reordered definitions use a full pass to retain deterministic diagnostics.
  const reuse =
    before &&
    !before.solved.errors.size &&
    !errors.size &&
    rows.length === before.rows.length &&
    rows.every((r, i) => r.id === before.rows[i].id);
  const dirty = new Set<string>(),
    pending: string[] = [];
  if (reuse) {
    for (let i = 0; i < rows.length; i++)
      if (rows[i] !== before.rows[i]) {
        dirty.add(rows[i].id);
        for (const row of [rows[i], before.rows[i]])
          if (row.statement?.relation === "=") pending.push(row.statement.name);
      }
    for (const name of new Set([
      ...Object.keys(overrides),
      ...Object.keys(before.overrides),
    ]))
      if (!equalQuantity(overrides[name], before.overrides[name])) {
        pending.push(name);
        const id = byName.get(name);
        if (id) dirty.add(id);
      }
    const visited = new Set<string>();
    for (let i = 0; i < pending.length; i++) {
      const name = pending[i];
      if (visited.has(name)) continue;
      visited.add(name);
      for (const id of new Set([
        ...(users.get(name) || []),
        ...(before.users.get(name) || []),
      ])) {
        if (dirty.has(id)) continue;
        dirty.add(id);
        const s = statements.get(id);
        if (s?.relation === "=") pending.push(s.name);
      }
    }
  }
  const values = new Map<string, Quantity>(),
    constraints = new Map<
      string,
      Readonly<{ pass: boolean; bound: Quantity; statement: Statement }>
    >(),
    visiting = new Set<string>();
  const resolve = (name: string): Quantity => {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (values.has(name)) return values.get(name)!;
    const id = byName.get(name);
    if (!id) throw Error(`Define ${name} with a value and units.`);
    if (errors.has(id)) throw Error(errors.get(id));
    if (visiting.has(name))
      throw Error(`Circular dependency involving ${name}.`);
    const cached = reuse && !dirty.has(id) && before.solved.values.get(name);
    if (cached) {
      values.set(name, cached);
      return cached;
    }
    visiting.add(name);
    try {
      work.assignments++;
      const value = immutable(
        evaluate(
          statements.get(id)!.expression,
          resolve,
          statements.get(id)!.mathVersion ?? 1,
        ),
      );
      values.set(name, value);
      return value;
    } finally {
      visiting.delete(name);
    }
  };
  for (const [id, s] of statements) {
    if (errors.has(id)) continue;
    try {
      if (s.relation === "=") resolve(s.name);
      else {
        const cached =
          reuse && !dirty.has(id) && before.solved.constraints.get(id);
        if (cached) {
          constraints.set(id, cached);
          continue;
        }
        work.constraints++;
        const actual = resolve(s.name),
          bound = immutable(
            evaluate(s.expression, resolve, s.mathVersion ?? 1),
          );
        if (!same(actual.dimension, bound.dimension))
          throw Error(
            `The result ${s.name} has units ${unitLabel(actual) || "1"}, but its limit has units ${unitLabel(bound) || "1"}. Check the units of ${s.name} and its inputs.`,
          );
        if (!!actual.absolute !== !!bound.absolute)
          throw Error(
            `The result ${s.name} and its limit mix absolute temperature and a temperature difference. Use matching temperature conventions.`,
          );
        constraints.set(
          id,
          immutable({
            pass: passes(s.relation, actual.value, bound.value),
            bound,
            statement: s,
          }),
        );
      }
    } catch (error) {
      errors.set(id, (error as Error).message);
    }
  }
  return Object.freeze({
    rows: Object.freeze([...rows]),
    overrides: immutable(
      Object.fromEntries(
        Object.entries(overrides).map(([name, value]) => [
          name,
          { ...value, dimension: [...value.dimension] as Dimension },
        ]),
      ),
    ),
    users: readMap(
      [...users].map(([name, ids]) => [name, Object.freeze(ids)] as const),
    ),
    solved: Object.freeze({
      statements: readMap(statements),
      values: readMap(values),
      errors: readMap(errors),
      constraints: readMap(constraints),
    }),
  });
}
export function calculate(
  regions: readonly Calculation[],
  overrides: Readonly<Record<string, Quantity>> = {},
): Solved {
  return solvePrepared(
    regions.map((r) => prepareCalculation(r.id, r.text, r.mathVersion ?? 1)),
    overrides,
  ).solved;
}
export function unitLabel(q: Quantity): string {
  if (q.absolute) return "°C";
  const match = Object.entries(units).find(
    ([, u]) => u.value === 1 && same(q.dimension, u.dimension),
  );
  if (match) return match[0];
  if (same(q.dimension, [0, 2, 0, 0])) return "m²";
  if (same(q.dimension, [1, 0, -3, -1])) return "W/(m²·K)";
  return q.dimension
    .map((d, i) =>
      d
        ? `${["kg", "m", "s", "K", "A", "mol", "cd", "rad"][i]}${d !== 1 ? `^${d}` : ""}`
        : "",
    )
    .filter(Boolean)
    .join("·");
}
export function display(q?: Quantity): string {
  if (!q) return "—";
  const value = q.absolute ? q.value - 273.15 : q.value;
  if (same(q.dimension, units.Pa.dimension) && Math.abs(value) >= 1e6)
    return `${Number((value / 1e6).toPrecision(6))} MPa`;
  return `${Number(value.toPrecision(6))} ${unitLabel(q)}`.trim();
}
export function references(e: Expression): string[] {
  if (e.kind === "name")
    return e.name in units || e.name === "degC" ? [] : [e.name];
  if (e.kind === "call") return [...new Set(e.args.flatMap(references))];
  if (e.kind === "unary") return references(e.expression);
  if (e.kind === "binary")
    return [...new Set([...references(e.left), ...references(e.right)])];
  return [];
}

export function passes(
  relation: Exclude<Statement["relation"], "=">,
  actual: number,
  bound: number,
): boolean {
  return relation === "<="
    ? actual <= bound
    : relation === ">="
      ? actual >= bound
      : relation === "<"
        ? actual < bound
        : actual > bound;
}
export function relationGlyph(relation: Statement["relation"]): string {
  return relation === "="
    ? ":="
    : relation === "<="
      ? "≤"
      : relation === ">="
        ? "≥"
        : relation;
}
