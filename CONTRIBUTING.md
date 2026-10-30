# Contributing

Start with the [vision](docs/vision.md), [interaction design](docs/interaction-design.md)
and [product plan](docs/product-plan.md). Prioritize useful engineering work:
blank-canvas authoring, equation/data connections, computational artifacts and hierarchy
when the problem requires it.

For architecture or ownership changes, follow the [software design](docs/design/README.md)
and [canvas extension patterns](docs/design/canvas-extension-patterns.md). Record consequential
choices in an ADR. The [repository map](docs/repository.md) identifies module boundaries.

## Setup

Requires Python 3.11+, Node 22.18+ and npm.

```sh
make setup
make canvas
```

Leave the Python server running and use `make canvas-dev` in another terminal for
frontend development. See the [application guide](apps/canvas/README.md).

The root `package-lock.json` owns both npm workspaces. Use `npm install` at the root
when updating dependencies and include the lockfile. `npm ci` installs shared tools
and both workspaces.

## Checks

```sh
make check
make check-browser
make check-foundation-package-browser
make verify
```

Browser checks require installed Chrome:

```sh
npx --no-install playwright install chrome
```

`make verify` runs product checks and both browser suites sequentially. CI runs the
same target. Set `PYTHON` to choose another Python executable. Documentation checks
include nonignored working-tree drafts; they do not stage changes.

## Implementation boundaries

- Foundation runtime code has no application, experiment, React or Node dependencies.
  Canvas consumers use declared `@manifold/foundation` exports.
- Renderers read immutable state and submit intents through application ports. They do
  not install executors, own durable storage or create a second accepted state/history.
- Preserve strict validation, limits, atomic operations, Undo/Redo, recovery and portable
  file behavior. Opening a file is not permission to execute its contents.
- Preserve source identity and mathematical meaning when changing layout or navigation.
  Incomplete expressions are valid work; missing information must not invent results.
- Test numerical changes against independently calculated results. Distinguish automated
  interaction mechanics from demonstrated usability or physical validity.
- For execution, use the session computation port and shared task scheduler. Install
  trusted, bounded executors only at the composition root; keep stale-result and
  cancellation safeguards intact.

## What belongs in the public repository

Include application/package source, executable tests and fixtures, build/CI tooling,
maintained architecture/user documentation, and curated README assets in `docs/images`.

Keep generated evaluation reports, historical acceptance notes, research experiments,
raw test screenshots, local workspace data, credentials, caches and dependencies local.
The ignore rules define these boundaries; `make check-repo` also rejects force-added
ignored files. Existing local research is not deleted.

Optional workload/profile tools may generate ignored local reports. Reports are not
required inputs to ordinary builds or correctness checks, and CI does not publish them
as artifacts. Engineering provenance inside a user's workspace is product data, not a
repository evaluation report; its contracts and tests must remain intact.

Contributions are licensed under Apache-2.0.
