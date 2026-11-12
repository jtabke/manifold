/** Explicit full-control MCP authority, separate from the approval-only assistant. */
import type { Reference } from "@manifold/foundation";
import { bindLiveWorkspace } from "../headless.ts";
import { inspectWorkspace, validateWorkspace } from "../agent.ts";
import { createCanvasAssistant } from "./assistant.ts";
import { editCanvas } from "./assistantCanvas.ts";
import type { AssistantCanvasPort } from "./assistantCanvas";
import type { RegionSession } from "./document";
import type { WorkspaceEdits } from "./app/workspaceFiles";

export function createMcpCanvas(
  session: RegionSession,
  edits: WorkspaceEdits,
  canvas: AssistantCanvasPort,
) {
  const assistant = createCanvasAssistant(session);
  const workspace = bindLiveWorkspace(session);
  let closed = false;
  let active: { id: string; controller: AbortController } | undefined;
  const check = (signal: AbortSignal) => {
    if (closed || signal.aborted) throw Error("MCP authority revoked");
  };
  return {
    async call(id: string, name: string, raw: unknown) {
      if (closed) throw Error("MCP connection is closed");
      if (active) throw Error("Another canvas operation is running");
      if (!raw || typeof raw !== "object" || Array.isArray(raw))
        throw Error("Expected canvas tool arguments");
      const args = raw as Record<string, unknown>;
      const controller = new AbortController();
      active = { id, controller };
      assistant.begin(id);
      try {
        check(controller.signal);
        if (edits.read().editing)
          throw Error(
            "Finish or cancel the current canvas edit before using MCP",
          );
        if (
          ["compute", "undo", "redo", "apply_proposal"].includes(name) &&
          args.expectedDocumentId !== session.document.id
        )
          throw Error("Canvas changed; inspect it again before mutation");
        if (name === "apply_proposal") {
          if (typeof args.id !== "string")
            throw Error("Expected a proposal ID");
          assistant.apply(args.id);
          return { documentId: session.document.id };
        }
        if (name === "edit_canvas") {
          if (Object.keys(args).some((key) => key !== "batch"))
            throw Error("Expected only an edit batch");
          const batch = args.batch as { edits?: unknown[] } | undefined;
          if (
            !batch ||
            !Array.isArray(batch.edits) ||
            batch.edits.length < 1 ||
            batch.edits.length > 50 ||
            JSON.stringify(batch).length > 100_000
          )
            throw Error("Expected 1–50 bounded edits");
          const result = session.atomic((staged) => editCanvas(staged, batch));
          return {
            result,
            documentId: session.document.id,
            validation: validateWorkspace(workspace),
          };
        }
        if (name === "compute") {
          const target = args.target as Reference;
          if (
            !target ||
            target.document !== session.document.document ||
            typeof target.item !== "string" ||
            !target.selection ||
            !target.selector
          )
            throw Error(
              "Use an exact computation reference discovered from this canvas",
            );
          const job = session.compute(target);
          const cancel = () => job.cancel();
          controller.signal.addEventListener("abort", cancel, { once: true });
          try {
            const completion = await job.completion;
            check(controller.signal);
            return {
              documentId: session.document.id,
              completion,
              validation: validateWorkspace(workspace),
            };
          } finally {
            controller.signal.removeEventListener("abort", cancel);
          }
        }
        if (name === "undo" || name === "redo") {
          session[name]();
          return { documentId: session.document.id };
        }
        if (name === "inspect_workspace") return inspectWorkspace(workspace);
        if (name === "validate") return validateWorkspace(workspace);
        if (name === "look_at_canvas") {
          const image = await canvas.capture(args);
          check(controller.signal);
          if (edits.read().editing)
            throw Error("Editing began during capture; try again");
          return image;
        }
        const result = assistant.tool(id, name, args);
        return name === "inspect_canvas"
          ? { ...result, attention: canvas.inspect() }
          : result;
      } finally {
        assistant.end(id);
        active = undefined;
      }
    },
    cancel(id: string) {
      if (active?.id === id) active.controller.abort();
    },
    close() {
      closed = true;
      active?.controller.abort();
      assistant.close();
      workspace.dispose();
    },
  };
}
