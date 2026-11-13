# Canonical numeric optimizer backend v1

This is an independent backend candidate, not an integrated product feature.
`artifact_optimizer.py` owns bounded numeric execution only. TypeScript must own
unit checking/normalization and graph lowering; source math versions are **not**
this contract version. The adapter does not establish graph provenance, model
analysis identity, currency, receipts, history, or document mutation. Those remain
foundation/application owners. No HTTP route, UI, registry or shared semaphore is
installed here.

## Reproducible optional runtime

Supported wheel profile: CPython **3.12**, Linux x86_64 with manylinux2014 support.
Verified interpreter: **3.12.16**. NumPy **2.2.6**, SciPy **1.15.3**. The exact
Python patch version is included in each backend identity, not silently ignored.
`requirements-optimizer.txt` is the optimization-only pinned/hash-locked manifest
for these CPython 3.12 wheels (not a cross-platform lock).

```sh
python3.12 -m venv /tmp/manifold-optimizer-venv
/tmp/manifold-optimizer-venv/bin/python -m pip install -r apps/canvas/requirements-optimizer.txt
/tmp/manifold-optimizer-venv/bin/python -m unittest discover -s apps/canvas/tests -p 'test_artifact_optimizer.py'
/tmp/manifold-optimizer-venv/bin/python -m unittest discover -s apps/canvas/tests -p 'test_*.py'
```

Use this venv's interpreter for the eventual Python transport: workers always use
`sys.executable`, never a request-selected executable or another discovered Python.
Default Python 3.14 is not the supported optimizer profile. Runtime installation
never occurs. Module import/validation and unrelated application operations do not
import SciPy/NumPy. The worker lazily imports dependencies. Missing libraries give
`unavailable`; unsupported versions or changed expected identities give
`backend_mismatch`, never a solver fallback. Identity probing raises
`BackendUnavailable` on dependency/startup/timeout failure.

## Callable API and strict request schema

- `backend_identity(timeout=5) -> dict`: fixed subprocess probe. The trusted host
  configures/probes the approved environment and freezes its returned identity in
  the capture; **do not replace a captured expected identity just before solving**.
- `program_digest(program) -> str`: validates and SHA-256 hashes a numeric capture.
  Replace each constant's `value` with its 16 lowercase hex digits of big-endian
  IEEE-754 binary64 bytes (e.g. 2 becomes `4000000000000000`); keep other fields
  unchanged. Wrap as `{"version": VERSION, "program": normalizedProgram}` and
  encode recursively sorted-key, compact UTF-8 JSON without whitespace. Node
  order matters; `1` and `1.0` match, while signed zeros remain distinct. This
  avoids cross-language decimal/exponent formatting ambiguity. Digest fixture:
  the one-node `const(2)` program with output 0 hashes to
  `fccf28040726cd9a9be993e6de5e1f5bfb4880c34928df553e2caa695f10dc2b`.
- `validate(body) -> None`: no dependency imports. Invalid shapes raise
  `InvalidRequest(ValueError)` before worker startup.
- `solve(body, *, cancelled=None) -> dict`: synchronous, frozen JSON capture.
  `cancelled` is a trusted host zero-argument predicate, e.g. `threading.Event().is_set`;
  it is never request data. It must be fast/nonblocking. Predicate exceptions
  propagate only after cleanup. No cancellation registry or result store exists.

Every object uses **exactly** the listed fields; extras/missing fields reject.

```json
{
  "version": "manifold-numeric-optimizer/1",
  "program": {
    "nodes": [
      {"op": "x"},
      {"op": "const", "value": 2},
      {"op": "sub", "args": [0, 1]},
      {"op": "mul", "args": [2, 2]}
    ],
    "output": 3
  },
  "program_sha256": "<program_digest(program): 64 lowercase hex characters>",
  "backend": {
    "adapter": "manifold-numeric-optimizer/1",
    "source_sha256": "<SHA-256 of exact adapter file bytes>",
    "python": "3.12.16",
    "numpy": "2.2.6",
    "scipy": "1.15.3"
  },
  "mode": "minimize",
  "bounds": [-3, 5],
  "target": null,
  "x_tolerance": 1e-9,
  "residual_tolerance": null,
  "limits": {"evaluations": 500, "iterations": 200, "wall_ms": 5000}
}
```

