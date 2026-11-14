import { useShortcutMatcher } from "../app/useShortcutPreferences";
import type { ShortcutAction } from "../interaction/shortcutBindings";
import { isCanvasControlEvent } from "../interaction/modalInput";
import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { reference, type Document } from "@manifold/foundation";
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
  Palette,
  WandSparkles,
  Shapes,
  MoreHorizontal,
  Ruler,
  Spline,
} from "lucide-react";
import { curvePath, isCurve, MAX_SPLINE_POINTS } from "../drawingCurves";
import type { RegionSession, Point } from "../document";
import {
  createDrawing,
  drawings,
  editDrawings,
  deleteDrawings,
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
import { CanvasCommandMenu } from "./CanvasCommandMenu";
import { DrawingScaleControls } from "./DrawingScaleControls";
import { defaultDrawingScale, snapDrawingPoint } from "../drawingScale";
import { DrawingAreaGrid, DrawingDimensions } from "./DrawingDimensions";
type Tool = "select" | "lasso" | "eraser" | DrawingKind;
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
  area?: DrawingEntry;
};
const tools = [
  ["select", "Select / Edit", MousePointer2],
  ["pen", "Pen", PenTool],
  ["highlighter", "Highlighter", Highlighter],
  ["eraser", "Eraser", Eraser],
  ["lasso", "Lasso drawings", Lasso],
  ["line", "Line", Minus],
  ["curve", "Curve", Spline],
  ["spline", "Spline", Spline],
  ["arrow", "Arrow", MoveUpRight],
  ["rectangle", "Rectangle", Square],
  ["ellipse", "Ellipse", Circle],
  ["text", "Drawing label", Type],
  ["connector", "Visual connector", Workflow],
  ["area", "Scaled drawing area", Ruler],
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
    ...(prior?.area ? { area: prior.area } : {}),
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
  activate: () => boolean,
  shared: {
    ids: readonly string[];
    select: (ids: string[]) => void;
    move: (delta: Point) => void;
    startMove: (e: DrawingPointer, id: string, ids: string[]) => void;
    duplicate: () => void;
    remove: () => void;
  },
  hand: boolean,
) {
  const matchShortcut = useShortcutMatcher();
  const [tool, setTool] = useState<Tool>("select");
  const [areaId, setAreaId] = useState<string>();
  const surface = useRef<SVGSVGElement>(null);
  const [style, setStyle] = useState({ color: "#c5d3e8", width: 3 });
  const selection = useMemo(() => new Set(shared.ids), [shared.ids]);
  const setSelection = (ids: Set<string>) => shared.select([...ids]);
  const [label, setLabel] = useState<Label>();
  const [focused, setFocused] = useState<string>();
  const gesture = useRef<Gesture | undefined>(undefined),
    frame = useRef<number | undefined>(undefined);
  const [version, redraw] = useReducer((n) => n + 1, 0);
  const pathDraft = useRef<
    { mark: Mark; points: InkPoint[]; expected: Document } | undefined
  >(undefined);
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
  const areaAt = (p: Point, scene = geometry) => {
    const areas = scene.entries
      .filter((e) => e.mark.kind === "area")
      .filter((e) => {
        const b = scene.bounds(e);
        return (
          p.x >= b.x &&
          p.x <= b.x + b.width &&
          p.y >= b.y &&
          p.y <= b.y + b.height
        );
      });
    const preferred =
      selectedStroke?.mark.kind === "area"
        ? selectedStroke.id
        : (selectedStroke?.mark.area?.item ?? areaId);
    return areas.find((e) => e.id === preferred) ?? areas[areas.length - 1];
  };
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
    pathDraft.current = undefined;
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
      (gesture.current && gesture.current.expected !== session.document) ||
      (pathDraft.current && pathDraft.current.expected !== session.document)
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
        const area = !prior && areaAt(label.at);
        if (area) mark.area = reference(session.document.document, area.id);
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
      if (pathDraft.current) return JSON.stringify(pathDraft.current.points);
      return g
        ? JSON.stringify([g.tool, g.points, g.last])
        : label
          ? JSON.stringify([label.at, label.text, label.entry?.id])
          : undefined;
    },
    finish: () => {
      if (!gesture.current && !pathDraft.current) return finishLabel();
      report("Finish or cancel the drawing gesture first.");
      return false;
    },
  });
  const finishPath = () => {
    const draft = pathDraft.current;
    if (!draft) return;
    const required = draft.mark.kind === "curve" ? 3 : 2;
    if (draft.points.length < required) {
      report(`Place at least ${required} points before finishing.`);
      return;
    }
    if (
      safe(() => {
        const id = createDrawing(
          session,
          { ...draft.mark, points: draft.points },
          undefined,
          draft.expected,
        );
        setSelection(new Set([id]));
      })
    )
      cancel();
  };
  const choose = (next: Tool) => {
    if (!finishLabel()) return false;
    cancel();
    setTool(next);
    return true;
  };
  const editLabel = (entry: DrawingEntry) => {
    if (!activate() || !choose("select")) return;
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
  const focusDrawing = (id: string) => {
    setFocused(id);
    if (activate() && choose("select")) setSelection(new Set([id]));
  };
  const drawingKey = (e: ReactKeyboardEvent<SVGGElement>, id: string) => {
    if (e.ctrlKey || e.metaKey || gesture.current || hand) return;
    if (
      (e.altKey && e.key.startsWith("Arrow")) ||
      e.key === "Home" ||
      e.key === "End"
    ) {
      e.preventDefault();
      e.stopPropagation();
      const nodes = [
        ...(surface.current?.querySelectorAll<SVGGElement>(
          "[data-drawing-id]",
        ) || []),
      ];
      const index = nodes.indexOf(e.currentTarget);
      const next =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? nodes.length - 1
            : (index +
                (["ArrowLeft", "ArrowUp"].includes(e.key) ? -1 : 1) +
                nodes.length) %
              nodes.length;
      nodes[next]?.focus();
      return;
    }
    if (e.altKey) return;
    const direction: Record<string, Point> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    };
    const delta = direction[e.key];
    if (!delta && e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    e.stopPropagation();
    if (!activate() || !choose("select")) return;
    const ids = selected.has(id) ? selection : new Set([id]);
    setSelection(ids);
    if (delta) {
      const step = e.shiftKey ? 20 : 5;
      shared.move({ x: delta.x * step, y: delta.y * step });
    }
  };
  const remove = shared.remove;
  const duplicate = shared.duplicate;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (isCanvasControlEvent(e)) return;
      const target = e.target as Element;
      if (target.closest("[data-curve-point]") && e.key.startsWith("Arrow"))
        return;
      if (
        !visible ||
        hand ||
        (tool === "select" && !selected.size && !gesture.current) ||
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
        if (gesture.current || pathDraft.current) cancel();
        else {
          setLabel(undefined);
          setSelection(new Set());
          setTool("select");
        }
      } else if (e.key === "Enter" && pathDraft.current) {
        finishPath();
      } else if (["Delete", "Backspace"].includes(e.key) && pathDraft.current) {
        const draft = pathDraft.current;
        draft.points = draft.points.slice(0, -1);
        if (!draft.points.length) cancel();
        else {
          draft.mark = { ...draft.mark, points: draft.points };
          redraw();
        }
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
    if (!activate() || !finishLabel()) return;
    const expected = session.document,
      scene = drawingGeometry(drawings(expected)),
      target = scene.pick(p, 7 / zoom);
    const area =
      tool === "select"
        ? target?.mark.kind === "area"
          ? target
          : target?.mark.area
            ? scene.byId.get(target.mark.area.item)
            : undefined
        : areaAt(p, scene);
    if (
      area?.mark.scale &&
      ["line", "arrow", "rectangle", "ellipse"].includes(tool)
    )
      p = snapDrawingPoint(p, scene.bounds(area), area.mark.scale);

    if (tool === "text") {
      setLabel({
        at: p,
        text: target?.mark.kind === "text" ? target.mark.text : "",
        entry: target?.mark.kind === "text" ? target : undefined,
        expected,
      });
      return;
    }
    if (isCurve(tool)) {
      e.currentTarget.focus();
      let draft = pathDraft.current;
      if (!draft) {
        draft = {
          expected,
          points: [],
          mark: {
            kind: tool as DrawingKind,
            color: style.color,
            width: style.width,
            text: "",
            start: null,
            end: null,
            points: [],
            ...(area ? { area: reference(expected.document, area.id) } : {}),
          },
        };
        pathDraft.current = draft;
        setSelection(new Set());
      }
      const last = draft.points[draft.points.length - 1];
      if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 0.6 / zoom) {
        if (draft.points.length >= MAX_SPLINE_POINTS) {
          report(
            `Splines support up to ${MAX_SPLINE_POINTS} knots. Press Enter to finish.`,
          );
          return;
        }
        draft.points = [...draft.points, p];
      }
      draft.mark = { ...draft.mark, points: draft.points };
      if (tool === "curve" && draft.points.length === 3) finishPath();
      redraw();
      return;
    }
    const handle = (e.target as Element).closest("[data-curve-point]");
    const controlIndex = handle
      ? Number(handle.getAttribute("data-curve-point"))
      : undefined;
    const controlEntry =
      controlIndex !== undefined ? selectedStroke : undefined;
    const resize = !!(e.target as Element).closest("[data-drawing-resize]"),
      ids = new Set(
        e.shiftKey || (target && selection.has(target.id))
          ? selection
          : selected,
      );
    if (tool === "select" && !resize && !controlEntry) {
      if (!e.shiftKey && (!target || !ids.has(target.id))) ids.clear();
      if (target) {
        if (e.shiftKey && ids.has(target.id)) ids.delete(target.id);
        else ids.add(target.id);
      }
      setSelection(ids);
    }
    if (
      tool === "select" &&
      !resize &&
      target &&
      [...ids].some((id) => !scene.byId.has(id))
    ) {
      shared.startMove(e, target.id, [...ids]);
      return;
    }
    const g: Gesture = {
      pointer: e.pointerId,
      capture: e.currentTarget,
      tool: tool,
      start: p,
      last: p,
      expected,
      geometry: scene,
      points: [p],
      erased: new Set(),
      area,
      transform:
        tool === "select" ? scene.transform(ids, p, resize) : undefined,
    };
    if (tool !== "select" && tool !== "lasso" && tool !== "eraser")
      g.mark = {
        kind: tool,
        ...(tool === "area"
          ? { scale: defaultDrawingScale() }
          : area
            ? { area: reference(expected.document, area.id) }
            : {}),
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
    if (controlEntry && controlIndex !== undefined) {
      g.transform = (end) => [
        {
          entry: controlEntry,
          mark: {
            ...controlEntry.mark,
            points: controlEntry.mark.points.map((point, i) =>
              i === controlIndex
                ? {
                    ...point,
                    x: end.x - controlEntry.view.x,
                    y: end.y - controlEntry.view.y,
                  }
                : point,
            ),
          },
        },
      ];
    }
    gesture.current = g;
    if (tool === "eraser") sample(g, p, zoom, e.shiftKey);
    e.currentTarget.dataset.drawingActive = "true";
    e.currentTarget.setPointerCapture(e.pointerId);
    hold(g, p, zoom);
    redraw();
  };
  const sample = (g: Gesture, p: InkPoint, zoom: number, shift: boolean) => {
    if (
      g.area?.mark.scale &&
      ["line", "arrow", "rectangle", "ellipse", "select"].includes(g.tool)
    )
      p = snapDrawingPoint(
        p,
        g.tool === "select" ? g.start : g.geometry.bounds(g.area),
        g.area.mark.scale,
      );
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
            e.mark.kind !== "area" &&
            !g.erased.has(e.id) &&
            g.geometry.sweptHit(e, g.last, p, 9 / zoom),
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
    const draft = pathDraft.current;
    if (draft && e.type === "pointermove") {
      if (draft.expected !== session.document) return cancel();
      draft.mark = { ...draft.mark, points: [...draft.points, p] };
      redraw();
      return;
    }
    const g = gesture.current;
    if (!g || g.pointer !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    if (g.expected !== session.document) return cancel();
    hold(g, p, zoom, e.type === "pointerup");
    if (!sample(g, p, zoom, e.shiftKey)) return;
    p = g.last;
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
        if (g.mark.kind === "area") {
          setAreaId(id);
          setTool("select");
        }
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
                if (entry.mark.kind === "area")
                  return [
                    { x: b.x, y: b.y },
                    { x: b.x + b.width, y: b.y },
                    { x: b.x + b.width, y: b.y + b.height },
                    { x: b.x, y: b.y + b.height },
                  ].every((p) => inside(p, g.points));
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
    areaId,
    setAreaId,
    select: (ids: string[]) => setSelection(new Set(ids)),
    session,
    report,
    surface,
    choose,
    style,
    setStyle,
    selection: selected,
    entries: visibleEntries,
    preview,
    pathDraft: pathDraft.current?.mark,
    finishPath,
    label,
    setLabel,
    finishLabel,
    down,
    track,
    cancel,
    duplicate,
    remove,
    editLabel,
    focusDrawing,
    drawingKey,
    focused,
    regularize,
    canRegularize: !preview && selectedStroke?.mark.kind === "pen",
    guidance: preview?.transform
      ? "Moving / resizing drawings · Release to place · Escape cancels"
      : preview?.regularized
        ? `${preview.regularized.kind === "ellipse" ? "Circle" : preview.regularized.kind === "line" ? "Line" : "Rectangle"} preview. Release to accept; move to keep drawing.`
        : tool === "curve"
          ? "Click start, control point, then end · Escape cancels · Backspace removes a point"
          : tool === "spline"
            ? "Click knots · Enter or double-click to finish · Backspace removes a knot · Escape cancels"
            : tool === "pen"
              ? "Draw, then hold still to preview a line, circle or rectangle."
              : tool === "select"
                ? "Drag selected objects to move · Double-click to edit · Shift-click adds · Escape clears"
                : tool === "connector"
                  ? "Drag between shapes · visual only"
                  : "Space-drag to pan · Shift constrains shapes · Esc to Select / Edit",
  };
}
type Controller = ReturnType<typeof useDrawingCanvas>;
function DrawingToolbar({
  drawing: d,
  onChooseTool,
  hand,
}: {
  drawing: Controller;
  onChooseTool: () => void;
  hand: boolean;
}) {
  const shapeTools = tools.filter(([tool]) =>
    [
      "line",
      "curve",
      "spline",
      "arrow",
      "rectangle",
      "ellipse",
      "connector",
      "area",
    ].includes(tool),
  );
  const extraTools = tools.filter(([tool]) =>
    ["highlighter", "eraser", "lasso"].includes(tool),
  );
  const activeShape = shapeTools.find(([tool]) => tool === d.tool);
  const activeExtra = extraTools.find(([tool]) => tool === d.tool);
  const ShapeIcon = activeShape?.[2] ?? Shapes;
  const styleVisible =
    !hand && !["select", "lasso", "eraser", "area"].includes(d.tool);
  const guidance = hand
    ? "Pan active · Drag to move the canvas · Escape returns to the previous tool"
    : d.guidance;
  const button = (
    [tool, name, Icon]: (typeof tools)[number],
    label: string = name,
  ) => (
    <button
      key={tool}
      aria-label={name}
      title={
        tool === "text"
          ? "Text label for diagrams · Equations and notes use the default pointer"
          : name
      }
      aria-pressed={!hand && d.tool === tool}
      onClick={() => {
        if (d.choose(tool)) onChooseTool();
      }}
    >
      <Icon size={17} />
      <span>{label}</span>
    </button>
  );
  return (
    <div
      className="drawing-toolbar"
      role="toolbar"
      aria-label="Drawing and diagram tools"
    >
      <div
        className="drawing-primary-tools"
        role="group"
        aria-label="Authoring tools"
      >
        {button(tools[0], "Select")}
        {button(tools[1])}
        <CanvasCommandMenu
          label="Shapes"
          icon={<ShapeIcon size={17} />}
          active={!hand && !!activeShape}
          description={
            activeShape && !hand
              ? `Shapes · ${activeShape[1]} active`
              : "Shapes and visual connectors"
          }
        >
          {shapeTools.map((entry) => button(entry))}
        </CanvasCommandMenu>
        {button(tools.find(([tool]) => tool === "text")!, "Text")}
        <div className="drawing-icon-menu">
          <CanvasCommandMenu
            label="More drawing tools"
            icon={<MoreHorizontal size={17} />}
            active={!hand && !!activeExtra}
            description={
              activeExtra && !hand
                ? `More drawing tools · ${activeExtra[1]} active`
                : "Highlighter, eraser and drawing lasso"
            }
          >
            {extraTools.map((entry) => button(entry))}
          </CanvasCommandMenu>
        </div>
      </div>
      <DrawingScaleControls
        session={d.session}
        entries={d.entries}
        selection={d.selection}
        areaId={d.areaId}
        setAreaId={d.setAreaId}
        select={d.select}
        report={d.report}
        disabled={hand || !!d.preview || !!d.pathDraft}
        drawArea={() => {
          if (d.choose("area")) onChooseTool();
        }}
      />
      {styleVisible && (
        <div className="drawing-icon-menu">
          <CanvasCommandMenu
            label="Drawing style"
            icon={<Palette size={17} />}
            align="right"
            description="Drawing style · Applies to new drawings"
          >
            <label className="drawing-style-color">
              Color
              <input
                aria-label="Stroke color"
                title="Stroke color for new drawings"
                type="color"
                value={d.style.color}
                onChange={(e) =>
                  d.setStyle({ ...d.style, color: e.target.value })
                }
              />
            </label>
            <label className="drawing-width">
              Width
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
          </CanvasCommandMenu>
        </div>
      )}
      <div
        className="drawing-selection-actions"
        role="group"
        aria-label="Drawing selection actions"
        hidden={hand || !d.selection.size}
      >
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
          hidden={!d.canRegularize}
          title="Fit one selected pen stroke to a line, circle or rectangle. Undo restores ink."
          disabled={!d.canRegularize}
          onClick={d.regularize}
        >
          <WandSparkles size={16} />
          <span>Regularize</span>
        </button>
      </div>
      {hand && (
        <span className="drawing-mode-status" aria-hidden="true">
          Pan
        </span>
      )}
      <span
        className="drawing-hint"
        aria-hidden="true"
        hidden={!d.preview && (hand || d.tool === "select")}
      >
        {guidance}
      </span>
      <span
        className="drawing-announcement"
        aria-live="polite"
        aria-atomic="true"
      >
        {!hand && `${tools.find(([tool]) => tool === d.tool)?.[1]} active. `}
        {guidance}{" "}
        {d.selection.size
          ? `${d.selection.size} drawing${d.selection.size === 1 ? "" : "s"} selected.`
          : "No drawings selected."}
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
  if (isCurve(m.kind))
    return <path {...common} d={curvePath(m.kind, points)} />;
  const box = geometry?.bounds ?? pointBounds(points);
  if (m.kind === "area")
    return (
      <rect
        {...common}
        {...box}
        className="drawing-area-border"
        strokeDasharray="8 5"
        pointerEvents="none"
      />
    );
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
const DrawingMark = memo(function DrawingMark({
  entry,
  index,
  selected,
  tabStop,
  dimensioned,
  shape,
  zoom,
  focusDrawing,
  drawingKey,
}: {
  entry: DrawingEntry;
  index: number;
  selected: boolean;
  tabStop: boolean;
  dimensioned: boolean;
  shape?: MarkGeometry;
  zoom: number;
  focusDrawing: Controller["focusDrawing"];
  drawingKey: Controller["drawingKey"];
}) {
  const renders = useRef(0);
  renders.current++;
  // Ink paths and hit geometry do not change when selection or camera position changes.
  const local = isInk(entry.mark.kind);
  const markGeometry = useMemo(
    () =>
      shape ?? {
        points: entry.mark.points,
        bounds: pointBounds(entry.mark.points),
      },
    [shape, entry.mark],
  );
  const hitPoints = useMemo(
    () =>
      ["area", "rectangle", "text", "ellipse"].includes(entry.mark.kind)
        ? undefined
        : markGeometry.points.map((p) => `${p.x},${p.y}`).join(" "),
    [entry.mark.kind, markGeometry.points],
  );
  return (
    <g
      data-drawing-id={entry.id}
      data-drawing-kind={entry.mark.kind}
      data-drawing-renders={renders.current}
      className={`drawing-mark ${selected ? "is-selected" : ""}`}
      tabIndex={tabStop ? 0 : -1}
      role="button"
      aria-label={
        entry.mark.kind === "area"
          ? `${entry.mark.scale!.name} scaled drawing area (${entry.mark.scale!.unit})`
          : `${entry.mark.kind === "text" ? `Label: ${entry.mark.text}` : entry.mark.kind} drawing ${index + 1}`
      }
      aria-pressed={selected}
      aria-describedby={`drawing-keyboard-help${dimensioned ? ` dimension-${entry.id}` : ""}`}
      onFocus={() => focusDrawing(entry.id)}
      onKeyDown={(e) => drawingKey(e, entry.id)}
      transform={
        local ? `translate(${entry.view.x} ${entry.view.y})` : undefined
      }
    >
      <rect
        className="drawing-focus"
        x={markGeometry.bounds.x - 8 / zoom}
        y={markGeometry.bounds.y - 8 / zoom}
        width={markGeometry.bounds.width + 16 / zoom}
        height={markGeometry.bounds.height + 16 / zoom}
        strokeWidth={2 / zoom}
        strokeDasharray={`${3 / zoom} ${3 / zoom}`}
      />
      {entry.mark.kind === "area" ? (
        <rect
          {...markGeometry.bounds}
          fill="none"
          stroke="transparent"
          strokeWidth={14 / zoom}
          pointerEvents="stroke"
        />
      ) : ["rectangle", "text", "ellipse"].includes(entry.mark.kind) ? (
        <rect {...markGeometry.bounds} fill="transparent" />
      ) : (
        <polyline
          className="drawing-hit"
          points={hitPoints}
          fill="none"
          stroke="transparent"
          strokeWidth={entry.mark.width + 14 / zoom}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      <MarkView mark={entry.mark} geometry={local ? undefined : markGeometry} />
    </g>
  );
});
const DrawingMarks = memo(function DrawingMarks({
  entries,
  erased,
  zoom,
  selection,
  focusDrawing,
  drawingKey,
  focused,
}: {
  entries: readonly DrawingEntry[];
  erased?: ReadonlySet<string>;
  zoom: number;
  selection: ReadonlySet<string>;
  focusDrawing: Controller["focusDrawing"];
  drawingKey: Controller["drawingKey"];
  focused: string | undefined;
}) {
  const geometry = drawingGeometry(entries);
  const tabStop = entries.some((e) => e.id === focused)
    ? focused
    : entries[0]?.id;
  return entries
    .filter((e) => !erased?.has(e.id))
    .map((entry, index) => {
      // Only dense ink needs local-path reuse; simple shapes/connectors keep shared world geometry.
      const local = isInk(entry.mark.kind);
      const scale =
        entry.mark.area && geometry.byId.get(entry.mark.area.item)?.mark.scale;
      const dimensioned =
        scale?.dimensions &&
        ["line", "arrow", "rectangle", "ellipse"].includes(entry.mark.kind) &&
        (selection.has(entry.id) ||
          scale.allDimensions ||
          !!entry.mark.dimensionPlacement);
      return (
        <DrawingMark
          key={entry.id}
          entry={entry}
          index={index}
          selected={selection.has(entry.id)}
          tabStop={entry.id === tabStop}
          dimensioned={!!dimensioned}
          shape={local ? undefined : geometry.geometry(entry)}
          zoom={zoom}
          focusDrawing={focusDrawing}
          drawingKey={drawingKey}
        />
      );
    });
});
/** Keep pointer samples and editor buffers out of the application shell's render loop. */
export function DrawingCanvas({
  session,
  buffers,
  report,
  toolbar,
  onChooseTool,
  onShortcut,
  hand,
  visible,
  zoom,
  point,
  activate,
  shared,
  placements,
  hidden,
}: {
  session: RegionSession;
  buffers: EditBuffers;
  report: (message: string) => void;
  toolbar: HTMLElement | null;
  onChooseTool: () => void;
  onShortcut: (action: ShortcutAction) => void;
  hand: boolean;
  visible: boolean;
  zoom: number;
  point: (x: number, y: number) => Point;
  activate: () => boolean;
  shared: Parameters<typeof useDrawingCanvas>[6];
  placements: Record<string, Point>;
  hidden: ReadonlySet<string>;
}) {
  const matchShortcut = useShortcutMatcher();
  const d = useDrawingCanvas(
    session,
    buffers,
    report,
    visible,
    zoom,
    activate,
    shared,
    hand,
  );
  const latest = useRef(d);
  useLayoutEffect(() => {
    latest.current = d;
  });
  const [events] = useState(() => ({
    focusDrawing: (id: string) => latest.current.focusDrawing(id),
    drawingKey: ((event, id) =>
      latest.current.drawingKey(event, id)) as Controller["drawingKey"],
  }));
  const entries = useMemo(() => {
    const geometry = drawingGeometry(d.entries);
    const placed = d.preview?.transform
      ? d.entries
      : previewDrawings(
          d.entries,
          d.entries
            .filter((e) => placements[e.id])
            .map((entry) => {
              const bounds = geometry.bounds(entry),
                at = placements[entry.id];
              return {
                entry,
                at: {
                  x: entry.view.x + at.x - bounds.x,
                  y: entry.view.y + at.y - bounds.y,
                },
              };
            }),
        );
    return placed.some((e) => hidden.has(e.id))
      ? placed.filter((e) => !hidden.has(e.id))
      : placed;
  }, [d.entries, !!d.preview?.transform, placements, hidden]);
  if (!visible) return null;
  const geometry = drawingGeometry(entries),
    b = geometry.selectionBounds(d.selection),
    active = !hand && d.tool !== "select";
  const coordinates = (e: DrawingPointer): InkPoint => ({
    ...point(e.clientX, e.clientY),
    pressure: e.pointerType === "pen" ? Math.max(0.05, e.pressure) : 0.75,
  });
  const draft = d.pathDraft ?? d.preview?.regularized ?? d.preview?.mark,
    stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  return (
    <>
      {toolbar &&
        createPortal(
          <DrawingToolbar
            drawing={d}
            onChooseTool={onChooseTool}
            hand={hand}
          />,
          toolbar,
        )}
      <svg
        ref={d.surface}
        className={`drawing-surface ${active ? "is-drawing" : ""} ${b ? "has-selection" : ""}`}
        data-drawing-surface=""
        tabIndex={-1}
        role="group"
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
          if (hand) return;
          if (d.pathDraft) {
            d.finishPath();
            return;
          }
          const entry = geometry.pick(point(e.clientX, e.clientY), 5 / zoom);
          if (entry?.mark.kind === "text") d.editLabel(entry);
        }}
      >
        {entries
          .filter((e) => e.mark.kind === "area")
          .map((area) => (
            <DrawingAreaGrid
              key={area.id}
              entry={area}
              bounds={geometry.bounds(area)}
              zoom={zoom}
            />
          ))}
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
        <desc id="drawing-keyboard-help">
          Tab enters or leaves drawings. Alt+Arrow browses drawings; Home and
          End focus the first or last. Enter or Space selects. Arrow keys move
          the selection by 5 units; Shift+Arrow moves by 20. Delete removes
          selected objects. Escape cancels the current action or clears
          selection.
        </desc>
        <DrawingMarks
          entries={entries}
          erased={d.preview?.erased}
          zoom={zoom}
          selection={d.selection}
          focusDrawing={events.focusDrawing}
          drawingKey={events.drawingKey}
          focused={d.focused}
        />
        <DrawingDimensions
          entries={entries}
          zoom={zoom}
          session={session}
          buffers={buffers}
          selection={d.selection}
          enabled={!hand && d.tool === "select" && !d.preview}
          point={point}
          select={d.select}
          activate={activate}
          report={report}
          onShortcut={onShortcut}
        />
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
        {b && (
          <g
            className="drawing-selection"
            pointerEvents="none"
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
        {!hand &&
          d.tool === "select" &&
          d.selection.size === 1 &&
          entries
            .filter(
              (entry) => d.selection.has(entry.id) && isCurve(entry.mark.kind),
            )
            .map((entry) => (
              <g key={entry.id} className="drawing-curve-controls">
                <polyline
                  points={geometry
                    .points(entry)
                    .map((p) => `${p.x},${p.y}`)
                    .join(" ")}
                  fill="none"
                  stroke="#8da9ce"
                  strokeWidth={1 / zoom}
                  strokeDasharray={`${4 / zoom} ${4 / zoom}`}
                  pointerEvents="none"
                />
                {geometry.points(entry).map((p, i) => (
                  <circle
                    key={i}
                    data-curve-point={i}
                    data-canvas-controls=""
                    pointerEvents="all"
                    style={{ cursor: "move" }}
                    cx={p.x}
                    cy={p.y}
                    r={5 / zoom}
                    fill="white"
                    stroke="#487bbf"
                    strokeWidth={1.5 / zoom}
                    tabIndex={0}
                    role="button"
                    aria-label={`${entry.mark.kind === "curve" && i === 1 ? "Control point" : "Knot"} ${i + 1}; arrow keys to move`}
                    onKeyDown={(e) => {
                      const action = matchShortcut(e.nativeEvent);
                      if (action) {
                        e.preventDefault();
                        e.stopPropagation();
                        onShortcut(action);
                        return;
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
                        d.surface.current
                          ?.querySelector<SVGGElement>(
                            `[data-drawing-id="${entry.id}"]`,
                          )
                          ?.focus();
                        return;
                      }
                      const delta: Record<string, Point> = {
                        ArrowLeft: { x: -1, y: 0 },
                        ArrowRight: { x: 1, y: 0 },
                        ArrowUp: { x: 0, y: -1 },
                        ArrowDown: { x: 0, y: 1 },
                      };
                      const step = delta[e.key];
                      if (!step) return;
                      e.preventDefault();
                      e.stopPropagation();
                      try {
                        const current = drawings(session.document).find(
                          (drawing) => drawing.id === entry.id,
                        );
                        if (!current) return;
                        editDrawings(session, [
                          {
                            entry: current,
                            mark: {
                              ...current.mark,
                              points: current.mark.points.map((p, index) =>
                                index === i
                                  ? {
                                      ...p,
                                      x: p.x + step.x * (e.shiftKey ? 20 : 5),
                                      y: p.y + step.y * (e.shiftKey ? 20 : 5),
                                    }
                                  : p,
                              ),
                            },
                          },
                        ]);
                      } catch (error) {
                        report((error as Error).message);
                      }
                    }}
                  />
                ))}
              </g>
            ))}
        {d.preview?.tool === "lasso" && (
          <polygon
            className="drawing-lasso"
            pointerEvents="none"
            points={d.preview.points.map((p) => `${p.x},${p.y}`).join(" ")}
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
