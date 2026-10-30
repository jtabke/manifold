# 0034 Workspace boundaries and repository evidence

Status: Accepted for repository consolidation, 2026-10-28; public artifact policy updated below.  
Related: [repository map](../../repository.md), application acceptance audit (internal design note).

## Context

The runtime contracts are shared, but canvas code accumulated in one flat directory and
one large component. Foundation tooling reached into the canvas dependency directory,
production consumers could bypass package exports, current guidance retained superseded
migration claims, and historical JSON reports obscured executable tests. CI ran local
checks without the complete browser/workload acceptance path.

## Decision

Use one root npm workspace lockfile and pinned toolchain for the canvas and foundation.
The canvas declares its foundation dependency and consumes only public package exports.
Keep the foundation runtime independent of application, experiments, UI and Node modules.
An AST-based repository check includes type imports, reexports and literal dynamic imports;
negative policy tests witness disallowed dependencies.

Group existing canvas files by application coordination, renderers, interaction mechanics
and styles. Extract math, note, response-plot, command-palette and navigation representations
from the shell with explicit props/callbacks. Preserve the accepted owner, existing DOM/classes,
preview/Undo behavior and renderer buffer/storage ports. Remove old paths without forwarding
modules. Continue domain/application decomposition when a concrete change exposes a coherent seam.

Keep generated measurements, research experiments, planning/acceptance notes and historical
foundation evaluation files local-only through ignore rules. Preserve existing local files;
do not make public builds depend on archive inventories or private production-count baselines.
Keep product source, executable tests/fixtures, maintained architecture/user documentation
and curated README images publishable. Public documentation must not link to unpublished files.
A repository guard rejects force-added ignored files using the actual Git ignore rules.

CI installs the root lockfile and Chrome and runs `make verify` sequentially. It does not
upload internal evaluation artifacts. Browser checks and optional workload tools create
ignored report directories as outputs, never require previous reports as inputs. Timing
and process RSS remain diagnostics rather than cross-machine thresholds.

## Alternatives and consequences

Keeping application-owned tooling avoids a root package but leaves the reusable package
dependent on an application directory. Independent tool installations add duplicate versions
and locks. The workspace adds a root manifest/lock but gives reproducible shared resolution
without changing runtime dependencies or upgrading pinned tools.

Leaving reports beside tests hides executable contracts among hundreds of checkpoints.
The earlier archive-inventory and CI-report-publication policy is superseded: historical
bytes remain on the author's disk, but are not public repository inputs. This separates
reproducible test sources from generated evaluation outputs without deleting research.

A broad application rewrite would couple repository cleanup to product behavior. This slice
uses existing seams and browser witnesses. The shell still carries substantial orchestration;
file movement and extraction do not prove net production simplification.

## Validation

`make check-repo` checks workspace exports/imports and rejects ignored tracked artifacts;
a disposable-repository regression covers forced additions without touching the real index.
`make check-docs-worktree` checks public links and diagram ownership. `make verify` runs
local correctness checks plus foundation and canvas browser suites. Validate publication
with a clean source export containing no private folders. Human working-loop validation
remains a separate product gate.
