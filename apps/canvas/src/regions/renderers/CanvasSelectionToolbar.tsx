import { useLayoutEffect, useRef, type ReactNode } from "react";
import type { CanvasRect } from "../selection";

/** Keep selection actions outside the selected content whenever viewport space permits. */
export function CanvasSelectionToolbar({
  bounds,
  zoom,
  children,
}: {
  bounds: CanvasRect;
  zoom: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const toolbar = ref.current;
    const paper = toolbar?.closest<HTMLElement>(".er-paper");
    const canvas = toolbar?.closest<HTMLElement>(".er-canvas");
    if (!toolbar || !paper || !canvas) return;
    const place = () => {
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
        x: origin.left + bounds.x * zoom,
        y: origin.top + bounds.y * zoom,
        width: bounds.width * zoom,
        height: bounds.height * zoom,
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
      toolbar.style.left = `${(x - origin.left) / zoom}px`;
      toolbar.style.top = `${(y - origin.top) / zoom}px`;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(toolbar);
    observer.observe(canvas);
    canvas.addEventListener("scroll", place);
    return () => {
      observer.disconnect();
      canvas.removeEventListener("scroll", place);
    };
  }, [bounds, zoom]);
  return (
    <div
      ref={ref}
      className="er-selection-tools"
      role="toolbar"
      aria-label="Canvas selection"
      style={{
        transform: `scale(${1 / zoom})`,
        flexWrap: "wrap",
        boxSizing: "border-box",
      }}
    >
      {children}
    </div>
  );
}
