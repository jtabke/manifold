import { useLayoutEffect, useRef, type ReactNode } from "react";
import type { CanvasRect } from "../selection";
import { canvasZoom } from "../interaction/canvasViewport";

/** Keep selection actions outside the selected content whenever viewport space permits. */
export function CanvasSelectionToolbar({
  bounds,
  zoom,
  children,
  onEscape,
}: {
  bounds: CanvasRect;
  zoom: number;
  children: ReactNode;
  onEscape: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const toolbar = ref.current;
    const paper = toolbar?.closest<HTMLElement>(".er-paper");
    const canvas = toolbar?.closest<HTMLElement>(".er-canvas");
    if (!toolbar || !paper || !canvas) return;
    const place = () => {
      const scale = canvasZoom(canvas, zoom);
      const viewport = canvas.getBoundingClientRect();
      const origin = paper.getBoundingClientRect();
      const margin = 12,
        gap = 8;
      toolbar.style.maxWidth = `${Math.max(1, canvas.clientWidth - 2 * margin)}px`;
      const size = toolbar.getBoundingClientRect();
      const left = viewport.left + margin,
        top = viewport.top + margin,
        right = viewport.left + canvas.clientWidth - margin,
        bottom = viewport.top + canvas.clientHeight - margin;
      const selection = {
        x: origin.left + bounds.x * scale,
        y: origin.top + bounds.y * scale,
        width: bounds.width * scale,
        height: bounds.height * scale,
      };
      let x = selection.x,
        y = selection.y - size.height - gap;
      if (y < top) {
        const below = selection.y + selection.height + gap;
        if (below + size.height <= bottom) y = below;
        else if (selection.x + selection.width + gap + size.width <= right) {
          x = selection.x + selection.width + gap;
          y = selection.y;
        } else if (selection.x - gap - size.width >= left) {
          x = selection.x - gap - size.width;
          y = selection.y;
        }
      }
      x = Math.max(left, Math.min(x, right - size.width));
      y = Math.max(top, Math.min(y, bottom - size.height));
      toolbar.style.left = `${(x - origin.left) / scale}px`;
      toolbar.style.top = `${(y - origin.top) / scale}px`;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(toolbar);
    observer.observe(canvas);
    canvas.addEventListener("scroll", place);
    canvas.addEventListener("canvaszoom", place);
    return () => {
      observer.disconnect();
      canvas.removeEventListener("scroll", place);
      canvas.removeEventListener("canvaszoom", place);
    };
  }, [bounds, zoom]);
  return (
    <div
      ref={ref}
      className="er-selection-tools"
      data-canvas-controls=""
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        const details =
          ref.current?.querySelector<HTMLDetailsElement>("details[open]");
        if (details) {
          details.open = false;
          details.querySelector("summary")?.focus();
        } else {
          onEscape();
          ref.current
            ?.closest<HTMLElement>(".er-canvas")
            ?.focus({ preventScroll: true });
        }
      }}
      role="toolbar"
      aria-label="Canvas selection"
      style={{
        transform: `scale(calc(1 / var(--canvas-zoom, ${zoom})))`,
        flexWrap: "wrap",
        boxSizing: "border-box",
      }}
    >
      {children}
    </div>
  );
}
