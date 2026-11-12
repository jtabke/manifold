/** Scoped MCP authority over the live owner, with tab-lifetime mutation recovery. */
import { canonical, freeze, json, type Reference } from "@manifold/foundation";
import { bindLiveWorkspace, HeadlessError } from "../headless.ts";
import {
  inspectWorkspace,
  summarizeWorkspace,
  validateWorkspace,
} from "../agent.ts";
import { createCanvasAssistant } from "./assistant.ts";
import { editCanvas, type AssistantCanvasPort } from "./assistantCanvas.ts";
import { inspectMcpFocus } from "./mcpInspection.ts";
import {
  McpError,
  mcpErrorData,
  mcpAllowed,
  MCP_MUTATIONS,
  type McpScope,
  type McpErrorData,
} from "./mcpProtocol.ts";
import type { RegionSession } from "./document.ts";
import type { WorkspaceEdits } from "./app/workspaceFiles";

type Operation = {
  operationId: string;
  tool: string;
  agent: string;
  signature: string;
  status: "running" | "accepted" | "failed";
  startedAt: string;
  documentId: string;
  result?: unknown;
  error?: McpErrorData;
};
type Completion = Awaited<ReturnType<RegionSession["compute"]>["completion"]>;
type Job = {
  id: string;
  operationId: string;
  owner: string;
  agent: string;
  documentId: string;
  target: Reference;
  state: "running" | "cancelling" | "completed";
  startedAt: string;
  finishedAt?: string;
  completion?: Completion;
  error?: McpErrorData;
  cancel: () => void;
  done: Promise<void>;
};
type Activity = {
  tool: string;
  agent: string;
  status: string;
  time: string;
  operationId?: string;
  documentId: string;
};
type Journal = {
  sessionId: string;
  operations: Map<string, Operation>;
  signatureBytes: number;
  jobs: Map<string, Job>;
  activity: Activity[];
  listeners: Set<() => void>;
};
// This belongs to the live RegionSession, not a socket: reconnecting in the same tab cannot replay an accepted edit.
// Never silently evict IDs. A full journal rejects new mutations; reload explicitly starts a new recovery lifetime.
const journals = new WeakMap<RegionSession, Journal>();
const MAX_OPERATIONS = 256,
  MAX_SIGNATURE_BYTES = 4 * 1024 * 1024,
  MAX_JOBS = 64,
  MAX_ACTIVE_JOBS = 4;
const CHUNK_SIZE = 128 * 1024;

