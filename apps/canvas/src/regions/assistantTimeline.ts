import type { AssistantObjectReference } from "./assistantReferences";

export type AssistantTurnPhase =
  | "waiting"
  | "reasoning"
  | "writing"
  | "stopping"
  | "complete"
  | "failed"
  | "stopped"
  | "disconnected";
export type AssistantToolStatus =
  | "running"
  | "complete"
  | "failed"
  | "stopped"
  | "blocked"
  | "timeout"
  | "limit"
  | "incomplete";
export type AssistantToolActivity = {
  id: string;
  name: string;
  status: AssistantToolStatus;
  references?: readonly AssistantObjectReference[];
  note?: string;
};

const labels = {
  inspect_workspace: [
    "Reading worksheet and models",
    "Inspect worksheet and models",
  ],
  inspect_canvas: ["Inspecting canvas layout", "Inspect canvas layout"],
  inspect_plot: ["Reading plot data", "Inspect plot data"],
  look_at_canvas: ["Capturing a canvas image", "Capture canvas image"],
  capabilities: ["Checking available operations", "Check available operations"],
  prepare_edit: ["Preparing an edit for review", "Prepare an edit for review"],
} as const;

export function assistantToolLabel(name: string, running = false) {
  const label = Object.hasOwn(labels, name)
    ? labels[name as keyof typeof labels]
    : undefined;
  return (
    label?.[running ? 0 : 1] ??
    (running ? "Inspecting the canvas" : "Canvas tool")
  );
}

export function assistantToolOutcome(status: AssistantToolStatus) {
  return {
    running: "Running",
    complete: "Done",
    failed: "Failed",
    stopped: "Stopped",
    blocked: "Blocked by read-only access",
    timeout: "Timed out",
    limit: "Tool limit reached",
    incomplete: "Not confirmed",
  }[status];
}

export function assistantLiveLabel(
  phase: AssistantTurnPhase,
  tools: readonly AssistantToolActivity[],
) {
  if (phase === "stopping") return "Stopping";
  for (let i = tools.length - 1; i >= 0; i--)
    if (tools[i]?.status === "running")
      return assistantToolLabel(tools[i].name, true);
  if (phase === "reasoning") return "Model is reasoning";
  if (phase === "writing") return "Writing response";
  return "Waiting for model";
}

export function assistantElapsed(start: number, end: number) {
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  return seconds >= 60
    ? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
    : seconds
      ? `${seconds}s`
      : "<1s";
}
