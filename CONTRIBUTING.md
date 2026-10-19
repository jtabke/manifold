# Contributing

Start with the [vision](docs/vision.md), [interaction design](docs/interaction-design.md)
and [roadmap](docs/ecosystem-and-roadmap.md). Prioritize blank-canvas authoring,
effortless equation/data connections, useful computational artifacts and hierarchy
when the work requires it.

## Code and setup

The application lives in `apps/canvas`. Its React interface and bounded mathematics
are in `src`; `server.py` serves the built frontend and `artifact_sampler.py` runs
a restricted Python plotting grammar. Python requires no third-party packages.
`tests` contains local interaction checks, browser workflows and server tests.

Use Python 3.11+, Node 22.18+ and npm:

```sh
make setup
make canvas
```

For frontend development, leave the server running and run `make canvas-dev` in
another terminal. See the [application guide](apps/canvas/README.md).

## Checks

```sh
make check
make check-browser
```

The browser suite requires installed Chrome and runs against a temporary server.
Set `PYTHON` to select a different Python executable. Include npm lockfile changes
when updating dependencies.

Keep changes focused on actual engineering work. Layout and navigation must preserve
mathematical meaning, identity and evaluated context. Incomplete expressions are
valid work; unresolved information must not produce invented results. Test numerical
changes against independently calculated results, and distinguish automated mechanics
from demonstrated usability or physical validity.

Keep generated assets, dependencies, caches and credentials out of commits.
Contributions are licensed under Apache-2.0.
