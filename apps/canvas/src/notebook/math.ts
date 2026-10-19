/** Bounded arithmetic worksheet, not a symbolic algebra engine. No dynamic code execution. */
export type Dimension = [number, number, number, number]; // kg, m, s, K
export type Quantity = {
  value: number;
  dimension: Dimension;
  absolute?: boolean;
};
export type Expression =
  | { kind: "number"; value: number }
  | { kind: "name"; name: string }
  | { kind: "unary"; expression: Expression }
  | { kind: "binary"; op: string; left: Expression; right: Expression };
export type Statement = {
  name: string;
  expression: Expression;
  raw: string;
  relation: "=" | "<=" | ">=" | "<" | ">";
  anonymous?: boolean;
};
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
export const same = (a: Dimension, b: Dimension) =>
  a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
/** Recognize worksheet expressions without interpreting ordinary prose as math.
 * A trailing equals sign requests evaluation; a named, unfinished x = stays a draft. */
export function expressionBody(text: string): string | undefined {
  const value = text.trim();
  if (/^[A-Za-z_][A-Za-z_0-9]*\s*(?::=|<=|>=|<|>|=|≤|≥)/.test(value)) return;
  const explicit = value.endsWith("="),
    body = (explicit ? value.slice(0, -1) : value).trim();
  if (!body || /[=:<>≤≥]/.test(body)) return;
  if (explicit) return body;
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
    if (quantityLiteral(parseNamed(`value = ${body}`).expression)) return body;
  } catch {
    /* Unmarked prose remains a thought. */
  }
}
export function parse(text: string, expressionId?: string): Statement {
  const body = expressionBody(text);
  if (body !== undefined && expressionId !== undefined) {
    // Stable private identities allow several anonymous results to coexist.
    const name = `__expr_${Array.from(expressionId)
      .map((c) => c.codePointAt(0)!.toString(16))
      .join("_")}`;
    return { ...parseNamed(`${name} = ${body}`), raw: text, anonymous: true };
  }
  const statement = parseNamed(text);
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
): Quantity {
  if (expression.kind === "number") {
    if (!Number.isFinite(expression.value))
      throw Error("The number is not finite.");
    return { value: expression.value, dimension: scalar };
  }
  if (expression.kind === "name") {
    if (expression.name === "degC")
      throw Error("Write an absolute temperature as a number followed by °C.");
    return Object.hasOwn(units, expression.name)
      ? units[expression.name]
      : resolve(expression.name);
  }
  if (expression.kind === "unary") {
    const q = evaluate(expression.expression, resolve);
    if (q.absolute) throw Error("Negate the Celsius number before its unit.");
    return { ...q, value: -q.value };
  }
  const { left, right, op } = expression;
  if (op === "*" && right.kind === "name" && right.name === "degC") {
    const n = evaluate(left, resolve);
    if (!same(n.dimension, scalar) || n.absolute)
      throw Error("°C needs a plain numeric value.");
    return { value: n.value + 273.15, dimension: temperature, absolute: true };
  }
  const a = evaluate(left, resolve),
    b = evaluate(right, resolve);
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
      value: op === "+" ? a.value + b.value : a.value - b.value,
      dimension: a.dimension,
      absolute:
        op === "+" ? a.absolute || b.absolute : a.absolute && !b.absolute,
    };
  } else {
    if (a.absolute || b.absolute)
      throw Error(
        "Use temperature differences in K in products and quotients.",
      );
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
        dimension: a.dimension.map((d) => d * b.value) as Dimension,
      };
    } else {
      if (op === "/" && b.value === 0) throw Error("Division by zero.");
      result = {
        value: op === "*" ? a.value * b.value : a.value / b.value,
        dimension: a.dimension.map(
          (d, i) => d + (op === "*" ? b.dimension[i] : -b.dimension[i]),
        ) as Dimension,
      };
    }
  }
  if (!Number.isFinite(result.value)) throw Error("The result is not finite.");
  return result;
}
export type Calculation = { id: string; text: string; x: number; y: number };
/** Display assignments quietly; show the result of actual arithmetic, even
 * when it has no variable references (e.g. answer = 2 + 3). */
export function quantityLiteral(expression: Expression): boolean {
  const number = (e: Expression): boolean =>
    e.kind === "number" || (e.kind === "unary" && number(e.expression));
  const unit = (e: Expression): boolean =>
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
export type Solved = {
  statements: Map<string, Statement>;
  values: Map<string, Quantity>;
  errors: Map<string, string>;
  constraints: Map<
    string,
    { pass: boolean; bound: Quantity; statement: Statement }
  >;
};
export function calculate(
  regions: Calculation[],
  overrides: Record<string, Quantity> = {},
): Solved {
  const statements = new Map<string, Statement>(),
    byName = new Map<string, string>(),
    values = new Map<string, Quantity>(),
    errors = new Map<string, string>(),
    constraints: Solved["constraints"] = new Map();
  for (const region of regions) {
    try {
      const s = parse(region.text, region.id);
      statements.set(region.id, s);
      if (s.relation === "=") {
        if (byName.has(s.name)) {
          errors.set(region.id, `${s.name} is already defined.`);
          errors.set(byName.get(s.name)!, `${s.name} is defined twice.`);
        } else byName.set(s.name, region.id);
      }
    } catch (e) {
      errors.set(region.id, (e as Error).message);
    }
  }
  const visiting = new Set<string>();
  const resolve = (name: string): Quantity => {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (values.has(name)) return values.get(name)!;
    const id = byName.get(name);
    if (!id) throw Error(`Define ${name} with a value and units.`);
    if (errors.has(id)) throw Error(errors.get(id));
    if (visiting.has(name))
      throw Error(`Circular dependency involving ${name}.`);
    visiting.add(name);
    try {
      const value = evaluate(statements.get(id)!.expression, resolve);
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
        const actual = resolve(s.name),
          bound = evaluate(s.expression, resolve);
        if (
          !same(actual.dimension, bound.dimension) ||
          !!actual.absolute !== !!bound.absolute
        )
          throw Error(
            "The limit and the result need matching units and temperature conventions.",
          );
        constraints.set(id, {
          pass: passes(s.relation, actual.value, bound.value),
          bound,
          statement: s,
        });
      }
    } catch (e) {
      errors.set(id, (e as Error).message);
    }
  }
  return { statements, values, errors, constraints };
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
      d ? `${["kg", "m", "s", "K"][i]}${d !== 1 ? `^${d}` : ""}` : "",
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
