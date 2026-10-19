import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Code2, GripVertical, MoreHorizontal, X } from "lucide-react";
import { display, passes } from "../notebook/math";
import { measurementOverlay } from "./datasetModel";
import type { DataSelection } from "./DatasetViews";
import type { Page } from "./document";
import {
  names,
  prepare,
  type Artifact,
  type ArtifactFocus,
  type ArtifactPresentation,
} from "./artifacts";
import {
  useArtifactResult,
  useSharedResults,
  runtimeKey,
  type ResultCache,
} from "./artifactRuntime";

type Props = {
  artifact: Artifact;
  dataSelection?: DataSelection;
  inspectMeasurement?: (dataset: string, row: number, column: number) => void;
  page: Page;
  current: Page;
  zoom: number;
  change: (a: Artifact) => void;
  remove: () => void;
  trace: () => void;
  focusCanvas?: (id: string) => void;
  detach?: (id: string) => void;
  openTool?: (
    editor: "python" | "dependencies",
    view: string,
    context?: string,
  ) => void;
  closedViews?: Set<string>;
  hiddenViews?: Set<string>;
  groupedViews?: Set<string>;
  layoutCancelVersion?: number;
  viewContexts?: Record<string, string>;
  pinView?: (id: string, context?: string) => void;
  explore: (id: string, value: number, anchor: Element) => void;
  finish: () => void;
  revert: () => void;
  accept: () => void;
  undo: () => void;
  focus?: ArtifactFocus;
  select: (
    target: ArtifactFocus["target"],
    range?: [number, number],
    quantity?: string,
    view?: string,
  ) => void;
  pending: boolean;
  canKeep: boolean;
  branch: (keep: boolean) => void;
  measure: (id: string, height: number) => void;
};
type Runtime = ReturnType<typeof useArtifactResult>;

/** One computational owner. Additional presentations never execute independently. */
export function ArtifactView(props: Props) {
  const { artifact: a, page, change } = props;
  const cache = useRef<ResultCache>(new Map());
  const latest = useRef(props);
  latest.current = props;
  const shared = useSharedResults();
  const localResult = useArtifactResult(
    page,
    a,
    cache.current,
    !shared,
    (receipt) => {
      const now = latest.current;
      if (now.artifact.receipt !== receipt)
        now.change({ ...now.artifact, receipt });
    },
  );
  const comparePage = useMemo(
    () => ({ ...page, active: a.compareContext || page.active }),
    [page, a.compareContext],
  );
  const localCompare = useArtifactResult(
    comparePage,
    a,
    cache.current,
    !shared &&
      !!a.comparing &&
      !!a.compareContext &&
      a.compareContext !== page.active,
  );
  const result = shared?.[runtimeKey(a.id, page.active)] || localResult;
  const compare =
    shared?.[runtimeKey(a.id, a.compareContext || page.active)] || localCompare;
  const views: ArtifactPresentation[] = [
    {
      id: a.id,
      renderer: a.renderer,
      at: a.at,
      width: a.width,
      height: a.height,
    },
    ...(a.views || []),
  ];
  const update = (view: ArtifactPresentation, next: Artifact) => {
    const owner = latest.current.artifact;
    if (view.id === owner.id)
      change({ ...next, views: owner.views, receipt: owner.receipt });
    else
      change({
        ...owner,
        code: next.code,
        comparing: next.comparing,
        compareContext: next.compareContext,
        views: owner.views?.map((v) =>
          v.id === view.id
            ? {
                id: v.id,
                renderer: next.renderer,
                at: next.at,
                width: next.width,
                height: next.height,
              }
            : v,
        ),
      });
  };
  const separate = (view: ArtifactPresentation, renderer: "plot" | "table") => {
    const owner = latest.current.artifact;
    if ((owner.views?.length || 0) >= 4) return;
    const horizontal = window.innerWidth > view.at.x + view.width * 2 + 65;
    const measured =
      document.querySelector<HTMLElement>(`[data-view-id="${view.id}"]`)
        ?.offsetHeight || view.height;
    change({
      ...owner,
      views: [
        ...(owner.views || []),
        {
          id: `view-${crypto.randomUUID()}`,
          renderer,
          at: horizontal
            ? { x: view.at.x + view.width + 35, y: view.at.y }
            : { x: view.at.x, y: view.at.y + measured + 35 },
          width: view.width,
          height: view.height,
        },
      ],
    });
  };
  return (
    <>
      {views
        .filter((view) => !props.closedViews?.has(view.id))
        .map((view) => {
          const context = props.viewContexts?.[view.id] || page.active,
            bound =
              context === page.active ? page : { ...page, active: context };
          const editable = context === page.active;
          return (
            <ArtifactPresentationView
              key={view.id}
              {...props}
              artifact={{
                ...a,
                renderer: view.renderer,
                at: view.at,
                width: view.width,
                height: view.height,
              }}
              viewId={view.id}
              page={bound}
              current={editable ? props.current : bound}
              editable={editable}
              followingContext={
                page.contexts.find((c) => c.id === page.active)?.label ||
                page.active
              }
              pending={editable && props.pending}
              canKeep={editable && props.canKeep}
              explore={(...args) => {
                if (editable) props.explore(...args);
              }}
              finish={() => {
                if (editable) props.finish();
              }}
              result={
                shared?.[runtimeKey(a.id, context)] ||
                (editable ? result : localResult)
              }
              comparison={compare}
              select={(target, range, quantity) =>
                props.select(target, range, quantity, view.id)
              }
              comparePage={comparePage}
              change={(next) => update(view, next)}
              remove={
                view.id === a.id
                  ? props.remove
                  : () =>
                      change({
                        ...a,
                        views: a.views?.filter((v) => v.id !== view.id),
                      })
              }
              separate={(renderer) => separate(view, renderer)}
            />
          );
        })}
    </>
  );
}

