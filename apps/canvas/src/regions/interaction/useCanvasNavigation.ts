import { isDialogEvent } from "./modalInput";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";

import { flushSync } from "react-dom";
import {
  attachCanvasViewport,
  canvasScroll,
  scrollCanvasTo,
  scrollCanvasBy,
} from "./canvasViewport";

const editable = "input,textarea,select,[contenteditable=true]";
const clampZoom = (value: number) => Math.min(2, Math.max(0.1, value));

// Camera gestures never write to the document, object positions or Undo history.
export function useCanvasNavigation(
  canvas: RefObject<HTMLDivElement | null>,
  zoom: number,
  setZoom: (zoom: number) => void,
  enabled: boolean,
  fit: () => void,
) {
  const [hand, setHand] = useState(false);
  const [space, setSpace] = useState(false);
  const [panning, setPanning] = useState(false);
  const current = useRef({ zoom, setZoom, fit });
  current.current = { zoom, setZoom, fit };
  const held = useRef(false);
  const spaceConsumed = useRef(false);
  const middleTap = useRef<{ x: number; y: number; time: number } | undefined>(
    undefined,
  );
  const gesture = useRef<
    | {
        pointer: number;
        button: number;
        startX: number;
        startY: number;
        moved: boolean;
        x: number;
        y: number;
        left: number;
        top: number;
      }
    | undefined
  >(undefined);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const ignoreClick = useRef(false);
  const pending = useRef<
    { zoom: number; left: number; top: number } | undefined
  >(undefined);
  useLayoutEffect(() => {
    if (canvas.current) attachCanvasViewport(canvas.current);
  }, [canvas, enabled]);

  useLayoutEffect(() => {
    const next = pending.current;
    if (next && next.zoom === zoom && canvas.current) {
      scrollCanvasTo(canvas.current, { left: next.left, top: next.top });
      pending.current = undefined;
    }
  }, [canvas, zoom]);

  const zoomAt = useCallback(
    (value: number, x?: number, y?: number) => {
      const node = canvas.current;
      if (!node) return;
      const before = pending.current || {
        zoom: current.current.zoom,
        left: canvasScroll(node).x,
        top: canvasScroll(node).y,
      };
      const next = clampZoom(value);
      if (next === before.zoom) return;
      const px = x ?? node.clientWidth / 2,
        py = y ?? node.clientHeight / 2,
        ratio = next / before.zoom;
      pending.current = {
        zoom: next,
        left: (before.left + px) * ratio - px,
        top: (before.top + py) * ratio - py,
      };
      // Commit dimensions before applying the anchored scroll, even during wheel bursts.
      flushSync(() => current.current.setZoom(next));
      if (gesture.current) {
        gesture.current.left = canvasScroll(node).x;
        gesture.current.top = canvasScroll(node).y;
      }
    },
    [canvas],
  );
  const zoomBy = useCallback(
    (delta: number) =>
      zoomAt(
        Math.round(
          ((pending.current?.zoom ?? current.current.zoom) + delta) * 100,
        ) / 100,
      ),
    [zoomAt],
  );
  const end = useCallback(() => {
    const g = gesture.current;
    gesture.current = undefined;
    if (g) middleTap.current = undefined;
    if (g && canvas.current?.hasPointerCapture(g.pointer))
      canvas.current.releasePointerCapture(g.pointer);
    setPanning(false);
  }, [canvas]);

  useEffect(() => {
    const node = canvas.current;
    if (!enabled || !node) return;
    const wheel = (e: WheelEvent) => {
      // Let tables and editors scroll locally. An explicit zoom gesture still
      // targets the canvas, including Chromium trackpad pinch (Ctrl+wheel).
      if (!e.ctrlKey && !e.metaKey) {
        for (
          let child = e.target as HTMLElement | null;
          child && child !== node;
          child = child.parentElement
        ) {
          const css = getComputedStyle(child);
          if (
            (/(auto|scroll)/.test(css.overflowY) &&
              child.scrollHeight > child.clientHeight + 1 &&
              e.deltaY) ||
            (/(auto|scroll)/.test(css.overflowX) &&
              child.scrollWidth > child.clientWidth + 1 &&
              (e.deltaX || e.shiftKey))
          )
            return;
        }
      }
      // Trackpads emit ordinary wheel deltas for two-finger panning and
      // Ctrl+wheel for pinch. Do not infer zoom from vertical movement.
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const rect = node.getBoundingClientRect(),
          unit =
            e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? node.clientHeight : 1,
          delta = Math.max(-240, Math.min(240, e.deltaY * unit));
        zoomAt(
          (pending.current?.zoom ?? current.current.zoom) *
            Math.exp(-delta * 0.01),
          e.clientX - rect.left,
          e.clientY - rect.top,
        );
        return;
      }
      e.preventDefault();
      const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX,
        dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
      scrollCanvasBy(
        node,
        dx *
          (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? node.clientWidth : 1),
        dy *
          (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? node.clientHeight : 1),
      );
      if (gesture.current) {
        gesture.current.left = canvasScroll(node).x;
        gesture.current.top = canvasScroll(node).y;
      }
    };
    const reset = () => {
      held.current = false;
      touches.current.clear();
      middleTap.current = undefined;
      setSpace(false);
      end();
    };
    const keydown = (e: KeyboardEvent) => {
      if (isDialogEvent(e)) return;
      if ((e.target as Element).closest(editable)) return;
      // Shift+Space belongs to the pie menu; unmodified Space still pans.
      if (e.shiftKey && e.code === "Space") return;
      if (e.code === "Space" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!(e.target as Element).closest("button,a,[role=button],summary"))
          e.preventDefault();
        held.current = true;
        setSpace(true);
      }
      if (["+", "=", "-"].includes(e.key) && !e.altKey) {
        e.preventDefault();
        zoomBy(e.key === "-" ? -0.1 : 0.1);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "0") {
        e.preventDefault();
        zoomAt(1);
      }
      if (e.key === "Escape" && (gesture.current || hand)) {
        e.preventDefault();
        e.stopPropagation();
        reset();
        setHand(false);
      }
    };
    const keyup = (e: KeyboardEvent) => {
      if (isDialogEvent(e)) {
        held.current = false;
        spaceConsumed.current = false;
        setSpace(false);
        return;
      }
      if (e.code === "Space") {
        if (spaceConsumed.current) {
          e.preventDefault();
          e.stopPropagation();
          spaceConsumed.current = false;
        }
        held.current = false;
        setSpace(false);
      }
    };
    const visibility = () => {
      if (document.hidden) reset();
    };
    node.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("keydown", keydown, true);
    window.addEventListener("keyup", keyup, true);
    window.addEventListener("blur", reset);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      node.removeEventListener("wheel", wheel);
      window.removeEventListener("keydown", keydown, true);
      window.removeEventListener("keyup", keyup, true);
      window.removeEventListener("blur", reset);
      document.removeEventListener("visibilitychange", visibility);
      reset();
    };
  }, [canvas, enabled, end, hand, zoomAt, zoomBy]);

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    ignoreClick.current = false;
    if (e.button !== 1) middleTap.current = undefined;
    if (!enabled || gesture.current) return false;
    if (e.pointerType === "touch") {
      if (
        (e.target as Element).closest(
          "button,a,input,textarea,select,[contenteditable=true]",
        )
      )
        return false;
      e.preventDefault();
      e.stopPropagation();
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      ignoreClick.current = true;
      setPanning(true);
      e.currentTarget.setPointerCapture(e.pointerId);
      return true;
    }
    if (
      e.button !== 1 &&
      !(
        e.button === 0 &&
        (hand || held.current) &&
        !(e.target as Element).closest(editable)
      )
    )
      return false;
    e.preventDefault();
    e.stopPropagation();
    gesture.current = {
      pointer: e.pointerId,
      button: e.button,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      x: e.clientX,
      y: e.clientY,
      left: canvasScroll(e.currentTarget).x,
      top: canvasScroll(e.currentTarget).y,
    };
    ignoreClick.current = true;
    if (held.current) spaceConsumed.current = true;
    setPanning(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    return true;
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (touches.current.has(e.pointerId)) {
      e.preventDefault();
      e.stopPropagation();
      const before = [...touches.current.values()].slice(0, 2);
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const after = [...touches.current.values()].slice(0, 2);
      const center = (points: { x: number; y: number }[]) => ({
        x: points.reduce((n, p) => n + p.x, 0) / points.length,
        y: points.reduce((n, p) => n + p.y, 0) / points.length,
      });
      const a = center(before),
        b = center(after);
      scrollCanvasBy(e.currentTarget, a.x - b.x, a.y - b.y);
      if (before.length === 2 && after.length === 2) {
        const oldDistance = Math.hypot(
          before[0].x - before[1].x,
          before[0].y - before[1].y,
        );
        const newDistance = Math.hypot(
          after[0].x - after[1].x,
          after[0].y - after[1].y,
        );
        const rect = e.currentTarget.getBoundingClientRect();
        if (oldDistance > 5 && newDistance > 5)
          zoomAt(
            (current.current.zoom * newDistance) / oldDistance,
            b.x - rect.left,
            b.y - rect.top,
          );
      }
      return true;
    }
    const g = gesture.current;
    if (!g || e.pointerId !== g.pointer) return false;
    e.preventDefault();
    e.stopPropagation();
    if (Math.hypot(e.clientX - g.startX, e.clientY - g.startY) > 4)
      g.moved = true;
    const node = e.currentTarget;
    g.left -= e.clientX - g.x;
    g.top -= e.clientY - g.y;
    scrollCanvasTo(node, { left: g.left, top: g.top });
    g.x = e.clientX;
    g.y = e.clientY;
    return true;
  };
  const up = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (touches.current.delete(e.pointerId)) {
      e.preventDefault();
      e.stopPropagation();
      setPanning(touches.current.size > 0);
      return true;
    }
    const g = gesture.current;
    if (!g || e.pointerId !== g.pointer) return false;
    e.preventDefault();
    e.stopPropagation();
    const previous = middleTap.current;
    end();
    if (g.button === 1 && !g.moved && e.type !== "pointercancel") {
      if (
        previous &&
        e.timeStamp - previous.time <= 400 &&
        Math.hypot(e.clientX - previous.x, e.clientY - previous.y) <= 5
      ) {
        current.current.fit();
      } else {
        middleTap.current = { x: e.clientX, y: e.clientY, time: e.timeStamp };
      }
    }
    return true;
  };
  const click = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.button !== 1 && (!ignoreClick.current || e.detail === 0))
      return false;
    ignoreClick.current = false;
    e.preventDefault();
    e.stopPropagation();
    return true;
  };
  return {
    hand,
    setHand,
    zoomBy,
    down,
    move,
    up,
    click,
    end,
    className: panning ? "is-panning" : hand || space ? "is-pan-ready" : "",
  };
}
