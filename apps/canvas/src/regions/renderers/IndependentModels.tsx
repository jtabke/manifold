import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { EditBuffers } from "../app/workspaceFiles.ts";
import { useEditBuffer } from "../app/useEditBuffer";
import * as f from "@manifold/foundation";
import { AUTHORED_MODEL, type AuthoredModel } from "../authoredModels";
import { ModelAnalysisEditor } from "./ModelAnalyses";
import { ModelDefinitionEditor } from "./ModelDefinitionEditor";
import type { RegionSession, Point } from "../document.ts";
import { canvasSchemas } from "../app/canvasDocument.ts";
import { readCsv } from "../dataSources.ts";
import {
  comparisonInstance,
  instantiateModel,
  reviewInstanceUpdate,
  applyInstanceUpdate,
  inspectModel,
  modelReference,
  modelRequest,
  modelViews,
  setModelInput,
  previewModelInput,
  keepModelPreview,
  reviewModelConnection,
  reviewModelCsv,
  applyModelConnection,
} from "../modelCommands.ts";
import "../styles/independentModels.css";
export function IndependentModels({
  session,
  positions,
  beforeAction,
  move,
  editBuffers,
  askAgent,
}: {
  session: RegionSession;
  askAgent?: (id: string, at: Point) => void;
  positions: Record<string, Point>;
  beforeAction: () => boolean;
  move: (id: string, event: PointerEvent) => void;
  editBuffers: EditBuffers;
}) {
  return modelViews(session.document).map((view) => (
    <ModelCard
      key={view.id}
      session={session}
      view={view}
      at={positions[view.id] || view}
      beforeAction={beforeAction}
      move={move}
      editBuffers={editBuffers}
      askAgent={askAgent}
    />
  ));
}
function ModelCard({
  session,
  view,
  at,
  beforeAction,
  move,
  editBuffers,
  askAgent,
}: {
  session: RegionSession;
  askAgent?: (id: string, at: Point) => void;
  view: f.View;
  at: Point;
  beforeAction: () => boolean;
  move: (id: string, event: PointerEvent) => void;
  editBuffers: EditBuffers;
}) {
  const [error, setError] = useState(""),
    [selectedSource, setSelectedSource] = useState(""),
    [connections, setConnections] = useState<ReadonlySet<string>>(
      () => new Set(),
    ),
    [reviewed, setReviewed] =
      useState<ReturnType<typeof reviewModelConnection>>();
  const document = session.document,
    alternative = view.alternative
      ? document.alternatives.get(view.alternative)
      : undefined,
    context = alternative ? alternative.context : undefined,
    frozenRequest = context && f.resolve(document, view.reference, context),
    instance =
      frozenRequest?.status === "resolved"
        ? comparisonInstance(
            frozenRequest.revision.body,
            frozenRequest.revision.schema,
          )
        : view.reference.item,
    { body, definition, revision } = inspectModel(
      session,
      instance,
      document,
      context,
    ),
    preview = !alternative && session.foundation.preview(),
    activePreview =
      preview && preview.context.root.item === modelRequest(instance)
        ? preview
        : undefined,
    sourceDocument = activePreview ? activePreview.document : document,
    sourceContext = activePreview ? activePreview.context : context,
    target = modelReference(document, modelRequest(instance)),
    scope: f.Scope = activePreview
      ? "preview"
      : alternative
        ? { alternative: alternative.id }
        : "baseline",
    result = session.foundation.result(target, scope),
    name = document.items.get(instance)?.label || "Model";
  const [editingAnalysis, setEditingAnalysis] = useState(false);
  const [editingDefinition, setEditingDefinition] = useState(false),
    [update, setUpdate] = useState<ReturnType<typeof reviewInstanceUpdate>>(),
    [resetBindings, setResetBindings] = useState(false);
  const latestDefinition = f.current(document, body.model.item);
  const canEdit = !alternative && latestDefinition?.schema === AUTHORED_MODEL;
  const needsUpdate =
    !alternative &&
    body.model.selection.kind === "pin" &&
    latestDefinition?.id !== body.model.selection.revision;
  const run = (action: () => void) => {
    try {
      if (!beforeAction()) return;
      action();
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <section
      className="im-card"
      aria-label={`${name}${alternative ? " comparison" : " model"}`}
      data-view-id={view.id}
      data-independent-model={instance}
      data-comparison={!!alternative}
      style={{ left: at.x, top: at.y }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <header>
        <strong>{alternative?.label || name}</strong>
        {askAgent && !alternative && (
          <button
            type="button"
            aria-label={`Ask agent about ${name}`}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              askAgent(view.id, {
                x: event.detail ? event.clientX : rect.right,
                y: event.detail ? event.clientY : rect.top,
              });
            }}
          >
            Ask agent
          </button>
        )}
        <span>{alternative ? "Kept comparison" : "Independent instance"}</span>
        <button
          aria-label={`Move ${name} model`}
          onPointerDown={(e) => {
            e.preventDefault();
            if (beforeAction()) move(view.id, e);
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
        >
          ↔
        </button>
      </header>
      <p className="im-meaning">
        {body.interpretation.frame} · {body.interpretation.condition}
        <br />
        Subject: {body.interpretation.subject}
      </p>
      {Object.entries(definition.inputs).map(([port, exposed]) => {
        const node = definition.nodes[exposed.node];
        if (node?.kind !== "input") return null;
        const binding = body.inputs[port],
          source =
            binding?.kind === "reference"
              ? f.project(
                  document,
                  binding.reference,
                  canvasSchemas,
                  session.foundation.resources(),
                  context,
                )
              : undefined,
          value =
            binding?.kind === "value"
              ? binding.value
              : source?.status === "resolved" &&
                  f.object(source.projection.value)
                ? Number(source.projection.value.value)
                : node.default;
        return (
          <div className="im-input" key={port}>
            <ModelInput
              key={revision.id}
              id={view.id + ":" + port}
              buffers={editBuffers}
              label={exposed.label}
              unit={node.unit}
              name={`${name} ${exposed.label}`}
              value={value}
              disabled={!!alternative}
              previewing={!!activePreview}
              cancelPreview={
                activePreview ? () => session.cancelPreview() : undefined
              }
              apply={(value, preview, fromBuffer) => {
                if (!fromBuffer && !beforeAction()) return false;
                try {
                  if (preview)
                    previewModelInput(session, instance, port, value);
                  else setModelInput(session, instance, port, value);
                  setError("");
                  return true;
                } catch (error) {
                  setError((error as Error).message);
                  return false;
                }
              }}
            />
            {binding?.kind === "reference" && (
              <small>
                Bound to{" "}
                {document.items.get(binding.reference.item)?.label ||
                  binding.reference.item}
                {binding.reference.selection.kind === "pin"
                  ? " · pinned"
                  : " · follows selected source"}
              </small>
            )}
            {!alternative && (
              <details
                onToggle={(event) => {
                  const open = event.currentTarget.open;
                  setConnections((current) => {
                    if (current.has(port) === open) return current;
                    const next = new Set(current);
                    if (open) next.add(port);
                    else next.delete(port);
                    return next;
                  });
                }}
              >
                <summary>Connect {exposed.label}</summary>
                {connections.has(port) && (
                  <>
                    <select
                      aria-label={`Source for ${exposed.label}`}
                      value={selectedSource}
                      onChange={(e) => {
                        setSelectedSource(e.target.value);
                        setReviewed(undefined);
                      }}
                    >
                      <option value="">
                        Choose a public port or CSV source
                      </option>
                      {modelViews(document)
                        .filter(
                          (v) =>
                            !v.alternative && v.reference.item !== instance,
                        )
                        .flatMap((v) => {
                          const info = inspectModel(session, v.reference.item);
                          return Object.entries(info.definition.outputs).map(
                            ([output, p]) => (
                              <option
                                key={v.id + output}
                                value={JSON.stringify([
                                  "model",
                                  v.reference.item,
                                  output,
                                ])}
                              >
                                {document.items.get(v.reference.item)?.label} ·{" "}
                                {p.label}
                              </option>
                            ),
                          );
                        })}
                      {session.state.regions
                        .filter((r) => r.data)
                        .map((r) => (
                          <option
                            key={r.id}
                            value={JSON.stringify(["csv", r.id])}
                          >
                            {r.data!.name}
                          </option>
                        ))}
                    </select>
                    <form
                      onChange={() => setReviewed(undefined)}
                      onSubmit={(e) => {
                        e.preventDefault();
                        const data = new FormData(e.currentTarget);
                        run(() => {
                          const [kind, item, output] = JSON.parse(
                            selectedSource,
                          ) as string[];
                          const next =
                            kind === "csv"
                              ? reviewModelCsv(
                                  session,
                                  instance,
                                  port,
                                  item!,
                                  Number(data.get("row")) - 1,
                                  Number(data.get("column")) - 1,
                                  String(data.get("unit")),
                                )
                              : reviewModelConnection(
                                  session,
                                  instance,
                                  port,
                                  modelReference(
                                    document,
                                    item!,
                                    f.modelPort(output!),
                                  ),
                                );
                          setReviewed(next);
                        });
                      }}
                    >
                      {selectedSource.startsWith('["csv"') && (
                        <fieldset>
                          <legend>
                            Review the exact source cell and declared units
                          </legend>
                          <label>
                            Data row
                            <input
                              name="row"
                              type="number"
                              defaultValue="1"
                              min="1"
                              max="10000"
                              required
                            />
                          </label>
                          <label>
                            Column
                            <input
                              name="column"
                              type="number"
                              defaultValue="1"
                              min="1"
                              max="12"
                              required
                            />
                          </label>
                          <label>
                            Declared unit
                            <input
                              name="unit"
                              defaultValue={node.unit}
                              required
                            />
                          </label>
                          <small>
                            {(() => {
                              const [, id] = JSON.parse(selectedSource);
                              const r = session.state.regions.find(
                                (r) => r.id === id,
                              );
                              return r?.data
                                ? readCsv(r.data).headers.join(" · ")
                                : "Source unavailable";
                            })()}
                          </small>
                        </fieldset>
                      )}
                      <button disabled={!selectedSource} type="submit">
                        Review connection
                      </button>
                    </form>
                    {reviewed?.review.destination.port === port && (
                      <div role="region" aria-label="Connection review">
                        <p>
                          {String(
                            (reviewed.review.source.value as f.Scalar).value,
                          )}{" "}
                          {(reviewed.review.source.value as f.Scalar).unit} →{" "}
                          {exposed.label}
                          <br />
                          {body.interpretation.frame} ·{" "}
                          {body.interpretation.condition}
                          <br />
                          Exact source revision:{" "}
                          {reviewed.review.source.revision}
                        </p>
                        <button
                          onClick={() =>
                            run(() => {
                              applyModelConnection(session, reviewed);
                              setReviewed(undefined);
                            })
                          }
                        >
                          Accept connection
                        </button>
                      </div>
                    )}
                  </>
                )}
              </details>
            )}
          </div>
        );
      })}
      {Object.entries(definition.outputs).map(([port, exposed]) => {
        const output = f.project(
          sourceDocument,
          modelReference(document, instance, f.modelPort(port)),
          canvasSchemas,
          session.foundation.resources(),
          sourceContext,
        );
        return (
          <output
            key={port}
            aria-label={
              port === "force" ? "Model force" : `Model ${exposed.label}`
            }
          >
            {port !== "force" && <small>{exposed.label}: </small>}
            {output.status === "resolved" && f.object(output.projection.value)
              ? `${output.projection.value.value} ${output.projection.value.unit}`
              : `${output.status}: ${output.status !== "resolved" ? output.reason : ""}`}
          </output>
        );
      })}
      <p className="im-status">
        {activePreview ? "Preview · baseline unchanged · " : ""}
        {result.status} · physical validity not assessed
      </p>
      <div className="im-actions">
        <button
          disabled={result.status === "pending"}
          onClick={() =>
            run(() => {
              session.compute(target, scope);
            })
          }
        >
          Compute model
        </button>
        {activePreview && (
          <>
            <button
              onClick={() =>
                run(() => {
                  keepModelPreview(session, instance, "Model comparison", {
                    x: at.x + 420,
                    y: at.y + 520,
                  });
                })
              }
            >
              Keep comparison
            </button>
            <button onClick={() => run(() => session.cancelPreview())}>
              Revert preview
            </button>
          </>
        )}
      </div>
      {!alternative && (
        <div className="im-actions">
          <button
            onClick={() =>
              run(() =>
                instantiateModel(
                  session,
                  body.model,
                  { x: at.x + 430, y: at.y },
                  name + " copy",
                ),
              )
            }
          >
            Duplicate instance
          </button>
          {Object.keys(definition.inputs).length > 0 &&
            !Object.keys(definition.children).length && (
              <button onClick={() => run(() => setEditingAnalysis(true))}>
                Analyze model
              </button>
            )}
          {canEdit && (
            <button onClick={() => run(() => setEditingDefinition(true))}>
              Edit model definition
            </button>
          )}
        </div>
      )}
      {needsUpdate && (
        <section aria-label="Definition revision update">
          <p>
            A published definition revision is available. This instance remains
            pinned.
          </p>
          <label>
            <input
              type="checkbox"
              checked={resetBindings}
              onChange={(e) => {
                setResetBindings(e.target.checked);
                setUpdate(undefined);
              }}
            />
            Reset existing input bindings to new defaults
          </label>
          <button
            onClick={() =>
              run(() =>
                setUpdate(
                  reviewInstanceUpdate(session, instance, resetBindings),
                ),
              )
            }
          >
            Review definition update
          </button>
          {update && (
            <div role="region" aria-label="Definition update review">
              <p>
                Previous revision:{" "}
                {update.review.before.selection.kind === "pin"
                  ? update.review.before.selection.revision
                  : ""}
                <br />
                New revision:{" "}
                {update.review.after.selection.kind === "pin"
                  ? update.review.after.selection.revision
                  : ""}
              </p>
              <ul aria-label="Model definition changes">
                {update.sourceChanges.map((text, i) => (
                  <li key={`equation:${i}`}>{text}</li>
                ))}
                {update.interfaceSummary.map((text, i) => (
                  <li key={`interface:${i}`}>{text}</li>
                ))}
              </ul>
              {!update.interfaceSummary.length && (
                <p>No public interface changes; calculations may change.</p>
              )}
              <p>
                {resetBindings
                  ? "All existing input bindings will be removed and new defaults used."
                  : "Existing input bindings are preserved."}
              </p>
              <button
                onClick={() =>
                  run(() => {
                    applyInstanceUpdate(session, update);
                    setUpdate(undefined);
                  })
                }
              >
                Accept definition update
              </button>
            </div>
          )}
        </section>
      )}
      {editingAnalysis && (
        <ModelAnalysisEditor
          session={session}
          buffers={editBuffers}
          instance={instance}
          at={{ x: at.x + 430, y: at.y }}
          close={() => setEditingAnalysis(false)}
        />
      )}
      {editingDefinition && latestDefinition?.schema === AUTHORED_MODEL && (
        <ModelDefinitionEditor
          session={session}
          buffers={editBuffers}
          initial={{
            label: document.items.get(body.model.item)?.label || name,
            source: (latestDefinition.body as unknown as AuthoredModel).source,
          }}
          definition={body.model.item}
          at={at}
          close={() => setEditingDefinition(false)}
          published={() => setEditingDefinition(false)}
        />
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
function ModelInput({
  id,
  buffers,
  label,
  unit,
  name,
  value,
  disabled,
  apply,
  previewing,
  cancelPreview,
}: {
  id: string;
  buffers: EditBuffers;
  label: string;
  unit: string;
  name: string;
  value?: number;
  disabled: boolean;
  previewing: boolean;
  cancelPreview?: () => void;
  apply: (value: number, preview: boolean, fromBuffer: boolean) => boolean;
}) {
  const input = useRef<HTMLInputElement>(null),
    submitted = useRef<string | undefined>(undefined),
    latest = useRef(apply);
  latest.current = apply;
  const wasPreviewing = useRef(previewing);
  useEffect(() => {
    if (
      !previewing &&
      wasPreviewing.current &&
      submitted.current !== undefined &&
      input.current
    ) {
      input.current.value = input.current.defaultValue;
      submitted.current = undefined;
    }
    wasPreviewing.current = previewing;
  }, [previewing]);
  const finish = (preview = false, fromBuffer = false) => {
    const field = input.current;
    if (!field || !field.reportValidity()) return false;
    const text = field.value;
    if (!latest.current(Number(text), preview, fromBuffer)) return false;
    submitted.current = text;
    return true;
  };
  useEditBuffer(
    buffers,
    id,
    {
      read: () => {
        const field = input.current;
        return !disabled &&
          field &&
          field.value !== field.defaultValue &&
          field.value !== submitted.current
          ? field.value
          : undefined;
      },
      finish: () => finish(false, true),
    },
    !disabled,
  );

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        finish(
          (event.nativeEvent as SubmitEvent).submitter?.getAttribute(
            "value",
          ) === "preview",
        );
      }}
    >
      <label>
        {label} <span>{unit}</span>
        <input
          ref={input}
          name="value"
          type="number"
          step="any"
          required
          min={-1e12}
          max={1e12}
          aria-label={name}
          defaultValue={value}
          disabled={disabled}
          onChange={() => {
            submitted.current = undefined;
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.value = event.currentTarget.defaultValue;
              submitted.current = undefined;
              cancelPreview?.();
            }
          }}
        />
      </label>
      {!disabled && (
        <div className="im-actions">
          <button type="submit" value="apply">
            Use value
          </button>
          <button type="submit" value="preview">
            Preview
          </button>
        </div>
      )}
    </form>
  );
}
