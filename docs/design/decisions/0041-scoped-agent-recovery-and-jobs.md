# 0041: Scoped agent recovery, jobs and portable snapshots

## Status

Accepted for the experimental local MCP adapter. Extends
[ADR 0040](0040-full-control-canvas-mcp.md), whose initial full-control-only and
inspect-before-retry contracts remain historical. The built-in Pi assistant is unchanged.

## Context

Live tools alone are insufficient for dependable external agents. Whole-workspace reads
are expensive, ambiguous mutation responses can cause duplicate creations, waiting for a
computation blocks inspection, and full control is excessive for read/proposal tasks.
Humans also need visible agent activity and a portable native handoff without arbitrary
filesystem access.

## Decision

Keep the existing live `RegionSession` as the sole accepted-state/execution/persistence
owner. Extend only the MCP adapters:

- Focused model, equation, selection and bounded dependency reads reuse current semantic
  projections and registered references; compact workspace discovery is optional.
- Share a small wire error/permission contract between Node and browser. Failures carry
  stable codes, messages and recovery guidance in MCP JSON text and structured content.
  Domain errors are translated at typed boundaries, never inferred from prose.
- Retain a bounded mutation journal in a WeakMap keyed by the live session, not the socket.
  All accepted-state mutations require a client operation ID and expected recovery-session
  ID, plus existing document guards where applicable. Exact canonical retries replay the
  recorded result/error without rerunning; conflicting reuse rejects. Publication outcomes
  are recorded before transport delivery. No IDs are silently evicted. A full journal
  rejects new actions while preserving queries and retries.
- A reload/file transition starts a new recovery lifetime. The session guard rejects old
  requests mechanically; changing it to replay an unknown action is not safe recovery.
  A new fragment can request a replacement process connection in the same still-open tab
  without replacing the accepted owner; it revokes the old bridge and resets permissions
  to read-only before a new human grant.
- Nonblocking computation submission returns a job ID with status/result/cancel tools.
  Jobs use the existing owner/executor and actual completion evidence, not simulated
  progress or success. Disconnect cancels only jobs owned by that bridge; bounded result
  metadata remains queryable after reconnection. The submit-and-wait tool remains available.
- Browser permissions default to read-only, with proposal-only, edit-without-compute and
  full-control scopes. Both transport and browser enforce them. A proposal-only connection
  can never invoke agent application; a local human review button applies the exact plan.
  Client-reported names label activity but are not authenticated identities.
- Show current tool, active jobs, reviewed proposals and up to 30 recent attributed actions.
  This is transient activity, not durable provenance. Shared Undo actions do not relabel
  the authorship of the work they reverse.
- Native export uses the existing owner/capture/archive path. The adapter retains one
  immutable snapshot per connection and serves bounded ordered text chunks with byte-length
  metadata. Clients assemble/save UTF-8 themselves. No server path or filesystem writer is
  added, and native Open retains its existing admission policy.

The [MCP reference](../../reference/mcp.md) owns exact tool schemas, bounds, session lifetimes,
Unicode chunk assembly rules and errors. No kernel/schema, document format or assistant
permission migration is introduced.

## Alternatives

- Transport-only response cache: lost on reconnect and cannot establish whether the owner
  accepted an action. Recovery state belongs to the live owner session.
- Automatic retry with a new operation ID: duplicates actions after ambiguous delivery.
- Durable command/audit ledger: requires native schema/lifecycle and attribution decisions
  beyond this local usability slice; explicit session guards bound the current guarantee.
- New computation scheduler or server-owned execution: would compete with established
  capture, cancellation, evidence currency and resource admission.
- Single inline export response or arbitrary output path: respectively fails transport
  bounds or expands filesystem authority unnecessarily.

## Consequences and verification

The interface is still experimental and advances the MCP server version to 0.2.0. Initial
clients must supply operation/session IDs for mutations. Recovery, jobs and activity are
bounded/tab-local, not durable. Exported evidence does not prove physical validity; a
completed job can fail/discard or become non-current after later edits.

Owner checks cover focused reads, current dependency traversal, permission denial, exact
retries and conflicts, reconnection, rejected-batch isolation, journal/job limits, explicit
human proposal approval, asynchronous cancellation, attribution and Unicode multi-chunk
native export/reopen. Transport checks cover schemas, grants/scopes, annotations and typed
errors. The real stdio/browser workflow covers all four scopes, review/approval, direct
edits, job polling, native handoff, draft guards, activity, reconnect/replacement-process
recovery and rejection of old mutation guards after reload. No paid model calls are made.
