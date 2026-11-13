# Developing Manifold

## Setup and local development

Requires **Node 22.18+**, npm and **Python 3.11+**. Run from the repository root.
If you use nvm, `nvm install` selects the supported Node line from `.nvmrc`.
Basic canvas operation uses only Python's standard library; no AI credentials are required.

```sh
npm ci
npm run dev
```

Open **<http://127.0.0.1:58311/>**, the development URL printed after both services are ready.
One terminal runs Vite and the Python backend; **Ctrl-C stops both and their owned processes**.
No production build is needed. `make setup` and `make dev` are equivalent entry points;
`make canvas-dev` is an alias for the combined launcher, not a second-terminal command.

### What updates live?

- **React/TypeScript/CSS:** Vite hot-updates the page, preserving React component state when
  Fast Refresh can do so. Some changes require an automatic full-page reload.
- **Python:** edits/additions/deletions of `apps/canvas/*.py` restart the backend automatically.
  Active computations and assistant connections are interrupted; reconnect/retry deliberately.
  The frontend stays running. Invalid Python stops the session with a labeled error; fix it and restart.
- **Dependencies or environment/configuration:** rerun `npm ci` after lockfile changes and restart
  the session after changing environment variables. Assistant companion source changes also need
  a session restart. Backend reload is development-only.

## Checks

```sh
npm run doctor                     # Versions, dependencies, ports and optional capabilities
npm run typecheck                  # Canvas and foundation types, without a bundle
npm test -- check-headless         # One focused canvas check
npm test -- --list                 # Discover checks; --jobs 2 enables bounded local parallelism
npm run build                     # Type-check and build the canvas
npm run test:browser -- check-blank-canvas-browser
npm run test:dev:browser           # Real HMR, proxy, backend restart and cleanup acceptance
npm run check                     # Full non-browser gate
npm run verify                    # Full gate, including browsers; matches CI
```

Build once before browser checks; they serve `dist`, not Vite. Full verification builds for you.
Build/check phases share output: run them sequentially, not in competing terminals.
For foundation-only work, `make foundation` starts its [workbench](../../packages/foundation/README.md).
See [detailed workflows](workflows.md) for test selection, timeouts, logs, assistant/agent tooling,
architecture boundaries and opt-in profiling. [Contributing](../../CONTRIBUTING.md) owns contribution
rules; the [repository map](../repository.md) identifies module owners.

## Built-app preview

```sh
make canvas
# Without Make:
npm run build
python3 apps/canvas/server.py
```

Open <http://127.0.0.1:58310/>. This serves built files: source changes require rebuilding and
refreshing the browser. Python changes require restarting the server. Use `npm run dev` for live updates.
Choose a Python executable with `PYTHON=/absolute/path/to/python npm run dev` or
`make canvas PYTHON=/absolute/path/to/python`.

## Browser-test setup

Browser installation is deliberate, not part of basic setup:

```sh
npm run setup:browser
```

On supported Linux systems that need OS libraries, use
`npx --no-install playwright install --with-deps chromium` (may require administrator access).
Alternatively set `MANIFOLD_BROWSER_EXECUTABLE=/absolute/path/to/chromium`.
This selection applies to application, foundation and installed-tool browser checks.
Doctor checks installation, not whether the browser can launch; browser tests verify launch.

## Troubleshooting

- **Startup fails:** run `npm run doctor`. `FAIL` items block the base workflow; optional browser
  and optimizer notices do not. Doctor never installs packages, starts an AI request or kills services.
- **Missing/wrong Python:** set `PYTHON` to a Python 3.11+ executable, not a shell command with arguments.
- **Port already occupied:** stop only a service you own, or explicitly choose another pair:

  ```sh
  MANIFOLD_API_PORT=58410 MANIFOLD_DEV_PORT=58411 npm run dev
  ```

  The launcher and Vite never silently select another port or adopt/kill an existing server.
  The backend proxy and exact allowed local API/assistant origins use the same pair.
  Browser storage is **origin-specific**: another port (or `localhost` instead of `127.0.0.1`)
  has separate workspaces. Keep a stable origin; export files before switching if you need your work.
- **Changes not appearing:** use the printed development URL, not the built preview on port 58310.
- **Browser check port conflict:** checks use a separate owned server on 58312. Set
  `MANIFOLD_BASE_URL` only for an existing test server you own. The runner never kills that server.
- **Failed check:** the runner prints retained stdout/stderr log locations. See
  [runner details](workflows.md#selecting-and-running-checks) for budgets and cancellation.

## Optional numerical runtime

Optimization requires an explicit SciPy installation; there is no built-in fallback or automatic install.
The hash lock supports **CPython 3.12 on Linux x86_64** only. Base Python 3.11+ support does not
include numerical optimization. Start the development server with the selected runtime:

```sh
make setup-optimizer                  # OPTIMIZER_PYTHON selects your CPython 3.12
PYTHON="$PWD/.venv/optimizer/bin/python" npm run dev
make check-optimizer
make verify PYTHON="$PWD/.venv/optimizer/bin/python"
```

The target owns `.venv/optimizer` and installs pinned, hash-checked binary wheels from
[`requirements-optimizer.txt`](../../apps/canvas/requirements-optimizer.txt); never globally.
Do not use another worktree's environment. Other platforms remain unsupported by this lock.
Missing/incompatible dependencies leave Open, editing and retained result inspection usable.
Numerical-only checks explicitly skip outside the supported environment; CI also tests the actual
numerical profile. The backend [protocol](../../apps/canvas/artifact_optimizer_contract.md) defines limits.

## Documentation ownership

Update each topic at its owner rather than duplicating contracts. See
[documentation ownership](workflows.md#documentation-ownership) for the guide/reference/design split.
Run `make check-docs-worktree` after documentation changes.
