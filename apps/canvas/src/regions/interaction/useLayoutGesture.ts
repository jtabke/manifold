import { isDialogEvent } from "./modalInput";
/** Renderer-local input geometry. Only completion may submit an authored operation. */
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { useFrameTask } from "./frameTask";
import type { Point } from "../document";
export type LayoutGeometry = Readonly<{
  at: Readonly<Point>;
  width: number;
  height: number;
}>;
export function useLayoutGesture(options: {
  geometry: LayoutGeometry;
  zoom: number;
  cancelVersion?: number;
  minHeight: number;
  minWidth?: number;
  maxHeight?: number;
  complete: (geometry: LayoutGeometry, resize: boolean) => void;
  cancel?: () => void;
}) {
  const [preview, setPreview] = useState<LayoutGeometry>();
  const latest = useRef(options);
  latest.current = options;
  const gesture = useRef<
    | {
        pointer: number;
        x: number;
        y: number;
        zoom: number;
        resize: boolean;
        start: LayoutGeometry;
        value: LayoutGeometry;
        complete: typeof options.complete;
      }
    | undefined
  >(undefined);
  const previewFrame = useFrameTask<LayoutGeometry>(setPreview);
  const clear = () => {
    previewFrame.cancel();
    // Native pointer-up/unmount releases capture; early release retargets the ensuing click.
    gesture.current = undefined;
    setPreview(undefined);
  };
  const cancel = (event?: Event | PointerEvent) => {
    if (
      !gesture.current ||
      (event &&
        "pointerId" in event &&
        event.pointerId !== gesture.current.pointer)
    )
      return;
    clear();
    latest.current.cancel?.();
  };
  useEffect(clear, [options.cancelVersion]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (isDialogEvent(event)) return;
      if (event.key !== "Escape" || !gesture.current) return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", cancel);
      clear();
    };
  }, []);
  return {
    value: preview ?? options.geometry,
    start(event: PointerEvent, resize = false) {
      if (event.button !== 0 || gesture.current) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      gesture.current = {
        pointer: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        zoom: options.zoom,
        resize,
        start: options.geometry,
        value: options.geometry,
        complete: options.complete,
      };
      setPreview(options.geometry);
    },
    move(event: PointerEvent) {
      const g = gesture.current;
      if (!g || g.pointer !== event.pointerId) return;
      const dx = (event.clientX - g.x) / g.zoom,
        dy = (event.clientY - g.y) / g.zoom;
      g.value = g.resize
        ? {
            ...g.start,
            width: Math.max(
              options.minWidth ?? 320,
              Math.min(1100, g.start.width + dx),
            ),
            height: Math.max(
              options.minHeight,
              Math.min(options.maxHeight ?? 750, g.start.height + dy),
            ),
          }
        : { ...g.start, at: { x: g.start.at.x + dx, y: g.start.at.y + dy } };
      previewFrame.schedule(g.value);
    },
    finish(event: PointerEvent) {
      const g = gesture.current;
      if (!g || g.pointer !== event.pointerId) return;
      clear();
      if (
        g.value.at.x !== g.start.at.x ||
        g.value.at.y !== g.start.at.y ||
        g.value.width !== g.start.width ||
        g.value.height !== g.start.height
      )
        g.complete(g.value, g.resize);
    },
    cancel,
  };
}
