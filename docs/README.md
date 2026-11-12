# Manifold documentation

## What are you trying to do?

| Task | Start here |
| --- | --- |
| Use the engineering canvas | [Canvas guide](guides/canvas.md): authoring, drawing, models, saved work and sharing. |
| Automate work with an agent | [Agent guide](guides/agents.md) and [bundled skill](../.agents/skills/manifold/SKILL.md): discover, inspect, edit, check, compute and hand back a candidate. |
| Connect an external agent to a live canvas | [MCP reference](reference/mcp.md): scoped access, focused reads, replay-safe editing, asynchronous jobs and portable native export. |
| Understand portable `.manifold` files | [File format reference](reference/manifold-format.md): envelopes, compatibility, assets, limits and trust boundaries. |
| Look up a CLI command | [CLI reference](reference/cli.md): flags, JSON contracts, statuses, exit codes and file safety. |
| Integrate the TypeScript API | [Headless and agent API reference](reference/headless-api.md): owners, transactions, execution and JSON helpers. |
| Contribute or run checks | [Contributing](../CONTRIBUTING.md) and [development guide](development/README.md). |
| Find code ownership | [Repository map](repository.md): packages, modules and tooling boundaries. |
| Understand or change the architecture | [Software design](design/README.md): implemented contracts, proposals and decision history. |

## Product direction

These pages explain intent and priorities, not a list of shipped features:

- [Vision](vision.md): mission and enduring principles.
- [Interaction design](interaction-design.md): intended experience and shared operations.
- [Product plan](product-plan.md): capability scope and priorities.
- [Roadmap](ecosystem-and-roadmap.md): remaining product validation and ecosystem work.

## Documentation boundaries

Guides explain tasks; reference defines exact public contracts; development documentation
explains contribution workflows; design views own architecture and invariants. Accepted
ADRs preserve rationale and superseded choices without overriding current reference.
Package READMEs remain entry points, with the reusable foundation's interface documented
in its [package guide](../packages/foundation/README.md).

Historical planning/evaluation notes and generated reports remain local-only. Public pages
must not depend on unpublished reports or stale migration narratives. Executable correctness
tests and fixtures remain part of the public source. See the
[documentation maintenance guidance](development/README.md#documentation-ownership).
