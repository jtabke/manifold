import {
  memo,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { Document } from "@manifold/foundation";
import type { Point, RegionSession } from "../document";
import type { EditBuffers } from "../app/workspaceFiles";
import { useEditBuffer } from "../app/useEditBuffer";
import { useShortcutMatcher } from "../app/useShortcutPreferences";
import type { ShortcutAction } from "../interaction/shortcutBindings";
import {
  dimensionAxes,
  dimensionLineLayout,
  type DimensionAxis,
  type DimensionPlacement,
} from "../drawingDimensions";
import { setDimensionPlacement } from "../drawingScaleOperations";
import type { DrawingEntry } from "../drawing";
import { drawingGeometry, type Bounds } from "../drawingGeometry";
import { drawingGridStep, formatDrawingLength } from "../drawingScale";
export function DrawingAreaGrid({
  entry,
  bounds: b,
  zoom,
}: {
  entry: DrawingEntry;
  bounds: Bounds;
  zoom: number;
}) {
  const scale = entry.mark.scale!,
    step = drawingGridStep(scale, zoom),
    id = `grid-${entry.id}`;
  return (
    <g className="drawing-area-grid" pointerEvents="none" aria-hidden="true">
      <defs>
        <pattern
          id={id}
          x={b.x}
          y={b.y}
          width={step}
          height={step}
          patternUnits="userSpaceOnUse"
        >
          <path
            d={`M ${step} 0 H 0 V ${step}`}
            fill="none"
            strokeWidth={0.6 / zoom}
          />
        </pattern>
      </defs>
      <rect {...b} fill={`url(#${id})`} stroke="none" />
      <text
        x={b.x + 8 / zoom}
        y={b.y + 18 / zoom}
        fontSize={12 / zoom}
        stroke="none"
      >
        {scale.name} · {scale.unit} · {scale.snap ? "Snap" : "Grid"}{" "}
        {formatDrawingLength(scale.gridMetres, scale.unit)}
      </text>
    </g>
  );
}
type Layout = ReturnType<typeof dimensionLineLayout>;
type Part = "line" | "label";
type Drag = {
  id: string;
  axis: DimensionAxis;
  part: Part;
  expected: Document;
  capture: SVGElement;
  pointer: number;
  start: Point;
  layout: Layout;
  base: DimensionPlacement;
  last: DimensionPlacement;
  moved: boolean;
};
export const DrawingDimensions = memo(function DrawingDimensions({
  entries,
  zoom,
  session,
  buffers,
  selection,
  enabled,
  point,
  select,
  activate,
  report,
  onShortcut,
}: {
  entries: readonly DrawingEntry[];
  zoom: number;
  session: RegionSession;
  buffers: EditBuffers;
  selection: ReadonlySet<string>;
  enabled: boolean;
  point: (x: number, y: number) => Point;
  select: (ids: string[]) => void;
  activate: () => boolean;
  report: (message: string) => void;
  onShortcut: (action: ShortcutAction) => void;
}) {
  const matchShortcut = useShortcutMatcher();
  const shortcuts = useRef({ matchShortcut, onShortcut });
  shortcuts.current = { matchShortcut, onShortcut };
  const drag = useRef<Drag | undefined>(undefined);
  const clickCleanup = useRef<(() => void) | undefined>(undefined);
  const suppressReleaseClick = () => {
    clickCleanup.current?.();
    const cleanup = () => {
      window.removeEventListener("click", stop, true);
      window.removeEventListener("pointerdown", nextPress, true);
      clickCleanup.current = undefined;
    };
    const stop = (e: MouseEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      cleanup();
    };
    const nextPress = () => {
      if (!drag.current) cleanup();
    };
    window.addEventListener("click", stop, true);
    window.addEventListener("pointerdown", nextPress, true);
    clickCleanup.current = cleanup;
  };
  const [preview, setPreview] = useState<{
    id: string;
    axis: DimensionAxis;
    placement: DimensionPlacement;
  }>();
  const cancel = () => {
    const g = drag.current;
    drag.current = undefined;
    setPreview(undefined);
    if (g) {
      delete g.capture.dataset.drawingActive;
      if (g.capture.hasPointerCapture(g.pointer))
        g.capture.releasePointerCapture(g.pointer);
    }
  };
  const safe = (operation: () => void) => {
    try {
      operation();
    } catch (e) {
      report((e as Error).message);
    }
  };
  useEditBuffer(buffers, "dimension-placement", {
    read: () =>
      drag.current
        ? JSON.stringify([
            drag.current.id,
            drag.current.axis,
            drag.current.last,
          ])
        : undefined,
    finish: () => {
      if (!drag.current) return true;
      report("Finish or cancel dimension placement first.");
      return false;
    },
  });
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!drag.current) return;
      const action = shortcuts.current.matchShortcut(e);
      if (e.key === "Escape" || action) {
        e.preventDefault();
        e.stopImmediatePropagation();
        cancel();
        if (action) shortcuts.current.onShortcut(action);
      }
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", cancel);
    };
  }, []);
  useEffect(() => {
    if (
      drag.current &&
      (!enabled || drag.current.expected !== session.document)
    )
      cancel();
  }, [session.document, enabled]);
  useEffect(() => {
    cancel();
  }, [zoom]);
  useEffect(
    () => () => {
      const g = drag.current;
      drag.current = undefined;
      clickCleanup.current?.();
      if (g) {
        delete g.capture.dataset.drawingActive;
        if (g.capture.hasPointerCapture(g.pointer))
          g.capture.releasePointerCapture(g.pointer);
      }
    },
    [],
  );
  const down = (
    e: ReactPointerEvent<SVGElement>,
    entry: DrawingEntry,
    axis: DimensionAxis,
    part: Part,
    layout: Layout,
  ) => {
    if (!enabled || e.button !== 0 || drag.current) return;
    e.preventDefault();
    e.stopPropagation();
    if (!activate()) return;
    suppressReleaseClick();
    select([entry.id]);
    e.currentTarget.focus({ preventScroll: true });
    const original = entry.mark.dimensionPlacement?.[axis];
    const base = {
      offset: layout.offset,
      ...(original?.label !== undefined ? { label: original.label } : {}),
    };
    drag.current = {
      id: entry.id,
      axis,
      part,
      layout,
      base,
      last: base,
      expected: session.document,
      capture: e.currentTarget,
      pointer: e.pointerId,
      start: point(e.clientX, e.clientY),
      moved: false,
    };
    e.currentTarget.dataset.drawingActive = "dimension";
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const track = (e: ReactPointerEvent<SVGElement>) => {
    const g = drag.current;
    if (!g || g.pointer !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    if (g.expected !== session.document) return cancel();
    const p = point(e.clientX, e.clientY),
      dx = p.x - g.start.x,
      dy = p.y - g.start.y;
    if (Math.hypot(dx, dy) * zoom > 2) g.moved = true;
    g.last =
      g.part === "line"
        ? {
            ...g.base,
            offset:
              g.base.offset + dx * g.layout.normal.x + dy * g.layout.normal.y,
          }
        : {
            offset: g.base.offset,
            label:
              g.layout.label.x -
              g.layout.span / 2 +
              dx * g.layout.tangent.x +
              dy * g.layout.tangent.y,
          };
    if (e.type === "pointerup") {
      cancel();
      if (g.moved)
        safe(() =>
          setDimensionPlacement(session, g.id, g.axis, g.last, g.expected),
        );
    } else if (g.moved)
      setPreview({ id: g.id, axis: g.axis, placement: g.last });
  };
  const key = (
    e: ReactKeyboardEvent<SVGElement>,
    entry: DrawingEntry,
    axis: DimensionAxis,
    part: Part,
    layout: Layout,
  ) => {
    const action = matchShortcut(e.nativeEvent);
    if (action) {
      e.preventDefault();
      e.stopPropagation();
      cancel();
      onShortcut(action);
      return;
    }
    if (!enabled) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancel();
      document
        .querySelector<SVGElement>(`[data-drawing-id="${entry.id}"]`)
        ?.focus();
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      e.stopPropagation();
      cancel();
      safe(() => setDimensionPlacement(session, entry.id, axis, null));
      return;
    }
    const arrows: Record<string, Point> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    };
    const direction = arrows[e.key];
    if (direction) {
      e.preventDefault();
      e.stopPropagation();
      if (!activate()) return;
      select([entry.id]);
      const vector = part === "line" ? layout.normal : layout.tangent,
        delta =
          ((direction.x * vector.x + direction.y * vector.y) *
            (e.shiftKey ? 20 : 5)) /
          zoom;
      if (Math.abs(delta) < 1e-9) return;
      const original = entry.mark.dimensionPlacement?.[axis];
      safe(() =>
        setDimensionPlacement(
          session,
          entry.id,
          axis,
          part === "line"
            ? { ...original, offset: layout.offset + delta }
            : {
                offset: layout.offset,
                label: layout.label.x - layout.span / 2 + delta,
              },
        ),
      );
    } else if ([" ", "Enter", "Delete", "Backspace"].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      if ((e.key === " " || e.key === "Enter") && activate())
        select([entry.id]);
    }
  };
  const controls = (
    entry: DrawingEntry,
    axis: DimensionAxis,
    part: Part,
    layout: Layout,
  ) => ({
    role: "button",
    "aria-disabled": !enabled,
    tabIndex: enabled && selection.has(entry.id) ? 0 : -1,
    "aria-label": `Move ${axis} dimension ${part}`,
    "aria-describedby": `dimension-placement-help dimension-${entry.id}`,
    "data-canvas-controls": "",
    "data-dimension-handle": part,
    className: `drawing-dimension-control is-${part}`,
    pointerEvents: enabled ? ("all" as const) : ("none" as const),
    onPointerDown: (e: ReactPointerEvent<SVGElement>) =>
      down(e, entry, axis, part, layout),
    onPointerMove: track,
    onPointerUp: track,
    onPointerCancel: (e: ReactPointerEvent<SVGElement>) => {
      if (e.pointerId === drag.current?.pointer) {
        e.stopPropagation();
        cancel();
      }
    },
    onLostPointerCapture: () => {
      if (drag.current) cancel();
    },
    onKeyDown: (e: ReactKeyboardEvent<SVGElement>) =>
      key(e, entry, axis, part, layout),
    onClick: (e: { stopPropagation: () => void }) => e.stopPropagation(),
    onDoubleClick: (e: { stopPropagation: () => void }) => e.stopPropagation(),
  });
  const geometry = drawingGeometry(entries),
    areas = new Map(
      entries.filter((e) => e.mark.kind === "area").map((e) => [e.id, e]),
    );
  return (
    <g className="drawing-dimensions" pointerEvents="none">
      <desc id="dimension-placement-help">
        Drag the dimension line to change its offset; drag the label along the
        line. Arrow keys move it, Shift moves farther. Home resets placement.
        Escape cancels a drag or returns to the shape. Placement never changes
        geometry.
      </desc>
      {entries.flatMap((entry) => {
        const scale =
          entry.mark.area && areas.get(entry.mark.area.item)?.mark.scale;
        if (!scale?.dimensions) return [];
        const axes = dimensionAxes(entry.mark.kind).filter(
          (axis) =>
            selection.has(entry.id) ||
            scale.allDimensions ||
            entry.mark.dimensionPlacement?.[axis],
        );
        if (!axes.length) return [];
        const [a, b] = geometry.points(entry),
          box = geometry.bounds(entry),
          rectangle = ["rectangle", "ellipse"].includes(entry.mark.kind);
        const length = (n: number) =>
          formatDrawingLength(n * scale.metresPerUnit, scale.unit);
        const angle = Number(
          ((-Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI).toFixed(2),
        );
        const labels = {
          width: length(Math.abs(b.x - a.x)),
          height: length(Math.abs(b.y - a.y)),
          length: length(Math.hypot(b.x - a.x, b.y - a.y)),
        };
        const summary = rectangle
          ? `${labels.width} × ${labels.height}`
          : `${labels.length} · ${angle}°`;
        return (
          <g
            key={entry.id}
            data-drawing-dimension={entry.id}
            role="group"
            aria-label={summary}
            className={selection.has(entry.id) ? "is-selected" : ""}
          >
            <desc id={`dimension-${entry.id}`}>{summary}</desc>
            {axes.map((axis) => {
              const start =
                axis === "width"
                  ? { x: box.x, y: box.y + Math.abs(b.y - a.y) }
                  : axis === "height"
                    ? {
                        x: box.x + Math.abs(b.x - a.x),
                        y: box.y + Math.abs(b.y - a.y),
                      }
                    : a;
              const end =
                axis === "width"
                  ? { x: box.x + Math.abs(b.x - a.x), y: start.y }
                  : axis === "height"
                    ? { x: start.x, y: box.y }
                    : b;
              const placement =
                preview?.id === entry.id && preview.axis === axis
                  ? preview.placement
                  : entry.mark.dimensionPlacement?.[axis];
              const layout = dimensionLineLayout(
                  start,
                  end,
                  zoom,
                  labels[axis],
                  placement,
                  axis === "height",
                ),
                sign = layout.outside ? -1 : 1;
              return (
                <g
                  key={axis}
                  data-dimension-axis={axis}
                  data-dimension-pinned={
                    !!entry.mark.dimensionPlacement?.[axis]
                  }
                >
                  {layout.extensions.map((line, i) => (
                    <line
                      key={i}
                      className="drawing-dimension-extension"
                      x1={line.from.x}
                      y1={line.from.y}
                      x2={line.to.x}
                      y2={line.to.y}
                      strokeWidth={1 / zoom}
                    />
                  ))}
                  <g
                    transform={`translate(${layout.origin.x} ${layout.origin.y}) rotate(${layout.angle})`}
                    data-dimension-offset={layout.offset}
                  >
                    <line
                      className="drawing-dimension-baseline"
                      x1={layout.start}
                      y1={0}
                      x2={layout.end}
                      y2={0}
                      strokeWidth={1 / zoom}
                    />
                    <path
                      className="drawing-dimension-arrow"
                      d={`M0 0 L${sign * layout.arrow} ${layout.halfArrow} L${sign * layout.arrow} ${-layout.halfArrow} Z`}
                    />
                    <path
                      className="drawing-dimension-arrow"
                      d={`M${layout.span} 0 L${layout.span - sign * layout.arrow} ${layout.halfArrow} L${layout.span - sign * layout.arrow} ${-layout.halfArrow} Z`}
                    />
                    <g {...controls(entry, axis, "line", layout)}>
                      <rect
                        x={layout.start}
                        y={-7 / zoom}
                        width={Math.max(14 / zoom, layout.end - layout.start)}
                        height={14 / zoom}
                        fill="transparent"
                        stroke="none"
                      />
                    </g>
                    <g {...controls(entry, axis, "label", layout)}>
                      <rect
                        className="drawing-dimension-label-hit"
                        x={
                          layout.label.x -
                          (labels[axis].length * 3.5 + 4) / zoom
                        }
                        y={-27 / zoom}
                        width={(labels[axis].length * 7 + 8) / zoom}
                        height={24 / zoom}
                        strokeWidth={1 / zoom}
                      />
                      <text
                        x={layout.label.x}
                        y={layout.label.y}
                        textAnchor="middle"
                        fontSize={12 / zoom}
                        strokeWidth={3 / zoom}
                        aria-hidden="true"
                      >
                        {labels[axis]}
                      </text>
                      {axis === "length" &&
                        selection.has(entry.id) &&
                        angle !== 0 && (
                          <text
                            data-dimension-angle=""
                            x={layout.label.x}
                            y={10 / zoom}
                            textAnchor="middle"
                            fontSize={10 / zoom}
                            strokeWidth={3 / zoom}
                            aria-hidden="true"
                          >
                            {angle}°
                          </text>
                        )}
                    </g>
                  </g>
                </g>
              );
            })}
          </g>
        );
      })}
    </g>
  );
});
