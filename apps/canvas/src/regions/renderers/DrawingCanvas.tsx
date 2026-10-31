import { useShortcutMatcher } from "../app/useShortcutPreferences";
import { isDialogEvent } from "../interaction/modalInput";
import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import type { Document } from "@manifold/foundation";
import {
  MousePointer2,
  PenTool,
  Highlighter,
  Eraser,
  Lasso,
  Minus,
  MoveUpRight,
  Square,
  Circle,
  Type,
  Workflow,
  Copy,
  Trash2,
} from "lucide-react";
import type { RegionSession, Point } from "../document";
import {
  createDrawing,
  drawings,
  editDrawings,
  deleteDrawings,
  duplicateDrawings,
  isInk,
  MAX_STROKE_POINTS,
  MAX_LABEL_LENGTH,
  type DrawingEntry,
  type DrawingEdit,
  type DrawingKind,
  type InkPoint,
  type Mark,
} from "../drawing";
import {
  constrain,
  drawingGeometry,
  inside,
  pointBounds,
  previewDrawings,
  type MarkGeometry,
} from "../drawingGeometry";
import { useEditBuffer } from "../app/useEditBuffer";
import { sameJson } from "../immutableJson";
import {
  regularizeStroke,
  REGULARIZE_HOLD_MS,
  REGULARIZE_MOVE_PX,
} from "../drawingRegularization";
import type { EditBuffers } from "../app/workspaceFiles";
import "../styles/drawing.css";
type Tool = "write" | "select" | "lasso" | "eraser" | DrawingKind;
type DrawingPointer = ReactPointerEvent<SVGSVGElement>;
type Label = {
  at: Point;
  text: string;
  entry?: DrawingEntry;
  expected: Document;
};
type Gesture = {
  pointer: number;
  capture: SVGSVGElement;
  tool: Tool;
  start: InkPoint;
  last: InkPoint;
  expected: Document;
  geometry: ReturnType<typeof drawingGeometry>;
  points: InkPoint[];
  mark?: Mark;
  regularized?: Mark;
  hold?: { at: Point; zoom: number; timer?: ReturnType<typeof setTimeout> };
  erased: Set<string>;
  transform?: (end: Point) => DrawingEdit[];
};
const tools = [
  ["select", "Select drawings", MousePointer2],
  ["pen", "Pen", PenTool],
  ["highlighter", "Highlighter", Highlighter],
  ["eraser", "Eraser", Eraser],
  ["lasso", "Lasso drawings", Lasso],
  ["line", "Line", Minus],
  ["arrow", "Arrow", MoveUpRight],
  ["rectangle", "Rectangle", Square],
  ["ellipse", "Ellipse", Circle],
  ["text", "Drawing label", Type],
  ["connector", "Visual connector", Workflow],
] as const;
const freehand = (tool: Tool) => isInk(tool) || tool === "lasso";
function clearHold(g: Gesture) {
  clearTimeout(g.hold?.timer);
  g.hold = undefined;
  g.regularized = undefined;
}
function labelMark(
  text: string,
  { color, width }: Pick<Mark, "color" | "width">,
  prior?: Mark,
): Mark {
  const old = prior && pointBounds(prior.points),
    lines = text.split("\n");
  const lineHeight =
    old && prior ? old.height / prior.text.split("\n").length : 32;
  const x = old?.x ?? 0,
    y = old?.y ?? 0;
  return {
    kind: "text",
    color,
    width,
    text,
    start: null,
    end: null,
    points: [
      { x, y, pressure: 0.5 },
      {
        x:
          x +
          Math.max(80, ...lines.map((line) => line.length * lineHeight * 0.4)),
        y: y + lines.length * lineHeight,
        pressure: 0.5,
      },
    ],
  };
}
function useDrawingCanvas(
  session: RegionSession,
  buffers: EditBuffers,
  report: (message: string) => void,
  visible: boolean,
  zoom: number,
) {
  const matchShortcut = useShortcutMatcher();
  const [tool, setTool] = useState<Tool>("write");
  const [style, setStyle] = useState({ color: "#c5d3e8", width: 3 });
  const [selection, setSelection] = useState(new Set<string>()),
    [label, setLabel] = useState<Label>();
  const gesture = useRef<Gesture | undefined>(undefined),
    frame = useRef<number | undefined>(undefined);
  const [version, redraw] = useReducer((n) => n + 1, 0);
  const preview = gesture.current;
  const fitted = preview?.regularized;
  const shown = useRef<{ gesture: Gesture; mark: Mark } | undefined>(undefined);
  useLayoutEffect(() => {
    // A timer result is not an accepted intent until its preview has reached the DOM.
    shown.current =
      visible && preview && fitted
        ? { gesture: preview, mark: fitted }
        : undefined;
  });
  const entries = drawings(session.document),
    geometry = drawingGeometry(entries);
  const selected = useMemo(
    () => new Set([...selection].filter((id) => geometry.byId.has(id))),
    [selection, geometry],
  );
  const selectedStroke =
    selected.size === 1 ? geometry.byId.get([...selected][0]) : undefined;
  const regularize = () => {
    if (gesture.current || selectedStroke?.mark.kind !== "pen") return;
    const mark = regularizeStroke(selectedStroke.mark, zoom);
    if (!mark)
      return report(
        "No confident line, circle or rectangle fit. The original stroke was kept.",
      );
    safe(() => editDrawings(session, [{ entry: selectedStroke, mark }]));
  };
  const safe = (operation: () => void) => {
    try {
      operation();
      return true;
    } catch (e) {
      report((e as Error).message);
      return false;
    }
  };
  const clearGesture = () => {
    const g = gesture.current;
    gesture.current = undefined;
    shown.current = undefined;
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
    if (g) {
      clearTimeout(g.hold?.timer);
      delete g.capture.dataset.drawingActive;
      if (g.capture.hasPointerCapture(g.pointer))
        g.capture.releasePointerCapture(g.pointer);
    }
  };
  const cancel = (event?: Event | DrawingPointer) => {
    if (
      event &&
      "pointerId" in event &&
      event.pointerId !== gesture.current?.pointer
    )
      return;
    clearGesture();
    redraw();
  };
  const show = () => {
    if (frame.current === undefined)
      frame.current = requestAnimationFrame(() => {
        frame.current = undefined;
        if (gesture.current) redraw();
      });
  };
  const hold = (g: Gesture, p: Point, scale: number, ending = false) => {
    if (g.tool !== "pen") return;
    if (
      g.hold?.zoom === scale &&
      Math.hypot(p.x - g.hold.at.x, p.y - g.hold.at.y) * scale <=
        REGULARIZE_MOVE_PX
    )
      return;
    clearHold(g);
    if (ending) return;
    const pending: NonNullable<Gesture["hold"]> = { at: p, zoom: scale };
    g.hold = pending;
    pending.timer = setTimeout(() => {
      pending.timer = undefined;
      if (
        gesture.current !== g ||
        g.hold !== pending ||
        g.expected !== session.document ||
        !g.capture.isConnected ||
        !g.capture.hasPointerCapture(g.pointer)
      )
        return;
      g.regularized = g.mark && regularizeStroke(g.mark, scale);
      if (g.regularized) redraw();
    }, REGULARIZE_HOLD_MS);
  };
  useEffect(() => clearGesture, []);
  useEffect(() => {
    const g = gesture.current;
    if (g?.hold && g.hold.zoom !== zoom) {
      clearHold(g);
      redraw();
    }
  }, [zoom]);
  useEffect(() => {
    if (
      !visible ||
      (gesture.current && gesture.current.expected !== session.document)
    )
      cancel();
  }, [session.document, visible]);
  const finishLabel = () => {
    if (!label) return true;
    const ok =
      !label.text.trim() ||
      label.entry?.mark.text === label.text ||
      safe(() => {
        const prior = label.entry?.mark;
        const mark = labelMark(label.text, prior ?? style, prior);
        if (label.entry)
          editDrawings(session, [{ entry: label.entry, mark }], label.expected);
        else createDrawing(session, mark, label.at, label.expected);
      });
    if (ok) setLabel(undefined);
    return ok;
  };
  useEditBuffer(buffers, "drawing", {
    read: () => {
      const g = gesture.current;
      return g
        ? JSON.stringify([g.tool, g.points, g.last])
        : label
          ? JSON.stringify([label.at, label.text, label.entry?.id])
          : undefined;
    },
    finish: () => {
      if (!gesture.current) return finishLabel();
      report("Finish or cancel the drawing gesture first.");
      return false;
    },
  });
  const choose = (next: Tool) => {
    if (!finishLabel()) return false;
    cancel();
    setTool(next);
    return true;
  };
  const editLabel = (entry: DrawingEntry) => {
    if (!choose("text")) return;
    const current = drawingGeometry(drawings(session.document)).byId.get(
      entry.id,
    );
    if (current)
      setLabel({
        entry: current,
        at: current.view,
        text: current.mark.text,
        expected: session.document,
      });
  };
  const remove = () =>
    safe(() => {
      deleteDrawings(session, [...selected]);
      setSelection(new Set());
    });
  const duplicate = () =>
    safe(() =>
      setSelection(new Set(duplicateDrawings(session, [...selected]))),
    );
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (isDialogEvent(e)) return;
      const target = e.target as Element;
      if (
        !visible ||
        tool === "write" ||
        target.closest("input,textarea,select,[contenteditable=true]")
      )
        return;
      const action = matchShortcut(e);
      if (action) {
        if (action === "canvas.undo" || action === "canvas.redo") cancel();
        return;
      }
      const controlKey = [
        "Enter",
        " ",
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
      ].includes(e.key);
      if (controlKey && target.closest("button,a,[role=button],summary"))
        return;
      const command = e.ctrlKey || e.metaKey;
      let handled = true;
      if (e.key === "Escape") {
        cancel();
        setLabel(undefined);
        setSelection(new Set());
        setTool("write");
      } else if (command && e.key.toLowerCase() === "d") {
        if (!gesture.current) duplicate();
      } else if (["Delete", "Backspace"].includes(e.key)) {
        if (!gesture.current) remove();
      } else
        handled =
          (e.key.length === 1 && !command && e.code !== "Space") ||
          (controlKey && e.code !== "Space");
      if (handled) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", cancel);
    };
  });
  const down = (e: DrawingPointer, p: InkPoint, zoom: number) => {
    if (e.button !== 0 || e.pointerType === "touch" || gesture.current) return;
    e.preventDefault();
    e.stopPropagation();
    if (!finishLabel()) return;
    const expected = session.document,
      scene = drawingGeometry(drawings(expected)),
      target = scene.pick(p, 7 / zoom);
    if (tool === "write") {
      if (target) {
        setTool("select");
        setSelection(new Set([target.id]));
      }
      return;
    }
    if (tool === "text") {
      setLabel({
        at: p,
        text: target?.mark.kind === "text" ? target.mark.text : "",
        entry: target?.mark.kind === "text" ? target : undefined,
        expected,
      });
      return;
    }
    const resize = !!(e.target as Element).closest("[data-drawing-resize]"),
      ids = new Set(selected);
    if (tool === "select" && !resize) {
      if (!e.shiftKey && (!target || !ids.has(target.id))) ids.clear();
      if (target) {
        if (e.shiftKey && ids.has(target.id)) ids.delete(target.id);
        else ids.add(target.id);
      }
      setSelection(ids);
    }
    const g: Gesture = {
      pointer: e.pointerId,
      capture: e.currentTarget,
      tool,
      start: p,
      last: p,
      expected,
      geometry: scene,
      points: [p],
      erased: new Set(),
      transform:
        tool === "select" ? scene.transform(ids, p, resize) : undefined,
    };
    if (tool !== "select" && tool !== "lasso" && tool !== "eraser")
      g.mark = {
        kind: tool,
        color: style.color,
        width:
          tool === "highlighter" ? Math.max(12, style.width * 4) : style.width,
        points: freehand(tool) ? g.points : [p, p],
        text: "",
        start:
          tool === "connector"
            ? scene.anchor(p, expected.document, 12 / zoom)
            : null,
        end: null,
      };
    gesture.current = g;
    if (tool === "eraser") sample(g, p, zoom, e.shiftKey);
    e.currentTarget.dataset.drawingActive = "true";
    e.currentTarget.setPointerCapture(e.pointerId);
    hold(g, p, zoom);
    redraw();
  };
  const sample = (g: Gesture, p: InkPoint, zoom: number, shift: boolean) => {
    if (
      freehand(g.tool) &&
      Math.hypot(
        p.x - g.points[g.points.length - 1].x,
        p.y - g.points[g.points.length - 1].y,
      ) >=
        0.6 / zoom
    ) {
      if (g.points.length >= MAX_STROKE_POINTS) {
        cancel();
        report(
          `This stroke reached the ${MAX_STROKE_POINTS}-point limit. Draw it as shorter strokes.`,
        );
        return false;
      }
      g.points.push(p);
    }
    if (g.tool === "eraser") {
      const hits = g.geometry.entries
        .filter(
          (e) =>
            !g.erased.has(e.id) && g.geometry.sweptHit(e, g.last, p, 9 / zoom),
        )
        .map((e) => e.id);
      if (hits.length) g.erased = new Set([...g.erased, ...hits]);
    }
    g.last = p;
    if (g.mark)
      g.mark = {
        ...g.mark,
        points: freehand(g.tool)
          ? g.points
          : [g.start, shift ? constrain(g.start, p, g.tool) : p],
        end:
          g.tool === "connector"
            ? g.geometry.anchor(p, g.expected.document, 12 / zoom)
            : null,
      };
    return true;
  };
  const track = (e: DrawingPointer, p: InkPoint, zoom: number) => {
    const g = gesture.current;
    if (!g || g.pointer !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    if (g.expected !== session.document) return cancel();
    hold(g, p, zoom, e.type === "pointerup");
    if (!sample(g, p, zoom, e.shiftKey)) return;
    if (e.type !== "pointerup") return show();
    const acceptedFit =
      shown.current?.gesture === g && shown.current.mark === g.regularized
        ? g.regularized
        : undefined;
    cancel();
    safe(() => {
      if (g.mark) {
        // Retain the authored ink as an ordinary history state: Undo shape → ink, then ink → absent.
        const id = createDrawing(session, g.mark, undefined, g.expected);
        setSelection(new Set([id]));
        if (acceptedFit) {
          const entry = drawings(session.document).find((e) => e.id === id);
          if (
            !entry ||
            !sameJson(entry.mark, g.mark) ||
            entry.view.x !== 0 ||
            entry.view.y !== 0
          )
            throw Error(
              "The stroke changed before regularization; its current drawing was kept.",
            );
          editDrawings(session, [{ entry, mark: acceptedFit }]);
        }
      } else if (g.tool === "eraser")
        deleteDrawings(session, [...g.erased], g.expected);
      else if (g.tool === "lasso")
        setSelection(
          new Set(
            g.geometry.entries
              .filter((entry) => {
                const b = g.geometry.bounds(entry);
                return (
                  inside(
                    { x: b.x + b.width / 2, y: b.y + b.height / 2 },
                    g.points,
                  ) || g.geometry.points(entry).some((p) => inside(p, g.points))
                );
              })
              .map((entry) => entry.id),
          ),
        );
      else if (
        g.transform &&
        Math.hypot(p.x - g.start.x, p.y - g.start.y) > 0.5
      )
        editDrawings(session, g.transform(p), g.expected);
    });
  };
  const visibleEntries = useMemo(
    () =>
      preview?.transform
        ? previewDrawings(entries, preview.transform(preview.last))
        : entries,
    [entries, version],
  );
  return {
    tool,
    choose,
    style,
    setStyle,
    selection: selected,
    entries: visibleEntries,
    preview,
    label,
    setLabel,
    finishLabel,
    down,
    track,
    cancel,
    duplicate,
    remove,
    editLabel,
    regularize,
    canRegularize: !preview && selectedStroke?.mark.kind === "pen",
    guidance: preview?.regularized
      ? `${preview.regularized.kind === "ellipse" ? "Circle" : preview.regularized.kind === "line" ? "Line" : "Rectangle"} preview. Release to accept; move to keep drawing.`
      : tool === "pen"
        ? "Draw, then hold still to preview a line, circle or rectangle."
        : tool === "write"
          ? "Sketch beside your calculations"
          : tool === "connector"
            ? "Drag between shapes · visual only"
            : "Space-drag to pan · Shift constrains shapes · Esc to write",
  };
}
type Controller = ReturnType<typeof useDrawingCanvas>;
function DrawingToolbar({ drawing: d }: { drawing: Controller }) {
  return (
    <div
      className="drawing-toolbar"
      role="toolbar"
      aria-label="Drawing and diagram tools"
    >
      <button
        aria-pressed={d.tool === "write"}
        onClick={() => d.choose("write")}
        title="Return to equations and notes"
      >
        Write
      </button>
      {tools.map(([tool, name, Icon]) => (
        <button
          key={tool}
          aria-label={name}
          title={name}
          aria-pressed={d.tool === tool}
          onClick={() => d.choose(tool)}
        >
          <Icon size={17} />
        </button>
      ))}
      <input
        aria-label="Stroke color"
        title="Stroke color"
        type="color"
        value={d.style.color}
        onChange={(e) => d.setStyle({ ...d.style, color: e.target.value })}
      />
      <label className="drawing-width">
        Width{" "}
        <input
          aria-label="Stroke width"
          type="range"
          min="1"
          max="10"
          value={d.style.width}
          onChange={(e) =>
            d.setStyle({ ...d.style, width: Number(e.target.value) })
          }
        />
      </label>
      {(
        [
          ["Duplicate drawings", Copy, d.duplicate],
          ["Delete drawings", Trash2, d.remove],
        ] as const
      ).map(([name, Icon, action]) => (
        <button
          key={name}
          aria-label={name}
          title={name}
          disabled={!d.selection.size}
          onClick={action}
        >
          <Icon size={16} />
        </button>
      ))}
      <button
        aria-label="Regularize selection"
        title="Fit one selected pen stroke to a line, circle or rectangle. Undo restores ink."
        disabled={!d.canRegularize}
        onClick={d.regularize}
      >
        Regularize
      </button>
      <span className="drawing-hint" aria-hidden="true">
        {d.guidance}
      </span>
      <span
        className="drawing-announcement"
        aria-live="polite"
        aria-atomic="true"
      >
        {d.guidance}
      </span>
    </div>
  );
}
/** A single outline keeps pressure-sensitive strokes to one SVG element. */
function inkOutline(points: InkPoint[], width: number) {
  const left: string[] = [],
    right: string[] = [];
  points.forEach((p, i) => {
    const a = points[Math.max(0, i - 1)],
      b = points[Math.min(points.length - 1, i + 1)],
      dx = b.x - a.x,
      dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1,
      r = (width * (0.2 + p.pressure * 0.8)) / 2;
    left.push(`${p.x - (dy / length) * r},${p.y + (dx / length) * r}`);
    right.push(`${p.x + (dy / length) * r},${p.y - (dx / length) * r}`);
  });
  return `M${left.join(" L")} L${right.reverse().join(" L")} Z`;
}
const MarkView = memo(function MarkView({
  mark: m,
  geometry,
}: {
  mark: Mark;
  geometry?: MarkGeometry;
}) {
  const points = geometry?.points ?? m.points,
    a = points[0],
    b = points[points.length - 1];
  const common = {
    stroke: m.color,
    strokeWidth: m.width,
    fill: "none",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (m.kind === "pen")
    return points.every((p) => p.x === a.x && p.y === a.y) ? (
      <circle cx={a.x} cy={a.y} r={m.width / 2} fill={m.color} />
    ) : (
      <path d={inkOutline(points, m.width)} fill={m.color} />
    );
  if (m.kind === "highlighter")
    return (
      <polyline
        {...common}
        opacity={0.3}
        points={`${points.map((p) => `${p.x},${p.y}`).join(" ")} ${b.x},${b.y}`}
      />
    );
  const box = geometry?.bounds ?? pointBounds(points);
  if (m.kind === "rectangle") return <rect {...common} {...box} />;
  if (m.kind === "ellipse")
    return (
      <ellipse
        {...common}
        cx={box.x + box.width / 2}
        cy={box.y + box.height / 2}
        rx={box.width / 2}
        ry={box.height / 2}
      />
    );
  if (m.kind === "text") {
    const lines = m.text.split("\n"),
      lineHeight = box.height / lines.length;
    return (
      <text
        x={box.x}
        y={box.y + lineHeight * 0.75}
        fill={m.color}
        fontSize={lineHeight * 0.75}
        fontFamily="inherit"
      >
        {lines.map((line, i) => (
          <tspan key={i} x={box.x} dy={i ? lineHeight : 0}>
            {line || " "}
          </tspan>
        ))}
      </text>
    );
  }
  const angle = Math.atan2(b.y - a.y, b.x - a.x),
    size = Math.max(10, m.width * 4);
  return (
    <g>
      <line {...common} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
      {["arrow", "connector"].includes(m.kind) && (
        <path
          {...common}
          d={`M${b.x - size * Math.cos(angle - 0.45)},${b.y - size * Math.sin(angle - 0.45)} L${b.x},${b.y} L${b.x - size * Math.cos(angle + 0.45)},${b.y - size * Math.sin(angle + 0.45)}`}
        />
      )}
    </g>
  );
});
const DrawingMarks = memo(function DrawingMarks({
  entries,
  erased,
}: {
  entries: readonly DrawingEntry[];
  erased?: ReadonlySet<string>;
}) {
  const geometry = drawingGeometry(entries);
  return entries
    .filter((e) => !erased?.has(e.id))
    .map((entry) => {
      // Only dense ink needs local-path reuse; simple shapes/connectors keep shared world geometry.
      const local = isInk(entry.mark.kind);
      return (
        <g
          key={entry.id}
          data-drawing-id={entry.id}
          data-drawing-kind={entry.mark.kind}
          className="drawing-mark"
          transform={
            local ? `translate(${entry.view.x} ${entry.view.y})` : undefined
          }
        >
          <MarkView
            mark={entry.mark}
            geometry={local ? undefined : geometry.geometry(entry)}
          />
        </g>
      );
    });
});
/** Keep pointer samples and editor buffers out of the application shell's render loop. */
export function DrawingCanvas({
  session,
  buffers,
  report,
  toolbar,
  visible,
  zoom,
  point,
}: {
  session: RegionSession;
  buffers: EditBuffers;
  report: (message: string) => void;
  toolbar: HTMLElement | null;
  visible: boolean;
  zoom: number;
  point: (x: number, y: number) => Point;
}) {
  const d = useDrawingCanvas(session, buffers, report, visible, zoom);
  if (!visible) return null;
  const geometry = drawingGeometry(d.entries),
    b = geometry.selectionBounds(d.selection),
    active = d.tool !== "write";
  const coordinates = (e: DrawingPointer): InkPoint => ({
    ...point(e.clientX, e.clientY),
    pressure: e.pointerType === "pen" ? Math.max(0.05, e.pressure) : 0.75,
  });
  const draft = d.preview?.regularized ?? d.preview?.mark,
    stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  return (
    <>
      {toolbar && createPortal(<DrawingToolbar drawing={d} />, toolbar)}
      <svg
        className={`drawing-surface ${active ? "is-drawing" : ""}`}
        data-drawing-surface=""
        aria-label="Drawings"
        onPointerDown={(e) => d.down(e, coordinates(e), zoom)}
        onPointerMove={(e) => d.track(e, coordinates(e), zoom)}
        onPointerUp={(e) => d.track(e, coordinates(e), zoom)}
        onPointerCancel={(e) => {
          stop(e);
          d.cancel(e);
        }}
        onLostPointerCapture={d.cancel}
        onClick={stop}
        onDoubleClick={(e) => {
          stop(e);
          const entry = geometry.pick(point(e.clientX, e.clientY), 5 / zoom);
          if (entry?.mark.kind === "text") d.editLabel(entry);
        }}
      >
        {active && (
          <rect
            className="drawing-background"
            x={-1_000_000}
            y={-1_000_000}
            width={2_000_000}
            height={2_000_000}
            fill="transparent"
          />
        )}
        <DrawingMarks entries={d.entries} erased={d.preview?.erased} />
        {draft && (
          <g
            pointerEvents="none"
            data-regularized-preview={d.preview?.regularized?.kind}
          >
            <MarkView
              mark={draft}
              geometry={geometry.geometry({
                mark: draft,
                view: { x: 0, y: 0 },
              })}
            />
          </g>
        )}
        {b && active && (
          <g
            className="drawing-selection"
            pointerEvents="none"
            stroke="#73569c"
            strokeWidth={1 / zoom}
          >
            <rect
              x={b.x - 5 / zoom}
              y={b.y - 5 / zoom}
              width={b.width + 10 / zoom}
              height={b.height + 10 / zoom}
              fill="none"
              strokeDasharray={`${5 / zoom} ${3 / zoom}`}
            />
            {d.tool === "select" && (
              <rect
                data-drawing-resize=""
                className="drawing-resize"
                pointerEvents="all"
                x={b.x + b.width - 5 / zoom}
                y={b.y + b.height - 5 / zoom}
                width={10 / zoom}
                height={10 / zoom}
                fill="white"
              />
            )}
          </g>
        )}
        {d.preview?.tool === "lasso" && (
          <polygon
            pointerEvents="none"
            points={d.preview.points.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="#73569c18"
            stroke="#73569c"
            strokeWidth={1 / zoom}
            strokeDasharray="5 3"
          />
        )}
      </svg>
      {d.label && (
        <div
          className="drawing-label-editor"
          data-drawing-editor=""
          style={{ left: d.label.at.x, top: d.label.at.y }}
          onPointerDown={stop}
          onClick={stop}
        >
          <textarea
            autoFocus
            aria-label="Drawing label text"
            maxLength={MAX_LABEL_LENGTH}
            value={d.label.text}
            onChange={(e) => d.setLabel({ ...d.label!, text: e.target.value })}
            onKeyDown={(e) => {
              stop(e);
              if (e.key === "Escape") d.setLabel(undefined);
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                d.finishLabel();
              }
            }}
            placeholder="Label…"
          />
          <button onClick={d.finishLabel}>Done</button>
          <button onClick={() => d.setLabel(undefined)}>Cancel</button>
        </div>
      )}
    </>
  );
}
