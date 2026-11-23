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
import type {
  AssistantToolActivity,
  AssistantToolStatus,
  AssistantTurnPhase,
} from "../assistantTimeline";
import type {
  AssistantPermission,
  AssistantSettings,
} from "../assistantSettings";

export type AssistantConnectionState = "offline" | "connecting" | "ready";
export type AssistantTurn = {
  id: string;
  prompt: string;
  selection: string[];
  answer: string;
  references: AssistantObjectReference[];
  settings?: AssistantSettings;
  phase: AssistantTurnPhase;
  startedAt: number;
  endedAt?: number;
  error?: string;
  tools: AssistantToolActivity[];
};
type Bridge = {
  socket: WebSocket;
  assistant: CanvasAssistant;
  active?: string;
  activeTools: Set<string>;
  stopping?: boolean;
  stopTimer?: number;
  requestedSettings?: AssistantSettings;
  resolveConnection?: (ready: boolean) => void;
};

function disposeBridge(current: Bridge | undefined) {
  clearTimeout(current?.stopTimer);
  current?.resolveConnection?.(false);
  current?.assistant.close();
  current?.socket.close();
}

function connectionSettings(value: unknown): AssistantSettings {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Invalid assistant settings");
  const fields = value as Record<string, unknown>;
  if (
    typeof fields.provider !== "string" ||
    !fields.provider ||
    fields.provider.length > 150 ||
    typeof fields.model !== "string" ||
    !fields.model ||
    fields.model.length > 300 ||
    typeof fields.thinking !== "string" ||
    !["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(
      fields.thinking,
    ) ||
    !["read-only", "reviewed-edits"].includes(String(fields.permissions))
  )
    throw Error("Invalid assistant settings");
  return {
    provider: fields.provider,
    model: fields.model,
    thinking: fields.thinking,
    permissions: fields.permissions as AssistantPermission,
  };
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
  const [permissions, changePermissions] =
    useState<AssistantPermission>("reviewed-edits");
  const permission = useRef<AssistantPermission>("reviewed-edits");
  const [settings, setSettings] = useState<AssistantSettings>();
  const bridge = useRef<Bridge | undefined>(undefined);
  const sync = () => setProposals(bridge.current?.assistant.proposals() ?? []);
  const setPermissions = (next: AssistantPermission) => {
    try {
      if (next !== "read-only" && next !== "reviewed-edits")
        throw Error("Choose read-only or reviewed-edit assistant access");
      bridge.current?.assistant.setPermissions(next);
      permission.current = next;
      changePermissions(next);
      sync();
    } catch (failure) {
      setError((failure as Error).message);
    }
  };
  const updateTurn = (
    id: string,
    update: (turn: AssistantTurn) => AssistantTurn,
  ) =>
    setTurns((previous) =>
      previous.map((turn) => (turn.id === id ? update(turn) : turn)),
    );
  const endTurn = (
    id: string,
    phase: "complete" | "failed" | "stopped" | "disconnected",
    error?: string,
  ) => {
    const endedAt = performance.now();
    updateTurn(id, (turn) => ({
      ...turn,
      phase,
      endedAt,
      error,
      tools: turn.tools.map((tool) =>
        tool.status === "running"
          ? { ...tool, status: phase === "stopped" ? "stopped" : "incomplete" }
          : tool,
      ),
    }));
  };
  const disconnect = (message?: string) => {
    const current = bridge.current;
    bridge.current = undefined;
    if (current?.active) endTurn(current.active, "disconnected", message);
    else if (message) setError(message);
    disposeBridge(current);
    setConnection("offline");
    setBusy(false);
    setProposals([]);
    setSettings(undefined);
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
      setError("");
      setConnection("connecting");
      const socket = new WebSocket(endpoint);
      const current: Bridge = {
        socket,
        assistant: createCanvasAssistant(session),
        activeTools: new Set(),
      };
      current.assistant.setPermissions(permission.current);
      const connected = new Promise<boolean>((resolve) => {
        current.resolveConnection = resolve;
      });
      bridge.current = current;
      socket.onmessage = async (event) => {
        if (bridge.current !== current) return;
        try {
          const message = JSON.parse(event.data);
          if (message.type === "ready") {
            if (message.settings !== undefined) {
              const accepted = connectionSettings(message.settings);
              // A companion may restrict access, but cannot promote the user's
              // read-only choice while the connection is being established.
              if (accepted.permissions === "read-only")
                setPermissions("read-only");
              setSettings({ ...accepted, permissions: permission.current });
            }
            setConnection("ready");
            current.resolveConnection?.(true);
            current.resolveConnection = undefined;
            return;
          }
          if (message.type === "error" && !message.requestId) {
            setError(message.message);
            return;
          }
          const requestId = current.active;
          if (!requestId || message.requestId !== requestId) return;
          if (message.type === "done" || message.type === "error") {
            current.assistant.end(requestId);
            current.active = undefined;
            current.requestedSettings = undefined;
            current.activeTools.clear();
            const stopped = current.stopping || message.cancelled;
            current.stopping = false;
            clearTimeout(current.stopTimer);
            current.stopTimer = undefined;
            setBusy(false);
            endTurn(
              requestId,
              stopped
                ? "stopped"
                : message.type === "error"
                  ? "failed"
                  : "complete",
              !stopped && message.type === "error"
                ? String(message.message).slice(0, 1000)
                : undefined,
            );
          } else if (message.type === "tool_activity") {
            const status = message.status as AssistantToolStatus;
            if (
              typeof message.id !== "string" ||
              ![
                "complete",
                "failed",
                "stopped",
                "blocked",
                "timeout",
                "limit",
                "incomplete",
              ].includes(status)
            )
              return;
            current.activeTools.delete(message.id);
            updateTurn(requestId, (turn) => {
              if (turn.tools.some((tool) => tool.id === message.id))
                return {
                  ...turn,
                  tools: turn.tools.map((tool) =>
                    tool.id === message.id ? { ...tool, status } : tool,
                  ),
                };
              if (
                (status !== "blocked" && status !== "limit") ||
                turn.tools.length >= 51
              )
                return turn;
              return {
                ...turn,
                tools: [
                  ...turn.tools,
                  { id: message.id, name: String(message.name ?? ""), status },
                ],
              };
            });
          } else if (current.stopping) {
            return;
          } else if (message.type === "phase") {
            if (message.phase === "reasoning" || message.phase === "waiting")
              updateTurn(requestId, (turn) => ({
                ...turn,
                phase: message.phase,
              }));
          } else if (message.type === "settings") {
            const accepted = connectionSettings(message.settings),
              requested = current.requestedSettings;
            if (
              !requested ||
              Object.keys(accepted).some(
                (key) =>
                  accepted[key as keyof AssistantSettings] !==
                  requested[key as keyof AssistantSettings],
              )
            )
              throw Error("Companion settings do not match this request");
            setSettings(accepted);
            updateTurn(requestId, (turn) => ({ ...turn, settings: accepted }));
          } else if (message.type === "text") {
            if (typeof message.text === "string")
              updateTurn(requestId, (turn) => ({
                ...turn,
                phase: "writing",
                answer: turn.answer + message.text,
              }));
          } else if (message.type === "tool") {
            const { id, name } = message;
            if (
              typeof id !== "string" ||
              typeof name !== "string" ||
              !current.assistant.active(requestId)
            )
              return;
            current.activeTools.add(id);
            updateTurn(requestId, (turn) =>
              turn.tools.length < 51
                ? {
                    ...turn,
                    phase: "waiting",
                    tools: [...turn.tools, { id, name, status: "running" }],
                  }
                : turn,
            );
            const stillRunning = () =>
              bridge.current === current &&
              current.assistant.active(requestId) &&
              current.activeTools.has(id);
            try {
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
              if (!stillRunning()) return;
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
              const references = [
                "inspect_workspace",
                "inspect_canvas",
                "inspect_plot",
              ].includes(name)
                ? (
                    result as {
                      references: readonly AssistantObjectReference[];
                    }
                  ).references
                : [];
              current.activeTools.delete(id);
              updateTurn(requestId, (turn) => ({
                ...turn,
                references: references.length
                  ? [
                      ...new Map(
                        [...turn.references, ...references].map((reference) => [
                          reference.href,
                          reference,
                        ]),
                      ).values(),
                    ]
                  : turn.references,
                tools: turn.tools.map((tool) =>
                  tool.id === id
                    ? {
                        ...tool,
                        status: "complete",
                        references: references.slice(0, 3),
                      }
                    : tool,
                ),
              }));
            } catch (failure) {
              if (!stillRunning()) return;
              const error =
                failure instanceof Error
                  ? failure.message
                  : "Canvas tool failed";
              const note =
                name === "look_at_canvas" && error.includes("canvas edit")
                  ? "Finish or cancel the open canvas edit, then request another capture."
                  : undefined;
              socket.send(
                JSON.stringify({ type: "tool_result", id, requestId, error }),
              );
              current.activeTools.delete(id);
              updateTurn(requestId, (turn) => ({
                ...turn,
                tools: turn.tools.map((tool) =>
                  tool.id === id ? { ...tool, status: "failed", note } : tool,
                ),
              }));
            }
          }
        } catch {
          disconnect("Invalid companion response. Reconnect to try again.");
        }
      };
      socket.onclose = () => {
        if (bridge.current !== current) return;
        disconnect(
          current.resolveConnection
            ? "Could not connect the assistant. Check Pi configuration and try again."
            : "Reconnect to continue. Pending proposals were discarded; accepted canvas edits are preserved.",
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
    preferences?: AssistantSettings,
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
      const requested = preferences
        ? connectionSettings({
            ...preferences,
            permissions: permission.current,
          })
        : undefined;
      current.assistant.begin(id, requested?.permissions ?? permission.current);
      current.active = id;
      current.requestedSettings = requested;
      setTurns((previous) => [
        ...previous,
        {
          id,
          prompt: text.trim(),
          selection: attached,
          answer: "",
          references: [],
          phase: "waiting",
          startedAt: performance.now(),
          tools: [],
          ...(requested ? { settings: requested } : {}),
        },
      ]);
      setBusy(true);
      setError("");
      current.socket.send(
        JSON.stringify({
          type: "prompt",
          requestId: id,
          activity: true,
          text: text.trim(),
          selection: attached,
          ...(requested ? { settings: requested } : {}),
        }),
      );
      return true;
    } catch (failure) {
      const current = bridge.current;
      const message =
        failure instanceof Error
          ? failure.message
          : "Could not send the request";
      if (current?.active) {
        endTurn(current.active, "failed", message);
        current.assistant.end(current.active);
        current.active = undefined;
        current.requestedSettings = undefined;
      } else setError(message);
      setBusy(false);
      return false;
    } finally {
      submission.current = false;
      setSubmitting(false);
    }
  };
  const stop = () => {
    const current = bridge.current;
    if (!current?.active || current.stopping) return;
    // Revoke browser tool authority immediately, even before Pi acknowledges cancellation.
    const id = current.active;
    current.stopping = true;
    current.assistant.end(id);
    updateTurn(id, (turn) => ({ ...turn, phase: "stopping" }));
    try {
      current.socket.send(JSON.stringify({ type: "cancel", requestId: id }));
      current.stopTimer = window.setTimeout(() => {
        if (bridge.current === current && current.active === id)
          disconnect(
            "Stop was not acknowledged. Canvas-tool access was revoked and the connection closed.",
          );
      }, 10_000);
    } catch {
      disconnect(
        "The companion could not acknowledge Stop. The connection was closed.",
      );
    }
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
    settings,
    permissions,
    setPermissions,
    connect,
    disconnect: () => disconnect(),
    send,
    stop,
    resolve,
  };
}
