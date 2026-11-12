import { useEffect, useRef, useState } from "react";
import { createMcpCanvas } from "../mcp";
import "../styles/mcp.css";
import type { RegionSession } from "../document";
import type { AssistantCanvasPort } from "../assistantCanvas";
import type { WorkspaceEdits } from "./workspaceFiles";

/** A private fragment requests a connection, but never grants authority by itself. */
export function CanvasMcp({
  session,
  edits,
  canvas,
}: {
  session: RegionSession;
  edits: WorkspaceEdits;
  canvas: AssistantCanvasPort;
}) {
  const [endpoint] = useState(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const value = params.get("mcp");
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
  });
  const ports = useRef({ edits, canvas });
  ports.current = { edits, canvas };
  const [status, setStatus] = useState("disconnected");
  const bridge = useRef<
    { socket: WebSocket; owner: ReturnType<typeof createMcpCanvas> } | undefined
  >(undefined);
  const disconnect = () => {
    const current = bridge.current;
    bridge.current = undefined;
    current?.owner.close();
    current?.socket.close();
  };
  useEffect(() => {
    if (endpoint) {
      const url = new URL(window.location.href);
      const params = new URLSearchParams(url.hash.slice(1));
      params.delete("mcp");
      url.hash = params.toString();
      window.history.replaceState(null, "", url);
    }
    return disconnect;
  }, [endpoint, session]);
  if (!endpoint) return null;
  const connect = () => {
    disconnect();
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
    );
    const socket = new WebSocket(endpoint);
    const current = { socket, owner };
    bridge.current = current;
    setStatus("connecting");
    socket.onopen = () => {
      if (bridge.current === current) setStatus("connected");
    };
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
        id = message.id;
        if (typeof id !== "string") throw Error("Invalid MCP call ID");
        if (message.type === "cancel") {
          owner.cancel(id);
          return;
        }
        if (message.type !== "tool") throw Error("Invalid MCP request");
        const result = await owner.call(id, message.name, message.args);
        if (bridge.current !== current || socket.readyState !== WebSocket.OPEN)
          return;
        const response = JSON.stringify({ id, result });
        if (new TextEncoder().encode(response).byteLength > 1_800_000)
          throw Error("Canvas result too large; request a smaller page");
        socket.send(response);
      } catch (error) {
        if (bridge.current === current && socket.readyState === WebSocket.OPEN)
          socket.send(JSON.stringify({ id, error: (error as Error).message }));
      }
    };
  };
  return (
    <section
      aria-label="External agent control"
      className="er-mcp-control"
      role="region"
    >
      <strong>External agent: {status}</strong>
      <span>
        {" "}
        Full control can read canvas content and images, apply edits, use shared
        Undo/Redo and run computations. Only enable for an agent you trust.
      </span>
      {status === "connected" || status === "connecting" ? (
        <button
          onClick={() => {
            disconnect();
            setStatus("disconnected");
          }}
        >
          Disconnect agent
        </button>
      ) : (
        <button onClick={connect}>Enable full control</button>
      )}
    </section>
  );
}
