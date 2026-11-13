import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import * as f from "@manifold/foundation";
import type { RegionSession, Point } from "../document";
import type { EditBuffers } from "../app/workspaceFiles";
import { useEditBuffer } from "../app/useEditBuffer";
import { AUTHORED_MODEL, type AuthoredModel } from "../authoredModels";
import { inspectModel } from "../modelCommands";
import {
  analysisViews,
  removeModelAnalysis,
  createModelAnalysis,
  reviseModelAnalysis,
  keepModelAnalysis,
} from "../modelAnalysisCommands";
import {
  analysisRequest,
  type AnalysisOutput,
  type AnalysisInput,
  type Sweep,
} from "../modelAnalysis";
import "../styles/modelAnalyses.css";
const format = (n: number) => Number(n.toPrecision(7)).toString();
export function ModelAnalysisEditor({
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
  initial?: Sweep;
  at: Point;
  close: () => void;
}) {
  const { definition } = inspectModel(session, instance);
  const input = Object.keys(definition.inputs)[0]!,
    output = Object.keys(definition.outputs)[0]!;
  const [spec, setSpec] = useState<Sweep>(
    () => initial || { input, output, low: 0, high: 10, points: 51 },
  );
  const [expected] = useState(session.document),
    [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null),
    id = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null,
      node = dialog.current!;
    node.showModal();
    return () => {
      node.close();
      previous?.focus();
    };
  }, []);
  useEditBuffer(buffers, id, {
    read: () => JSON.stringify(spec),
    finish: () => {
      setError(
        "Apply, preview or cancel analysis settings before changing files.",
      );
      return false;
    },
  });
  const save = (preview: boolean) => {
    try {
      f.assert(
        session.document === expected,
        "Work changed; cancel and reopen analysis settings",
      );
      if (item) reviseModelAnalysis(session, item, spec, preview, expected);
      else createModelAnalysis(session, instance, spec, at);
      close();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const inputPort = definition.inputs[spec.input],
    node = inputPort && definition.nodes[inputPort.node];
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
          {item ? "Edit model analysis" : "Analyze model"}
        </h2>
        <button onClick={close}>Cancel analysis editing</button>
      </header>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save(false);
        }}
      >
        <label>
          Swept input
          <select
            aria-label="Swept model input"
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
            aria-label="Analysis model output"
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
        <p>
          Range in {node?.kind === "input" ? node.unit : "input units"}. The
          sweep overrides this input only for the analysis; its accepted value
          and connection stay unchanged.
        </p>
        {(
          [
            ["low", "Range start"],
            ["high", "Range end"],
            ["points", "Sweep points"],
          ] as const
        ).map(([field, label]) => (
          <label key={field}>
            {label}
            <input
              autoFocus={field === "low"}
              type="number"
              required
              step={field === "points" ? 1 : "any"}
              min={field === "points" ? 2 : -1e12}
              max={field === "points" ? 201 : 1e12}
              aria-label={label}
              value={Number.isNaN(spec[field]) ? "" : spec[field]}
              onChange={(e) =>
                setSpec((s) => ({ ...s, [field]: e.target.valueAsNumber }))
              }
            />
          </label>
        ))}
        <button type="submit">
          {item ? "Apply analysis settings" : "Create analysis"}
        </button>
        {item && (
          <button type="button" onClick={() => save(true)}>
            Preview analysis settings
          </button>
        )}
      </form>
      {error && <p role="alert">{error}</p>}
    </dialog>
  );
}
export function ModelAnalyses({
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
  return analysisViews(session.document).map((view) => (
    <AnalysisCard
      key={view.id}
      {...{ session, view, beforeAction, move, buffers }}
      at={positions[view.id] || view}
    />
  ));
}
function AnalysisCard({
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
  const preview = !alternative && session.foundation.preview();
  const activePreview =
    preview && preview.context.root.item === view.reference.item
      ? preview
      : undefined;
  const source = activePreview ? activePreview.document : document,
    context = activePreview ? activePreview.context : alternative?.context;
  const selected = f.resolve(source, view.reference, context);
  f.assert(selected.status === "resolved", "Analysis unavailable");
  analysisRequest(selected.revision.body);
  const body = selected.revision.body;
  const scope: f.Scope = activePreview
    ? "preview"
    : alternative
      ? { alternative: alternative.id }
      : "baseline";
  const result = session.foundation.result(view.reference, scope);
  const receipt = "receipt" in result ? result.receipt : undefined;
  const series =
    receipt?.kind === "typed@1" && receipt.outcome.status === "success"
      ? (receipt.outcome.output.body as unknown as AnalysisOutput)
      : undefined;
  const name =
    document.items.get(view.reference.item)?.label || "Model analysis";
  const [editing, setEditing] = useState(false),
    [error, setError] = useState("");
  const job = useRef<ReturnType<RegionSession["compute"]> | undefined>(
    undefined,
  );
  const run = (action: () => void, finish = true) => {
    try {
      if (finish && !beforeAction()) return;
      action();
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <section
      className="im-card ma-card"
      aria-label={
        alternative ? alternative.label + " analysis comparison" : name
      }
      data-view-id={view.id}
      data-model-analysis={view.reference.item}
      data-analysis-comparison={!!alternative}
      style={{ left: at.x, top: at.y }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <header>
        <strong>{alternative?.label || name}</strong>
        <span>
          {alternative
            ? "Kept analysis"
            : activePreview
              ? "Analysis preview"
              : "Model analysis"}
        </span>
        <button
          aria-label={`Move ${name}`}
          onPointerDown={(e) => {
            e.preventDefault();
            if (beforeAction()) move(view.id, e);
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
        >
          ↔
        </button>
      </header>
      <p className="im-status" aria-label="Analysis status">
        {result.status} · {body.points} points · physical validity not assessed
      </p>
      {result.status === "blocked" && <p role="alert">{result.reason}</p>}
      {receipt?.outcome.status === "failed" && (
        <p role="alert">{receipt.outcome.reason}</p>
      )}
      <div className="im-actions">
        <button
          disabled={!!activePreview}
          onClick={() => run(() => removeModelAnalysis(session, view))}
        >
          Remove analysis
        </button>
        <button
          disabled={result.status === "pending" || result.status === "blocked"}
          onClick={() =>
            run(() => {
              job.current = session.compute(view.reference, scope);
            }, false)
          }
        >
          Compute analysis
        </button>
        {result.status === "pending" && job.current && (
          <button onClick={() => job.current?.cancel()}>Cancel analysis</button>
        )}
        {!alternative && (
          <button onClick={() => run(() => setEditing(true), !activePreview)}>
            Edit analysis settings
          </button>
        )}
        {!alternative && result.status === "current" && (
          <button
            onClick={() =>
              run(
                () =>
                  keepModelAnalysis(
                    session,
                    view.reference.item,
                    `${name}: ${series!.x.label} ${body.low}–${body.high} ${series!.x.unit}`,
                    { x: at.x + 560, y: at.y },
                  ),
                false,
              )
            }
          >
            Keep analysis
          </button>
        )}
        {activePreview && (
          <button onClick={() => run(() => session.cancelPreview(), false)}>
            Revert analysis preview
          </button>
        )}
      </div>
      {series && (
        <AnalysisSeries
          key={receipt!.id}
          series={series}
          receipt={receipt!.id}
        />
      )}
      {series && receipt?.kind === "typed@1" && (
        <AnalysisCapture
          session={session}
          receipt={receipt}
          instance={body.instance.item}
        />
      )}
      {editing && (
        <ModelAnalysisEditor
          session={session}
          buffers={buffers}
          instance={body.instance.item}
          item={view.reference.item}
          initial={body}
          at={at}
          close={() => setEditing(false)}
        />
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
function AnalysisCapture({
  session,
  receipt,
  instance,
}: {
  session: RegionSession;
  receipt: f.TypedReceipt;
  instance: string;
}) {
  const input = receipt.snapshot.input.body as unknown as AnalysisInput;
  const info = inspectModel(
    session,
    instance,
    session.document,
    receipt.context,
  );
  const source =
    info.definitionRevision.schema === AUTHORED_MODEL
      ? (info.definitionRevision.body as unknown as AuthoredModel).source
      : undefined;
  return (
    <details>
      <summary>Captured model and sources</summary>
      <p>
        Input: {input.x.label} ({input.x.unit}); output: {input.y.label} (
        {input.y.unit}). {input.interpretation.frame} ·{" "}
        {input.interpretation.condition}
      </p>
      <ul aria-label="Captured analysis inputs">
        {Object.entries(input.inputs).map(([port, value]) => (
          <li key={port}>
            {input.model.inputs[port]!.label} = {format(value.value)}{" "}
            {value.unit}
            {port === input.x.port ? " (overridden by sweep)" : ""}
          </li>
        ))}
      </ul>
      {source && (
        <ol aria-label="Captured model equations">
          {source.rows.map((row) => (
            <li key={row.id}>{row.text}</li>
          ))}
        </ol>
      )}
      <p>Definition revision: {info.definitionRevision.id}</p>
      <ul aria-label="Captured source revisions">
        {receipt.snapshot.dependencies.map((d) => (
          <li key={d.item + d.revision + f.canonical(d.selector)}>
            {session.document.items.get(d.item)?.label || d.item}: {d.revision}
          </li>
        ))}
      </ul>
    </details>
  );
}
export function AnalysisSeries({
  series,
  receipt,
  markers,
}: {
  series: AnalysisOutput;
  receipt: string;
  markers?: {
    current: number;
    candidate: number | null;
    target: number | null;
  };
}) {
  const [selected, setSelected] = useState(0),
    page = Math.floor(selected / 25),
    start = page * 25;
  const maxAbs = Math.max(1, ...series.points.map((p) => Math.abs(p[1]))),
    ys = series.points.map((p) => p[1] / maxAbs);
  const min = Math.min(
      ...ys,
      ...(markers?.target !== null && markers?.target !== undefined
        ? [markers.target / maxAbs]
        : []),
    ),
    max = Math.max(
      ...ys,
      ...(markers?.target !== null && markers?.target !== undefined
        ? [markers.target / maxAbs]
        : []),
    ),
    span = max - min || 1;
  const x = (n: number) =>
    52 +
    ((n - series.points[0]![0]) /
      (series.points.at(-1)![0] - series.points[0]![0])) *
      410;
  const y = (n: number) =>
    max === min ? 110 : 180 - ((n / maxAbs - min) / span) * 140;
  const point = series.points[selected]!;
  return (
    <div className="ma-series" data-receipt-id={receipt}>
      <svg
        viewBox="0 0 500 230"
        role="img"
        aria-label={`${series.y.label} versus ${series.x.label}`}
        onClick={(e) => {
          const bounds = e.currentTarget.getBoundingClientRect(),
            at = ((e.clientX - bounds.left) * 500) / bounds.width;
          setSelected(
            Math.max(
              0,
              Math.min(
                series.points.length - 1,
                Math.round(((at - 52) / 410) * (series.points.length - 1)),
              ),
            ),
          );
        }}
      >
        <path d="M52 30V180H462" fill="none" stroke="currentColor" />
        {markers ? (
          <>
            {series.points.map((p, i) => (
              <circle
                key={i}
                cx={x(p[0])}
                cy={y(p[1])}
                r="2.5"
                fill="#267f78"
              />
            ))}
            {(
              [
                ["Current", markers.current],
                ["Candidate", markers.candidate],
              ] as const
            ).map(
              ([label, value], i) =>
                value !== null &&
                value >= series.points[0]![0] &&
                value <= series.points.at(-1)![0] && (
                  <g key={label}>
                    <path
                      d={`M${x(value)} 40V180`}
                      stroke="currentColor"
                      strokeDasharray="4 4"
                    />
                    <text
                      x={Math.max(52, Math.min(390, x(value)))}
                      y={48 + i * 16}
                    >
                      {label}
                    </text>
                  </g>
                ),
            )}
            {markers.target !== null && (
              <g>
                <path
                  d={`M52 ${y(markers.target)}H462`}
                  stroke="currentColor"
                  strokeDasharray="2 4"
                />
                <text
                  x="390"
                  y={Math.max(70, Math.min(175, y(markers.target)))}
                >
                  Target
                </text>
              </g>
            )}
          </>
        ) : (
          <polyline
            fill="none"
            stroke="#267f78"
            strokeWidth="2"
            points={series.points.map((p) => `${x(p[0])},${y(p[1])}`).join(" ")}
          />
        )}
        <circle cx={x(point[0])} cy={y(point[1])} r="4" fill="#ad542c" />
        <text x="52" y="20">
          {series.y.label} ({series.y.unit})
        </text>
        <text x="52" y="35">
          Range: {format(Math.min(...series.points.map((p) => p[1])))} …{" "}
          {format(Math.max(...series.points.map((p) => p[1])))}
        </text>
        <text x="52" y="218">
          {series.x.label} ({series.x.unit}): {format(series.points[0]![0])} …{" "}
          {format(series.points.at(-1)![0])}
        </text>
      </svg>
      <output aria-label="Selected analysis point">
        {series.x.label} = {format(point[0])} {series.x.unit}; {series.y.label}{" "}
        = {format(point[1])} {series.y.unit}
      </output>
      <table aria-label="Analysis result table">
        <thead>
          <tr>
            <th>Point</th>
            <th>
              {series.x.label} ({series.x.unit})
            </th>
            <th>
              {series.y.label} ({series.y.unit})
            </th>
          </tr>
        </thead>
        <tbody>
          {series.points.slice(start, start + 25).map((p, i) => (
            <tr key={start + i} aria-selected={selected === start + i}>
              <td>
                <button
                  aria-label={`Inspect point ${start + i + 1}`}
                  aria-pressed={selected === start + i}
                  onClick={() => setSelected(start + i)}
                >
                  {start + i + 1}
                </button>
              </td>
              <td>{format(p[0])}</td>
              <td>{format(p[1])}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="im-actions">
        <button disabled={!page} onClick={() => setSelected((page - 1) * 25)}>
          Previous points
        </button>
        <span>
          {start + 1}–{Math.min(start + 25, series.points.length)} of{" "}
          {series.points.length}
        </span>
        <button
          disabled={start + 25 >= series.points.length}
          onClick={() => setSelected(start + 25)}
        >
          Next points
        </button>
      </div>
    </div>
  );
}
