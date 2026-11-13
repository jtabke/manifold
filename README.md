<p align="center">
  <img src="apps/canvas/public/manifold-logo.png" alt="Manifold" width="420">
</p>

<h1 align="center">Manifold</h1>
<p align="center"><strong>A bicycle for the engineering mind.</strong></p>
<p align="center">Create · Connect · Explore</p>

Manifold is an open-source engineering canvas for equations, measurements, sketches
and computational results. Think spatially, connect your work and explore alternatives
without losing the original.

![Units-aware thermal calculation and an interactive response plot on the Manifold canvas](docs/images/engineering-canvas.png)

## Work with the problem, not the interface

- **Write naturally.** Place equations and notes anywhere. Units-aware results appear
  beside your work; a quiet, content-sized editor keeps the canvas out of the way.
- **Connect and inspect.** Import CSV measurements, trace mathematical relationships
  and put plots and tables alongside the definitions that produced them.
- **Explore safely.** Vary an input, see downstream effects and constraint crossings,
  then cancel, accept the value or keep an alternative.
- **Sketch your reasoning.** Use pressure-sensitive ink, highlighter, shapes, labels
  and attached visual connectors. Draw and hold a pen stroke to preview a clean line,
  circle or rectangle. Sketches never silently become mathematical dependencies.
- **Keep control.** Undo/Redo, deliberate docking previews, overlap selection and
  searchable, customizable shortcuts support different ways of working.
- **Keep your work.** Save locally in your browser and export portable workspace files.
  Local browser storage is device-specific; export a file for backup or handoff.

**Early prototype.** These are implemented interactions, not a claim of validated
engineering practice or demonstrated usability. AI is optional and requires explicit provider setup;
ordinary local use does not require credentials.

## A closer look

### Explore an input before changing your baseline

Preview the consequences, including whether a constraint still holds. Keep a useful
alternative or return to the original.

![Live exploration of force with a power constraint, previewed results and a response plot](docs/images/live-exploration.png)

### Put diagrams beside the mathematics

Sketch a load path, annotate assumptions and connect visual elements without changing
the computational model.

![A spring and applied-force diagram drawn beside units-aware engineering equations](docs/images/drawing-and-diagrams.png)

### Make the keyboard yours

Search the shortcut reference, record personal canvas bindings, or edit and exchange
their JSON configuration. Editor keys and essential navigation remain protected.

![Personal shortcut customization with recording controls and JSON import and export](docs/images/shortcut-customization.png)

## Run locally

Requires **Python 3.11+**, **Node 22.18+** and npm. Python uses only the standard library.

```sh
npm ci
npm run dev
```

Open [Manifold locally](http://127.0.0.1:58311/). Click the canvas and start writing,
or import a CSV. **New canvas** opens separate work with its own URL.

Frontend edits update live; Python edits restart the backend. Ctrl-C stops both services.
`make dev` runs the same workflow. For a built-app preview without live updates, use `make canvas`.
Run `npm run doctor` if setup fails; see the [development quickstart](docs/development/README.md)
for browser-test installation, optional runtimes and port configuration.

See the [canvas guide](docs/guides/canvas.md) for controls and file handling, or the
[documentation index](docs/README.md) for guides, reference and architecture.

## Develop and contribute

```sh
npm run typecheck   # Fast type feedback, without a bundle
npm test -- check-headless
npm run check       # Repository, docs, Python, types, unit tests and builds
npm run verify      # Also runs browser workflows; install Chromium first
```

The reusable, UI-independent foundation and its examples live in
[`packages/foundation`](packages/foundation/README.md); run `make foundation` for its workbench.
For browser-free document inspection, editing and explicit computation, see the
[headless TypeScript API](docs/reference/headless-api.md).
For external-agent control of an open canvas, see the [local MCP server](docs/reference/mcp.md)
with human-selected permissions, focused inspection, replay-safe live editing, asynchronous
computation and portable native snapshots.
For installable CLI/MCP tooling and a first successful workflow, start with the
[agent tools installation guide](docs/guides/agent-tools.md). The package runs outside a
source checkout; the canvas application still starts separately.
For agent workflows with JSON discovery, atomic edits, validation, comparison and explicit
computation, see the [agent guide](docs/guides/agents.md) and [CLI reference](docs/reference/cli.md).
A [bundled Manifold skill](.agents/skills/manifold/SKILL.md) teaches agents that workflow;
the [spring edit](apps/canvas/tests/fixtures/agent-spring/task.md) and
[worksheet authoring](apps/canvas/tests/fixtures/agent-conduction/task.md) practice tasks have
independent verifiers. Use `inspect --compact` for concise discovery; full detail remains the default.

- [Contributing](CONTRIBUTING.md) and [development guide](docs/development/README.md)
- [Architecture and extension patterns](docs/design/canvas-extension-patterns.md)
- [Repository map](docs/repository.md)
- [Vision](docs/vision.md) and [interaction design](docs/interaction-design.md)

Manifold is licensed under [Apache-2.0](LICENSE).
