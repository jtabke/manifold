# 0039: Approval-only Pi assistant over the live canvas

## Status

Accepted for the experimental local human–agent slice. No general multiplayer,
remote hosting, autonomous editing, shell access or computation authority is introduced.

## Context

The file-based agent CLI intentionally opens independent owners and publishes separate
candidates. It cannot update an open canvas. Human–agent assistance should instead use
selection and the existing live operation owner without introducing competing file writers.
Pi provides a Node SDK with custom tools, streaming, cancellation and ephemeral sessions.
Its normal coding tools and resource discovery are inappropriate defaults for this surface.

## Decision

Keep `RegionSession` in the browser authoritative. An optional loopback Node companion
hosts Pi and routes only `inspect_workspace`, `inspect_canvas`, `inspect_plot`, `look_at_canvas`,
`capabilities` and `prepare_edit` to the canvas. Image inspection is registered only when the
selected model declares image support.
The local Python server lazily starts and owns one companion, proxies authenticated configuration
requests, and shuts it down on server exit. Canvas setup detects Pi credential metadata and the
configured default model, offers provider/model selection and an optional API key, and obtains a
short-lived one-use connection ticket. No second terminal or copied URL is needed. Standalone
companion startup remains an advanced option, not the primary UX.

The companion has an allowlist of canvas tools, a custom resource loader with no project
instructions/extensions/skills, and in-memory conversations. Existing Pi credentials remain local
to Node. A supplied API key is cleared from the input at submission and held in a separate
connection-scoped runtime, never written to Pi, browser storage or the document. Discovery returns
only credential presence and model metadata, not credential values. Setup/Connect make no inference
request; model calls occur only after a user sends a request. The UI discloses that requests and
inspected engineering content reach the provider.

The composer exposes model, supported thinking level and access choices. Each request captures
one credential-free settings snapshot; the companion validates and acknowledges that exact snapshot
before inference. Model/thinking changes retain the same ephemeral Pi session and use nonpersisting
SDK mutations. Read-only is a restriction of the existing approval-only tool set: both the companion
and browser owner deny edit proposals/application, and entering read-only dismisses pending proposals.
No option enables automatic application, shell tools or computation. Provider credentials remain
connection-scoped. Settings, responses and per-turn attribution remain transient.

Rich replies use Markdown and KaTeX. Mermaid fences are bounded, rendered lazily with no network
resource access, and displayed in a script-disabled sandbox after sanitization; diagram source is
always available. Rendering carries no canvas mutation or tool authority and is not checked
engineering evidence. Unsupported or incomplete content falls back to readable source.

A nonmodal assistant popup opens at the canvas invocation point, with viewport-edge clamping.
Its initial surface is a compact single-line composer with send, gear and close controls, not a
sidebar or chat header. Right-click actions, model-card actions and the toolbar share this owner.
Multiline drafts, replies, reviewed proposals and settings expand only as needed; Escape closes
the popup and ends its connection. A gear button reveals provider, model and credential settings.
Enter submits and Shift+Enter adds a newline. The first explicit submission connects using detected
Pi defaults, then sends exactly that captured request and selection once ready. Missing setup or
connection failure opens settings without discarding the draft. Setup alone never invokes a model,
and edits remain approval-only. The popup does not block manual canvas editing; its `dialog[open]`
boundary excludes canvas keyboard shortcuts without trapping focus.

`app/useCanvasAssistant` coordinates the transient connection, streamed requests and proposal
review lifecycle. `CanvasAssistant` owns the anchored composer and settings visibility;
`AssistantConversation` renders responses and proposal diagnostics without transport authority.
Disconnect and unmount share bridge disposal. Neither this controller nor its views owns accepted
workspace state, persistence or a separate Undo history.

`assistantCanvas` extends only the live assistant's edit schema, leaving the file/headless protocol
unchanged. Drawing, connector, grouping, placement, worksheet-plot and scalar-sweep setup operations
lower through the existing drawing, scene and session commands. Canvas diffs include geometry,
marks, plot/analysis definitions and group changes; Apply retains their exact reviewed identities.
Grouping is not automatic layout, drawing text is not engineering source, and creating a sweep
request never executes it. Plot reads retain actual result currency and do not manufacture receipts.

The composition root supplies a narrow canvas-inspection/capture port, not DOM scripting or generic
browser control. `inspect_canvas` includes current measured frames, viewport and invocation point
in world coordinates. `look_at_canvas` captures only the canvas subtree or one visible representation
using the existing raster export machinery. JPEG dimensions and payload size are bounded; images
exclude assistant/settings and browser chrome, are sent as native image tool content rather than
base64 text, and are never persisted. Document/camera changes reject an in-flight capture, and
Stop/disconnect revoke asynchronous results before they can be delivered. Workspace text and pixels
remain untrusted content, not instructions. Image interpretation is not computation evidence.

`RegionSession.prepare` collects validated commands in a disposable staging session. For
consequence inspection, a disposable candidate reader uses the existing domain/result-currency
implementation with retained evidence and resources; it is never connected to UI, persistence
or execution. The live owner, history, attention and saved bytes remain unchanged. The browser
retains the exact reviewed commands privately and displays a generated diff and validation.
Apply checks the original immutable document and submits those commands as one ordinary atomic
operation, retaining generated identities and shared Undo/Redo. It never reruns an agent batch.
A whole-document change makes the proposal stale; duplicate/dismissed applications reject.
Unaccepted renderer drafts block submission and Apply rather than being silently overwritten.

The service binds only to `127.0.0.1`, validates Host and exact permitted Origin for HTTP
configuration and WebSocket access, and requires a fresh random startup token. The Python proxy
also checks local Host/Origin and bounded JSON requests before launching or forwarding. One-use
tickets expire after a minute; pending grants release their ephemeral key runtime on expiry.
Node startup is bounded and missing dependencies fail recoverably without affecting authoring. Payload, connection, turn, proposal and tool-call
limits bound the local surface. Tool responses are correlated to connection/request/call IDs
and time out. Stop immediately revokes browser tool authority; disconnect or panel close
discards proposals, disposes the Pi session and leaves accepted work intact. File transitions
navigate away from the old canvas, disposing its connection. Connection URLs are not persisted.

## Alternatives

- Concurrent archive writes: preserve file-based candidates for offline automation, not live editing.
- Moving ownership into a server first: unnecessary for a local assistant and expands migration scope.
- General coding-agent tools or UI automation: bypass semantic validation and approval boundaries.
- Automatic edit application: deferred until there is a concrete permission/scoping design.

## Consequences and verification

The companion is a third npm workspace and an optional server-managed process. The first
slice inspects the full bounded worksheet/model summary; focused inspection and finer conflict
checks are future improvements, not current guarantees. Conversation/proposal attribution is
transient and is not a durable audit log or native archive history. There is no provider login
UI, chat persistence, automatic computation or assurance of engineering correctness.

`check-canvas-assistant` covers no-publication staging, exact commands/creation identities,
atomic Apply/Undo/Redo, failed/stale/dismissed/duplicate rejection and owner isolation.
The companion tests cover authentication/origins, request correlation, busy/replay rejection,
streaming, cancellation, timeout/disconnect cleanup, managed setup/tickets/key isolation and a real
Pi SDK restricted session. Python tests cover lazy owned-process startup/shutdown, no key persistence,
proxy-origin rejection and recoverable dependency/startup failures.
`check-canvas-assistant-browser` exercises a deterministic agent through the actual bridge,
selected model context, human drafts, evidence currency, saving and lifecycle transitions.
These checks do not make paid model requests or establish model quality/usability.
