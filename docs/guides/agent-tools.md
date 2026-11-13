# Install and connect Manifold agent tools

Manifold has two independent workflows:

- **File CLI:** inspect, author, validate and explicitly compute a separate native
  candidate. No running canvas, Python, model credentials or account is required.
- **Live MCP:** connect an external client to an open local canvas. The human grants
  a scope; the browser remains the only writer and keeps normal Undo/Redo.

The tools require **Node 22.18+**. Interfaces are experimental. The installable package
is prepared for distribution but is not claimed to be published on npm.

## Install a built package

A maintainer can provide a `manifold-cli-0.1.0.tgz` release tarball. Install the tarball
at its actual path:

```sh
npm install -g /path/to/manifold-cli-0.1.0.tgz
manifold --version
manifold --help
```

To build that tarball yourself, from a source checkout:

```sh
npm ci
npm pack --workspace @manifold/cli --pack-destination /tmp
npm install -g /tmp/manifold-cli-0.1.0.tgz
```

The installed tools work outside the checkout. They include the CLI, MCP server,
read-only MCP App preview, license and an agent skill at `dist/SKILL.md` inside the
installed package. The package does **not** include or start the canvas application.
No npm registry lookup of a similarly named package is needed.

## First successful file workflow

Use an empty working directory and fresh output names:

```sh
manifold create --output initial.manifold
manifold inspect initial.manifold --compact
manifold capabilities
```

Save the following as `changes.json`, substituting the actual `documentId` returned
by inspection:

```json
{
  "expectedDocumentId": "<documentId from inspection>",
  "edits": [
    { "operation": "createEquation", "text": "x := 2 mm", "as": "input" },
    { "operation": "createEquation", "text": "F = (10 N/mm)*x" }
  ]
}
```

Then:

```sh
manifold edit initial.manifold --changes changes.json --output candidate.manifold
manifold validate candidate.manifold --strict
manifold diff initial.manifold candidate.manifold
manifold inspect candidate.manifold --compact
```

Worksheet expressions derive without an execution job. For scalar models, discover
a computation request and call `compute` explicitly; do not invent request IDs.
Open `candidate.manifold` with the canvas's Open/import control to review it visually.
File commands never update a live tab, overwrite the baseline, or silently compute.
Validation does not establish physical validity.

Continue with the [agent guide](agents.md) and [CLI reference](../reference/cli.md).

## Connect an MCP client

1. Start the canvas separately. In a source checkout, run `make canvas` and leave
   it running. Do not start another process on an occupied port.
2. Run `manifold doctor`. It checks the runtime, installed assets and the default
   local canvas URL. For another local instance, use
   `manifold doctor --canvas-url http://127.0.0.1:58311/`.
3. Run `manifold mcp-config` and copy the emitted `mcpServers` entry into your
   client's configuration. It uses absolute paths for this installation's Node
   executable and MCP script, avoiding shell/PATH and npm startup chatter.
4. Restart or reconnect the MCP client, then ask it to call `connect_canvas`.
5. Open the private URL returned by that call. Opening it grants nothing. Select
   **Agent permissions** in the canvas and grant only the scope needed.
6. Ask the client to inspect the canvas. Disconnect through the canvas indicator
   to revoke access. Disconnect is not rollback.

For a nondefault canvas, set `MANIFOLD_CANVAS_URL` in the client's server environment.
Only local HTTP URLs are accepted. Never share the private connection URL.
Moving/removing the installation invalidates its generated configuration; regenerate it.

`manifold-mcp` or `manifold mcp` can also launch the stdio server directly. Do not
wrap it in `npm run` in MCP configuration. It requires no Pi provider or credentials.

### Read-only in-chat preview

MCP Apps-compatible hosts can display the image from `look_at_canvas` inside chat.
It is a **captured image**, not a live canvas, editor, numerical validation or second
workspace owner. Ask for another capture after edits. The preview has no tool calls,
permission controls, remote fonts or network dependencies. Ordinary MCP clients
still receive the normal image result.

### Diagnose without granting access

`manifold doctor` returns JSON and exits 0 when its runtime/assets checks pass and
the local HTTP response contains the Manifold page title. It exits 1 for unavailable
prerequisites and 2 for invalid arguments. The title check is a diagnostic heuristic,
not server authentication or proof that a tab is connected. It follows no redirects,
reads a bounded page prefix, and never grants permission or computes. The report
omits URL query/fragment credentials. Live scope and recovery state are available
only through MCP after connection.

See the [MCP reference](../reference/mcp.md) for scopes, proposals, recovery and jobs.
