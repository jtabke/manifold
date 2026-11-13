import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import * as f from "@manifold/foundation";
import type { RegionSession, Point } from "../document";
import type { EditBuffers } from "../app/workspaceFiles";
import { useEditBuffer } from "../app/useEditBuffer";
import { inspectModel, modelReference } from "../modelCommands";
import { canvasSchemas } from "../app/canvasDocument";
import {
  optimizationRequest,
  optimizationCapability,
  type OptimizationSpec,
  type OptimizationOutput,
  type OptimizationInput,
} from "../modelOptimization";
import {
  optimizationViews,
  createModelOptimization,
  reviseModelOptimization,
  reviewOptimizationRuntime,
  applyOptimizationCandidate,
  keepModelOptimization,
  removeModelOptimization,
} from "../modelOptimizationCommands";
import "../styles/modelAnalyses.css";
const format = (n: number) => Number(n.toPrecision(10)).toString();
export function ModelOptimizationEditor({
  session,
  buffers,
  instance,
  item,
  initial,
  at,
  close,
}: {
  session: RegionSession;
  buffers: EditBuffers;
  instance: string;
  item?: string;
  initial?: OptimizationSpec;
  at: Point;
  close: () => void;
}) {
  const { definition } = inspectModel(session, instance);
  const [spec, setSpec] = useState<OptimizationSpec>(
    () =>
      initial || {
        input: Object.keys(definition.inputs)[0]!,
        output: Object.keys(definition.outputs)[0]!,
        low: 0,
        high: 10,
        mode: "minimize",
        target: null,
        xTolerance: 1e-8,
        residualTolerance: null,
      },
  );
  const [expected] = useState(session.document),
    [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null),
    id = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null,
      node = dialog.current!;
    node.showModal();
    node.querySelector<HTMLInputElement>('[aria-label="Lower bound"]')?.focus();
    return () => {
      node.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  useEditBuffer(buffers, id, {
    read: () => JSON.stringify(spec),
    finish: () => {
      setError(
        "Create, save or cancel optimization settings before changing files.",
      );
      return false;
    },
  });
  const input = definition.inputs[spec.input],
    node = input && definition.nodes[input.node];
  const projectedOutput = f.project(
    session.document,
    modelReference(session.document, instance, f.modelPort(spec.output)),
    canvasSchemas,
    session.foundation.resources(),
  );
  const outputUnit =
    projectedOutput.status === "resolved" &&
    f.object(projectedOutput.projection.value)
      ? String(projectedOutput.projection.value.unit)
      : "unresolved output units";
  return (
    <dialog
      ref={dialog}
      className="im-editor"
      aria-labelledby={id + "-title"}
      onKeyDown={(e) => e.stopPropagation()}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <header>
        <h2 id={id + "-title"}>
          {item ? "Edit optimization" : "Optimize model"}
        </h2>
        <button onClick={close}>Cancel optimization editing</button>
      </header>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            f.assert(
              session.document === expected,
              "Work changed; reopen optimization settings",
            );
            if (item) reviseModelOptimization(session, item, spec, expected);
            else createModelOptimization(session, instance, spec, at);
            close();
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <label>
          Variable input
          <select
            aria-label="Optimization input"
            value={spec.input}
            onChange={(e) => setSpec((s) => ({ ...s, input: e.target.value }))}
          >
            {Object.entries(definition.inputs).map(([port, p]) => (
              <option key={port} value={port}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Output
          <select
            aria-label="Optimization output"
            value={spec.output}
            onChange={(e) => setSpec((s) => ({ ...s, output: e.target.value }))}
          >
            {Object.entries(definition.outputs).map(([port, p]) => (
              <option key={port} value={port}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Goal
          <select
            aria-label="Optimization goal"
            value={spec.mode}
            onChange={(e) => {
              const mode = e.target.value as OptimizationSpec["mode"];
              setSpec((s) => ({
                ...s,
                mode,
                target: mode === "target" ? 0 : null,
                residualTolerance: mode === "target" ? 1e-8 : null,
              }));
            }}
          >
            <option value="minimize">Minimize</option>
            <option value="maximize">Maximize</option>
            <option value="target">Solve target</option>
          </select>
        </label>
        <p>
          Closed bounds and input tolerance in{" "}
          {node?.kind === "input" ? node.unit : "input units"}. Target and
          residual tolerance are in {outputUnit}. Other effective inputs and
          source observations stay fixed. Requires explicitly upgraded
          scientific v3 authored equations.
        </p>
        {(
          [
            ["low", "Lower bound"],
            ["high", "Upper bound"],
            ["xTolerance", "Input tolerance"],
            ...(spec.mode === "target"
              ? [
                  ["target", "Target output"],
                  ["residualTolerance", "Residual tolerance"],
                ]
              : []),
          ] as [
            keyof Pick<
              OptimizationSpec,
              "low" | "high" | "xTolerance" | "target" | "residualTolerance"
            >,
            string,
          ][]
        ).map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              type="number"
              step="any"
              required
              autoFocus={key === "low"}
              aria-label={label}
              value={
                spec[key] === null || Number.isNaN(spec[key]) ? "" : spec[key]!
              }
              onChange={(e) =>
                setSpec((s) => ({ ...s, [key]: e.target.valueAsNumber }))
              }
            />
          </label>
        ))}
        <button type="submit">
          {item ? "Save optimization settings" : "Create optimization"}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
    </dialog>
  );
}
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
    [reviewing, setReviewing] = useState(false);
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
        const backend = await optimizationCapability();
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
      if (alive.current) setReviewing(false);
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
      <p aria-label="Optimization status">
        {reviewing
          ? "Reviewing numerical runtime"
          : result.status === "ready" && prior
            ? "noncurrent retained evidence"
            : result.status}{" "}
        · {body.mode} · {body.input}: [{body.low}, {body.high}]
      </p>
      <p>
        Bounded local search, not a global-optimum proof. Solve target requires
        a bracket or satisfactory endpoint. No physical-validity assessment.
      </p>
      {result.status === "blocked" && <p role="status">{result.reason}</p>}
      {receipt?.outcome.status === "failed" && (
        <p role="alert">{receipt.outcome.reason}</p>
      )}
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
          <button onClick={() => job.current?.cancel()}>
            Cancel optimization
          </button>
        )}
        {!alternative && (
          <button disabled={!info} onClick={() => act(() => setEditing(true))}>
            Edit optimization settings
          </button>
        )}
        <button
          disabled={!applicable}
          onClick={() =>
            act(() => {
              f.assert(receipt, "No reviewed receipt");
              applyOptimizationCandidate(session, view, receipt, document);
            })
          }
        >
          {replacesSource ? "Replace source with candidate" : "Apply candidate"}
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
            Keep optimization
          </button>
        )}
        <button
          onClick={() => act(() => removeModelOptimization(session, view))}
        >
          Remove optimization
        </button>
      </div>
      {replacesSource && (
        <p role="note">
          Apply replaces the input's source connection with a literal candidate.
          Undo restores the exact prior connection.
        </p>
      )}
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
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
