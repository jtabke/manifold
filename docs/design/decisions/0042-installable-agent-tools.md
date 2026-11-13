# 0042: Installable agent tools and read-only MCP App presentation

Status: Accepted for the experimental local tooling slice.

## Context

The CLI and live MCP adapter already use existing headless/browser owners, but
checkout-relative entry points make external installation and client setup fragile.
A chat preview should not introduce another editor, state owner or permission grant.

## Decision

Keep one monorepo and add `@manifold/cli` as a distribution workspace. Build JavaScript
entry points, shared chunks, a self-contained MCP App HTML resource, license and skill.
The package depends only on `ws` at runtime; foundation, mathematics and MCP SDK code
are bundled from locked dependencies. Extract the shared canvas tool descriptors from
the Pi runtime so MCP packaging never pulls in a model/provider runtime.

The installed launcher lazily loads file commands, diagnostics or MCP. A configuration
command prints absolute Node/script paths without writing client configuration.
Diagnostics probe only an explicitly selected/default loopback HTTP page and never
connect to the authenticated canvas bridge or grant authority.

Attach a read-only MCP Apps resource to the existing `look_at_canvas` tool. Reuse its
existing image response and browser-enforced scope. The widget renders a captured image
without tool calls, external resource fetches, persistence, model messages or editing.
Text/image responses continue to work in clients without MCP Apps support.

Verify packed installation in a clean temporary directory, actual stdio discovery,
grants, denied writes, CLI candidate authoring and resource retrieval. Exercise the
widget with a real Apps bridge and browser. Add these checks to repository gates.
A manually dispatched release workflow prepares a tarball; npm publication requires a
separate explicit maintainer selection and configured trusted-publishing environment.

## Consequences and exclusions

Package version and protocol versions remain separate. This does not stabilize every
experimental schema, bundle the canvas web application, create remote authentication,
deploy a hosted endpoint or grant npm publication authority. Existing document/session
guards, operation replay recovery, computation limits, shared Undo and native exports
remain unchanged. The preview cannot certify numerical correctness or physical validity.