`mode` is `minimize`, `maximize`, or `target`. For `target`, `target` is a finite
number and `residual_tolerance` is finite and nonnegative. Both must be null in
other modes. Bounds are closed, strictly increasing, each with absolute magnitude
at most 1e12. Constants/target/residual tolerance have the same 1e12 magnitude cap.
`x_tolerance` is finite, >= 1e-12 and <= min(1e12, interval width). Booleans, strings, NaN,
infinities and non-JSON structures are not numeric scalars.

The DAG has 1–256 nodes, depth <= 32; output and argument references are integer
indices (not booleans). Each argument must refer to an **earlier** node: cycles,
forward references and undeclared inputs reject. Every node must contribute to
output. Constants and `x` have the exact shapes above. All other nodes have exactly
`op` and `args`. Multiple `x` occurrences refer to the same single variable.

Canonical operations, not expression strings or arbitrary function names:

- Unary: `pos neg sqrt abs sin cos tan asin acos atan sinh cosh tanh exp ln
  log10 floor ceil round cbrt`.
- Binary: `add sub mul div pow atan2` (`atan2(y, x)` argument order).
- `min max`: 2–16 arguments.

All values/intermediates must be finite real IEEE-754 doubles. Powers require
an evaluated exponent in [-12, 12]. Negative bases use the existing Math.js
predictable real-power policy: its bounded rational interpretation must have an
odd denominator (for example `(-8)^(1/3)` and `(-8)^(2/3)` are real, while
`(-1)^0.5` rejects). The rational search retains its 10^7 denominator bound and
relative acceptance threshold below 1e-14. `atan2(0, 0)` rejects. Inverse trig and atan2
return numeric radians; trig consumes numeric radians. `ln` is natural log.
`round` follows the worksheet's default Math.js decimal-rounding policy: it first
corrects to 12 decimal places when nearly equal (`relTol=1e-12`, `absTol=1e-15`),
then rounds integral ties **away from zero**, including negatives. `floor` and
`ceil` likewise correct values indistinguishable from the nearest integer using
those tolerances. This differs from Python's rounding even for some adjacent
binary64 values, not only exact ties; differential tests exercise those boundaries.
`cbrt` is real for negative arguments. Floor/ceil/round consume canonical
dimensionless values; this adapter cannot verify units.
Constants such as pi/e must already be lowered to finite numeric constants.
Domain/overflow/nonfinite failures stop immediately; no penalty substitution.
There is no interval-wide domain or pole proof; ordinary floating math semantics
apply (e.g. tan near a mathematical pole can return a large finite value).

Compact serialized requests are capped at 65,536 UTF-8 bytes. The worker also caps
raw stdin. **HTTP integration must cap raw body bytes before JSON parsing** (this
Python API receives an already parsed object). Output is capped at 16,384 bytes.
There are no unbounded diagnostics or request-controlled error messages.

## Search, termination and result

Min/max uses only `scipy.optimize.minimize_scalar(method='bounded')`; max negates
the objective. Both closed bounds are explicitly evaluated and compared with all
valid interior samples; SciPy's final candidate is explicitly checked. This is a
**local search, not global proof**. A constant objective can converge; ties retain
the first sampled point (the lower bound).

Target uses only `scipy.optimize.brentq`: both bounds are evaluated, a satisfactory
endpoint is accepted, otherwise opposite residual signs are required. No bracket
returns `no_bracket`, including tangent roots the bracket does not capture. There
is no squared-residual minimization fallback. Success requires convergence **and**
actual returned-root residual <= tolerance. A discontinuous sign change can return
`residual_not_met`, never false success. Endpoint acceptance is the explicit
zero-iteration exception. Brent uses absolute `xtol` and `rtol = 4 * machine epsilon`;
bounded minimization also has SciPy's internal relative floating-point resolution.
Neither x tolerance alone nor solver success certifies a target residual.

