# Developing Manifold

Use this guide for setup, checks and diagnostic tooling. For contribution scope and review
expectations, see [Contributing](../../CONTRIBUTING.md). For module ownership, use the
[repository map](../repository.md); for implemented feature contracts, use
[canvas extension patterns](../design/canvas-extension-patterns.md).

## Setup and local development

Requires Python 3.11+, Node 22.18+ and npm. Run commands from the repository root; the npm
workspace has one lockfile and shared tools. Python uses the standard library.

```sh
make setup
make canvas
```

Without Make:

```sh
npm ci
npm --prefix apps/canvas run build
python3 apps/canvas/server.py
```

The application is at <http://127.0.0.1:58310/>. The Python server binds to localhost;
`--port` selects another port. For frontend development, leave that server running and use:

```sh
make canvas-dev
```

Vite runs at <http://127.0.0.1:58311/> and proxies API calls to port 58310. `make foundation`
runs the reusable foundation's workbench; see its [package guide](../../packages/foundation/README.md).

## Checks

```sh
make check          # Repository policy, docs, Python, formatting, types, local tests and builds
make verify         # All of the above, plus foundation and canvas browser workflows
```

Browser workflows require installed Chrome. Build/browser phases share output, so run them
sequentially. `make verify-application-foundation` is an alias for `make verify`; it does not
regenerate optional diagnostic reports.

For narrower checks:

```sh
make check-repo
make check-docs-worktree
npm --prefix apps/canvas run check
npm --prefix apps/canvas test -- check-agent check-agent-cli check-agent-skill check-agent-compact check-agent-conduction check-agent-recovery
make check-browser
make check-foundation-package-browser
```

Canvas browser checks start a temporary server on port 58312. Use `MANIFOLD_BASE_URL` only
for an existing test server you own, or `PYTHON` to choose the Python executable.
For a focused browser workflow:

```sh
npm --prefix apps/canvas run build
npm --prefix apps/canvas run test:all-browser -- check-blank-canvas-browser
```

The agent checks cover JSON contracts, atomic edits and aliases, revision guards, diagnostics,
semantic differences and evidence, plus CLI subprocess exit/channel behavior, safe publication,
file changes, pending-job timeout/signals and retained failed receipts. Existing headless checks
cover canvas/API/native round trips, immutable snapshots, native admission, no implicit
network access, multi-output typed execution and unit derivation. Authoring checks exercise
single-step Undo/Redo, rollback even after caught edit failures, stale/reentrant calls,
async callbacks, expired editor handles and disposal:

```sh
npm --prefix apps/canvas test -- check-headless check-headless-discovery check-headless-authoring
```

### Agent-to-canvas browser handoff

`check-agent-handoff-browser` authors separate ready/computed spring candidates with the real
CLI, opens them through native file input, checks displayed source/units/results and the failed
constraint, edits worksheet displacement through the UI, exercises Undo/Redo, exports and
reopens in fresh browser contexts. Durable IndexedDB evidence, receipt identities and request
statuses must survive without executor requests; worksheet edits must not change the independent
model's evidence. Overlapping fixture model cards are moved using actual UI handles before editing.
This verifies interaction mechanics, not unfamiliar-engineer usability.

```sh
npm --prefix apps/canvas run build
npm --prefix apps/canvas run test:all-browser -- check-agent-handoff-browser
```

Chrome is the default browser, as in the existing browser suite. This new check also accepts
`MANIFOLD_BROWSER_EXECUTABLE=/absolute/path/to/chromium` for explicit local Chromium verification;
that override applies only to this check and is not a passing Chrome gate for the full suite.

### Skill acceptance scenarios

The [`manifold` skill](../../.agents/skills/manifold/SKILL.md) has a
[checked-in spring task and native baseline](../../apps/canvas/tests/fixtures/agent-spring/task.md).
`check-agent-skill` verifies portable metadata, runs the real CLI from outside the repository,
and independently checks numerical facts, preserved authored content, current computation
receipts and an honest structured report. Negative cases include stale edits, incorrect
units, drafts/unresolved source, a loosened constraint, missing or stale evidence, misleading
reports and unrelated content changes.

