# Manifold installed tools

Local workspace authoring and a permission-scoped live canvas MCP server, without
a source checkout at runtime. Requires Node 22.18+. Experimental interfaces.

Build and install a tarball from this repository:

```sh
npm ci
npm pack --workspace @manifold/cli --pack-destination /tmp
npm install -g /tmp/manifold-cli-0.1.0.tgz
manifold --help
manifold doctor
manifold mcp-config
```

This package is prepared for distribution; npm registry publication is a separate
maintainer action. Do not assume that `npx @manifold/cli` is available yet.
The package does not include or start the canvas web application.

Start with the [installation guide](https://github.com/jtabke/manifold/blob/main/docs/guides/agent-tools.md),
then the [CLI contract](https://github.com/jtabke/manifold/blob/main/docs/reference/cli.md)
or [MCP contract](https://github.com/jtabke/manifold/blob/main/docs/reference/mcp.md).
The bundled `dist/SKILL.md` teaches the file-based workflow.

`manifold-mcp` and `manifold mcp` run the same stdio server. For client configuration,
prefer the absolute Node/script paths printed by `manifold mcp-config`.
No provider runtime, credentials, automatic computation, permission grants or remote
MCP service are included. MCP Apps hosts can display a read-only captured canvas image;
ordinary MCP clients still receive the same image content.
