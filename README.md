<p align="center">
  <img src="apps/canvas/public/manifold-logo.png" alt="Manifold" width="420">
</p>

<h1 align="center">Manifold</h1>
<p align="center"><strong>A bicycle for the engineering mind.</strong></p>
<p align="center">Create · Connect · Explore</p>

Manifold is an open-source computational engineering canvas. Write equations and
notes, import measurements, connect quantities and explore results in one workspace.

**Early prototype.** The vision describes the intended product; the application
implements bounded mathematical authoring, data relationships, plots, alternatives
and nested models. No live AI service is connected. Engineering validity and a
usability advantage have not been demonstrated.

## Product direction

- [Vision](docs/vision.md): mission and enduring principles.
- [Interaction design](docs/interaction-design.md): intended behavior and shared operations.
- [Roadmap](docs/ecosystem-and-roadmap.md): current scope and priorities.

## Run the application

Requires Python 3.11+, Node 22.18+ and npm. The Python server uses only the standard
library; no Python package installation is needed.

```sh
make setup
make canvas
```

Open [Manifold locally](http://127.0.0.1:58310/). Start typing an equation or note,
click to place it, or import a CSV. Work saves in this browser on this device.
**New canvas** opens separate work with its own URL.

Without Make:

```sh
npm --prefix apps/canvas ci
npm --prefix apps/canvas run build
python3 apps/canvas/server.py
```

See the [application guide](apps/canvas/README.md) for development and controls.

## Development

```sh
make check          # Documentation, server tests, formatting, build and canvas checks
make check-browser  # Browser workflows; requires Chrome
```

The [contributing guide](CONTRIBUTING.md) describes the code and checks.
Manifold is licensed under [Apache-2.0](LICENSE).