The [conduction task](../../apps/canvas/tests/fixtures/agent-conduction/task.md) adds a distinct
workflow: author a worksheet from a problem statement, retain an initial stage, then revise
one dimensional input. `check-agent-conduction` exercises compact discovery and scoped full
details through real CLI subprocesses. Its verifier checks the protected baseline, exact
revision scope (including protected revision headers and views), dimensions, expected arithmetic
and independent conductivity, area, temperature-difference and thickness counterfactuals.
Negative cases include nominal input references multiplied by zero and metadata-only tampering.
Numerical checks allow 1e-12 relative/absolute tolerance for floating-point rounding. No execution
job or receipt is required for worksheet-derived values.

The [recovery task](../../apps/canvas/tests/fixtures/agent-recovery/task.md) starts with wrong
worksheet units, an unresolved reference and a spring projection whose checked evidence is
not current. `check-agent-recovery` runs the real CLI through diagnosis, one guarded repair,
a separately saved pre-computation stage and explicit spring execution. It checks the residual
failed requirement, protected revisions/views and receipt-pinned history, all historical receipts
and their contexts, unrelated model evidence, honest statuses and structured handoff, plus
rollback, stale guards and negative candidates. It uses the native export policy for retained
revisions: superseded unpinned source heads may be omitted; session Undo is not file history. A passing verifier
does not establish that every claimed command was executed; cached requests can leave no new
saved evidence. Review command logs for that distinction.

`check-agent-compact` verifies opt-in compatibility, JSON-safe summaries, preserved
values/units/statuses, current/pending/failed evidence, diagnostics, focused region detail,
full provenance access and unchanged accepted state. Its bounded fixture-size check guards
against reintroducing receipt-key/provenance noise, not a general response-size guarantee.

To assess usability rather than only CLI correctness, explicitly load the skill in a fresh
agent context, provide the task and a private output directory, and run afterward:

```sh
node apps/canvas/tools/verify-agent-spring.mjs /absolute/path/candidate.manifold /absolute/path/report.json
node apps/canvas/tools/verify-agent-conduction.mjs /absolute/path/initial.manifold /absolute/path/final.manifold /absolute/path/report.json
node apps/canvas/tools/verify-agent-recovery.mjs /absolute/path/repaired.manifold /absolute/path/candidate.manifold /absolute/path/report.json
```

All three verifiers admit/reopen candidates through the existing canvas owner and compare them
to the baseline with independent expected arithmetic. None writes submitted files or
starts execution jobs; the conduction verifier also revises an isolated in-memory copy to
check how the formula responds to other inputs. These checks cannot
prove which commands an agent ran, inspect arbitrary prose for honesty, or certify physical
validity. Review the transcript/summary as well. Keep transcripts, reports and candidates in
temporary/ignored evidence locations. Paid agent runs are manual, not part of `make check`.

## Implementation boundaries

Features submit typed requests through `apps/canvas/src/regions/commands.ts`. Accepted domain
checks run inside the shared owner through `app/canvasDocument.ts`. `canvasWorkspace` in
`workspaceFiles.ts` coordinates Save/Open/New/Export through that owner and the incremental
store. UI code owns unaccepted buffers; it downloads or navigates only after successful
operations. Do not add accepted state, history or persistence inside a component.

Computations belong to `session.computations`. A renderer reads/subscribes through the service
and requests `run()` explicitly; mounting does not create another executor or cache.
`createArtifactComputations` observes core receipts and owns demand/cancellation intent.
A trusted host installs an `ArtifactExecutor` at session construction; `samplingExecution.ts`
adapts captured inputs and stages verified code bytes for the shared checked-admission path.
`artifactRuntime.ts` contains React bindings, not another result store.

