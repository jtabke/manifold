import { useEffect, useRef, useState } from "react";
import {
  createCanvasAssistant,
  type CanvasAssistant,
  type AssistantProposal,
} from "../assistant";
import type { RegionSession } from "../document";
import type { WorkspaceEdits } from "./workspaceFiles";
import type { AssistantCanvasPort } from "../assistantCanvas";
import type { AssistantObjectReference } from "../assistantReferences";

export type AssistantConnectionState = "offline" | "connecting" | "ready";
export type AssistantTurn = {
  id: string;
  prompt: string;
  selection: string[];
  answer: string;
  references: AssistantObjectReference[];
};
type Bridge = {
  socket: WebSocket;
  assistant: CanvasAssistant;
  active?: string;
  resolveConnection?: (ready: boolean) => void;
};

function disposeBridge(current: Bridge | undefined) {
  current?.resolveConnection?.(false);
  current?.assistant.close();
  current?.socket.close();
}

/** Owns transient transport and review state; accepted edits stay in RegionSession. */
export function useCanvasAssistant(
  session: RegionSession,
  edits: WorkspaceEdits,
  canvas: AssistantCanvasPort,
) {
  const canvasPort = useRef(canvas);
  canvasPort.current = canvas;
  const [connection, setConnection] =
    useState<AssistantConnectionState>("offline");
  const [submitting, setSubmitting] = useState(false);
  const submission = useRef(false);
  const [turns, setTurns] = useState<AssistantTurn[]>([]);
  const [proposals, setProposals] = useState<AssistantProposal[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [activity, setActivity] = useState("");
  const bridge = useRef<Bridge | undefined>(undefined);
  const sync = () => setProposals(bridge.current?.assistant.proposals() ?? []);
  const disconnect = () => {
    const current = bridge.current;
    bridge.current = undefined;
    disposeBridge(current);
    setConnection("offline");
    setBusy(false);
    setActivity("");
    setProposals([]);
  };
  useEffect(() => {
    const detach = session.subscribe(() => {
      if (bridge.current) setProposals(bridge.current.assistant.proposals());
    });
    return () => {
      detach();
      const current = bridge.current;
      bridge.current = undefined;
      disposeBridge(current);
    };
  }, [session]);
  const connect = async (url: string): Promise<boolean> => {
    try {
      const endpoint = new URL(url);
      if (
        endpoint.protocol !== "ws:" ||
        endpoint.hostname !== "127.0.0.1" ||
        endpoint.pathname !== "/" ||
        endpoint.username ||
        endpoint.password ||
        endpoint.hash ||
        !/^[a-f0-9]{64}$/.test(endpoint.searchParams.get("token") ?? "")
      )
        throw Error(
          "Paste the private ws://127.0.0.1 connection URL printed by the companion",
        );
      disconnect();
      setTurns([]);
      setError("");
      setConnection("connecting");
      const socket = new WebSocket(endpoint);
      const current: Bridge = {
        socket,
        assistant: createCanvasAssistant(session),
      };
      const connected = new Promise<boolean>((resolve) => {
        current.resolveConnection = resolve;
      });
      bridge.current = current;
      socket.onmessage = async (event) => {
        if (bridge.current !== current) return;
        try {
          const message = JSON.parse(event.data);
          if (message.type === "ready") {
            setConnection("ready");
            current.resolveConnection?.(true);
            current.resolveConnection = undefined;
            return;
          }
          if (message.type === "error" && !message.requestId) {
            setError(message.message);
            return;
          }
          if (message.requestId !== current.active) return;
          if (message.type === "text") {
            setActivity("Writing a response…");
            setTurns((previous) =>
              previous.map((turn) =>
                turn.id === message.requestId
                  ? { ...turn, answer: turn.answer + message.text }
                  : turn,
              ),
            );
          } else if (message.type === "tool") {
            setActivity(
              (
                {
                  inspect_workspace: "Reading the worksheet…",
                  inspect_canvas: "Inspecting canvas layout…",
                  inspect_plot: "Reading plot data…",
                  look_at_canvas: "Looking at the canvas image…",
                  capabilities: "Checking available operations…",
                  prepare_edit: "Preparing an edit for review…",
                } as Record<string, string>
              )[message.name] || "Inspecting the canvas…",
            );
            try {
              if (!current.assistant.active(message.requestId)) return;
              if (message.name === "look_at_canvas" && edits.read().editing)
                throw Error(
                  "Finish or cancel the current canvas edit before capturing an image",
                );
              const result =
                message.name === "look_at_canvas"
                  ? await canvasPort.current.capture(message.args)
                  : message.name === "inspect_canvas"
                    ? {
                        ...current.assistant.tool(
                          message.requestId,
                          message.name,
                          message.args,
                        ),
                        attention: canvasPort.current.inspect(),
                      }
                    : current.assistant.tool(
                        message.requestId,
                        message.name,
                        message.args,
                      );
              if (
                bridge.current !== current ||
                !current.assistant.active(message.requestId)
              )
                return;
              if (message.name === "look_at_canvas" && edits.read().editing)
                throw Error(
                  "Canvas editing began during capture; finish or cancel the edit and look again",
                );
              sync();
              const response = JSON.stringify({
                type: "tool_result",
                id: message.id,
                requestId: message.requestId,
                result,
              });
              if (new TextEncoder().encode(response).byteLength > 1_800_000)
                throw Error(
                  "Canvas tool result is too large; inspect a smaller page or one object",
                );
              socket.send(response);
              if (
                [
                  "inspect_workspace",
                  "inspect_canvas",
                  "inspect_plot",
                ].includes(message.name)
              ) {
                const references = (
                  result as { references: readonly AssistantObjectReference[] }
                ).references;
                setTurns((previous) =>
                  previous.map((turn) =>
                    turn.id === message.requestId
                      ? {
                          ...turn,
                          references: [
                            ...new Map(
                              [...turn.references, ...references].map(
                                (reference) => [reference.href, reference],
                              ),
                            ).values(),
                          ],
                        }
                      : turn,
                  ),
                );
              }
              setActivity("Thinking…");
            } catch (failure) {
              if (
                bridge.current !== current ||
                !current.assistant.active(message.requestId)
              )
                return;
              socket.send(
                JSON.stringify({
                  type: "tool_result",
                  id: message.id,
                  requestId: message.requestId,
                  error: (failure as Error).message,
                }),
              );
            }
          } else if (message.type === "done" || message.type === "error") {
            current.assistant.end(message.requestId);
            current.active = undefined;
            setBusy(false);
            setActivity(
              message.cancelled
                ? "Stopped. Nothing was applied automatically."
                : "",
            );
            if (message.type === "error") setError(message.message);
          }
        } catch {
          setError("Invalid companion response; disconnect and try again");
          disconnect();
        }
      };
      socket.onerror = () => {
        if (bridge.current === current)
          setError(
            "Could not connect the assistant. Disconnect and retry, or refresh your Pi configuration.",
          );
      };
      socket.onclose = () => {
        if (bridge.current !== current) return;
        disconnect();
        setError(
          (previous) =>
            previous ||
            "Companion disconnected. Pending proposals were discarded; accepted edits are preserved.",
        );
      };
      return connected;
    } catch (failure) {
      setError((failure as Error).message);
      return false;
    }
  };
  const send = async (
    text: string,
    selection: string[],
    ensureConnection: () => Promise<boolean>,
  ): Promise<boolean> => {
    if (submission.current || busy || !text.trim()) return false;
    const attached = [...new Set(selection)];
    if (edits.read().editing) {
      setError(
        "Finish or cancel the current canvas edit before asking the assistant.",
      );
      return false;
    }
    submission.current = true;
    setSubmitting(true);
    try {
      if (connection !== "ready" && !(await ensureConnection())) return false;
      const current = bridge.current;
      if (
        !current ||
        current.active ||
        current.socket.readyState !== WebSocket.OPEN
      )
        return false;
      if (edits.read().editing) {
        setError(
          "Finish or cancel the current canvas edit before asking the assistant.",
        );
        return false;
      }
      const id = crypto.randomUUID();
      current.assistant.begin(id);
      current.active = id;
      setTurns((previous) => [
        ...previous,
        {
          id,
          prompt: text.trim(),
          selection: attached,
          answer: "",
          references: [],
        },
      ]);
      setBusy(true);
      setError("");
      setActivity("Thinking…");
      current.socket.send(
        JSON.stringify({
          type: "prompt",
          requestId: id,
          text: text.trim(),
          selection: attached,
        }),
      );
      return true;
    } finally {
      submission.current = false;
      setSubmitting(false);
    }
  };
  const stop = () => {
    const current = bridge.current;
    if (!current?.active) return;
    // Revoke browser tool authority immediately, even before Pi acknowledges cancellation.
    current.assistant.end(current.active);
    current.socket.send(
      JSON.stringify({ type: "cancel", requestId: current.active }),
    );
    setActivity("Stopping…");
  };
  const resolve = (proposal: AssistantProposal, apply: boolean) => {
    try {
      if (apply && edits.read().editing)
        throw Error(
          "Finish or cancel the current canvas edit before applying this proposal.",
        );
      if (apply) bridge.current?.assistant.apply(proposal.id);
      else bridge.current?.assistant.dismiss(proposal.id);
      setError("");
      sync();
    } catch (failure) {
      setError((failure as Error).message);
      sync();
    }
  };

  return {
    connection,
    turns,
    proposals,
    busy,
    submitting,
    error,
    activity,
    connect,
    disconnect,
    send,
    stop,
    resolve,
  };
}
