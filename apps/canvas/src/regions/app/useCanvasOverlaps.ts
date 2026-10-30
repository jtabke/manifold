import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { canvasScroll } from "../interaction/canvasViewport";
import { framesAtPoint, nextOverlap, overlapPoint } from "../overlap";
import type { Point } from "../document";
import type { CanvasFrame } from "../selection";

const attributes = [
  "data-region-id",
  "data-tool-id",
  "data-view-id",
  "data-plot-id",
  "data-model-id",
  "data-data-relation-id",
];
export const canvasObjectSelector = attributes.map((a) => `[${a}]`).join(",");
export function canvasObjectId(element: Element) {
  const node = element.closest(canvasObjectSelector);
  return (
    (node &&
      attributes.map((a) => node.getAttribute(a)).find((id) => id !== null)) ||
    undefined
  );
}

/** Personal attention only: never reorder records, write geometry or create history. */
export function useCanvasOverlaps(options: {
  canvas: RefObject<HTMLDivElement | null>;
  zoom: number;
  epoch: string;
  readFrames: () => CanvasFrame[];
  point: (x: number, y: number) => Point;
}) {
  const [ids, setIds] = useState<string[]>([]),
    [picked, setPicked] = useState<string>();
  const origin = useRef<{ point: Point; ids: string[] } | undefined>(undefined),
    focused = useRef<string | undefined>(undefined);
  const element = (id: string) =>
    options.canvas.current?.querySelector<HTMLElement>(
      attributes.map((a) => `[${a}="${CSS.escape(id)}"]`).join(","),
    );
  const clear = () => {
    origin.current = undefined;
    setIds((previous) => (previous.length ? [] : previous));
    setPicked(undefined);
  };
  useLayoutEffect(clear, [options.epoch]);
  useLayoutEffect(() => {
    const node = picked ? element(picked) : undefined;
    if (!node || !node.getClientRects().length) {
      focused.current = undefined;
      return;
    }
    const marked: Element[] = [];
    for (
      let current: Element | null = node;
      current && current !== options.canvas.current;
      current = current.parentElement
    )
      if (current.matches(canvasObjectSelector)) {
        current.setAttribute("data-overlap-picked", "");
        marked.push(current);
      }
    if (focused.current !== picked) {
      focused.current = picked;
      node
        .querySelector<HTMLButtonElement>('button[aria-label^="Move "]')
        ?.focus({ preventScroll: true });
    }
    return () => {
      for (const item of marked) item.removeAttribute("data-overlap-picked");
    };
  });
  const clientPoint = (point: Point) => {
    const canvas = options.canvas.current!,
      rect = canvas.getBoundingClientRect(),
      scroll = canvasScroll(canvas);
    return {
      x: rect.left + point.x * options.zoom - scroll.x,
      y: rect.top + point.y * options.zoom - scroll.y,
    };
  };
  return {
    ids,
    picked,
    clear,
    keyboardPoint(id: string) {
      const frames = options.readFrames(),
        frame = frames.find((f) => f.id === id);
      if (!frame) return;
      if (
        origin.current?.ids.includes(id) &&
        framesAtPoint(frames, origin.current.point).some((f) => f.id === id)
      )
        return clientPoint(origin.current.point);
      return clientPoint(overlapPoint(frame, frames));
    },
    capture(x: number, y: number) {
      const point = options.point(x, y),
        hits = framesAtPoint(options.readFrames(), point),
        painted = [
          ...new Set(
            document
              .elementsFromPoint(x, y)
              .filter((node) => options.canvas.current?.contains(node))
              .map(canvasObjectId)
              .filter((id): id is string => !!id),
          ),
        ];
      const found = hits
        .map((f) => f.id)
        .sort((a, b) => {
          const ai = painted.indexOf(a),
            bi = painted.indexOf(b);
          return (ai < 0 ? Infinity : ai) - (bi < 0 ? Infinity : bi);
        });
      const previous = origin.current;
      const ordered =
        previous &&
        Math.hypot(point.x - previous.point.x, point.y - previous.point.y) *
          options.zoom <
          3 &&
        previous.ids.length === found.length &&
        previous.ids.every((id) => found.includes(id))
          ? previous.ids
          : found;
      origin.current = { point, ids: ordered };
      setIds(ordered);
    },
    underneath: () => nextOverlap(origin.current?.ids || [], picked),
    select(id: string) {
      const node = element(id),
        at = origin.current?.point;
      if (
        !node ||
        !at ||
        !framesAtPoint(options.readFrames(), at).some((f) => f.id === id)
      )
        return;
      setPicked(id);
      return node;
    },
  };
}