Sampling recipes retain declared input references, frozen context and exact source pins;
parameter edits change the selected execution key, while unrelated notes/layout do not.
The installed typed method validates returned output before publication. See
[ADR 0027](../design/decisions/0027-normalized-sampling-plans.md),
[ADR 0028](../design/decisions/0028-shared-typed-execution-evidence.md) and
[ADR 0029](../design/decisions/0029-canvas-sampler-on-shared-evidence.md) for rationale.
The [computation contracts](../../apps/canvas/tests/check-artifact-computations.mjs)
exercise injection, source invalidation, multiple readers, recovery and resource failures.

Worksheet projection, semantic identity and sampled curves share prepared expressions and
the dimensional evaluator. Successful edits reuse unaffected values; ambiguity, errors and
order changes may require full evaluation. These read-only derivations own no document
changes, history, execution currency or persistence. See
[ADR 0037](../design/decisions/0037-bounded-incremental-worksheet-derivation.md).

## Optional diagnostics

These reproduce bounded measurements, not latency, heap, usability or engineering-validity
guarantees. Generated reports stay local/CI-ephemeral under ignored `evidence/` paths and are
not prerequisites for ordinary checks. Read each tool's source for its workload and output.

| Command from repository root | Diagnostic scope |
| --- | --- |
| `make measure-artifact-computations` | 1/8/16-request computation-service demand and observation. |
| `node apps/canvas/tools/measure-canvas-document.mjs` | 10/100/256 regions, Keep/Undo, views and checked results; `--digest` checks tested source identity. Excludes rendering and browser storage. |
| `node apps/canvas/tools/measure-canvas-storage.mjs` | Save planning, hashing and memory-backend writes with a 960 KB CSV; not IndexedDB latency. |
| `node apps/canvas/tools/measure-canvas-retention.mjs` | Protected history/result cleanup, Save and serialized storage reduction. |
| `node apps/canvas/tools/measure-result-snapshots.mjs` | 201-point updates and native source deduplication with a 940 KB CSV. |
| `node apps/canvas/tools/measure-calculation-history.mjs` | Recent-cache growth over 1,000 edits and ordinary edits with kept content. |
| `make measure-foundation-models` | Independent model source/storage costs. |
| `make measure-sampling-plans` | 10/100/256-region closure and Save costs. |
| `make measure-canvas-capacity` | Native/local sizes, UTF-8/JSON expansion, fresh-process handoff, recovery and refusal. |
| `make measure-canvas-scene` | 1/8/24 tools and 12 named layouts over source-backed checked work. |
| `make measure-authored-models` | Authored scalar model workload. |
| `make measure-model-analyses` | Model-backed analysis workload. |
| `make measure-worksheet-evaluation` | 64/256-row sparse, chain and fan-out derivation and cache limits. |

For the large drawing workload, including 2,000 marks and an 8,192-point stroke:

```sh
npm --prefix apps/canvas run build
npm --prefix apps/canvas run test:all-browser -- check-drawing-performance-browser
```

Its report, `evidence/current/canvas/drawing-browser-results.json`, separates preview geometry,
owner publication, browser rendering opportunities, durable saving and JavaScript heap.
Timings depend on the device. Rendering-opportunity and automation timings are not physical
input-latency guarantees.

## Documentation ownership

- [User guides](../README.md): task-oriented instructions for canvas users and agents.
- [Reference](../reference/cli.md): exact public API/CLI contracts and limits.
- [Design](../design/README.md): current ownership/invariants, explicitly labelled proposals,
  and decision rationale. ADRs retain history; guides should not narrate migrations.
- Package READMEs: short package-specific entry points, with foundation's own public interface
  documented in its package. `AGENTS.md` is reserved for coding-agent repository instructions,
  not product usage documentation.

Update the owning page rather than copying a contract into several guides. Run
`make check-docs-worktree` after moves or link changes; it includes nonignored untracked docs.
Dependencies retain their own licenses; font and icon notices ship in their npm packages.
