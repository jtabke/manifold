# 0040: Explicit full-control live canvas MCP

## Status

Accepted for the experimental local external-agent slice. Extends live canvas access
without changing the built-in Pi assistant's approval-only boundary in
[ADR 0039](0039-live-canvas-assistant.md).

## Context

External agents need the same semantic canvas access without routing inference through
Manifold's Pi companion. The requested authority includes immediate editing and explicit
computation, not just proposals. File-based candidate writers cannot update a live tab
without introducing a competing owner.

## Decision

Use the official MCP TypeScript SDK with stdio transport in the existing assistant npm
workspace. A process owns one authenticated ephemeral loopback WebSocket listener, no
workspace state and no model session. `connect_canvas` returns a private canvas URL with
a fragment credential. The canvas removes that fragment from browser history and shows
an explicit full-control grant. It opens no socket until the user enables control.
The exact canvas Origin, loopback Host, random token and single connected tab bound
transport authority. The MCP process must not be exposed on a public network.

`CanvasMcp` owns transient browser connection/revocation. `createMcpCanvas` supplies an
independent full-control semantic adapter over the existing `RegionSession`, canvas
inspection/capture ports and renderer-draft guard. It reuses assistant read/proposal
operations, with full workspace inspection for discoverable computation references.
Direct edits lower through `editCanvas` in one atomic owner transaction, proposals apply
exact prepared commands, history uses the shared Undo/Redo owner and computations use
`RegionSession.compute` with actual completion evidence. No generic shell, DOM control,
archive mutation, arbitrary executor or second persistence owner is introduced.

Mutations retain accepted document guards and proposals retain exact reviewed-root guards.
One tool call runs at a time with bounded arguments/responses and a two-minute timeout.
Cancellation/disconnect revokes outstanding capture delivery and cancels active MCP jobs.
Synchronous accepted edits are not rolled back after transport failure; clients must inspect
before retrying ambiguous mutations. MCP never invokes a provider itself. The external
client controls whether tool data reaches a model provider; the browser grant discloses
content/image access, direct edits, shared history and computations.

## Alternatives

- Wrap the file CLI: useful for offline candidates, but cannot safely control the live owner.
- Extend the Pi prompt bridge: couples external clients to inference and approval-only turns.
- Network-facing HTTP MCP: introduces remote authentication/deployment concerns unnecessary
  for a local client-launched process.
- Expose arbitrary UI/kernel commands: bypasses the existing semantic and validation boundary.

## Consequences and verification

The MCP SDK is an additional assistant-workspace dependency. This is a repository-local
stdio integration, not a published service or a promise that every UI action has an API.
Each MCP process controls one explicitly connected canvas. Independent canvases use separate
processes and saved workspace URLs; existing same-workspace tab-conflict behavior remains.
There is no durable agent audit log or automatic inference.

`apps/assistant/test/mcp.test.mjs` checks actual MCP discovery/schema handling, connection
credentials/origins, single-canvas ownership, correlated calls, images, cancellation/timeout
and disconnect cleanup. `check-canvas-mcp` checks atomic direct edits, rejected-batch isolation,
exact proposal application, stale guards, computation receipts, shared Undo/Redo and drafts.
`check-canvas-mcp-browser` launches a real stdio client and actual canvas, verifies no authority
before opt-in, and exercises edits, computation, capture, shared history and revocation without
paid inference. See the [MCP reference](../../reference/mcp.md) for setup and tool contracts.
