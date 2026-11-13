# Repository organization and maintenance

Manifold is a four-package npm workspace with one lockfile and shared development tools.
The [extension guide](design/canvas-extension-patterns.md) defines implemented feature patterns;
the [product plan](product-plan.md) owns priorities and [ADRs](design/decisions/README.md)
record architecture choices.

## Code ownership

| Location | Responsibility |
| --- | --- |
| `packages/foundation/src` | UI-independent immutable records, atomic operations, computation evidence, resources and storage. No application, experiment, React or Node imports. |
| `packages/cli` | Built standalone CLI/MCP distribution, lazy installed launcher, local diagnostics, clean-install and MCP Apps browser checks. |
| `packages/foundation/workbench` | Executable examples of foundation contracts. |
| `apps/canvas/src/regions/app` | Composition, coordination, admission, file/storage lifecycle and renderer buffers. |
| `apps/canvas/src/regions/renderers` | Canvas representations and controls; transient input and intents through application ports. |
| `apps/canvas/src/regions/interaction` | Commands, viewport, navigation and transient gestures. |
| `apps/canvas/src/regions/styles` | Canvas styles. |
| `apps/canvas/src/regions/*.ts` | Domain schemas, models, projections and computation adapters. |
| `apps/canvas/src/notebook` | Bounded mathematics and immutable derived views. |
| `apps/canvas/server.py`, `artifact_sampler.py`, `assistant_bridge.py` | Static/API host, restricted Python sampling and lazy owned assistant-process bridge. |
| `apps/canvas/tests`, `packages/foundation/test` | Executable contracts, browser workflows and fixtures. |
| `apps/canvas/src/headless*.ts`, `apps/canvas/src/agent.ts` | Browser-free canvas owner and transport-free JSON automation contracts. |
| `apps/assistant` | Optional server-managed Pi companion: authenticated setup/connection bridge, restricted tools, connection-scoped keys and ephemeral conversations. |
| `apps/assistant/src/mcp*.mjs`, `apps/canvas/src/regions/mcp*.ts`, `apps/canvas/src/regions/app/CanvasMcp.tsx` | Local stdio MCP transport/tools, scoped semantic access, tab-session mutation/job recovery, focused reads, native snapshots and explicit browser grant/activity over the existing owner. |
| `apps/canvas/src/regions/assistant.ts` | Transient reviewed proposals over the active canvas owner; no second persistence/history authority. |
| `apps/canvas/tools/manifold.mjs` | File-based agent CLI over the headless owner; explicit computation and no-clobber candidate publication. |
| `apps/canvas/tools`, `scripts` | Other diagnostics, check orchestration and repository policy. |
| `docs/images` | Curated, real application screenshots used by the README. |
| `.agents/skills/manifold` | Manifold product skill, also bundled into installed tooling; links to public guides/reference rather than duplicating the CLI. |
| `apps/canvas/tests/fixtures/agent-spring`, `agent-conduction`, `agent-recovery` | Native baselines and bounded skill acceptance tasks for editing/computation, worksheet authoring/revision and diagnosis/recovery; generated candidates/reports are not checked in. |
| `docs/guides` | Task-oriented canvas and agent usage. |
| `docs/reference` | Exact CLI and headless/agent API contracts. |
| `docs/development` | Contributor setup, checks and optional diagnostics. |
| `docs/design` | Architecture/invariants, labelled proposals and decision rationale. |

The application shell lives in `app/Regions.tsx`. Keep exploration, renderer buffers,
commands and presentation in their owning modules rather than adding another accepted store.
An extraction should remove the original implementation and preserve ownership; moving
lines alone is not simplification.

`notebook/math.ts` owns dimensional evaluation. `worksheetProjection.ts` owns bounded
worksheet derivation/caches. `authoredModels.ts`, `modelCommands.ts` and `modelResults.ts`
own reusable model definitions, publication and output requests; `modelAnalysis.ts` and
`modelAnalysisCommands.ts` own bounded sweeps and accepted analysis intents.

## Documentation entry points

[Documentation](README.md) routes readers by task. The root README owns product overview and
quick start; [Contributing](../CONTRIBUTING.md) owns contribution expectations. Application
package READMEs are short entry points, while the reusable foundation keeps its own public
interface in its [package guide](../packages/foundation/README.md). Keep each contract in
one owning page and link to it from guides; maintain history in ADRs rather than repeating
migration status in current usage documentation.

## Package and tooling boundaries

Run `npm ci` or `make setup` from the repository root. Update dependencies at the root
and preserve its lockfile. Workspace scripts resolve shared tools from the root.

Canvas code consumes declared public package exports:

```ts
import { createWorkspace } from "@manifold/foundation";
import { indexedBackend } from "@manifold/foundation/indexed-db";
```

Foundation tests may inspect internals. Production consumers must use declared exports.
Renderers must not reach durable storage/admission implementations. `make check-repo`
checks static, type, reexport and dynamic imports; negative tests exercise the guard.

## Checks and CI

```sh
make check-repo
make check
make check-browser
make check-foundation-package-browser
make verify
```

CI installs the root lockfile and Playwright-managed Chromium, then runs `make verify` on pushes and pull requests.
Build/browser phases run sequentially because they share output. Browser scripts use
private temporary servers. No internal evaluation artifacts are uploaded.

## Public source versus local research

The public checkout contains source, tests/fixtures, tooling, user/architecture docs
and curated assets. It must build and pass ordinary checks without local research.

The ignore rules keep `evidence/`, `experiments/`, `docs/briefs/`, historical foundation
evaluation notes and their audit/count scripts local-only. Raw test screenshots, workspace
data, caches and dependencies are also excluded. Existing files stay on disk.
`make check-repo` rejects tracked files matching ignore rules, including force-added reports.
Optional diagnostic tools can regenerate ignored outputs; those outputs are not build inputs.

Historical decisions may mention local-only notes, but public documentation must not link
to unpublished files. Run `make check-docs-worktree` to check links, anchors and diagrams
without staging anything. Curated screenshots belong in `docs/images`, not the ignored
test screenshot directory.