export function createMcpCanvas(
  session: RegionSession,
  edits: WorkspaceEdits,
  canvas: AssistantCanvasPort,
  options: { scope?: McpScope; agent?: string } = {},
) {
  const scope = options.scope ?? "read-only";
  const agent = (options.agent ?? "External agent").slice(0, 80);
  const ownerId = crypto.randomUUID();
  let journal = journals.get(session);
  if (!journal) {
    journal = {
      sessionId: crypto.randomUUID(),
      operations: new Map(),
      signatureBytes: 0,
      jobs: new Map(),
      activity: [],
      listeners: new Set(),
    };
    journals.set(session, journal);
  }
  const state = journal;
  const assistant = createCanvasAssistant(session);
  const workspace = bindLiveWorkspace(session);
  let closed = false;
  let active:
    | { id: string; tool: string; controller: AbortController }
    | undefined;
  let snapshot:
    | {
        id: string;
        text: string;
        documentId: string;
        evidenceSequence: number;
        byteLength: number;
      }
    | undefined;
  const subscriptions = new Set<() => void>();
  const notify = () => {
    for (const listener of state.listeners) {
      try {
        listener();
      } catch {
        /* Observers cannot turn an accepted operation into a failure. */
      }
    }
  };
  const detach = session.subscribe(notify);
  const log = (tool: string, status: string, operationId?: string) => {
    state.activity.push({
      tool,
      agent,
      status,
      operationId,
      time: new Date().toISOString(),
      documentId: session.document.id,
    });
    state.activity = state.activity.slice(-30);
    notify();
  };
  const check = (signal: AbortSignal) => {
    if (closed || signal.aborted)
      throw new McpError(
        "CANCELLED",
        "MCP authority revoked",
        "Reconnect and query operation_status before retrying a mutation.",
      );
  };
  const draftGuard = () => {
    if (edits.read().editing)
      throw new McpError(
        "HUMAN_DRAFT_ACTIVE",
        "Finish or cancel the current canvas edit before using this tool",
        "Ask the human to finish or cancel their draft; do not overwrite it.",
      );
  };
  const guard = (expected: unknown) => {
    if (expected !== session.document.id)
      throw new McpError(
        "STALE_DOCUMENT",
        "Canvas changed; inspect it again before mutation",
        "Reinspect, review the change, and submit a new operation ID with the new documentId.",
      );
  };
  const operationView = ({ signature: _signature, ...entry }: Operation) =>
    freeze({ ...entry });
  const domainError = (error: unknown, tool: string) =>
    error instanceof McpError
      ? error
      : error instanceof HeadlessError
        ? new McpError(
            ["edit_canvas", "prepare_edit", "apply_proposal"].includes(tool) &&
            ["INVALID_INPUT", "OPERATION_REJECTED"].includes(error.code)
              ? "INVALID_EDIT"
              : error.code,
            error.message,
          )
        : new McpError(
            ["edit_canvas", "prepare_edit", "apply_proposal"].includes(tool)
              ? "INVALID_EDIT"
              : "OPERATION_REJECTED",
            mcpErrorData(error).message,
          );
  const mutate = (
    tool: string,
    args: Record<string, unknown>,
    run: () => unknown,
  ) => {
    const operationId = args.operationId;
    if (
      typeof operationId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(operationId)
    )
      throw new McpError(
        "INVALID_ARGUMENTS",
        "Mutations require a client-generated operationId (1–128 safe characters)",
      );
    json(args);
    const signature = canonical({ tool, args });
    const previous = state.operations.get(operationId);
    if (previous) {
      if (previous.signature !== signature)
        throw new McpError(
          "OPERATION_ID_CONFLICT",
          "Operation ID was already used with different arguments",
          "Query operation_status. Use a new UUID only for a genuinely new operation.",
        );
      if (previous.error)
        throw new McpError(
          previous.error.code,
          previous.error.message,
          previous.error.recovery,
        );
      if (previous.status === "running")
        throw new McpError(
          "BUSY",
          "Operation is already running",
          "Query operation_status; do not submit another mutation.",
        );
      return previous.result;
    }
    const bytes = new TextEncoder().encode(signature).byteLength;
    if (
      state.operations.size >= MAX_OPERATIONS ||
      state.signatureBytes + bytes > MAX_SIGNATURE_BYTES
    )
      throw new McpError(
        "OPERATION_LIMIT",
        "Tab recovery journal is full; existing operation IDs remain queryable",
        "Export/checkpoint the canvas before reloading. Reload starts a new recovery session; never replay old ambiguous IDs there.",
      );
    const entry: Operation = {
      operationId,
      tool,
      agent,
      signature,
      status: "running",
      startedAt: new Date().toISOString(),
      documentId: session.document.id,
    };
    state.operations.set(operationId, entry);
    state.signatureBytes += bytes;
    try {
      if (tool !== "cancel_compute") draftGuard();
      const result = freeze(run());
      entry.status = "accepted";
      entry.result = result;
      entry.documentId = session.document.id;
      log(tool, "accepted", operationId);
      return result;
    } catch (error) {
      const failure = domainError(error, tool);
      entry.status = "failed";
      entry.error = failure.toJSON();
      log(tool, "failed", operationId);
      throw failure;
    }
  };
  const jobView = (job: Job) => ({
    jobId: job.id,
    operationId: job.operationId,
    agent: job.agent,
    state: job.state,
    documentId: job.documentId,
    target: job.target,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  });
  const findJob = (id: unknown) => {
    const job = typeof id === "string" ? state.jobs.get(id) : undefined;
    if (!job)
      throw new McpError(
        "JOB_NOT_FOUND",
        "Computation job not found in this tab session",
      );
    return job;
  };
  const startJob = (args: Record<string, unknown>) => {
    guard(args.expectedDocumentId);
    const target = args.target as Reference;
    if (
      !target ||
      target.document !== session.document.document ||
      typeof target.item !== "string" ||
      !target.selection ||
      !target.selector
    )
      throw new McpError(
        "INVALID_ARGUMENTS",
        "Use an exact computation reference discovered from this canvas",
      );
    if (
      state.jobs.size >= MAX_JOBS ||
      [...state.jobs.values()].filter((entry) => entry.state !== "completed")
        .length >= MAX_ACTIVE_JOBS
    )
      throw new McpError(
        "JOB_LIMIT",
        "Computation job limit reached (64 retained, 4 active)",
        "Cancel or wait for active jobs. Export/checkpoint before reloading a full tab job registry.",
      );
    const computation = session.compute(target);
    const job: Job = {
      id: crypto.randomUUID(),
      operationId: args.operationId as string,
      owner: ownerId,
      agent,
      documentId: session.document.id,
      target,
      state: "running",
      startedAt: new Date().toISOString(),
      cancel: computation.cancel,
      done: Promise.resolve(),
    };
    state.jobs.set(job.id, job);
    job.done = computation.completion
      .then(
        (completion) => {
          job.completion = completion;
        },
        (error: unknown) => {
          job.error = mcpErrorData(error, "COMPUTE_FAILED");
        },
      )
      .then(() => {
        job.state = "completed";
        job.finishedAt = new Date().toISOString();
        log(
          "compute",
          job.error
            ? "failed"
            : job.completion?.status === "retained"
              ? "completed"
              : "discarded",
          job.operationId,
        );
      });
    return { documentId: job.documentId, jobId: job.id };
  };
  const resultOf = (job: Job) => ({
    job: jobView(job),
    completion: job.completion,
    error: job.error,
  });
  return {
    state() {
      return {
        sessionId: state.sessionId,
        scope,
        agent,
        current: active?.tool,
        jobs: [...state.jobs.values()].map(jobView),
        activity: [...state.activity],
        proposals: assistant.proposals(),
      };
    },
    subscribe(listener: () => void) {
      state.listeners.add(listener);
      subscriptions.add(listener);
      return () => {
        state.listeners.delete(listener);
        subscriptions.delete(listener);
      };
    },
    /** Only a local review button can accept a proposal under proposal-only authority. */
    dismissProposal(id: string) {
      if (closed)
        throw new McpError("CONNECTION_CLOSED", "MCP connection is closed");
      assistant.dismiss(id);
      log("prepare_edit", "human-dismissed");
    },
    approveProposal(id: string) {
      if (closed || scope === "read-only")
        throw new McpError(
          "PERMISSION_DENIED",
          "Proposal approval is unavailable",
        );
      draftGuard();
      try {
        assistant.apply(id);
        log("apply_proposal", "human-approved");
      } catch (error) {
        throw domainError(error, "apply_proposal");
      }
    },
    async call(id: string, name: string, raw: unknown): Promise<unknown> {
      if (closed)
        throw new McpError(
          "CONNECTION_CLOSED",
          "MCP connection is closed",
          "Reconnect to the same tab to query operation_status.",
        );
      if (active)
        throw new McpError(
          "BUSY",
          "Another canvas operation is running",
          "Wait for it or cancel the outstanding call. Prefer start_compute for long computations.",
        );
      if (!raw || typeof raw !== "object" || Array.isArray(raw))
        throw new McpError(
          "INVALID_ARGUMENTS",
          "Expected canvas tool arguments",
        );
      if (!mcpAllowed(scope, name))
        throw new McpError(
          "PERMISSION_DENIED",
          `Tool ${name} is not allowed with ${scope} authority`,
          "Ask the human to disconnect and choose the appropriate permission scope; do not change it yourself.",
        );
      const args = raw as Record<string, unknown>;
      json(raw);
      if (JSON.stringify(raw).length > 100_000)
        throw new McpError(
          "INVALID_ARGUMENTS",
          "Tool arguments exceed 100,000 characters",
        );
      const controller = new AbortController();
      active = { id, tool: name, controller };
      assistant.begin(id);
      notify();
      try {
        check(controller.signal);
        if ((MCP_MUTATIONS as readonly string[]).includes(name)) {
          if (args.expectedSessionId !== state.sessionId)
            throw new McpError(
              "RECOVERY_SESSION_CHANGED",
              "Mutation belongs to another tab recovery session",
              "Query connect_canvas/operation_status. Do not replay ambiguous operations across reloads; inspect accepted work and explicitly plan a new action.",
            );
          const accepted = mutate(name, args, () => {
            if (name === "edit_canvas") {
              const batch = args.batch as
                | { expectedDocumentId?: string; edits?: unknown[] }
                | undefined;
              guard(batch?.expectedDocumentId);
              if (
                !Array.isArray(batch?.edits) ||
                batch.edits.length < 1 ||
                batch.edits.length > 50
              )
                throw new McpError(
                  "INVALID_EDIT",
                  "Expected 1–50 bounded edits",
                );
              const result = session.atomic((staged) =>
                editCanvas(staged, batch),
              );
              return {
                operationId: args.operationId,
                documentId: session.document.id,
                result,
              };
            }
            if (name === "compute" || name === "start_compute")
              return startJob(args);
            if (name === "cancel_compute") {
              const job = findJob(args.jobId);
              if (job.state !== "completed") {
                job.state = "cancelling";
                job.cancel();
              }
              return { jobId: job.id, cancellationRequested: true };
            }
            guard(args.expectedDocumentId);
            if (name === "apply_proposal") {
              if (typeof args.id !== "string")
                throw new McpError(
                  "INVALID_ARGUMENTS",
                  "Expected a proposal ID",
                );
              assistant.apply(args.id);
            } else if (name === "undo" || name === "redo") session[name]();
            return {
              operationId: args.operationId,
              documentId: session.document.id,
            };
          });
          if (name !== "compute") return accepted;
          const job = findJob((accepted as { jobId: string }).jobId);
          const cancel = () => {
            if (job.state !== "completed") {
              job.state = "cancelling";
              job.cancel();
            }
          };
          controller.signal.addEventListener("abort", cancel, { once: true });
          try {
            await job.done;
            check(controller.signal);
            return {
              ...resultOf(job),
              jobId: job.id,
              documentId: session.document.id,
            };
          } finally {
            controller.signal.removeEventListener("abort", cancel);
          }
        }
        if (name === "operation_status") {
          const entry = state.operations.get(String(args.operationId));
          return {
            sessionId: state.sessionId,
            operationId: args.operationId,
            status: entry?.status ?? "unknown",
            operation: entry ? operationView(entry) : undefined,
            recovery: entry
              ? "An accepted entry means the action was submitted, not that computation succeeded. Inspect the returned job or canvas."
              : "Unknown only means not recorded in this tab session. Never infer non-application across a reload or different sessionId.",
          };
        }
        if (name === "proposal_status") {
          const proposal = assistant
            .proposals()
            .find((entry) => entry.id === args.id);
          if (!proposal)
            throw new McpError(
              "ITEM_NOT_FOUND",
              "Proposal not found in this connection",
            );
          return {
            id: proposal.id,
            status: proposal.status,
            documentId: proposal.documentId,
          };
        }
        if (name === "job_status") return jobView(findJob(args.jobId));
        if (name === "job_result") return resultOf(findJob(args.jobId));
        if (name === "agent_activity")
          return {
            sessionId: state.sessionId,
            activity: [...state.activity],
            jobs: [...state.jobs.values()].map(jobView),
          };
        if (
          [
            "inspect_model",
            "inspect_equation",
            "inspect_dependencies",
            "inspect_selection",
          ].includes(name)
        )
          return inspectMcpFocus(
            session,
            workspace,
            name,
            args,
            canvas.inspect(),
          );
        if (name === "inspect_workspace")
          return args.compact
            ? summarizeWorkspace(workspace)
            : inspectWorkspace(workspace);
        if (name === "validate") return validateWorkspace(workspace);
        if (name === "export_workspace") {
          draftGuard();
          guard(args.expectedDocumentId);
          const text = workspace.export();
          snapshot = {
            id: crypto.randomUUID(),
            text,
            documentId: session.document.id,
            evidenceSequence: session.evidenceSequence,
            byteLength: new Blob([text]).size,
          };
          log(name, "captured");
          return {
            snapshotId: snapshot.id,
            sessionId: state.sessionId,
            documentId: snapshot.documentId,
            evidenceSequence: snapshot.evidenceSequence,
            filename: "manifold-workspace.manifold",
            mediaType: "application/json",
            encoding: "utf-8",
            byteLength: snapshot.byteLength,
            chunkCount: Math.ceil(text.length / CHUNK_SIZE),
            chunkSize: CHUNK_SIZE,
            chunkUnit:
              "UTF-16 code units; concatenate text chunks before UTF-8 encoding",
          };
        }
        if (name === "read_export") {
          if (!snapshot || args.snapshotId !== snapshot.id)
            throw new McpError(
              "SNAPSHOT_NOT_FOUND",
              "Export snapshot expired or belongs to another connection",
              "Capture a new snapshot; only one export is retained per connection.",
            );
          const index = args.index;
          const chunks = Math.ceil(snapshot.text.length / CHUNK_SIZE);
          if (
            !Number.isInteger(index) ||
            Number(index) < 0 ||
            Number(index) >= chunks
          )
            throw new McpError(
              "INVALID_ARGUMENTS",
              "Export chunk index is out of range",
            );
          return {
            snapshotId: snapshot.id,
            index,
            text: snapshot.text.slice(
              Number(index) * CHUNK_SIZE,
              (Number(index) + 1) * CHUNK_SIZE,
            ),
            hasMore: Number(index) + 1 < chunks,
          };
        }
        if (name === "look_at_canvas") {
          draftGuard();
          const image = await canvas.capture(args);
          check(controller.signal);
          draftGuard();
          return image;
        }
        if (name === "prepare_edit") {
          draftGuard();
          guard(
            (args.batch as { expectedDocumentId?: string } | undefined)
              ?.expectedDocumentId,
          );
        }
        const result = assistant.tool(id, name, args);
        if (name === "prepare_edit") log(name, "proposed");
        return name === "inspect_canvas"
          ? { ...result, attention: canvas.inspect() }
          : result;
      } catch (error) {
        throw domainError(error, name);
      } finally {
        assistant.end(id);
        active = undefined;
        notify();
      }
    },
    cancel(id: string) {
      if (active?.id === id) active.controller.abort();
    },
    close() {
      if (closed) return;
      closed = true;
      active?.controller.abort();
      for (const job of state.jobs.values())
        if (job.owner === ownerId && job.state !== "completed") {
          job.state = "cancelling";
          job.cancel();
        }
      for (const listener of subscriptions) state.listeners.delete(listener);
      subscriptions.clear();
      snapshot = undefined;
      detach();
      assistant.close();
      workspace.dispose();
    },
  };
}
