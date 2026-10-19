# Manifold canvas

The current implementation of the [Manifold vision](../../docs/vision.md): a freeform
canvas for equations, notes, CSV measurements, linked plots, alternatives and nested
models. It is an early prototype with bounded arithmetic and Python sampling.

## Run

Requires Python 3.11+, Node 22.18+ and npm. From the repository root:

```sh
npm --prefix apps/canvas ci
npm --prefix apps/canvas run build
python3 apps/canvas/server.py
```

Open [the canvas](http://127.0.0.1:58310/). `make setup` and `make canvas` perform the
same steps. The server uses the Python standard library and binds to localhost.
Use `--port` to select a different port.

For frontend development, leave the Python server running, then run:

```sh
npm --prefix apps/canvas run dev
```

Open [the development server](http://127.0.0.1:58311/). Its API proxy targets port 58310.

## Using the canvas

Start typing an equation or note, then click to choose its position. **Write** starts
in the visible canvas. Arithmetic such as `1+1` evaluates without a variable name.
Click mathematical notation to edit it; Enter continues below and Escape finishes
editing. Unresolved expressions remain editable.

Use **Import CSV** or drop a CSV onto the canvas. Measurements retain their source;
connections to mathematical quantities require explicit review. Plot responses and
compare alternatives through the existing quantities. The command palette opens
with Ctrl/Cmd+K.

Wheel zooms. Middle-drag or Space-drag pans; double middle-click fits the work.
Drag blank space or Shift-click to select several objects. Movement and arrangement
preserve mathematical meaning. Model boundaries organize existing work and expose
reviewed interfaces; evaluation currently uses globally unique symbols.

Accepted work, its title and navigation state save in this browser on this device.
**New canvas** creates an independent URL. Keep that URL to reopen it. Portable
workspace export is available through the command palette. Uncommitted text and
temporary previews are not restored.

## Code

- `src/regions`: canvas, engineering documents, data, plots, models and interactions.
- `src/notebook/math.ts`: bounded parsing, units and evaluation.
- `server.py`: static files, health endpoint and bounded sampling endpoint.
- `artifact_sampler.py`: validated plot code executed in a separate Python process.
- `tests`: local checks, browser workflows and Python server tests.
- `tools/run-checks.mjs`: application check runner.

## Checks

From the repository root, run `make check` and `make check-browser`. Browser checks
require installed Chrome and start a temporary server on port 58312.
Use `MANIFOLD_BASE_URL` to target an existing test server, or `PYTHON` to choose its
Python executable. For a focused browser check:

```sh
npm --prefix apps/canvas run test:all-browser -- check-blank-canvas-browser
```

Dependencies retain their own licenses; fonts and icons include notices in their
npm packages. No live AI service is connected.
