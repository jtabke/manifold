/** Transient assistant proposals. The existing RegionSession remains the only writer. */
import { freeze } from "@manifold/foundation";
import { bindLiveWorkspace } from "../headless.ts";
import {
  compareWorkspaces,
  summarizeWorkspace,
  validateWorkspace,
} from "../agent.ts";
import { RegionSession } from "./document.ts";
import { assistantObjectReference } from "./assistantReferences.ts";
import {
  assistantCapabilities,
  canvasChanges,
  editCanvas,
  inspectCanvas,
  inspectPlot,
  summarizeCanvas,
} from "./assistantCanvas.ts";

export type AssistantProposal = Readonly<{
  id: string;
  requestId: string;
  explanation: string;
  documentId: string;
  status: "pending" | "applied" | "dismissed" | "stale";
  diff: ReturnType<typeof compareWorkspaces> & {
    canvas: ReturnType<typeof canvasChanges>;
  };
  validation: ReturnType<typeof validateWorkspace>;
}>;

export function createCanvasAssistant(session: RegionSession) {
  const workspace = bindLiveWorkspace(session);
  let closed = false;
  let request: string | undefined;
  const proposals = new Map<
    string,
    {
      proposal: AssistantProposal;
      plan: ReturnType<RegionSession["prepare"]>;
    }
  >();
  const check = () => {
    if (closed) throw Error("Assistant session is closed");
  };
  const view = (
    entry: typeof proposals extends Map<string, infer T> ? T : never,
  ) =>
    freeze({
      ...entry.proposal,
      status:
        entry.proposal.status === "pending" &&
        entry.plan.expected !== session.document
          ? ("stale" as const)
          : entry.proposal.status,
    });
  return Object.freeze({
    begin(requestId: string) {
      check();
      if (request) throw Error("An assistant request is already running");
      request = requestId;
    },
    active(requestId: string) {
      return !closed && request === requestId;
    },
    end(requestId: string) {
      if (request === requestId) request = undefined;
    },
    tool(requestId: string, name: string, args: unknown) {
      check();
      if (request !== requestId)
        throw Error("Assistant request is no longer active");
      if (name === "inspect_workspace") {
        const snapshot = summarizeWorkspace(workspace);
        return freeze({
          ...snapshot,
          references: [
            ...snapshot.worksheet.regions.map((region) =>
              assistantObjectReference(
                region.id,
                session.state.regions.find((item) => item.id === region.id)
                  ?.label ||
                  region.name ||
                  region.text.slice(0, 80) ||
                  "Worksheet region",
              ),
            ),
            ...snapshot.models.flatMap((model) => [
              assistantObjectReference(model.id, model.label),
              ...model.inputs.map((input) =>
                assistantObjectReference(
                  model.id,
                  `${model.label} → ${input.label}`,
                  input.id,
                ),
              ),
            ]),
          ],
        });
      }
      if (name === "inspect_canvas") {
        const snapshot = summarizeCanvas(session, args);
        return freeze({
          ...snapshot,
          references: snapshot.objects.map((object) => {
            const region = session.state.regions.find(
              (region) => region.id === object.id,
            );
            const drawing = snapshot.drawings.find(
              (drawing) => drawing.view === object.id,
            );
            const label =
              session.document.items.get(
                "object" in object && typeof object.object === "string"
                  ? object.object
                  : object.id,
              )?.label ||
              region?.label ||
              region?.text.slice(0, 80) ||
              drawing?.mark.text.slice(0, 80) ||
              (drawing
                ? `${drawing.mark.kind} drawing`
                : snapshot.plots.some((plot) => plot.id === object.id)
                  ? "Worksheet plot"
                  : "Canvas object");
            return assistantObjectReference(object.id, label);
          }),
        });
      }
      if (name === "inspect_plot") {
        const snapshot = inspectPlot(session, args);
        return freeze({
          ...snapshot,
          references: [
            assistantObjectReference(
              snapshot.id,
              session.document.items.get(snapshot.id)?.label || "Plot",
            ),
          ],
        });
      }
      if (name === "capabilities") return assistantCapabilities();
      if (name !== "prepare_edit") throw Error("Unsupported assistant tool");
      if (!args || typeof args !== "object" || Array.isArray(args))
        throw Error("Expected an edit proposal");
      const { explanation, batch, ...extra } = args as Record<string, unknown>;
      if (
        Object.keys(extra).length ||
        typeof explanation !== "string" ||
        explanation.length > 5000 ||
        !batch ||
        typeof batch !== "object" ||
        !Array.isArray((batch as { edits?: unknown }).edits) ||
        (batch as { edits: unknown[] }).edits.length < 1 ||
        (batch as { edits: unknown[] }).edits.length > 50 ||
        JSON.stringify(batch).length > 100_000
      )
        throw Error("Expected an explanation and 1–50 bounded edits");
      if (proposals.size >= 20)
        throw Error(
          "Proposal limit reached; reconnect to start a new conversation",
        );
      const plan = session.prepare((staged) => {
        editCanvas(staged, batch);
        // A disposable candidate reader reuses the normal result-currency implementation.
        // It has no transport, storage, UI history or execution authority; the live owner is untouched.
        const inspection = new RegionSession(
          staged.state,
          () => [],
          staged.document,
          staged.artifacts,
          false,
          {
            foundation: {
              document: staged.document,
              receipts: [...session.foundation.evidence().entries()].map(
                ([, receipt]) => receipt,
              ),
              resources: session.foundation.resources(),
            },
          },
          { artifactExecutor: null },
        );
        const candidate = bindLiveWorkspace(inspection);
        try {
          return {
            diff: {
              ...compareWorkspaces(workspace, candidate),
              canvas: canvasChanges(
                inspectCanvas(session),
                inspectCanvas(inspection),
              ),
            },
            validation: validateWorkspace(candidate),
          };
        } finally {
          candidate.dispose();
          inspection.dispose();
        }
      });
      const proposal: AssistantProposal = freeze({
        id: crypto.randomUUID(),
        requestId,
        explanation,
        documentId: plan.expected.id,
        status: "pending",
        ...plan.value,
      });
      proposals.set(proposal.id, { proposal, plan });
      return proposal;
    },
    proposals() {
      check();
      return [...proposals.values()].map(view);
    },
    apply(id: string) {
      check();
      const entry = proposals.get(id);
      if (!entry || view(entry).status !== "pending")
        throw Error(
          "Proposal is stale or already resolved; ask the assistant to refresh it",
        );
      // Accept the exact commands reviewed, including generated identities. Never rerun the agent batch.
      session.atomic((staged) => staged.applyCommands(entry.plan.commands));
      entry.proposal = freeze({ ...entry.proposal, status: "applied" });
    },
    dismiss(id: string) {
      check();
      const entry = proposals.get(id);
      if (entry && entry.proposal.status === "pending")
        entry.proposal = freeze({ ...entry.proposal, status: "dismissed" });
    },
    close() {
      closed = true;
      request = undefined;
      proposals.clear();
      workspace.dispose();
    },
  });
}
export type CanvasAssistant = ReturnType<typeof createCanvasAssistant>;