Hard requested ranges: evaluations 1–10,000, iterations 1–1,000, wall_ms 1–30,000.
All objective evaluations (both endpoints, repeated solver endpoint calls, failed
evaluations and final checks) consume the same budget; no caching hides calls.
Bounded-minimizer `iterations` counts its interior objective calls (SciPy's `nit`);
a wrapper also enforces the cap during its startup. Brent iterations are reported
by SciPy; interrupted Brent runs have unknown (`null`) iteration count. Final
checks can exhaust the budget even after numerical convergence.

A fresh isolated subprocess uses a fixed no-shell invocation, empty inherited
environment plus explicit one-thread BLAS/OpenMP settings. The parent enforces a
wall deadline including startup/imports and checks cancellation at <=20 ms polling
intervals while waiting. It kills and reaps the worker before returning on timeout,
cancellation or exceptions; OS scheduling/kill/reap latency can extend wall time
beyond the requested instant. The worker also checks a cooperative numeric deadline.
There is no general hostile-code sandbox or OS memory quota: requests cannot execute
code, and DAG/evaluation bounds limit work. The eventual transport must enforce a
shared admission semaphore and keep its slot until `solve` returns.

Every result has exactly these fields:

| Field | Meaning |
| --- | --- |
| `version`, `program_sha256` | Captured adapter contract and program digest. |
| `expected_backend`, `backend` | Captured expected identity and actual identity, or actual null if not established. Actual identity is checked before evaluation. |
| `algorithm` | `scipy.optimize.minimize_scalar:bounded` or `scipy.optimize.brentq`. |
| `scope` | `local-search-not-global-proof` or `bracketed-root`. |
| `bounds`, `target` | Frozen request values. |
| `x_tolerance`, `residual_tolerance`, `relative_x_tolerance` | Effective requested tolerances; relative tolerance is Brent's 4*epsilon or null for bounded. |
| `limits` | Exact effective requested evaluation/iteration/wall limits. |
| `success`, `code` | Boolean and one closed termination code below. |
| `candidate` | null, or exactly `{x, output, residual}`; finite valid sample within bounds. Residual is signed output-target, or null outside target mode. |
| `evaluations`, `iterations` | Nonnegative known counts, or null when interrupted before those counts could be recovered. |

Codes: `converged`, `no_bracket`, `residual_not_met`, `iteration_limit`,
`evaluation_limit`, `deadline`, `cancelled`, `domain_error`, `program_mismatch`,
`backend_mismatch`, `unavailable`, `transport_error`. Only `converged` has success
true. Expected numerical nonconvergence is distinct from malformed requests,
dependency absence, capture/runtime mismatch, and worker transport failures.
No arbitrary SciPy `OptimizeResult` or exception text is serialized.

A valid partial candidate may be retained on numerical/domain/budget failure, but
is **not** a success certificate. Target success records the checked returned root;
other partial candidates are the best valid sample seen so far. Forced parent kill
cannot recover worker counts/candidate/actual identity: those fields are null,
not fabricated zeros. Pre-start failures have zero evaluations/iterations.
Source/program hashes are reproducibility checks, **not trusted graph provenance**.

## Verification boundary

Tests use analytic min/max and root oracles, closed endpoints, constant objectives,
no-bracket/tangent roots, discontinuity refusal, domains/poles/overflow, independent
function values and existing admitted sampler values, validation/security/resource
bounds, final-check budgets, identity/profile mismatch, missing dependencies,
fixed child environment, and callable cancellation/deadline child reaping.
The pinned numerical tests explicitly skip on unsupported/missing runtime; run them
in the documented venv, not only default Python. Missing dependency behavior is also
exercised with `-I -S`, which excludes all site packages.

The implementation checkout's full Python suite was attempted with both the pinned
venv and default Python. Its assistant companion startup test requires repository
Node dependencies (`node_modules` is absent in the prepared checkout); this is an
unrelated regression-check gap, not an optimizer pass or a reason to change the
companion. Parent integration must run the full suite after normal repository setup.
