import { useEffect, useRef, useState } from "react";
import { createMcpCanvas } from "../mcp";
import { mcpErrorData, McpError, type McpScope } from "../mcpProtocol";
import "../styles/mcp.css";
import type { RegionSession } from "../document";
import type { AssistantCanvasPort } from "../assistantCanvas";
import type { WorkspaceEdits } from "./workspaceFiles";

type Owner = ReturnType<typeof createMcpCanvas>;
const scopes: { id: McpScope; label: string; description: string }[] = [
  {
    id: "read-only",
    label: "Read-only access",
    description:
      "Read canvas content, images and portable exports. No proposals, edits or computations.",
  },
  {
    id: "proposal-only",
    label: "Proposals only",
    description:
      "Read and prepare edits. Only you can Apply a proposal here; the agent cannot edit or compute.",
  },
  {
    id: "edit",
    label: "Edit without compute",
    description:
      "Read, apply edits, export and use shared Undo/Redo. No computations.",
  },
  {
    id: "full-control",
    label: "Full control",
    description:
      "Read, apply edits, export, use shared Undo/Redo and run registered computations.",
  },
];

function clearMcpFragment() {
  const url = new URL(window.location.href);
  const params = new URLSearchParams(url.hash.slice(1));
  params.delete("mcp");
  url.hash = params.toString();
  window.history.replaceState(null, "", url);
}

function requestedEndpoint() {
  const value = new URLSearchParams(window.location.hash.slice(1)).get("mcp");
  if (!value) return;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "ws:" ||
      url.hostname !== "127.0.0.1" ||
      url.pathname !== "/" ||
      url.username ||
      url.password ||
      url.hash ||
      !/^[a-f0-9]{64}$/.test(url.searchParams.get("token") ?? "")
    )
      return;
    return url.href;
  } catch {
    return;
  }
}

