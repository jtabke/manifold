# 0038 Versioned scientific scalar math

Status: Accepted for the bounded scientific scalar slice, 2026-11-11.

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

New source records carry `mathVersion: 2`. Missing version means the fixed historical v1 grammar
and arithmetic, including implicit multiplication and ordinary names such as `sin` and `pi`.
Low-level parser/evaluator defaults remain v1; new authoring explicitly selects v2. Existing worksheet
equations require an explicit **Use scientific math (v2)** command (or `enableScientificMath` automation
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

## Evidence and compatibility

New worksheet calculations use `manifold-worksheet/2` receipts; old receipts continue validation
with v1 source and rules. Scientific native model operations identify
`manifold-equations-mathjs@15.2.0`; historical model methods remain registered unchanged.
Scientific sampling has a distinct method/runtime and bounded Python adapter v2. Its Python AST
admits only the same named scalar functions, without arbitrary calls or authored evaluation.
The existing checked sampler admission still compares captured code, metadata and numerical points.
Open restores checked evidence without execution, including when no sampler is installed.

New exports use application native wrapper **V8** so older readers reject scientific work instead of
ignoring its interpretation marker. V1–V7 imports remain supported without upgrading their source.
Foundation transport, accepted document ownership, pinned revisions and receipt storage do not change.
V8 is an application compatibility barrier, not a claim that relabeling untrusted JSON is safe.

## Validation

[Scalar integration contracts](../../../apps/canvas/tests/check-scientific-math.mjs) exercise function
and unit oracles, domains/refusals, source spans/dependencies, historical names and explicit upgrade/Undo,
mixed-version boundaries, precise angle exploration, constraints/curves, actual isolated Python
sampling, retained evidence, independent native model instances, a 201-point analysis, native/local
recovery and headless/agent handoff. [Browser contracts](../../../apps/canvas/tests/check-scientific-math-browser.mjs)
exercise real authoring, rendered results, transient angle exploration, UI export/Open and reload.
Existing differential worksheet, provenance, model, sampler and historical fixture checks remain gates.

Implementation review: `MANIFOLD_BROWSER_EXECUTABLE=/usr/bin/chromium make verify` passes:
52 local application checks, 185 foundation tests, both foundation browser workflows and all 34
application browser checks, plus repository/docs/Python/format/type/build gates. Production dependency
audit reports zero vulnerabilities. Chromium is a supported browser configuration across both suites;
CI installs Playwright-managed Chromium, and an explicit executable override supports local installs.
The earlier browser gaps are resolved: the command-palette check verifies navigation to an existing
response without creating sampling work, while the dataset check verifies the precise unit diagnostic,
disabled acceptance and unchanged worksheet. Neither fix relaxes computation or unit safeguards.
