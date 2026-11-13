import { useEffect, useRef, useState, type PointerEvent } from "react";
import * as f from "@manifold/foundation";
import type { RegionSession, Point } from "../document";
import type { EditBuffers } from "../app/workspaceFiles";
import { inspectModel, modelReference } from "../modelCommands";
import {
  optimizationRequest,
  optimizationCapability,
  type OptimizationOutput,
  type OptimizationInput,
} from "../modelOptimization";
import {
  computeOptimizationResponse,
  undoOptimizationApply,
  optimizationViews,
  reviewOptimizationRuntime,
  applyOptimizationCandidate,
  keepModelOptimization,
  removeModelOptimization,
} from "../modelOptimizationCommands";
import { AnalysisSeries } from "./ModelAnalyses";
import { optimizationConvert } from "../optimizationQuantities";
import type { AnalysisOutput, ResponseRequest } from "../modelAnalysis";
import "../styles/modelAnalyses.css";
const format = (n: number) => Number(n.toPrecision(10)).toString();
export { ModelOptimizationEditor } from "./OptimizationEditor";
import { ModelOptimizationEditor } from "./OptimizationEditor";
export function ModelOptimizations({
  session,
  positions,
  beforeAction,
  move,
  buffers,
}: {
  session: RegionSession;
  positions: Record<string, Point>;
  beforeAction: () => boolean;
  move: (id: string, event: PointerEvent) => void;
  buffers: EditBuffers;
}) {
  return optimizationViews(session.document).map((view) => (
    <OptimizationCard
      key={view.id}
      {...{ session, view, beforeAction, move, buffers }}
      at={positions[view.id] || view}
    />
  ));
}
function OptimizationCard({
  session,
  view,
  at,
  beforeAction,
  move,
  buffers,
}: {
  session: RegionSession;
  view: f.View;
  at: Point;
  beforeAction: () => boolean;
  move: (id: string, event: PointerEvent) => void;
  buffers: EditBuffers;
}) {
  const document = session.document,
    alternative = view.alternative
      ? document.alternatives.get(view.alternative)
      : undefined;
  const selected = f.resolve(document, view.reference, alternative?.context);
  f.assert(selected.status === "resolved", "Optimization unavailable");
  optimizationRequest(selected.revision.body);
  const body = selected.revision.body;
  const result = session.foundation.result(
    view.reference,
    alternative ? { alternative: alternative.id } : "baseline",
  );
  const prior = [...session.foundation.evidence().entries()]
    .map(([, r]) => r)
    .filter(
      (r): r is f.TypedReceipt =>
        r.kind === "typed@1" &&
        r.snapshot.origin.document === view.reference.document &&
        r.snapshot.origin.item === view.reference.item,
    )
    .sort((a, b) => b.order - a.order)[0];
  const receipt =
    "receipt" in result && result.receipt?.kind === "typed@1"
      ? result.receipt
      : prior;
  const output =
    receipt?.outcome.status === "success"
      ? (receipt.outcome.output.body as unknown as OptimizationOutput)
      : undefined;
  const captured = receipt?.snapshot.input.body as unknown as
    | OptimizationInput
    | undefined;
  const [editing, setEditing] = useState(false),
    [error, setError] = useState(""),
    [reviewing, setReviewing] = useState(false),
    [runtimeUnavailable, setRuntimeUnavailable] = useState(false),
    [applied, setApplied] = useState<{
      after: f.Document;
      receipt: string;
    } | null>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const job = useRef<ReturnType<RegionSession["compute"]> | undefined>(
      undefined,
    ),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      job.current?.cancel();
    };
  }, []);
  const edits = () =>
    buffers.compose({
      read: () => ({ draft: "" }),
      finish: beforeAction,
      settle: async () => {},
    });
  const act = (action: () => void) => {
    try {
      if (!edits().finish()) return;
      action();
      setError("");
      status.current?.focus();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const run = async () => {
    if (!edits().finish()) return;
    const expected = session.document,
      draft = edits().read().draft;
    try {
      setReviewing(true);
      setError("");
      if (!alternative) {
        let backend;
        try {
          backend = await optimizationCapability();
          if (alive.current) setRuntimeUnavailable(false);
        } catch (e) {
          if (alive.current) setRuntimeUnavailable(true);
          throw e;
        }
        f.assert(
          alive.current &&
            session.document === expected &&
            edits().read().draft === draft,
          "Work or pending edits changed during runtime review; Run again",
        );
        reviewOptimizationRuntime(
          session,
          view.reference.item,
          backend,
          expected,
        );
      }
      f.assert(alive.current, "Optimization closed");
      job.current = session.compute(
        view.reference,
        alternative ? { alternative: alternative.id } : "baseline",
      );
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) {
        setReviewing(false);
        status.current?.focus();
      }
    }
  };
  const info = (() => {
    try {
      return !alternative
        ? inspectModel(session, body.instance.item)
        : undefined;
    } catch {
      return undefined;
    }
  })();
  const [selectedResponse, setSelectedResponse] = useState<string | null>(null);
  const responses = [...document.items.entries()]
    .map(([id]) => ({ id, revision: f.current(document, id) }))
    .filter(
      (r) =>
        r.revision?.schema === "canvas-model-response@1" &&
        (r.revision.body as unknown as ResponseRequest).receipt === receipt?.id,
    );
  // Prefer the explicit action result, including a deduplicated earlier request.
  // Reload falls back deterministically to the most recently retained response.
  const response =
    responses.find((r) => r.id === selectedResponse) ||
    responses
      .sort((a, b) => {
        const order = (id: string) => {
          const result = session.foundation.result(
            modelReference(document, id),
            "baseline",
          );
          return "receipt" in result ? (result.receipt?.order ?? -1) : -1;
        };
        return order(a.id) - order(b.id) || a.id.localeCompare(b.id);
      })
      .at(-1);
  const responseBody = response?.revision?.body as unknown as
    | ResponseRequest
    | undefined;
  const responseResult = response
    ? session.foundation.result(
        modelReference(document, response.id),
        "baseline",
      )
    : undefined;
  const responseReceipt =
    responseResult && "receipt" in responseResult
      ? responseResult.receipt
      : undefined;
  const responseSeries =
    responseReceipt?.kind === "typed@1" &&
    responseReceipt.outcome.status === "success"
      ? (responseReceipt.outcome.output.body as unknown as AnalysisOutput)
      : undefined;
  const quantity = (value: number, axis: "input" | "output") => {
    const source =
      axis === "input" ? captured?.scalar.x.unit : captured?.scalar.y.unit;
    const display = body.displayUnits?.[axis] || source || "1";
    if (!source) return `${format(value)} ${display}`;
    try {
      return `${format(optimizationConvert(value, source, display))} ${display}`;
    } catch {
      return `${format(value)} ${source}`;
    }
  };
  const runtimeMissing =
    runtimeUnavailable ||
    ["unavailable", "backend_mismatch", "transport_error"].includes(
      output?.code || "",
    );
  const historical =
    applied?.receipt === receipt?.id && result.status !== "current";
  const binding = info?.body.inputs[body.input],
    replacesSource = binding?.kind === "reference";
  const applicable =
    !alternative &&
    !session.foundation.preview() &&
    result.status === "current" &&
    output?.success;
  return (
    <section
      className="im-card ma-card"
      aria-label="Model optimization"
      data-view-id={view.id}
      data-model-optimization={view.reference.item}
      data-optimization-comparison={!!alternative}
      style={{ left: at.x, top: at.y }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <header>
        <strong>
          {alternative?.label ||
            document.items.get(view.reference.item)?.label ||
            "Optimization"}
        </strong>
        <span>{alternative ? "Kept optimization" : "Model optimization"}</span>
        <button
          aria-label="Move optimization"
          onPointerDown={(e) => {
            e.preventDefault();
            if (beforeAction()) move(view.id, e);
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
        >
          ↔
        </button>
      </header>
      <p
        ref={status}
        tabIndex={-1}
        aria-label="Optimization status"
        role="status"
        aria-live="polite"
      >
        {reviewing
          ? "Reviewing numerical runtime"
          : result.status === "pending"
            ? "Running"
            : historical
              ? "Result from before this change"
              : runtimeMissing
                ? "Runtime unavailable"
                : result.status === "ready" && prior
                  ? "Model changed — result captured before current settings. Run again before applying"
                  : result.status === "failed"
                    ? "Stopped without convergence"
                    : output
                      ? output.success
                        ? body.mode === "target"
                          ? "Target met"
                          : "Search converged"
                        : "Stopped without convergence"
                      : "Ready"}
      </p>
      <p>
        {body.mode === "target"
          ? "Reach target"
          : body.mode === "minimize"
            ? "Make smaller"
            : "Make larger"}
        :{" "}
        {captured?.scalar.y.label ||
          info?.definition.outputs[body.output]?.label ||
          body.output}
        {body.mode === "target"
          ? ` = ${body.target} ${captured?.scalar.y.unit || ""}`
          : ""}
        . Change only{" "}
        {captured?.scalar.x.label ||
          info?.definition.inputs[body.input]?.label ||
          body.input}{" "}
        in [{body.low}, {body.high}] {captured?.scalar.x.unit || ""}.
      </p>
      {output?.candidate && captured && (
        <p>
          <strong>Current (at Run):</strong>{" "}
          {quantity(
            captured.scalar.inputs[captured.scalar.x.port]!.value,
            "input",
          )}{" "}
          → <strong>Proposed:</strong> {quantity(output.candidate.x, "input")};
          resulting {captured.scalar.y.label}:{" "}
          {quantity(output.candidate.output, "output")}.
          {output.candidate.residual !== null && (
            <>
              {" "}
              Target error {format(Math.abs(output.candidate.residual))}{" "}
              {captured.scalar.y.unit}; numerical tolerance{" "}
              {output.residual_tolerance} {captured.scalar.y.unit}.
            </>
          )}
          {output.candidate.x === output.bounds[0] ||
          output.candidate.x === output.bounds[1]
            ? " Best found at the selected limit; range has not been expanded."
            : ""}
          {!output.success && " Unconfirmed candidate — Apply disabled."}
        </p>
      )}
      {output && !output.success && (
        <p role="status">
          {output.code === "no_bracket"
            ? "Checked endpoints are on the same side of the target. Edit the range or target; this does not prove no solution exists."
            : output.code.includes("domain")
              ? "The model could not be evaluated in this range. The numerical runtime did not identify a failed expression. Edit the range or view the model."
              : "Search stopped without confirmed convergence. Review range and model; another run is not guaranteed to succeed."}
        </p>
      )}
      {result.status === "blocked" && body.backend && (
        <p role="status">
          Model not ready: {result.reason}. View the model or edit optimization
          settings.
        </p>
      )}
      {receipt?.outcome.status === "failed" && (
        <p role="alert">
          Computation could not finish. Review the model and permitted range,
          then Run again.
        </p>
      )}
      <details className="optimization-controls">
        <summary>Settings and actions</summary>
        <p>
          One variable; all other effective inputs fixed. Bounded local search,
          not global-optimum or engineering acceptance proof. Run explicitly
          captures and reviews the optional runtime.
        </p>
        <div className="im-actions">
          <button
            disabled={
              reviewing ||
              result.status === "pending" ||
              !!session.foundation.preview()
            }
            onClick={() => void run()}
          >
            Run optimization
          </button>
          {result.status === "pending" && (
            <button
              onClick={() => {
                job.current?.cancel();
                status.current?.focus();
              }}
            >
              Cancel optimization
            </button>
          )}
          {!alternative && (
            <button
              disabled={!info}
              onClick={() => act(() => setEditing(true))}
            >
              Edit settings / Adjust range
            </button>
          )}
          <button
            disabled={!applicable}
            onClick={() =>
              act(() => {
                f.assert(receipt, "No reviewed receipt");
                applyOptimizationCandidate(session, view, receipt, document);
                setApplied({ after: session.document, receipt: receipt.id });
              })
            }
          >
            Apply change
          </button>
          {!alternative && (
            <button
              disabled={result.status !== "current"}
              onClick={() =>
                act(() => {
                  keepModelOptimization(session, view, {
                    x: at.x + 560,
                    y: at.y,
                  });
                })
              }
            >
              Keep result
            </button>
          )}
          <button
            onClick={() => act(() => removeModelOptimization(session, view))}
          >
            Remove optimization
          </button>
        </div>
        {output?.candidate && captured && (
          <p role="note">
            Apply writes the literal {String(output.candidate.x)}{" "}
            {captured.scalar.x.unit} to {captured.scalar.x.label}.
            {replacesSource
              ? " This replaces and disconnects the current source connection. Undo restores that exact connection."
              : " Undo restores the exact former input literal."}
          </p>
        )}
        {historical && (
          <p role="status">
            Applied {captured?.scalar.x.label}:{" "}
            {captured &&
              String(
                captured.scalar.inputs[captured.scalar.x.port]!.value,
              )}{" "}
            → {output?.candidate && String(output.candidate.x)}{" "}
            {captured?.scalar.x.unit}. Evidence below is from before this
            change.{" "}
            <button
              disabled={
                session.document !== applied?.after ||
                !!session.foundation.preview()
              }
              onClick={() =>
                act(() => {
                  f.assert(applied, "Apply history unavailable");
                  undoOptimizationApply(session, applied.after);
                  setApplied(null);
                })
              }
            >
              Undo this change
            </button>
            {session.document !== applied?.after &&
              " Later work exists; use global Undo to review history."}
          </p>
        )}
        {receipt?.outcome.status === "success" && (
          <div className="im-actions">
            <button
              disabled={responseResult?.status === "pending"}
              onClick={() =>
                act(() => {
                  const response = computeOptimizationResponse(
                    session,
                    view,
                    receipt,
                  );
                  setSelectedResponse(response.item);
                  job.current = response.job;
                })
              }
            >
              Compute response plot
            </button>
            <button
              disabled={responseResult?.status === "pending"}
              onClick={() =>
                act(() => {
                  const response = computeOptimizationResponse(
                    session,
                    view,
                    receipt,
                    2,
                  );
                  setSelectedResponse(response.item);
                  job.current = response.job;
                })
              }
            >
              Check endpoint outputs
            </button>
            {responseResult?.status === "pending" && (
              <button
                onClick={() => {
                  job.current?.cancel();
                  status.current?.focus();
                }}
              >
                Cancel response sampling
              </button>
            )}
          </div>
        )}
        {responseResult?.status === "pending" && (
          <p role="status">Sampling captured model…</p>
        )}
        {responseReceipt?.outcome.status === "failed" && (
          <p role="alert">
            Response sampling stopped: one or more captured model evaluations
            failed. No continuous curve or partial values are claimed. Edit the
            range or view the model.
          </p>
        )}
        {responseSeries && responseBody && (
          <details open>
            <summary>
              Checked response samples — exact optimization capture
            </summary>
            <p>
              Additional explicit sampling; not solver evaluation points. Each
              dot is checked evidence, not continuity or global optimality.
              Current at Run: {responseBody.current} {responseSeries.x.unit};
              candidate: {responseBody.candidate ?? "none"}; bounds:{" "}
              {responseBody.capture.low}–{responseBody.capture.high}; target:{" "}
              {responseBody.target ?? "none"}. Source receipt:{" "}
              {responseBody.receipt}. Live model edits do not replace this
              capture.
            </p>
            <AnalysisSeries
              key={responseReceipt!.id}
              series={responseSeries}
              receipt={responseReceipt!.id}
              markers={responseBody}
            />
          </details>
        )}
      </details>
      {output && captured && (
        <div data-optimization-receipt={receipt!.id}>
          <p aria-label="Optimization termination">
            {output.success
              ? "Converged and independently checked"
              : "Not applicable"}{" "}
            · {output.code}
          </p>
          {output.candidate && (
            <output aria-label="Optimization candidate">
              {captured.scalar.x.label} = {format(output.candidate.x)}{" "}
              {captured.scalar.x.unit}; {captured.scalar.y.label} ={" "}
              {format(output.candidate.output)} {captured.scalar.y.unit}
              {output.candidate.residual !== null
                ? `; residual = ${format(output.candidate.residual)} ${captured.scalar.y.unit}`
                : ""}
            </output>
          )}
          <details>
            <summary>Numerical work and tolerances</summary>
            <p>
              Evaluations: {output.evaluations ?? "unknown"}/
              {output.limits.evaluations}; iterations:{" "}
              {output.iterations ?? "unknown"}/{output.limits.iterations}; wall
              limit: {output.limits.wall_ms} ms. Input tolerance:{" "}
              {output.x_tolerance} {captured.scalar.x.unit}
              {output.residual_tolerance !== null
                ? `; residual tolerance: ${output.residual_tolerance} ${captured.scalar.y.unit}`
                : ""}
              .
            </p>
          </details>
          <details>
            <summary>Captured model, sources and numerical provenance</summary>
            <p>
              {output.algorithm} · {output.scope}
            </p>
            <p>
              Python {output.backend?.python || "unavailable"}; NumPy{" "}
              {output.backend?.numpy || "unknown"}; SciPy{" "}
              {output.backend?.scipy || "unknown"}
            </p>
            <p>
              Backend: {output.expected_backend.source_sha256}
              <br />
              Program: {output.program_sha256}
            </p>
            <ul>
              {Object.entries(captured.scalar.inputs).map(([port, s]) => (
                <li key={port}>
                  {captured.scalar.model.inputs[port]!.label} ={" "}
                  {format(s.value)} {s.unit}
                  {port === captured.scalar.x.port
                    ? " (varied in capture only)"
                    : " (fixed)"}
                </li>
              ))}
            </ul>
            <ul>
              {receipt!.snapshot.dependencies.map((d) => (
                <li key={d.item + d.revision + f.canonical(d.selector)}>
                  {d.item}: {d.revision}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
      {editing && (
        <ModelOptimizationEditor
          {...{ session, buffers, at }}
          instance={body.instance.item}
          item={view.reference.item}
          initial={body}
          close={() => setEditing(false)}
        />
      )}
      {runtimeMissing && (
        <details open>
          <summary>Optional numerical runtime setup</summary>
          <p>
            Settings stay editable and the rest of the canvas remains usable. A
            local developer can enable the supported CPython 3.12 / NumPy 2.2.6
            / SciPy 1.15.3 profile using the repository’s hash-locked setup.
            Nothing is installed automatically.
          </p>
          <textarea
            readOnly
            aria-label="Copy optional runtime setup"
            value={
              "make setup-optimizer OPTIMIZER_PYTHON=python3.12\nmake canvas PYTHON=.venv/optimizer/bin/python"
            }
          />
        </details>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
