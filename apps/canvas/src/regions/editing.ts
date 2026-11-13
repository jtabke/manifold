/** Source locations for the rendered math; the arithmetic AST stays unchanged. */
import type { Expression, Statement } from "../notebook/math.ts";

export type SourceSpan = { start: number; end: number };
type Token = SourceSpan & { value: string };
export function mathSource(statement: Statement, text: string) {
  const tokens: Token[] = [];
  for (const match of text.matchAll(
    /\d*\.\d+(?:[eE][+-]?\d+)?|\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z_0-9]*|°C|:=|<=|>=|<|>|[≤≥²³+\-−*/^=×·]/g,
  )) {
    const start = match.index,
      end = start + match[0].length;
    const value =
      (
        {
          ":=": "=",
          "≤": "<=",
          "≥": ">=",
          "°C": "degC",
          "−": "-",
          "×": "*",
          "·": "*",
        } as Record<string, string>
      )[match[0]] || match[0];
    if (value === "²" || value === "³") {
      tokens.push({ value: "^", start, end: start });
      tokens.push({ value: value === "²" ? "2" : "3", start, end });
    } else tokens.push({ value, start, end });
  }
  let cursor = 0;
  const take = (value: string, numeric = false): SourceSpan => {
    const index = tokens.findIndex(
      (t, i) =>
        i >= cursor &&
        (numeric ? Number(t.value) === Number(value) : t.value === value),
    );
    if (index < 0) return { start: text.length, end: text.length };
    cursor = index + 1;
    return { start: tokens[index].start, end: tokens[index].end };
  };
  const name = statement.anonymous ? undefined : take(statement.name),
    relation = statement.anonymous ? undefined : take(statement.relation);
  const expressions = new Map<
    Expression,
    { span: SourceSpan; operator?: SourceSpan }
  >();
  const walk = (e: Expression): SourceSpan => {
    let span: SourceSpan, operator: SourceSpan | undefined;
    if (e.kind === "number") span = take(String(e.value), true);
    else if (e.kind === "name" || e.kind === "unit" || e.kind === "constant")
      span = take(e.name);
    else if (e.kind === "call") {
      const name = take(e.name);
      operator = name;
      const args = e.args.map(walk);
      let end = args.at(-1)?.end ?? name.end;
      const opening = text.indexOf("(", name.end);
      let depth = 0;
      for (let i = opening; opening >= 0 && i < text.length; i++) {
        if (text[i] === "(") depth++;
        if (text[i] === ")" && --depth === 0) {
          end = i + 1;
          break;
        }
      }
      span = { start: name.start, end };
    } else if (e.kind === "unary") {
      operator = take("-");
      span = { start: operator.start, end: walk(e.expression).end };
    } else {
      const left = walk(e.left);
      // Juxtaposition has no authored multiplication character.
      operator =
        tokens[cursor]?.value === e.op
          ? take(e.op)
          : { start: left.end, end: left.end };
      span = { start: left.start, end: walk(e.right).end };
    }
    expressions.set(e, { span, operator });
    return span;
  };
  walk(statement.expression);
  return { name, relation, expressions };
}

export function caretInSpan(span: SourceSpan, fraction: number): SourceSpan {
  const offset =
    span.start +
    Math.round((span.end - span.start) * Math.max(0, Math.min(1, fraction)));
  return { start: offset, end: offset };
}

/** Numeric source ranges for direct editing and literal exploration. */
export function sourceSpans(text: string): { start: number; end: number }[] {
  const offset = /^\s*[A-Za-z_][A-Za-z_0-9]*\s*(?::=|<=|>=|<|>|=|≤|≥)/.test(
    text,
  )
    ? text.search(/(?::=|<=|>=|<|>|=|≤|≥)/)
    : -1;
  return [
    ...text.matchAll(
      /(?<![A-Za-z_0-9.])(?:\d*\.\d+|\d+(?:\.\d*)?)(?:[eE][+-]?\d+)?/g,
    ),
  ]
    .filter((match) => match.index > offset)
    .map((match) => ({
      start: match.index,
      end: match.index + match[0].length,
    }));
}