/** A private fragment requests a connection. Only a human's selected scope grants authority. */
export function CanvasMcp({
  session,
  edits,
  canvas,
}: {
  session: RegionSession;
  edits: WorkspaceEdits;
  canvas: AssistantCanvasPort;
}) {
  const [endpoint, setEndpoint] = useState(requestedEndpoint);
  const ports = useRef({ edits, canvas });
  ports.current = { edits, canvas };
  const [scope, setScope] = useState<McpScope>("read-only");
  const [status, setStatus] = useState("disconnected");
  const [agent, setAgent] = useState("External agent");
  const [view, setView] = useState<ReturnType<Owner["state"]>>();
  const [error, setError] = useState("");
  const bridge = useRef<
    { socket: WebSocket; owner?: Owner; unsubscribe?: () => void } | undefined
  >(undefined);
  const disconnect = () => {
    const current = bridge.current;
    bridge.current = undefined;
    current?.unsubscribe?.();
    current?.owner?.close();
    current?.socket.close();
  };
  useEffect(() => {
    if (endpoint) clearMcpFragment();
    return disconnect;
  }, [endpoint, session]);
  useEffect(() => {
    const requested = () => {
      const candidate = requestedEndpoint();
      if (!candidate) return;
      clearMcpFragment();
      disconnect();
      setEndpoint(candidate);
      setScope("read-only");
      setStatus("disconnected");
      setView(undefined);
      setError("");
    };
    window.addEventListener("hashchange", requested);
    return () => window.removeEventListener("hashchange", requested);
  }, [session]);
  if (!endpoint) return null;
  const connect = () => {
    disconnect();
    setView(undefined);
    setError("");
    setAgent("External agent");
    setStatus("connecting");
    const socket = new WebSocket(endpoint);
    const current: NonNullable<typeof bridge.current> = { socket };
    bridge.current = current;
    socket.onclose = () => {
      if (bridge.current === current) {
        disconnect();
        setStatus("disconnected");
      }
    };
    socket.onerror = () => {
      if (bridge.current === current) {
        disconnect();
        setStatus("connection failed");
      }
    };
    socket.onmessage = async (event) => {
      if (bridge.current !== current) return;
      let id: string | undefined;
      try {
        const message = JSON.parse(event.data);
        if (message.type === "hello") {
          if (current.owner || typeof message.agent?.name !== "string")
            throw new McpError("INVALID_REQUEST", "Invalid agent handshake");
          const name =
            message.agent.name.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 80) ||
            "External agent";
          setAgent(name);
          const owner = createMcpCanvas(
            session,
            {
              read: () => ports.current.edits.read(),
              finish: () => ports.current.edits.finish(),
              settle: () => ports.current.edits.settle(),
            },
            {
              inspect: () => ports.current.canvas.inspect(),
              capture: (args) => ports.current.canvas.capture(args),
            },
            { scope, agent: name },
          );
          current.owner = owner;
          current.unsubscribe = owner.subscribe(() => {
            if (bridge.current === current) setView(owner.state());
          });
          setView(owner.state());
          socket.send(
            JSON.stringify({
              type: "grant",
              scope,
              sessionId: owner.state().sessionId,
            }),
          );
          return;
        }
        if (message.type === "ready" && current.owner) {
          setStatus("connected");
          return;
        }
        const owner = current.owner;
        if (!owner)
          throw new McpError(
            "INVALID_REQUEST",
            "Agent handshake is incomplete",
          );
        id = message.id;
        if (typeof id !== "string")
          throw new McpError("INVALID_REQUEST", "Invalid MCP call ID");
        if (message.type === "cancel") {
          owner.cancel(id);
          return;
        }
        if (message.type !== "tool")
          throw new McpError("INVALID_REQUEST", "Invalid MCP request");
        const result = await owner.call(id, message.name, message.args);
        if (bridge.current !== current || socket.readyState !== WebSocket.OPEN)
          return;
        const response = JSON.stringify({ id, result });
        if (new TextEncoder().encode(response).byteLength > 1_800_000)
          throw new McpError(
            "RESULT_TOO_LARGE",
            "Canvas tool result is too large",
            "Use focused inspection, smaller pages or export chunks. For mutations, query operation_status before retrying.",
          );
        socket.send(response);
      } catch (failure) {
        if (
          bridge.current === current &&
          socket.readyState === WebSocket.OPEN
        ) {
          const detail = mcpErrorData(failure);
          socket.send(JSON.stringify({ id, error: detail }));
          if (!id) {
            setError(detail.message);
            disconnect();
            setStatus("connection failed");
          }
        }
      }
    };
  };
  const connected = status === "connected" || status === "connecting";
  const permission = scopes.find((entry) => entry.id === scope)!;
  return (
    <section
      aria-label="External agent control"
      className="er-mcp-control"
      role="region"
    >
      <strong>External agent: {status}</strong>
      {connected && (
        <p>
          Client-reported name: <b>{agent}</b> · Granted scope:{" "}
          {permission.label}
        </p>
      )}
      <label>
        Agent permissions{" "}
        <select
          aria-label="Agent permissions"
          value={scope}
          disabled={connected}
          onChange={(event) => setScope(event.target.value as McpScope)}
        >
          {scopes.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>
      <p>
        {permission.description} Your content may reach the agent's model
        provider. Only enable for an agent you trust. Disconnect before changing
        permissions.
      </p>
      {connected ? (
        <button
          onClick={() => {
            disconnect();
            setStatus("disconnected");
          }}
        >
          Disconnect agent
        </button>
      ) : (
        <button onClick={connect}>
          {scope === "full-control"
            ? "Enable full control"
            : `Enable ${permission.label.toLowerCase()}`}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      {status === "connected" && view && (
        <>
          <p aria-live="polite">
            Current action: {view.current ?? "Idle"} ·{" "}
            {view.jobs.filter((job) => job.state !== "completed").length} active
            computation(s)
          </p>
          {view.proposals.map((proposal) => (
            <article key={proposal.id} aria-label="External agent proposal">
              <strong>Proposed edit · {proposal.status}</strong>
              <p>{proposal.explanation}</p>
              <p>
                {proposal.diff.regions.length} worksheet changes ·{" "}
                {proposal.diff.models.length} affected models ·{" "}
                {proposal.validation.issues.length} validation issue(s)
              </p>
              <details>
                <summary>Review changes and diagnostics</summary>
                <pre>
                  {JSON.stringify(
                    { changes: proposal.diff, validation: proposal.validation },
                    null,
                    2,
                  )}
                </pre>
              </details>
              <button
                disabled={proposal.status !== "pending" || !!view.current}
                onClick={() => {
                  try {
                    bridge.current?.owner?.approveProposal(proposal.id);
                    setError("");
                  } catch (failure) {
                    setError(mcpErrorData(failure).message);
                  }
                }}
              >
                Apply agent proposal
              </button>
              <button
                disabled={!["pending", "stale"].includes(proposal.status)}
                onClick={() =>
                  bridge.current?.owner?.dismissProposal(proposal.id)
                }
              >
                Dismiss agent proposal
              </button>
            </article>
          ))}
          <details>
            <summary>Agent activity ({view.activity.length})</summary>
            <p>
              Transient activity only, not a durable audit log. Undo/Redo can
              affect human edits; these entries attribute the agent action, not
              the authorship of the reversed work.
            </p>
            <ol>
              {view.activity
                .slice()
                .reverse()
                .map((entry, index) => (
                  <li key={`${entry.time}-${index}`}>
                    {entry.agent} · {entry.tool} · {entry.status} ·{" "}
                    <time>{entry.time}</time>
                  </li>
                ))}
            </ol>
            <ul>
              {view.jobs.map((job) => (
                <li key={job.jobId}>
                  {job.agent} · computation {job.jobId} · {job.state}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </section>
  );
}
