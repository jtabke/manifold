# 0038 Versioned scientific scalar math

Status: Accepted for the bounded scientific scalar slice; v3 compatibility/product policy approved, 2026-11-12.

Related: [incremental worksheet derivation](0037-bounded-incremental-worksheet-derivation.md), [authored scalar models](0035-authorable-scalar-models-and-general-outputs.md), [model analyses](0036-model-backed-analysis-requests.md).

## Outcome and boundary

A new worksheet can author `theta := 30 deg`, `F := 500 N`, and `Fx := F*cos(theta)`;
review the result and requirement; explore the angle without accepting it; create independent
reusable models and a bounded sweep; and reopen the same source and retained evidence.
Scientific functions must not be a worksheet-only shortcut or silently reinterpret saved work.
Arrays, user functions, complex numbers, symbolic algebra, solving and calculus remain outside this slice.

## Decision

Use the exact application dependency Math.js 15.2.0 through a small, statically imported factory.
Math.js owns new numerical operations and unit conversion/algebra. Manifold owns source grammar,
name binding, domains, absolute-temperature policy, resource bounds, document mutation and evidence.
Do not expose Math.js parsing, compilation, evaluation, mutable imports or library instances to authored source.
The shared expression tree gains unit, constant and bounded call nodes; its existing consumers
handle those nodes instead of introducing a second worksheet authority.

New source records carry `mathVersion: 3`. Missing version means the fixed historical v1 grammar
and arithmetic, including implicit multiplication and ordinary names such as `sin` and `pi`.
Low-level parser/evaluator defaults remain v1; new authoring explicitly selects v3. Existing worksheet
equations require an explicit **Use scientific math (v3)** command (or `enableScientificMathV3` automation
edit); existing model rows have the equivalent explicit editor action. These edits use existing Undo.
Source versions participate in prepared caches, semantic keys, dependency closures, model source,
sampling captures, CSV measurement identity and saved calculation identity.

Under v2, supported function and constant names are reserved. New unit symbols are units in
numeric-unit juxtaposition and its unit suffix (`2 A`, `3 W/(m^2 K)`), not arbitrary bare references:
`A := 2 m^2` and `1/A` still mean an area and its reciprocal. Historical unit names remain reserved.
Calls are allowlisted; other adjacent symbols retain multiplication. Division and implicit products
retain left-to-right product precedence; use parentheses to state a denominator explicitly.

Quantities remain plain finite real numbers with canonical SI dimensions, never Math.js objects.
The original `[kg, m, s, K]` prefix is preserved, with optional trailing `[A, mol, cd, rad]` entries;
trailing zero dimensions are equivalent. Angles have their own dimension. Trig functions accept angles
or dimensionless radians; `atan2` normalizes compatible inputs and returns radians. Absolute Celsius
is distinguished from temperature differences; adding or multiplying absolute temperatures and
passing them to functions remain errors. Historical equations reject additional dimensions rather
than dropping them through their four-dimensional arithmetic.

Limits remain 1,200 normalized characters, 256 expression tokens, 32 nesting levels, real finite
results, and dimensionless power exponents from -12 to 12. Function arities are fixed (2–16 for
`min`/`max`). Unit spelling is a reviewed allowlist, not the entire Math.js catalog. In particular,
`psi` is not admitted by this slice; its library conversion discrepancy is not hidden by relaxed tests.

## Approved v3 scalar functions

The `asin`, `acos`, `atan`, `sinh`, `cosh`, `tanh`, `floor`, `ceil`,
`round` and `cbrt` additions are source-enabled only in v3. The v2 function table
is frozen so saved v1 **and v2** source keeps its meaning. For example, v2 already permits
`round := 2`, `x := 3`, `y := round(x+1)` and computes `y = 8`. Reserving `round`
or parsing that product as a function call in v2 would break saved calculations,
authored models and captured Python evidence. Unknown single-argument adjacency
(including `x(y+1)`) must not become an unsupported-function error.

The functions have these semantics:

