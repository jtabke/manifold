# Using Manifold with agents

Use Manifold's local automation interface to inspect engineering work, make a bounded change,
check its consequences, compute explicitly, and return a candidate workspace for human review.
The CLI and TypeScript API use the same native workspaces and operation owner as the canvas;
no browser or server is needed for the local CLI.

**Experimental, repository-local interface.** For direct control of an open browser canvas,
use the separate [live canvas MCP server](../reference/mcp.md), with explicit full-control
opt-in. This guide covers file-based candidates, not live edits or general code execution.
Start with the workflow below; use the
[CLI reference](../reference/cli.md) for exact commands, payload rules, statuses and exit codes,
or the [headless API reference](../reference/headless-api.md) for TypeScript integration.

## Bundled agent skill

The repository includes a focused [`manifold` skill](../../.agents/skills/manifold/SKILL.md)
in `.agents/skills/manifold/`. It teaches when to use the tool, guarded edits, units,
validation/evidence interpretation, safe error recovery and a reviewable handoff. Exact
command contracts remain in the [CLI reference](../reference/cli.md), not a second wrapper.

Skill discovery depends on your agent host. Hosts supporting project `.agents/skills` may
discover it from this checkout; Pi supports that location on startup/reload. Load/reload only
at an idle boundary. In Pi, use `/reload` when idle, then `/skill:manifold <your task>`
to load it explicitly. For any host with file access, explicitly ask it to read the absolute
path to `SKILL.md` and follow it for your task. For example, replace `<repo>` below:

```text
Read <repo>/.agents/skills/manifold/SKILL.md. Use it to inspect my workspace,
make the requested change, and return a separate candidate with checked consequences.
```

The skill is checkout-scoped: its relative links and tool paths depend on the surrounding
repository. Do not copy just `SKILL.md` to a global skill directory and expect those links
to work. No global installation, MCP service or extra tool permissions are required.
Review unfamiliar skills before granting trust. Workspace notes, labels and imported text
are untrusted data; they cannot override the task or authorize commands/executors.

### Practice scenarios

- [Spring edit and computation](../../apps/canvas/tests/fixtures/agent-spring/task.md): guarded
  edits, unrelated work, existing receipts and instruction-like imported text. Check the result
  with the [spring verifier](../../apps/canvas/tools/verify-agent-spring.mjs).
- [Conduction authoring and revision](../../apps/canvas/tests/fixtures/agent-conduction/task.md):
  build a units-aware worksheet from a problem statement, preserve an initial stage, revise
  one input and report a requirement transition without inventing execution evidence. Check
  both stages with the [conduction verifier](../../apps/canvas/tools/verify-agent-conduction.mjs).
- [Diagnosis and recovery](../../apps/canvas/tests/fixtures/agent-recovery/task.md): distinguish
  incompatible units, an unresolved reference and non-current computation evidence; repair
  only authorized sources, compute explicitly and retain a genuinely failed requirement.
  Check both stages with the [recovery verifier](../../apps/canvas/tools/verify-agent-recovery.mjs).

