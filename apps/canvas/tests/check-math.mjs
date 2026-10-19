import assert from "node:assert/strict";
import {
  calculate,
  display,
  parse,
  evaluate,
  quantityLiteral,
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
