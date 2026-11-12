/** Version 2 source grammar. Historical source continues through the fixed v1 parser. */
import type { Expression, Statement } from "./math.ts";
import {
  scientificUnits,
  scientificFunctions,
  scientificConstants,
} from "./scientific.ts";
const oldUnits = new Set([
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
  "degC",
]);
const number = (e: Expression): boolean =>
  e.kind === "number" || (e.kind === "unary" && number(e.expression));
const unitTree = (e: Expression): boolean =>
  e.kind === "unit" ||
  (e.kind === "name" && (scientificUnits.has(e.name) || e.name === "degC")) ||
  (e.kind === "binary" &&
    (e.op === "^"
      ? unitTree(e.left) && number(e.right)
      : ["*", "/"].includes(e.op) && unitTree(e.left) && unitTree(e.right)));
const markUnits = (e: Expression): Expression =>
  e.kind === "name"
    ? { kind: "unit", name: e.name }
    : e.kind === "binary"
      ? {
          ...e,
          left: markUnits(e.left),
          right: e.op === "^" ? e.right : markUnits(e.right),
        }
      : e;
const literal = (e: Expression): boolean =>
  number(e) ||
  e.kind === "constant" ||
  (e.kind === "binary" &&
    ["*", "/"].includes(e.op) &&
    literal(e.left) &&
    unitTree(e.right));
export function parseScientific(text: string): Statement {
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
  if (["__proto__", "constructor", "prototype"].includes(name))
    throw Error("That name is reserved.");
  if (oldUnits.has(name)) throw Error(`${name} is reserved for a unit.`);
  if (
    Object.hasOwn(scientificConstants, name) ||
    Object.hasOwn(scientificFunctions, name)
  )
    throw Error(`${name} is reserved for scientific mathematics.`);
  const tokens: string[] = [];
  const pattern =
    /\s*(?:(\d*\.\d+|\d+(?:\.\d*)?)(?:[eE]([+-]?\d+))?|([A-Za-z_][A-Za-z_0-9]*)|([(),+\-*/^]))/gy;
  let cursor = 0;
  while (cursor < body.length) {
    pattern.lastIndex = cursor;
    const match = pattern.exec(body);
    if (!match)
      throw Error(
        `Unrecognized notation near “${body.slice(cursor, cursor + 12)}”. Use scalar arithmetic and supported scientific functions.`,
      );
    tokens.push(
      match[1]
        ? match[1] + (match[2] ? "e" + match[2] : "")
        : match[3] || match[4],
    );
    if (tokens.length > 256) throw Error("Keep expressions within 256 tokens.");
    cursor = pattern.lastIndex;
  }
  let i = 0,
    depth = 0;
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
    if (token && /^[A-Za-z_]/.test(token)) {
      if (["__proto__", "constructor", "prototype"].includes(token))
        throw Error("That name is reserved.");
      if (Object.hasOwn(scientificFunctions, token) && tokens[i] === "(") {
        i++;
        const args: Expression[] = [];
        if (tokens[i] !== ")") {
          args.push(sum());
          while (tokens[i] === ",") {
            i++;
            args.push(sum());
          }
        }
        if (tokens[i++] !== ")")
          throw Error("A closing parenthesis is missing.");
        const [low, high] = scientificFunctions[token];
        if (args.length < low || args.length > high)
          throw Error(
            `Use ${low === high ? low : `${low}–${high}`} arguments for ${token}.`,
          );
        return { kind: "call", name: token, args };
      }
      if (Object.hasOwn(scientificConstants, token))
        return { kind: "constant", name: token };
      return { kind: "name", name: token };
    }
    throw Error("Expected a number, variable, or parenthesis.");
  };
  const power = (): Expression => {
    if (++depth > 32) throw Error("Keep expression nesting within 32 levels.");
    let left = primary();
    if (tokens[i] === "^") {
      i++;
      left = { kind: "binary", op: "^", left, right: power() };
    }
    depth--;
    return left;
  };
  const product = (): Expression => {
    let left = power();
    while (i < tokens.length) {
      let op = tokens[i],
        implicit = false;
      if (op === "*" || op === "/") i++;
      else if (op === "(" || /^[A-Za-z_\d.]/.test(op)) {
        op = "*";
        implicit = true;
      } else break;
      let right = power();
      if (implicit && literal(left) && unitTree(right))
        right = markUnits(right);
      left = { kind: "binary", op, left, right };
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
    mathVersion: 2,
  };
}