- `asin` and `acos` require dimensionless inputs in the closed interval [-1, 1];
  `atan` accepts finite dimensionless inputs. All three return explicit radian
  quantities, not dimensionless numbers. Angles as inputs are rejected.
- Hyperbolic functions require dimensionless inputs; overflow is rejected rather
  than producing an infinite result.
- `floor`, `ceil` and `round` require dimensionless inputs. There is no implicit
  choice between rounding canonical SI values and rounding an authored unit.
  `round` uses Math.js nearest-integer semantics with ties **away from zero**
  (not JavaScript's positive-direction ties or Python's ties-to-even). All three
  retain Math.js 15.2.0 default tolerances (`relTol=1e-12`, `absTol=1e-15`),
  including its 12-decimal precision selection before rounding and tolerant
  floor/ceil selection near integer boundaries.
- `cbrt` computes real roots of negative values as well as positive values and
  zero. It roots the canonical SI value and divides each dimension exponent by
  three, allowing fractional dimensions just as existing unit powers do.
- Every kernel rejects absolute Celsius values and non-finite input/output.

The user approved new-authoring v3 defaults and explicit, undoable upgrades.
Ordinary edits, imports and retained evidence never upgrade source. The existing
`enableScientificMath` API remains a v2 opt-in and never downgrades v3;
`enableScientificMathV3` is the distinct v3 operation. Upgrading a definition
can expose reserved-name collisions as diagnostics; no automatic rename or data
rebinding occurs. Single-argument juxtaposition remains multiplication; only
unambiguous empty/multi-argument unknown calls get function diagnostics in v3.

Worksheet receipts and keys, model arithmetic/function methods, sampling captures,
typed sampler methods and Python runtimes identify v3 independently. Old methods,
receipts and Python admission stay fixed. Python uses real `cbrt` and an explicit
rounding implementation, not built-in ties-to-even. Both runtimes retain the same tolerance behavior near integers and halves;
boundary differential fixtures exercise both sides of the selection thresholds. Arrays, general nth-root syntax
and display settings remain outside this slice.

## Evidence and compatibility

New worksheet calculations use `manifold-worksheet/3` receipts; old receipts continue validation
with their original v1/v2 source and rules. Mixed closures use the maximum source version. Scientific native model operations identify
`manifold-equations-mathjs@15.2.0`; historical model methods remain registered unchanged.
Scientific sampling has a distinct method/runtime and bounded Python adapter v3 (with v1/v2 retained). Its Python AST
admits only the same named scalar functions, without arbitrary calls or authored evaluation.
The existing checked sampler admission still compares captured code, metadata and numerical points.
Open restores checked evidence without execution, including when no sampler is installed.

New exports use application native wrapper **V9** so older readers reject scientific work instead of
ignoring its interpretation marker. V1–V8 imports remain supported without upgrading their source.
Foundation transport, accepted document ownership, pinned revisions and receipt storage do not change.
V3 worksheet revisions additionally use required `canvas-record@2` so raw foundation readers
cannot silently interpret them as legacy source. V9 is an application compatibility barrier, not a claim that relabeling untrusted JSON is safe.

## Validation

[Scalar integration contracts](../../../apps/canvas/tests/check-scientific-math.mjs) exercise function
and unit oracles, domains/refusals, source spans/dependencies, historical names and explicit upgrade/Undo,
mixed-version boundaries, precise angle exploration, constraints/curves, actual isolated Python
sampling, retained evidence, independent native model instances, a 201-point analysis, native/local
recovery and headless/agent handoff. [Browser contracts](../../../apps/canvas/tests/check-scientific-math-browser.mjs)
exercise real authoring, rendered results, transient angle exploration, UI export/Open and reload.
Existing differential worksheet, provenance, model, sampler and historical fixture checks remain gates.

Validation is owned by `make verify`, including the focused
[full v3 contract](../../../apps/canvas/tests/check-scientific-v3.mjs), sampler version/refusal
unit tests, and browser authoring/rendering/native round trips.