function ArtifactPresentationView({
  artifact: a,
  page,
  current,
  zoom,
  change,
  remove,
  explore,
  finish,
  revert,
  accept,
  undo,
  focus,
  select,
  pending,
  canKeep,
  branch,
  viewId,
  result,
  comparison,
  comparePage,
  separate,
  measure,
  trace,
  editable,
  followingContext,
  focusCanvas,
  detach,
  openTool,
  hiddenViews,
  groupedViews,
  layoutCancelVersion,
  viewContexts,
  pinView,
  dataSelection,
  inspectMeasurement,
}: Props & {
  editable: boolean;
  followingContext: string;
  viewId: string;
  result: Runtime;
  comparison: Runtime;
  comparePage: Page;
  separate: (renderer: "plot" | "table") => void;
}) {
  const [source, setSource] = useState(false),
    [draft, setDraft] = useState(""),
    [menu, setMenu] = useState(false),
    [dragging, setDragging] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const gesture = useRef<
    | { clientX: number; value: number; moved: boolean; cancelled?: boolean }
    | undefined
  >(undefined);
  const brush = useRef<number | undefined>(undefined);
  const move = useRef<
    | {
        x: number;
        y: number;
        at: Artifact["at"];
        width: number;
        height: number;
        resize: boolean;
      }
    | undefined
  >(undefined);
  const frame = useRef<HTMLElement>(null),
    measurement = useRef(measure);
  measurement.current = measure;
  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    const update = () => measurement.current(viewId, element.offsetHeight);
    const observer = new ResizeObserver(update);
    observer.observe(element);
    update();
    return () => observer.disconnect();
  }, [viewId]);
  const inputSource = page.regions.find((r) => r.id === a.input)?.source;
  const ownFocus: ArtifactFocus | undefined =
    focus?.id === a.id
      ? focus
      : inputSource &&
          dataSelection?.dataset === inputSource.dataset &&
          (!dataSelection.columns.length ||
            dataSelection.columns.includes(inputSource.column))
        ? { id: a.id, target: "input" }
        : undefined;
  const resolved = useMemo(() => {
    try {
      return names(page, a);
    } catch {
      return undefined;
    }
  }, [page, a]);
  const live = useMemo(() => {
    try {
      return names(current, a);
    } catch {
      return undefined;
    }
  }, [current, a]);
  const evidence = useMemo(() => {
    try {
      return { result: measurementOverlay(page, a.output, a.input) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [page, a.output, a.input]);
  const observed =
    evidence.result?.records.filter(
      (r) =>
        r.inputs[evidence.result!.input].value >= a.low &&
        r.inputs[evidence.result!.input].value <= a.high,
    ) || [];
  const visibleObserved =
    observed.length > 1000
      ? observed.filter(
          (r, i) =>
            i % Math.ceil(observed.length / 1000) === 0 ||
            dataSelection?.rows.includes(r.row),
        )
      : observed;
  const baseline = useMemo(() => {
    try {
      return comparison.current ? names(comparePage, a) : undefined;
    } catch {
      return undefined;
    }
  }, [comparePage, a, comparison.current]);
  useEffect(() => {
    if (!dragging) return;
    const cancel = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" ||
        ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z")
      ) {
        e.preventDefault();
        e.stopPropagation();
        if (gesture.current) gesture.current.cancelled = true;
        gesture.current = undefined;
        setDragging(false);
        revert();
      }
    };
    window.addEventListener("keydown", cancel, true);
    return () => window.removeEventListener("keydown", cancel, true);
  }, [dragging, revert]);
  const points = result.receipt?.points || [],
    basePoints = comparison.current ? comparison.receipt?.points || [] : [];
  const limit =
    resolved &&
    [...resolved.p.statements].find(
      ([id, s]) =>
        (!a.requirement || a.requirement === id) &&
        s.name === resolved.y.name &&
        s.relation !== "=" &&
        resolved.p.solved.constraints.has(id),
    );
  const bound = limit && resolved!.p.solved.constraints.get(limit[0])!.bound;
  const threshold = bound
    ? bound.absolute
      ? bound.value - 273.15
      : bound.value
    : undefined;
  const scalarY = (q: NonNullable<typeof live>["yq"]) =>
    q.absolute ? q.value - 273.15 : q.value;
  const ys = [...points, ...basePoints].map((p) => p[1]);
  observed.forEach((r) => ys.push(scalarY(r.value)));
  if (threshold !== undefined) ys.push(threshold);
  const min = Math.min(...ys),
    max = Math.max(...ys),
    span = max - min || 1;
  const left = 64,
    right = a.width - 28,
    top = 28,
    bottom = a.height - 118;
  const px = (x: number) =>
    left + ((x - a.low) / (a.high - a.low)) * (right - left);
  const py = (y: number) => bottom - ((y - min) / span) * (bottom - top);
  const path = (data: [number, number][]) =>
    data.map(([x, y], i) => `${i ? "L" : "M"}${px(x)},${py(y)}`).join(" ");
  const fmt = (n: number) => Number(n.toPrecision(5)).toString();
  const xDisplay = (n: number) => n - (resolved?.xq.absolute ? 273.15 : 0);
  const liveX = live?.xq.value,
    liveY = live && scalarY(live.yq);
  const contextLabel = page.contexts.find((c) => c.id === page.active)?.label;
  const baseLabel = page.contexts.find((c) => c.id === a.compareContext)?.label;
  useEffect(() => {
    move.current = undefined;
  }, [layoutCancelVersion]);
  const isPreview = current !== page;
  const tick =
    10 ** Math.ceil(Math.log10((a.high - a.low) / (right - left))) ||
    a.high - a.low;
  const proposed = (value: number, fine = false) => {
    const step = fine ? tick / 10 : tick;
    return Math.max(a.low, Math.min(a.high, Math.round(value / step) * step));
  };
  const screenX = (clientX: number) => {
    const rect = svg.current!.getBoundingClientRect();
    return Math.max(
      a.low,
      Math.min(
        a.high,
        a.low +
          ((((clientX - rect.left) * a.width) / rect.width - left) /
            (right - left)) *
            (a.high - a.low),
      ),
    );
  };
  const intersections: number[] = [];
  if (threshold !== undefined)
    for (let i = 1; i < points.length; i++) {
      const [x0, y0] = points[i - 1],
        [x1, y1] = points[i];
      if ((y0 - threshold) * (y1 - threshold) < 0)
        intersections.push(x0 + ((threshold - y0) / (y1 - y0)) * (x1 - x0));
    }
  const selectedSamples = ownFocus?.range
    ? points.filter(([x]) => x >= ownFocus.range![0] && x <= ownFocus.range![1])
    : [];
  const passing =
    threshold === undefined
      ? undefined
      : selectedSamples.filter(([, y]) =>
          passes(limit![1].relation as "<=" | ">=" | "<" | ">", y, threshold),
        ).length;
  const activate = (target: ArtifactFocus["target"]) => ({
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      select(target);
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        select(target);
      }
    },
  });
  const endGesture = () => {
    const g = gesture.current;
    gesture.current = undefined;
    setDragging(false);
    if (g?.moved && !g.cancelled) finish();
  };
  return (
    <section
      ref={frame}
      className={`er-plot er-artifact ${ownFocus ? "has-linked-focus" : ""}`}
      aria-label="Python response artifact"
      data-artifact-id={a.id}
      data-view-id={viewId}
      data-status={result.status}
      data-execution-key={result.receipt?.code_sha256}
      style={{
        left: a.at.x,
        top: a.at.y,
        width: a.width,
        minHeight: a.height,
        display: hiddenViews?.has(viewId) ? "none" : undefined,
      }}
      onPointerMove={(e) => {
        const d = move.current;
        if (!d) return;
        const dx = (e.clientX - d.x) / zoom,
          dy = (e.clientY - d.y) / zoom;
        change(
          d.resize
            ? {
                ...a,
                width: Math.max(320, Math.min(1100, d.width + dx)),
                height: Math.max(280, Math.min(750, d.height + dy)),
              }
            : {
                ...a,
                at: {
                  x: Math.max(0, d.at.x + dx),
                  y: Math.max(0, d.at.y + dy),
                },
              },
        );
      }}
      onPointerUp={() => {
        move.current = undefined;
      }}
      onPointerCancel={() => {
        move.current = undefined;
      }}
    >
      <header
        className="er-artifact-head"
        onDoubleClick={(e) => {
          if (!(e.target as Element).closest("button,select"))
            focusCanvas?.(viewId);
        }}
      >
        <button
          aria-label="Move artifact"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            move.current = {
              x: e.clientX,
              y: e.clientY,
              at: a.at,
              width: a.width,
              height: a.height,
              resize: false,
            };
          }}
        >
          <GripVertical size={18} />
        </button>
        <b>
          {resolved ? `${resolved.y.name} / ${resolved.x.name}` : "Response"}
        </b>
        <span className="er-artifact-origin">Computed</span>
        <span className="er-artifact-status">
          {result.current ? (isPreview ? "Preview" : "") : result.status}
        </span>
        {viewContexts?.[viewId] && (
          <span className="cs-pinned">Pinned · {contextLabel}</span>
        )}
        <div className="er-artifact-controls">
          {pinView && (
            <select
              className={viewContexts?.[viewId] ? "cs-pinned" : "cs-following"}
              aria-label="Artifact scenario"
              value={viewContexts?.[viewId] || "follow"}
              onChange={(e) =>
                pinView(
                  viewId,
                  e.target.value === "follow" ? undefined : e.target.value,
                )
              }
            >
              <option value="follow">Following · {followingContext}</option>
              {page.contexts.map((c) => (
                <option key={c.id} value={c.id}>
                  Pinned · {c.label}
                </option>
              ))}
            </select>
          )}
          <button
            aria-pressed={a.renderer === "plot"}
            onClick={() => change({ ...a, renderer: "plot" })}
          >
            Plot
          </button>
          <button
            aria-pressed={a.renderer === "table"}
            onClick={() => change({ ...a, renderer: "table" })}
          >
            Table
          </button>
          <button
            aria-label="Inspect Python"
            aria-pressed={source}
            onClick={() => {
              if (!source) setDraft(result.job?.code || a.code || "");
              setSource(!source);
            }}
          >
            <Code2 size={18} />
          </button>
          <button
            aria-label="Artifact actions"
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            <MoreHorizontal size={18} />
          </button>
          <button aria-label="Remove artifact" onClick={remove}>
            <X size={16} />
          </button>
        </div>
      </header>
      {a.requirement && resolved && !limit && (
        <small className="er-linked-requirement-error" role="status">
          Linked requirement unavailable
        </small>
      )}
      {menu && (
        <div className="er-artifact-menu" role="menu">
          {focusCanvas && (
            <button
              role="menuitem"
              onClick={() => {
                focusCanvas(viewId);
                setMenu(false);
              }}
            >
              Focus artifact
            </button>
          )}
          {openTool && (
            <button
              role="menuitem"
              onClick={() => {
                openTool("python", viewId, viewContexts?.[viewId]);
                setMenu(false);
              }}
            >
              Open Python separately
            </button>
          )}
          {openTool && (
            <button
              role="menuitem"
              onClick={() => {
                openTool("dependencies", viewId, viewContexts?.[viewId]);
                setMenu(false);
              }}
            >
              Inspect relationships
            </button>
          )}
          {detach && groupedViews?.has(viewId) && (
            <button
              role="menuitem"
              onClick={() => {
                detach(viewId);
                setMenu(false);
              }}
            >
              Detach from group
            </button>
          )}

          <button
            role="menuitem"
            onClick={() => {
              setMenu(false);
              trace();
            }}
          >
            Trace connections
          </button>
          <button
            role="menuitem"
            disabled={(a.views?.length || 0) >= 4}
            onClick={() => {
              separate("table");
              setMenu(false);
            }}
          >
            Open table separately
          </button>
          <button
            role="menuitem"
            disabled={(a.views?.length || 0) >= 4}
            onClick={() => {
              separate("plot");
              setMenu(false);
            }}
          >
            Open plot separately
          </button>
        </div>
      )}
      {result.error && (
        <p className="er-artifact-error" role="status">
          {result.error}
        </p>
      )}
      {a.renderer === "plot" && (evidence.result || evidence.error) && (
        <div className="er-evidence-legend">
          <span>━ Modeled response · other inputs fixed</span>
          <span>
            ○ Calculated from paired measurements
            {observed.length > 1000
              ? ` · ${visibleObserved.length}/${observed.length} points shown`
              : ""}
            {evidence.error ? ` · unavailable: ${evidence.error}` : ""}
          </span>
          {resolved && evidence.result && (
            <small>
              {Object.entries(evidence.result.records[0]?.inputs || {})
                .filter(([name]) => name !== resolved.x.name)
                .map(
                  ([name]) =>
                    `${name} = ${display(resolved.p.solved.values.get(name)!)}`,
                )
                .join(" · ")}
            </small>
          )}
        </div>
      )}
      {result.current && a.renderer === "plot" && (
        <svg
          ref={svg}
          viewBox={`0 0 ${a.width} ${a.height - 52}`}
          aria-label={`${resolved?.y.name} response to ${resolved?.x.name}`}
          role="group"
        >
          <rect
            x={left}
            y={top}
            width={right - left}
            height={bottom - top}
            fill="transparent"
            className="er-range-surface"
            aria-label="Select sampled range"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              brush.current = screenX(e.clientX);
            }}
            onPointerMove={(e) => {
              if (brush.current === undefined) return;
              const x = screenX(e.clientX);
              select("range", [
                Math.min(x, brush.current),
                Math.max(x, brush.current),
              ]);
            }}
            onPointerUp={() => {
              brush.current = undefined;
            }}
            onPointerCancel={() => {
              brush.current = undefined;
            }}
          />
          {ownFocus?.range && (
            <rect
              x={px(ownFocus.range[0])}
              y={top}
              width={Math.max(1, px(ownFocus.range[1]) - px(ownFocus.range[0]))}
              height={bottom - top}
              fill="#8970b822"
              pointerEvents="none"
            />
          )}
          <path
            d={`M${left},${top}V${bottom}H${right}`}
            stroke="#c9cbc5"
            fill="none"
            pointerEvents="none"
          />
          <text x={left - 10} y={top + 5} textAnchor="end">
            {fmt(max)}
          </text>
          <text x={left - 10} y={bottom + 5} textAnchor="end">
            {fmt(min)}
          </text>
          {!!basePoints.length && (
            <path
              d={path(basePoints)}
              stroke="#9b9e9b"
              strokeDasharray="6 5"
              strokeWidth="2"
              fill="none"
              pointerEvents="none"
            />
          )}
          <g
            role="button"
            tabIndex={0}
            aria-label="Select output relationship"
            className={`er-chart-target ${ownFocus?.target === "expression" ? "is-linked" : ""}`}
            {...activate("expression")}
          >
            <path
              d={path(points)}
              stroke="transparent"
              strokeWidth="18"
              fill="none"
            />
            <path
              d={path(points)}
              stroke={
                ownFocus?.target === "expression"
                  ? "#7959a8"
                  : page.active !== "original"
                    ? "#ad672b"
                    : "#4d515a"
              }
              strokeWidth="2.8"
              fill="none"
              pointerEvents="none"
            />
          </g>
          {threshold !== undefined && (
            <g
              role="button"
              tabIndex={0}
              aria-label="Inspect plotted requirement"
              data-link-source={limit?.[0]}
              className={`er-chart-target ${ownFocus?.target === "requirement" ? "is-linked" : ""}`}
              {...activate("requirement")}
            >
              <path
                d={`M${left},${py(threshold)}H${right}`}
                stroke="transparent"
                strokeWidth="16"
              />
              <path
                d={`M${left},${py(threshold)}H${right}`}
                stroke={
                  ownFocus?.target === "requirement" ? "#7959a8" : "#7b8078"
                }
                strokeDasharray="5 5"
                pointerEvents="none"
              />
              <text x={right} y={py(threshold) - 9} textAnchor="end">
                {fmt(threshold)} {resolved?.yUnit} limit
              </text>
              {intersections.map((x, i) => (
                <g key={i}>
                  <circle
                    cx={px(x)}
                    cy={py(threshold)}
                    r="5"
                    fill="#fdfcf9"
                    stroke="#7b8078"
                  />
                  <title>
                    Sampled intersection ≈ {fmt(xDisplay(x))} {resolved?.xUnit}
                  </title>
                </g>
              ))}
            </g>
          )}
          {visibleObserved.map((r) => (
            <circle
              key={`observed-${r.row}`}
              role="button"
              tabIndex={0}
              aria-label={`Inspect paired measurement row ${r.row + 1}`}
              data-observed-row={r.row}
              cx={px(r.inputs[evidence.result!.input].value)}
              cy={py(scalarY(r.value))}
              r={
                dataSelection?.dataset === evidence.result?.dataset &&
                dataSelection?.rows.includes(r.row)
                  ? 9
                  : 6
              }
              fill="#fff"
              stroke="#417b98"
              strokeWidth="2.5"
              onClick={() =>
                inspectMeasurement?.(
                  evidence.result!.dataset,
                  r.row,
                  evidence.result!.column,
                )
              }
              onKeyDown={(e) => {
                if (e.key === "Enter")
                  inspectMeasurement?.(
                    evidence.result!.dataset,
                    r.row,
                    evidence.result!.column,
                  );
              }}
            >
              <title>
                Row {r.row + 1} · calculated {display(r.value)} from paired
                measured inputs
              </title>
            </circle>
          ))}
          {baseline &&
            baseline.xq.value >= a.low &&
            baseline.xq.value <= a.high && (
              <g pointerEvents="none">
                <circle
                  cx={px(baseline.xq.value)}
                  cy={py(scalarY(baseline.yq))}
                  r="6"
                  fill="#fff"
                  stroke="#969b95"
                  strokeWidth="2"
                />
                <path
                  d={`M${px(baseline.xq.value)},${bottom}V${py(scalarY(baseline.yq))}`}
                  stroke="#b1b5ae"
                  strokeDasharray="3 4"
                />
              </g>
            )}
          {liveX !== undefined &&
            liveY !== undefined &&
            liveX >= a.low &&
            liveX <= a.high && (
              <g>
                <path
                  d={`M${px(liveX)},${bottom}V${py(liveY)}`}
                  stroke="#aa6329"
                  pointerEvents="none"
                />
                <g
                  role="slider"
                  tabIndex={0}
                  aria-label="Vary artifact input"
                  aria-disabled={!editable}
                  aria-orientation="horizontal"
                  aria-valuemin={xDisplay(a.low)}
                  aria-valuemax={xDisplay(a.high)}
                  aria-valuenow={xDisplay(liveX)}
                  aria-valuetext={live ? display(live.xq) : undefined}
                  className={`er-design-point ${ownFocus?.target === "point" ? "is-selected" : ""} ${isPreview ? "is-preview" : ""}`}
                  transform={`translate(${px(liveX)} ${py(liveY)})`}
                  onPointerDown={(e) => {
                    if (!editable) {
                      select("point");
                      return;
                    }
                    e.stopPropagation();
                    e.currentTarget.setPointerCapture(e.pointerId);
                    select("point");
                    gesture.current = {
                      clientX: e.clientX,
                      value: liveX,
                      moved: false,
                    };
                  }}
                  onPointerMove={(e) => {
                    const g = gesture.current;
                    if (!g || g.cancelled) return;
                    const dx = e.clientX - g.clientX;
                    if (Math.abs(dx) < 3 && !g.moved) return;
                    g.moved = true;
                    setDragging(true);
                    const rect = svg.current!.getBoundingClientRect();
                    explore(
                      a.input,
                      proposed(
                        g.value +
                          ((dx * a.width) / rect.width / (right - left)) *
                            (a.high - a.low),
                        e.shiftKey,
                      ),
                      e.currentTarget,
                    );
                  }}
                  onPointerUp={endGesture}
                  onPointerCancel={() => {
                    gesture.current = undefined;
                    setDragging(false);
                    revert();
                  }}
                  onKeyDown={(e) => {
                    if (e.key.startsWith("Arrow")) {
                      e.preventDefault();
                      e.stopPropagation();
                    }
                    if (e.key === "Escape") {
                      gesture.current = undefined;
                      setDragging(false);
                      revert();
                    }
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      select("point");
                    }
                    if (
                      editable &&
                      (e.key === "ArrowLeft" || e.key === "ArrowRight")
                    ) {
                      select("point");
                      explore(
                        a.input,
                        proposed(
                          liveX +
                            (e.key === "ArrowRight" ? 1 : -1) *
                              (e.shiftKey ? tick / 10 : tick),
                          e.shiftKey,
                        ),
                        e.currentTarget,
                      );
                    }
                  }}
                  onKeyUp={(e) => {
                    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                      e.stopPropagation();
                      finish();
                    }
                  }}
                >
                  <circle r="19" fill="transparent" />
                  <circle className="er-point-halo" r="14" />
                  <circle
                    r="7"
                    fill={
                      isPreview || page.active !== "original"
                        ? "#b16c2f"
                        : "#7959a8"
                    }
                    stroke="#fff"
                    strokeWidth="2"
                  />
                  <text x={15} y={-12} className="er-point-hint">
                    {resolved?.x.name} ↔ drag
                  </text>
                  <title>
                    Drag horizontally to vary {resolved?.x.name}; vertical
                    dragging does not solve for inputs.
                  </title>
                </g>
              </g>
            )}
          <text x={left} y={bottom + 24}>
            {fmt(xDisplay(a.low))}
          </text>
          <text x={right} y={bottom + 24} textAnchor="end">
            {fmt(xDisplay(a.high))}
          </text>
          <g
            role="button"
            tabIndex={0}
            aria-label="Select horizontal quantity"
            data-link-source={a.input}
            className={`er-chart-axis ${(ownFocus?.target === "input" && (!ownFocus.quantity || ownFocus.quantity === a.input)) || ownFocus?.target === "point" ? "is-linked" : ""}`}
            {...activate("input")}
          >
            <rect
              x={(left + right) / 2 - 65}
              y={bottom + 27}
              width="130"
              height="30"
              rx="4"
            />
            <text x={(left + right) / 2} y={bottom + 48} textAnchor="middle">
              {resolved?.x.name} ({resolved?.xUnit})
            </text>
          </g>
          <g
            role="button"
            tabIndex={0}
            aria-label="Select output quantity"
            data-link-source={a.output}
            className="er-chart-target"
            {...activate("expression")}
          >
            <text x={left} y={16}>
              {resolved?.y.name} ({resolved?.yUnit})
            </text>
          </g>
        </svg>
      )}
      {result.current && a.renderer === "table" && (
        <div className="er-artifact-table" style={{ maxHeight: a.height - 75 }}>
          <table>
            <thead>
              <tr>
                <th>
                  <button onClick={() => select("input")}>
                    {resolved?.x.name} ({resolved?.xUnit})
                  </button>
                </th>
                <th>
                  <button onClick={() => select("expression")}>
                    {resolved?.y.name} ({resolved?.yUnit})
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {points.map(([x, y], i) => (
                <tr
                  key={i}
                  className={
                    (
                      ownFocus?.range
                        ? x >= ownFocus.range[0] && x <= ownFocus.range[1]
                        : liveX !== undefined &&
                          Math.abs(liveX - x) <=
                            (a.high - a.low) / (points.length - 1) / 2
                    )
                      ? "is-linked"
                      : ""
                  }
                  onClick={() => select("range", [x, x])}
                >
                  <td>{fmt(xDisplay(x))}</td>
                  <td>{fmt(y)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {ownFocus &&
        (ownFocus.view ? ownFocus.view === viewId : viewId === a.id) &&
        result.current && (
          <div
            className="er-artifact-selection"
            aria-label="Artifact selection"
          >
            {ownFocus.target === "point" && !editable && (
              <span>Pinned · {contextLabel}</span>
            )}
            {ownFocus.target === "point" && editable && (
              <>
                <span>{isPreview ? "Preview" : `${resolved?.x.name} ↔`}</span>
                {pending && !dragging ? (
                  <>
                    <button onClick={revert}>Revert</button>
                    <button onClick={accept}>Accept</button>
                  </>
                ) : !dragging && !isPreview ? (
                  <>
                    {canKeep ? (
                      <>
                        <button onClick={undo}>Undo value</button>
                        <button onClick={() => branch(true)}>
                          Keep as alternative
                        </button>
                      </>
                    ) : (
                      <button onClick={() => branch(false)}>
                        Try alternative
                      </button>
                    )}
                    {a.compareContext && a.compareContext !== page.active && (
                      <button
                        aria-pressed={!!a.comparing}
                        onClick={() =>
                          change({ ...a, comparing: !a.comparing })
                        }
                      >
                        Compare
                      </button>
                    )}
                  </>
                ) : null}
              </>
            )}
            {ownFocus.target === "input" && (
              <span>
                {resolved?.p.statements.get(ownFocus.quantity || a.input)?.name}{" "}
                · shared quantity
              </span>
            )}
            {ownFocus.target === "expression" && (
              <span>{resolved?.y.name} · authored relationship</span>
            )}
            {ownFocus.target === "requirement" && (
              <span>
                {limit && resolved?.p.texts[limit[0]]}
                {intersections.length
                  ? ` · sampled crossing ≈ ${fmt(xDisplay(intersections[0]))} ${resolved?.xUnit}`
                  : " · no sampled crossing"}
              </span>
            )}
            {ownFocus.target === "range" && (
              <span>
                {fmt(xDisplay(ownFocus.range![0]))}–
                {fmt(xDisplay(ownFocus.range![1]))} {resolved?.xUnit} ·{" "}
                {selectedSamples.length} samples
                {passing === undefined ? "" : ` · ${passing} meet this limit`}
              </span>
            )}
            {ownFocus.target === "context" && (
              <div className="er-artifact-context">
                <b>{contextLabel}</b>
                <span>
                  Computed{" "}
                  {result.receipt &&
                    new Date(result.receipt.time).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                </span>
                {resolved &&
                  [
                    a.input,
                    ...Object.values(result.receipt?.bindings || {}),
                  ].map((id) => {
                    const s = resolved.p.statements.get(id),
                      q = s && resolved.p.solved.values.get(s.name);
                    return (
                      q && (
                        <button
                          key={id}
                          onClick={() => select("input", undefined, id)}
                        >
                          {s!.name} = {display(q)}
                        </button>
                      )
                    );
                  })}
              </div>
            )}
          </div>
        )}
      {a.comparing && a.compareContext !== page.active && (
        <div
          className="er-artifact-comparison"
          aria-label="Artifact comparison"
        >
          {baseline && live ? (
            <>
              <span className="er-baseline-key">
                {baseLabel} · {display(baseline.xq)} · {display(baseline.yq)}
              </span>
              <span className="er-alternative-key">
                {contextLabel} · Δ{resolved?.y.name}{" "}
                {fmt(scalarY(live.yq) - scalarY(baseline.yq))}{" "}
                {live.yq.absolute ? "K" : resolved?.yUnit}
              </span>
            </>
          ) : (
            <span>
              {baseLabel} · {comparison.status}
            </span>
          )}
        </div>
      )}
      {source && (
        <div className="er-artifact-code">
          <p>
            {draft === result.job?.code
              ? "Model-derived Python"
              : "Python draft · not run"}
          </p>
          <small>
            Restricted sampling code · edit the equation to change the model.
          </small>
          <textarea
            aria-label="Artifact Python source"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
          />
          <div>
            <button
              onClick={() => {
                change({ ...a, code: draft });
                result.run();
              }}
            >
              Run Python
            </button>
            <button
              onClick={() => {
                change({ ...a, code: undefined });
                setDraft(prepare(page, { ...a, code: undefined }).code);
              }}
            >
              Use model code
            </button>
          </div>
          {result.receipt && (
            <details>
              <summary>Execution & bindings</summary>
              <pre>
                {JSON.stringify(
                  {
                    context: result.receipt.context,
                    inputs: result.receipt.inputs,
                    bindings: result.receipt.bindings,
                    definitions: result.receipt.definitions,
                    code_sha256: result.receipt.code_sha256,
                    runtime: result.receipt.runtime,
                    time: result.receipt.time,
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
          )}
        </div>
      )}
      <button
        className="er-artifact-resize"
        aria-label="Resize artifact"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          move.current = {
            x: e.clientX,
            y: e.clientY,
            at: a.at,
            width: a.width,
            height: a.height,
            resize: true,
          };
        }}
      >
        ◢
      </button>
    </section>
  );
}
