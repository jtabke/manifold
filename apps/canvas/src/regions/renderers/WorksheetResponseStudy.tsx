import { useEffect, useId, useMemo, useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import { SwapAxesButton } from "./PlotAxes";
import type { EditBuffers } from "../app/workspaceFiles";
import { useEditBuffer } from "../app/useEditBuffer";
import { revealCanvasElement } from "../interaction/canvasViewport";
import { useLayoutGesture } from "../interaction/useLayoutGesture";
import {
  project,
  type Page,
  type Point,
  type RegionSession,
  type ResponseStudyPlot,
} from "../document";
import {
  designChoices,
  mapDesignResponses,
  studyFixedInputs,
  studySources,
  type DesignLimitPreview,
  type DesignResponseMap,
  type DesignSpec,
} from "../worksheetOptimization";
import {
  WorksheetResponseMaps,
  type MapInspection,
} from "./WorksheetResponseMaps";
import {
  DesignCandidate,
  DesignFields,
  useWorksheetDesignRun,
} from "./WorksheetDesignControls";
import { WorksheetLimitPreview } from "./WorksheetLimitPreview";
import "../styles/worksheetOptimization.css";
import "../styles/worksheetResponseStudy.css";

export function WorksheetResponseStudy({
  plot,
  page,
  session,
  buffers,
  at,
  width,
  zoom,
  selected,
  cancelVersion,
  pending,
  beforeEdit,
  move,
  cancelMove,
  select,
  source,
  trace,
  fold,
  remove,
  notify,
}: {
  plot: ResponseStudyPlot;
  page: Page;
  session: RegionSession;
  buffers: EditBuffers;
  at: Point;
  width: number;
  zoom: number;
  selected: boolean;
  cancelVersion: number;
  pending: boolean;
  beforeEdit: () => boolean;
  move: (at: Point) => void;
  cancelMove: () => void;
  select: () => void;
  source: (id: string) => void;
  trace: () => void;
  fold?: () => void;
  remove: () => void;
  notify: (message: string) => void;
}) {
  const id = useId();
  const host = useRef<HTMLElement>(null),
    setup = useRef<HTMLFormElement>(null),
    outcome = useRef<HTMLHeadingElement>(null);
  const layout = useLayoutGesture({
    geometry: { at, width, height: plot.height },
    zoom,
    cancelVersion,
    minWidth: 320,
    minHeight: 240,
    cancel: cancelMove,
    complete: (geometry) => move(geometry.at),
  });
  const [inspector, setInspector] = useState<"setup" | "review">();
  // View-only, like the probe and pins: do not change the study or invalidate a checked candidate.
  const [swapped, setSwapped] = useState(false);
  const [draft, setDraft] = useState<{
    of: ResponseStudyPlot["study"];
    spec: DesignSpec;
  }>();
  // Don't put an input probe or a solver result in the accepted record. Opening a
  // saved study derives its local grid like a response curve; only Run calls the host.
  const spec = useMemo(
    () => ({ goal: plot.output, ...plot.study }),
    [plot.output, plot.study],
  );
  const fields = draft?.of === plot.study ? draft.spec : spec;
  const dirty = fields !== spec;
  const orderedAxes = (axes: DesignSpec["axes"]) =>
    swapped ? [...axes].reverse() : axes;
  const [inspection, setInspection] = useState<{
    map: DesignResponseMap;
    selected: MapInspection;
  }>();
  const search = useWorksheetDesignRun(session, notify);
  const [previewState, setPreviewState] = useState<{
    of: DesignResponseMap;
    trial: DesignResponseMap;
  }>();
  const { map, unavailable } = useMemo(() => {
    try {
      return { map: mapDesignResponses(page, spec), unavailable: "" };
    } catch (e) {
      return { unavailable: (e as Error).message };
    }
    // Canvas positions, groups, and camera don't change the worksheet inputs.
  }, [page.regions, page.links, page.contexts, page.active, spec]);
  const preview = previewState?.of === map ? previewState?.trial : undefined;
  const review = preview ? undefined : search.review;
  const p = project(page),
    name = p.statements.get(plot.output)?.name || "Unresolved objective";
  const fixed = useMemo(() => studyFixedInputs(page, spec), [p, spec]);
  function previewLimit(limit?: DesignLimitPreview) {
    if (!limit) setPreviewState(undefined);
    else if (map && !dirty && !pending && !search.running)
      setPreviewState({
        of: map,
        trial: mapDesignResponses(page, spec, limit),
      });
  }
  const choices = useMemo(
    () => designChoices(page, plot.output),
    [p, plot.output],
  );
  useEffect(() => {
    if (search.review) setInspector("review");
  }, [search.review]);
  useEffect(() => {
    if (inspector === "review" && search.review && outcome.current) {
      revealCanvasElement(outcome.current, {
        block: "nearest",
        inline: "nearest",
      });
      outcome.current.focus({ preventScroll: true });
    }
  }, [inspector, search.review]);
  useEditBuffer(buffers, `study:${plot.id}`, {
    read: () => (dirty ? JSON.stringify(fields) : undefined),
    finish: () => {
      if (!dirty) return true;
      openSetup();
      search.setError(
        "Update maps or discard these settings before changing files.",
      );
      return false;
    },
  });
  function openSetup(addMap = false) {
    setInspector("setup");
    requestAnimationFrame(() =>
      setup.current
        ?.querySelector<HTMLElement>(
          addMap ? 'select[aria-label="Add reported quantity"]' : "select",
        )
        ?.focus(),
    );
  }
  function update() {
    search.setError("");
    if (!beforeEdit()) return;
    try {
      session.updateResponseStudy(plot.id, fields);
      setDraft(undefined);
      search.clear();
      setInspector(undefined);
      requestAnimationFrame(() => {
        const title = host.current?.querySelector(".study-title");
        revealCanvasElement(title, { block: "nearest", inline: "nearest" });
        host.current?.focus({ preventScroll: true });
      });
    } catch (e) {
      search.setError((e as Error).message);
    }
  }
  const currentInspection =
    inspection?.map === map ? inspection?.selected : undefined;
  return (
    <section
      ref={host}
      tabIndex={0}
      className={`er-response-study worksheet-design-controls${selected ? " is-selected" : ""}`}
      data-plot-id={plot.id}
      data-response-study=""
      aria-labelledby={`${id}-title`}
      style={{
        left: layout.value.at.x,
        top: layout.value.at.y,
        width: layout.value.width,
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={layout.finish}
      onPointerMove={layout.move}
      onPointerCancel={layout.cancel}
      onLostPointerCapture={layout.cancel}
      onClick={(e) => {
        e.stopPropagation();
        if (!(e.target as Element).closest("button,summary,input,select,label"))
          select();
      }}
      onFocus={(e) => {
        if (e.target === e.currentTarget) select();
      }}
    >
      <div className="study-header">
        <button
          className="study-grip"
          aria-label="Move response study"
          onPointerDown={(e) => layout.start(e)}
        >
          <GripVertical size={16} />
        </button>
        <div className="study-title">
          <span className="study-kicker">Response study</span>
          <div className="study-title-line">
            <h2 id={`${id}-title`}>{name}</h2>
            <span className="study-scenario">
              Scenario:{" "}
              <strong>
                {page.contexts.find((c) => c.id === page.active)?.label}
              </strong>
            </span>
          </div>
        </div>
        <div className="study-actions">
          <button
            type="button"
            aria-expanded={inspector === "setup"}
            onClick={() =>
              inspector === "setup" ? setInspector(undefined) : openSetup()
            }
          >
            Setup{dirty ? " · draft" : ""}
          </button>
          <button
            type="button"
            className="design-primary"
            disabled={
              !!unavailable || pending || dirty || search.running || !!preview
            }
            onClick={() => {
              if (!beforeEdit()) return;
              setInspection(undefined);
              void search.run(spec);
            }}
          >
            Run
          </button>
          {review && (
            <button
              type="button"
              className="study-review-action"
              aria-expanded={inspector === "review"}
              onClick={() =>
                setInspector(inspector === "review" ? undefined : "review")
              }
            >
              Review candidate
            </button>
          )}
        </div>
      </div>
      <section className="study-inputs" aria-labelledby={`${id}-inputs`}>
        <div className="study-varied">
          <div className="study-axis-heading">
            <h3 id={`${id}-inputs`}>Study inputs</h3>
            <SwapAxesButton
              swapped={swapped}
              onSwap={() => setSwapped((value) => !value)}
            />
          </div>
          <dl className="study-axes" aria-label="Varied inputs">
            {orderedAxes(spec.axes).map((axis, k) => {
              const input = choices.inputs.find((q) => q.id === axis.id);
              return (
                <div key={axis.id}>
                  <dt>{k === 0 ? "X axis" : "Y axis"}</dt>
                  <dd>
                    <button
                      type="button"
                      title="Edit source input"
                      onClick={() => source(axis.id)}
                    >
                      {input?.name ||
                        p.statements.get(axis.id)?.name ||
                        "Unresolved"}
                    </button>
                    {input && (
                      <strong>
                        {Number(input.current.toPrecision(6))} {input.unit}
                      </strong>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
        {fixed.length > 0 && (
          <details className="study-fixed">
            <summary>Fixed inputs ({fixed.length})</summary>
            <dl className="study-fixed-values" aria-label="Fixed inputs">
              {fixed.map(({ id, name, value }) => (
                <div key={id}>
                  <dt>
                    <button
                      type="button"
                      aria-label={`Edit fixed input ${name}`}
                      onClick={() => source(id)}
                    >
                      {name}
                    </button>
                  </dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </details>
        )}
      </section>
      {search.running && (
        <div className="study-feedback" role="status">
          Searching…{" "}
          <button type="button" onClick={search.cancel}>
            Cancel run
          </button>
        </div>
      )}
      {search.staleReview && (
        <p role="status">
          Worksheet changed. Run again for a current candidate.
        </p>
      )}
      {pending && (
        <p role="status">
          Maps show accepted inputs. Finish the worksheet preview before running
          or updating.
        </p>
      )}
      {search.error && (
        <p className="study-feedback" role="alert">
          {search.error}
        </p>
      )}
      <div
        className={`study-body${inspector && (inspector === "setup" || review) ? " with-inspector" : ""}`}
      >
        {inspector === "setup" && (
          <section className="study-inspector" aria-label="Study setup">
            <h3>Study setup</h3>
            <form
              ref={setup}
              onSubmit={(e) => {
                e.preventDefault();
                if (!search.running && !pending && dirty) update();
              }}
            >
              <DesignFields
                choices={choices}
                name={name}
                spec={
                  swapped
                    ? { ...fields, axes: orderedAxes(fields.axes) }
                    : fields
                }
                change={(patch) => {
                  search.clear();
                  setDraft({
                    of: plot.study,
                    spec: {
                      ...fields,
                      ...patch,
                      axes: patch.axes ? orderedAxes(patch.axes) : fields.axes,
                    },
                  });
                }}
                disabled={search.running || pending}
                fixedAxes
              />
              <button
                type="submit"
                className="design-primary"
                disabled={search.running || pending || !dirty}
              >
                Update maps
              </button>
              <button
                type="button"
                disabled={!dirty}
                onClick={() => {
                  setDraft(undefined);
                  search.setError("");
                }}
              >
                Discard changes
              </button>
            </form>
          </section>
        )}
        {inspector === "review" && review && (
          <section className="study-inspector" aria-label="Candidate review">
            <DesignCandidate
              review={review}
              heading={outcome}
              adopt={(alternative) => {
                if (beforeEdit() && search.adopt(alternative)) {
                  setInspection(undefined);
                  setInspector(undefined);
                  host.current?.focus({ preventScroll: true });
                }
              }}
            />
            <button
              type="button"
              onClick={() => {
                if (map) setInspection({ map, selected: "candidate" });
                const heading = document.getElementById(`${id}-maps`);
                revealCanvasElement(heading, {
                  block: "nearest",
                  inline: "nearest",
                });
                heading?.focus({ preventScroll: true });
              }}
            >
              Locate on maps
            </button>
          </section>
        )}
        <div className="study-plots">
          {map ? (
            <WorksheetResponseMaps
              map={preview ?? map}
              grid={map}
              swapped={swapped}
              review={review}
              limits={
                <WorksheetLimitPreview
                  map={map}
                  preview={preview?.preview}
                  disabled={pending || dirty || search.running}
                  change={previewLimit}
                />
              }
              heading={`${id}-maps`}
              selected={currentInspection}
              select={(selected) => setInspection({ map, selected })}
            />
          ) : (
            <p role="status">Maps unavailable: {unavailable}</p>
          )}
          <div className="study-links">
            <button type="button" onClick={() => openSetup(true)}>
              Add map
            </button>
            <button type="button" onClick={trace}>
              Trace calculations
            </button>
            {fold && (
              <button type="button" onClick={fold}>
                Fold source equations
              </button>
            )}
            <button type="button" onClick={remove}>
              Remove study
            </button>
          </div>
          <details className="study-sources">
            <summary>Worksheet sources</summary>
            <ul>
              {studySources(page, spec).map((id) => (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => source(id)}
                    aria-label={`Edit source: ${p.texts[id]}`}
                  >
                    {p.texts[id]}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        </div>
      </div>
    </section>
  );
}
