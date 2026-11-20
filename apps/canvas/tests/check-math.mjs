import assert from "node:assert/strict";
import {
  calculate,
  compileRowCalculation,
  display,
  parse,
  evaluate,
  evaluationWork,
  prepareCalculation,
  quantityLiteral,
  resetEvaluationWork,
  solvePrepared,
} from "../src/notebook/math.ts";
const regions = (lines) =>
  lines.map((text, i) => ({ id: String(i), text, x: 0, y: 0 }));
const thermal = [
  "T_ambient := 25 °C",
  "Q := 800 W",
  "h := 60 W/(m^2 K)",
  "A := 0.2 m^2",
  "T := T_ambient + Q/(h A)",
  "T <= 100 °C",
];
const base = calculate(regions(thermal));
assert.equal(base.errors.size, 0);
assert.equal(display(base.values.get("T")), "91.6667 °C");
assert.equal(base.constraints.get("5").pass, true);
// Independent thermal balance and lower area bound.
assert.ok(
  Math.abs(base.values.get("T").value - 273.15 - (25 + 800 / (60 * 0.2))) <
    1e-10,
);
const minimum = 800 / (60 * (100 - 25));
for (const [area, pass] of [
  [minimum - 1e-6, false],
  [minimum, true],
  [minimum + 1e-6, true],
]) {
  const result = calculate(regions(thermal), {
    A: { value: area, dimension: [0, 2, 0, 0] },
  });
  assert.equal(result.constraints.get("5").pass, pass);
}
const alternative = calculate(regions(thermal), {
  h: { value: 40, dimension: [1, 0, -3, -1] },
});
assert.equal(display(alternative.values.get("T")), "125 °C");
assert.equal(alternative.constraints.get("5").pass, false);
assert.equal(
  display(calculate(regions(["A := 2000 cm^2"])).values.get("A")),
  "0.2 m²",
);
assert.equal(
  display(calculate(regions(["T := -20 °C + 5 K"])).values.get("T")),
  "-15 °C",
);
assert.equal(
  display(calculate(regions(["delta := 100 °C - 25 °C"])).values.get("delta")),
  "75 K",
);
assert.equal(
  display(calculate(regions(["answer := -2^2"])).values.get("answer")),
  "-4",
);
assert.equal(
  display(calculate(regions(["answer := 2^3^2"])).values.get("answer")),
  "512",
);
assert.equal(
  display(
    calculate(
      regions([
        "T := 25 °C + Q/(h*A)",
        "A := .2 m^2",
        "h := 60 W/(m^2 K)",
        "Q := 800 W",
      ]),
    ).values.get("T"),
  ),
  "91.6667 °C",
);
for (const lines of [
  ["x := 1 m + 1 W"],
  ["x := 25 °C + 30 °C"],
  ["x := 25 °C * 2"],
  ["x := 1/0"],
  ["x := y + 1", "y := x + 1"],
  ["x := 1", "x := 2"],
  ["x := missing"],
  ["x := 1e999"],
  ["x := 1 m", "x <= 1 W"],
  ["x := 1", "x <= 25 °C"],
])
  assert.ok(calculate(regions(lines)).errors.size > 0, lines.join(";"));
const unitMismatch = calculate(
  regions(["x := 4 s", "k := 10 N/mm", "F = k*x", "F < 30 N"]),
);
assert.equal(
  unitMismatch.errors.get("3"),
  "The result F has units kg·s^-1, but its limit has units N. Check the units of F and its inputs.",
);
assert.equal(unitMismatch.constraints.has("3"), false);
assert(!unitMismatch.errors.get("3").includes("temperature"));
assert.equal(
  calculate(regions(["x := 1", "x < 2 m"])).errors.get("1"),
  "The result x has units 1, but its limit has units m. Check the units of x and its inputs.",
);
for (const source of [
  ["T := 25 °C", "T < 30 K"],
  ["T := 25 K", "T < 30 °C"],
]) {
  const mismatch = calculate(regions(source));
  assert.equal(
    mismatch.errors.get("1"),
    "The result T and its limit mix absolute temperature and a temperature difference. Use matching temperature conventions.",
  );
  assert.equal(mismatch.constraints.size, 0);
}
for (const payload of [
  "x := globalThis.alert(1)",
  "x := __proto__.constructor",
  "x := import('x')",
])
  assert.throws(() => parse(payload));
assert.throws(() =>
  evaluate(parse("x := 2^99").expression, () => {
    throw Error("No name");
  }),
);
console.log(
  "Arithmetic, dependency, units, affine-temperature, bounds and invalid-input checks passed.",
);

for (const literal of ["20", "-20", "20 K", "12 W/(m^2*K)", "25 °C"])
  assert.equal(
    quantityLiteral(parse(`x = ${literal}`).expression),
    true,
    literal,
  );
for (const expression of ["2+3", "2*3", "1/3", "2^3", "(2 m)*(3 m)", "a+2"])
  assert.equal(
    quantityLiteral(parse(`x = ${expression}`).expression),
    false,
    expression,
  );

const prepare = (lines) =>
  lines.map((line, i) => {
    const [text, version, id = String(i)] = Array.isArray(line)
      ? line
      : [line, 1];
    return prepareCalculation(id, text, version);
  });