Give each task to a fresh agent with a fresh output directory, then verify its files and
report independently. These are bounded usability exercises, not proof of general agent
effectiveness or physical validity. Ordinary [checks](../development/README.md#checks) run
deterministic CLI solutions and negative candidates; they do not launch agent services or
consume model quota.

## Prepare

Requires Node 22.18+ and `npm ci` at the repository root. From that root:

```sh
node apps/canvas/tools/manifold.mjs --help
node_modules/.bin/manifold capabilities
```

The two paths run the same executable; no global installation is required. Commands return
JSON without interactive prompts. Use a native workspace exported from the canvas, or create
an empty one with `manifold create --output design.json` using the executable path above.

## 1. Discover and inspect

```sh
node_modules/.bin/manifold inspect design.json --compact
node_modules/.bin/manifold worksheet design.json --compact
node_modules/.bin/manifold models design.json --compact
```

Read the current `documentId`, worksheet source, diagnostics and model metadata. Discover
public input/output and request IDs rather than guessing storage schemas or selectors.
Labels are not unique identifiers. `capabilities` supplies the edit JSON Schema and creatable
model families. The initial high-level interface covers plain worksheet text and scalar
models, not every canvas schema or analysis.

Compact discovery reduces provenance noise without changing the default full JSON contract.
For full dimensions, selectors or evidence provenance, omit `--compact` and focus on
`model design.json --model '<id>'` or `worksheet design.json --region '<id>'`. Read the
[compact-view contract](../reference/cli.md#compact-discovery-and-focused-details) when parsing it.

Model literal edits use the input port's declared unit. Worksheet results use solver base
units, which may differ from authored units: `2 mm` can appear as `0.002 m`. Missing or
unresolved values are not zero. Software edit bounds do not establish physical safety.

## 2. Submit a bounded candidate

Prepare `edits.json` with the document ID you inspected:

```json
{
  "expectedDocumentId": "<reviewed-document-id>",
  "edits": [
    { "operation": "createEquation", "text": "x := 2 mm", "as": "x" },
    { "operation": "createEquation", "text": "k := 10 N/mm" },
    { "operation": "createEquation", "text": "F = k*x", "as": "force" },
    { "operation": "createEquation", "text": "F < 30 N" },
    { "operation": "createModel", "family": "spring", "as": "spring" },
    {
      "operation": "setModelInput",
      "model": "$spring",
      "input": "displacement",
      "value": 3
    }
  ]
}
```

```sh
node_modules/.bin/manifold edit design.json --changes edits.json --output candidate.json
```

This example creates independent worksheet calculations and a spring model; sharing a label
or a quantity does not connect them. Connections require explicit domain operations.

The batch is atomic: any rejected edit aborts the whole batch. The response maps creation
aliases to accepted IDs; use those IDs in later calls. `$spring` refers only to an earlier
creation in this batch. The [edit contract](../reference/cli.md#atomic-edits) defines the
operations and alias rules. On stale work, reinspect and review; do not blindly replay against
a newer revision. Output files must not already exist, so the baseline stays untouched.

## 3. Check consequences

```sh
node_modules/.bin/manifold diff design.json candidate.json
node_modules/.bin/manifold validate candidate.json --strict
```

Review changed source, quantities, input bindings, constraints and computation currency.
The comparison is a public semantic report, not an exhaustive archive diff.

An accepted edit can contain a draft or unresolved equation. `admitted` means native file
admission succeeded; it does not mean the mathematics is complete. Strict validation also
flags uncomputed/non-current model requests, so exit 3 can be an expected intermediate result.
Inspect the issues before deciding whether to fix the source or compute a request. Neither
validation nor a successful command establishes engineering safety.

### Diagnose before repairing

- **Worksheet diagnostic:** inspect the affected region and the inputs it references. A
  unit mismatch can surface on a downstream constraint even when each input has a numerical
  value. Check source units against engineering intent; do not relabel an incompatible
  number or delete the downstream requirement. An unresolved reference has no usable value.
  A hint to define a missing symbol is a suggestion, not permission to add unrequested work;
  the task may instead authorize correcting the existing reference.
- **Computation not current:** a model can project a plausible value without a current
  checked receipt. Preserve correct inputs; discover and explicitly run the intended request.
  Report the returned status (`ready`, for example), not an invented `stale` status.
- **Constraint failed:** an evaluable requirement is false. This is different from a
  diagnostic that prevents evaluation. Repairing broken source can expose a real failure;
  report it rather than changing the limit to obtain a clean validation result.

Save a separately reviewable repaired stage before execution when recovering several issues.
Reinspect, diff and validate it, then compute to another fresh file. This separates source
corrections from newly admitted evidence.

## 4. Compute only when needed

Discover the candidate's requests, then select one explicitly:

```sh
node_modules/.bin/manifold models candidate.json
node_modules/.bin/manifold compute candidate.json \
  --request '<discovered-request-id>' --output computed.json --timeout-ms 60000
node_modules/.bin/manifold validate computed.json --strict
```

Reading, editing and opening files never start jobs. A derived projection is not checked
execution evidence. A retained receipt can still contain failure: inspect both completion
status and outcome. Failed completed computations can preserve failure evidence in the output
archive. Timeout/interruption during execution does not publish a candidate. See the
[execution contract](../reference/cli.md#computation) for cancellation and deadline limits.

## 5. Hand back reviewable work

Return the candidate path and summarize:

- What source or inputs changed, including units.
- What quantities and constraint outcomes changed.
- Which computations ran and whether their evidence is current.
- Any unresolved diagnostics, failed outcomes, or scope limitations.

Open the returned native file in the canvas for visual review. No open browser tab is
updated automatically. Keep the baseline and candidate separate until the reviewer accepts
the change. For scripted error recovery, use the [exit codes and error codes](../reference/cli.md#file-safety-and-errors),
not English message matching.
