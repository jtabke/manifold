import { isDialogEvent } from "../interaction/modalInput";
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { GripVertical, MoreHorizontal } from "lucide-react";
import { worksheetInputUnit } from "../worksheetInputUnit";
import { display, unitLabel } from "../../notebook/math";
import {
  RegionSession,
  project,
  positions,
  curve,
  type CurvePlot,
  type Point,
} from "../document";
import { useLayoutGesture } from "../interaction/useLayoutGesture";
import { responsePlotAxes, SwapAxesButton } from "./PlotAxes";
const format = (n: number, digits = 5) =>
  Number(n.toPrecision(digits)).toString();

export function CurveRegion({
  session,
  workingPage,
  zoom,
  layoutCancelVersion,
  cancelLayout,
  comparisonContext,
  previewOnMove,
  finishInput,
  commands,
  quiet,
  revert,
  plot,
  selected,
  compare,
  select,
  move,
  resize,
  inspect,
  branch,
  reveal,
  setInput,
}: {
  session: RegionSession;
  zoom: number;
  layoutCancelVersion: number;
  cancelLayout: () => void;
  workingPage: import("../document").Page;
  comparisonContext?: string;
  previewOnMove: boolean;
  finishInput: () => void;
  commands: () => void;
  quiet: boolean;
  revert: () => void;
  plot: CurvePlot;
  selected: boolean;
  compare: boolean;
  select: () => void;
  move: (at: Point) => void;
  resize: (w: number, h: number) => void;
  inspect: () => void;
  branch: () => void;
  reveal: () => void;
  setInput: (id: string, x: number, anchor?: Element) => void;
}) {
  const page = workingPage,
    p = project(page),
    at = plot.at || positions(page)[plot.id];
  const layout = useLayoutGesture({
    geometry: { ...plot, at },
    zoom,
    cancelVersion: layoutCancelVersion,
    minWidth: 380,
    minHeight: 260,
    cancel: cancelLayout,
    complete: (geometry, resizing) =>
      resizing ? resize(geometry.width, geometry.height) : move(geometry.at),
  });
  const ids =
    compare && comparisonContext
      ? ["original", comparisonContext]
      : [page.active];
  const series = useMemo(
    () => ids.map((context) => ({ context, ...curve(page, plot, context) })),
    [
      page,
      plot.input,
      plot.output,
      plot.low,
      plot.high,
      compare,
      comparisonContext,
    ],
  );
  const output = p.statements.get(plot.output),
    input = p.statements.get(plot.input),
    q = input && p.solved.values.get(input.name);
  const inputUnit = q && worksheetInputUnit(input, q);
  const acceptedInput =
    input && project(session.state).solved.values.get(input.name);
  const values = series.flatMap((s) =>
    s.points.flatMap((pt) =>
      [pt.y, pt.limit].filter((v): v is number => v !== undefined),
    ),
  );
  const min = values.length ? Math.min(...values) : 0,
    max = values.length ? Math.max(...values) : 1,
    pad = Math.max(1, (max - min) * 0.12);
  const width = layout.value.width,
    height = layout.value.height,
    left = 54,
    right = width - 24,
    top = 78,
    bottom = height - 62;
  const swapped = !!plot.swapped;
  const axes = responsePlotAxes(
    { left, right, top, bottom },
    [plot.low, plot.high],
    [min - pad, max + pad],
    swapped,
  );
  const inputLabel = `${input?.name ?? "?"}${inputUnit?.label ? ` (${inputUnit.label})` : ""}`;
  const outputUnit = series[0]?.unit && unitLabel(series[0].unit);
  const outputLabel = `${output?.name ?? "?"}${outputUnit ? ` (${outputUnit})` : ""}`;
  const shown = (n: number, isInput: boolean) =>
    format(isInput ? (inputUnit?.fromBase(n) ?? n) : n, 3);
  const ticks = (domain: readonly [number, number], count: number) =>
    Array.from(
      { length: count },
      (_, i) => domain[0] + ((domain[1] - domain[0]) * i) / (count - 1),
    );
  const svg = useRef<SVGSVGElement>(null);
  const [preview, setPreview] = useState<number>();
  const scrub = useRef<
    { pixel: number; moved: boolean; id: number } | undefined
  >(undefined);
  useEffect(() => {
    const cancel = (e: KeyboardEvent) => {
      if (isDialogEvent(e)) return;
      if (e.key !== "Escape" || !scrub.current) return;
      const id = scrub.current.id;
      if (svg.current?.hasPointerCapture(id))
        svg.current.releasePointerCapture(id);
      scrub.current = undefined;
      setPreview(undefined);
      revert();
    };
    window.addEventListener("keydown", cancel, true);
    return () => window.removeEventListener("keydown", cancel, true);
  }, [revert]);
  const point = (e: PointerEvent<SVGSVGElement>) =>
    axes.inputAt(axes.inputPixel(svg.current, e.clientX, e.clientY));
  const guide = preview ?? q?.value;
  const path = (
    points: readonly { x: number; y?: number; limit?: number }[],
    field: "y" | "limit",
  ) => {
    let open = false;
    return points
      .map((pt) => {
        if (pt[field] === undefined) {
          open = false;
          return "";
        }
        const segment = `${open ? "L" : "M"}${axes.point(pt.x, pt[field]!).join(",")}`;
        open = true;
        return segment;
      })
      .join(" ");
  };
  return (
    <section
      className={`er-plot ${selected ? "is-selected" : ""}`}
      data-plot-id={plot.id}
      data-swapped={swapped || undefined}
      tabIndex={0}
      aria-label={`Response of ${output?.name || "output"} to ${input?.name || "input"}`}
      onFocus={select}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) {
          e.stopPropagation();
          inspect();
        }
      }}
      style={{
        left: layout.value.at.x,
        top: layout.value.at.y,
        width,
        height,
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={layout.move}
      onPointerUp={layout.finish}
      onPointerCancel={layout.cancel}
      onLostPointerCapture={layout.cancel}
      onClick={select}
    >
      <button
        className="er-grip"
        aria-label="Move response plot"
        onPointerDown={(e) => layout.start(e)}
      >
        <GripVertical size={15} />
      </button>
      {selected && quiet && (
        <button
          className="er-object-menu"
          aria-label="Plot commands"
          onClick={commands}
        >
          <MoreHorizontal size={16} />
        </button>
      )}
      {selected && !quiet && (
        <div className="er-region-actions">
          <button onClick={inspect}>Edit definition</button>
          <button onClick={branch}>Try alternative</button>
          <button onClick={reveal}>Reveal dependencies</button>
        </div>
      )}
      <header>
        <span>
          {output?.name || "?"} <span className="er-vs">against</span>{" "}
          {input?.name || "?"}
        </span>
        <small>
          Same definitions ·{" "}
          {page.contexts.find((c) => c.id === page.active)?.label}
        </small>
        <SwapAxesButton
          swapped={swapped}
          disabled={workingPage !== session.state}
          onSwap={() => session.swapPlotAxes(plot.id)}
        />
      </header>
      {values.length ? (
        <svg
          ref={svg}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="Live response curve"
          onPointerDown={(e) => {
            e.stopPropagation();
            select();
            e.currentTarget.setPointerCapture(e.pointerId);
            scrub.current = {
              pixel: swapped ? e.clientY : e.clientX,
              moved: false,
              id: e.pointerId,
            };
            setPreview(point(e));
          }}
          onPointerMove={(e) => {
            if (
              scrub.current &&
              Math.abs(
                (swapped ? e.clientY : e.clientX) - scrub.current.pixel,
              ) > 4
            ) {
              scrub.current.moved = true;
              setPreview(point(e));
              if (previewOnMove)
                setInput(plot.input, point(e), e.currentTarget);
            }
          }}
          onPointerUp={(e) => {
            if (preview !== undefined) {
              const value = point(e);
              setPreview(undefined);
              e.currentTarget.releasePointerCapture(e.pointerId);
              if (scrub.current?.moved) {
                setInput(plot.input, value, e.currentTarget);
                if (previewOnMove) finishInput();
              }
              scrub.current = undefined;
            }
          }}
          onPointerCancel={() => {
            setPreview(undefined);
            scrub.current = undefined;
            revert();
          }}
        >
          {ticks(axes.vertical, swapped ? 3 : 4).map((value, i) => {
            return (
              <g key={i}>
                <line
                  className="er-gridline"
                  x1={left}
                  x2={right}
                  y1={axes.y(value)}
                  y2={axes.y(value)}
                />
                <text x={left - 9} y={axes.y(value) + 4} textAnchor="end">
                  {shown(value, swapped)}
                </text>
              </g>
            );
          })}
          {ticks(axes.horizontal, 3).map((value) => (
            <text
              key={value}
              x={axes.x(value)}
              y={bottom + 22}
              textAnchor="middle"
            >
              {shown(value, !swapped)}
            </text>
          ))}
          {series.map((s) => (
            <g
              key={s.context}
              className={
                s.context === "original"
                  ? "er-original-series"
                  : "er-alternative-series"
              }
            >
              <path className="er-response-line" d={path(s.points, "y")} />
              <path
                className="er-requirement-line"
                d={path(s.points, "limit")}
              />
            </g>
          ))}
          {series[0]?.points.at(-1)?.limit !== undefined && (
            <text
              x={swapped ? axes.x(series[0].points.at(-1)!.limit!) : right}
              y={
                swapped ? top - 4 : axes.y(series[0].points.at(-1)!.limit!) - 7
              }
              textAnchor={swapped ? "middle" : "end"}
            >
              Limit {format(series[0].points.at(-1)!.limit!, 4)}
            </text>
          )}
          {guide !== undefined && (
            <path className="er-guide" d={axes.guide(guide)} fill="none" />
          )}
          {guide !== undefined &&
            output &&
            p.solved.values.get(output.name) &&
            (() => {
              const result = p.solved.values.get(output.name)!;
              const value = result.absolute
                ? result.value - 273.15
                : result.value;
              const [cx, cy] = axes.point(guide, value);
              return (
                <circle className="er-design-point" cx={cx} cy={cy} r={7}>
                  <title>
                    {input?.name} = {inputUnit?.format(guide) ?? format(guide)}{" "}
                    · {output.name} = {display(result)} · drag{" "}
                    {swapped ? "vertically" : "horizontally"}
                  </title>
                </circle>
              );
            })()}
          {acceptedInput && guide !== acceptedInput.value && (
            <path
              className="er-accepted-guide"
              d={axes.guide(acceptedInput.value)}
              fill="none"
            />
          )}
          <text x={left} y={top - 12}>
            {swapped ? inputLabel : outputLabel}
          </text>
          <text x={(left + right) / 2} y={height - 13} textAnchor="middle">
            {swapped ? outputLabel : inputLabel}
          </text>
        </svg>
      ) : (
        <p className="er-plot-blocked">
          Resolve the plotted quantities before calculating this response.
        </p>
      )}
      <div className="er-plot-readout">
        {preview !== undefined ? "Varying " : "Drag to vary "}
        {input?.name}{" "}
        {!quiet &&
          guide !== undefined &&
          `= ${format(inputUnit?.fromBase(guide) ?? guide, 4)}`}{" "}
        {compare && comparisonContext && (
          <span>
            Original <i />{" "}
            <b>
              Alternative <i />
            </b>
          </span>
        )}
      </div>
      <button
        className="er-resize"
        aria-label="Resize response plot"
        onPointerDown={(e) => layout.start(e, true)}
      />
    </section>
  );
}