const q = (value, dimension = [0, 0, 0, 0]) => ({ value, dimension });
// Compare entries (including first-use order, precise diagnostics and affine
// flags), not ReadMap objects whose backing storage is deliberately private.
function compareRows(lines, samples) {
  const rows = prepare(lines),
    run = compileRowCalculation(rows);
  for (const overrides of samples) {
    const expected = solvePrepared(rows, overrides).solved,
      actual = run(overrides);
    for (const key of ["statements", "values", "errors", "constraints"])
      assert.deepEqual(
        [...actual[key]],
        [...expected[key]],
        `${lines}: ${key}`,
      );
  }
}
compareRows(
  [
    "hot < bound",
    ["hot = ambient + rise", 2],
    "delta = hot - 20 °C",
    "rise = 5 K",
    ["ambient = 25 °C", 3],
    "bound = 40 °C",
    "rise >= rise - 5 K",
  ],
  [
    {},
    { rise: q(12, [0, 0, 0, 1]) },
    { ambient: q(300, [0, 0, 0, 1]) },
    { rise: q(2, [0, 1, 0, 0]) },
    { bound: q(42) },
    {},
  ],
);
compareRows(
  [
    ["toString = reading", 2],
    "legacy = toString",
    ["toString <= 5 A", 2],
    ["angle = asin(x)", 3],
    ["fraction = sin(angle)", 2],
    "x = 0.5",
    ["2 + 3 =", 3],
  ],
  [
    {},
    { reading: q(3, [0, 0, 0, 0, 1]), x: q(1) },
    { reading: q(2), x: q(2) },
    { toString: q(4), x: q(0) },
    Object.create({ reading: q(1) }),
    {},
  ],
);
compareRows(
  ["used = dup + 1", "dup = 1", "dup = 2", "used < cap", "dup >= 2"],
  [{}, { dup: q(5) }, { dup: q(6), cap: q(8) }, { cap: q(10) }, {}],
);
compareRows(["broken := (", "out = missing"], [{}, { missing: q(1) }, {}]);
compareRows(
  [["a = 1", 1, "same-id"], ["b = input", 1, "same-id"], "out = a"],
  [{ input: q(1) }, { input: q(2) }],
);
compareRows(
  ["out = first", "first = second + 1", "second = first + 1", "out <= 3"],
  [{}, { first: q(1) }, { second: q(10) }, { out: q(0) }, {}, { second: q(0) }],
);
compareRows(
  ["result = 1 / x + later", "x = 0", "result > 0"],
  [
    {},
    { x: q(2) },
    { x: q(2), later: q(3) },
    { x: q(0), later: q(3) },
    { later: q(3), x: q(-2) },
  ],
);

// Compile once, then discard access to the source list. Independent assignments
// and the limit expression are evaluated once, even when declared out of order.
{
  const { proxy, revoke } = Proxy.revocable(
    prepare([
      "P = force * speed * gain",
      "P <= cap",
      "gain = half * 2",
      "half = 0.5",
      "cap = 80 W",
    ]),
    {},
  );
  resetEvaluationWork();
  const run = compileRowCalculation(proxy);
  revoke();
  const speed = q(3, [0, 1, -1, 0]);
  let first, last;
  for (let i = 1; i <= 10000; i++) {
    last = run({ force: q(i, [1, 1, -2, 0]), speed });
    first ??= last;
    assert.equal(last.values.get("P").value, 3 * i);
    assert.equal(last.constraints.get("1").pass, 3 * i <= 80);
  }
  assert.equal(last.statements, first.statements);
  assert.equal(last.values.get("gain"), first.values.get("gain"));
  assert.equal(
    last.constraints.get("1").bound,
    first.constraints.get("1").bound,
  );
  assert.deepEqual([...last.values.keys()], ["half", "gain", "P", "cap"]);
  assert.deepEqual(evaluationWork(), {
    parses: 0,
    expressions: 5 * 10000 + 8,
    assignments: 10000 + 3,
    constraints: 10000,
  });
  // A newly introduced override invalidates an already cached transitive input.
  const sample = { force: q(8, [1, 1, -2, 0]), speed };
  assert.equal(
    run(
      Object.defineProperty(sample, "half", {
        value: q(2),
        configurable: true,
      }),
    ).values.get("P").value,
    96,
  );
  delete sample.half;
  assert.equal(run(sample).values.get("P").value, 24);
  assert.equal(first.values.get("P").value, 3);
}

// Aliases and borrowed dimensions must not retain or freeze caller-owned data,
// even for a shallow-frozen override. Failures never contaminate another row.
{
  const run = compileRowCalculation(
    prepare(["out = reading", "sum = reading + out", "out <= limit"]),
  );
  const reading = q(2, [0, 1, 0, 0]),
    limit = Object.freeze(q(3, [0, 1, 0, 0]));
  const first = run({ reading, limit });
  reading.value = 7;
  limit.dimension[1] = 0;
  const failed = run({ reading, limit });
  assert.match(failed.errors.get("2"), /limit has units 1/);
  reading.dimension[1] = 0;
  const next = run({ reading, limit });
  assert.equal(next.errors.size, 0);
  assert.equal(next.constraints.get("2").pass, false);
  assert.equal(failed.constraints.has("2"), false);
  assert.equal(first.errors.size, 0);
  assert.deepEqual(first.values.get("out"), q(2, [0, 1, 0, 0]));
  assert.equal(first.values.get("sum").value, 4);
  assert.deepEqual(first.values.get("sum").dimension, [0, 1, 0, 0]);
  assert.deepEqual(first.constraints.get("2").bound, q(3, [0, 1, 0, 0]));
  for (const map of [
    first.values,
    first.constraints,
    first.errors,
    failed.errors,
  ]) {
    assert.equal(map.set, undefined);
    map.forEach((_v, _k, view) => assert.equal(view, map));
  }
  assert.throws(() => (first.constraints.get("2").bound.dimension[1] = 9));
  assert.throws(() => (first.values.get("out").value = 4));
}
console.log(
  "Compiled row calculations: ordered cold-solver parity, immutable snapshots and one-plan 10,000-row work counts pass.",
);
