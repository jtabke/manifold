# Manifold canvas

The browser application and headless automation adapters for Manifold. This package owns
canvas domain schemas, worksheet derivation, rendering and interaction, local/native file
handling, and the restricted Python sampling host. Accepted changes and computation evidence
use the shared [`@manifold/foundation`](../../packages/foundation/README.md) owner.

## Run locally

From the repository root, with Python 3.11+, Node 22.18+ and npm:

```sh
make setup
make canvas
```

Open [the canvas](http://127.0.0.1:58310/).

## Documentation

- [Canvas guide](../../docs/guides/canvas.md): controls, drawing, models and file handling.
- [Agent workflow](../../docs/guides/agents.md): bounded automation and candidate review.
- [CLI reference](../../docs/reference/cli.md): commands, JSON payloads and exit codes.
- [Headless API reference](../../docs/reference/headless-api.md): TypeScript integration.
- [Development guide](../../docs/development/README.md): setup, checks and diagnostics.
- [Extension patterns](../../docs/design/canvas-extension-patterns.md): implemented operation,
  renderer, computation and storage contracts.
- [Repository map](../../docs/repository.md): module ownership and tooling boundaries.
