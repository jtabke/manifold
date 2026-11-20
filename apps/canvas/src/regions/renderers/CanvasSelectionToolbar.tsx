import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { touches, type CanvasRect } from "../selection";
import { canvasScroll, canvasZoom } from "../interaction/canvasViewport";

/** Float in unused space near the selection; in a crowded viewport reserve a shelf outside the paper. */
export function CanvasSelectionToolbar({
  bounds,
  obstacles,
  canvas,
  zoom,
  children,
  onEscape,
}: {
  bounds: CanvasRect;
  obstacles: readonly CanvasRect[];
  canvas: RefObject<HTMLDivElement | null>;
  zoom: number;
  children: ReactNode;
  onEscape: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const toolbar = ref.current,
      view = canvas.current,
      host = toolbar?.parentElement;
    if (!toolbar || !view || !host) return;
    const place = () => {
      const scale = canvasZoom(view, zoom),
        scroll = canvasScroll(view);
      const margin = 8,
        gap = 12,
        width = toolbar.offsetWidth,
        height = toolbar.offsetHeight;
      // Measure the whole host, not the shortened viewport when the shelf is docked.
      const right = host.clientWidth - width - margin,
        bottom = host.clientHeight - height - margin;
      const sx = bounds.x * scale - scroll.x,
        sy = bounds.y * scale - scroll.y;
      const x = Math.max(margin, Math.min(right, sx));
      const candidates = [
        { x, y: sy - height - gap },
        { x, y: sy + bounds.height * scale + gap },
        { x: sx + bounds.width * scale + gap, y: sy },
        { x: sx - width - gap, y: sy },
      ];
      const free = candidates.find(({ x, y }) => {
        if (x < margin || x > right || y < margin || y > bottom) return false;
        const world = {
          x: (x + scroll.x - 3) / scale,
          y: (y + scroll.y - 3) / scale,
          width: (width + 6) / scale,
          height: (height + 6) / scale,
        };
        return (
          !touches(world, bounds) &&
          !obstacles.some((frame) => touches(world, frame))
        );
      });
      toolbar.toggleAttribute("data-docked", !free);
      toolbar.style.left = free ? `${free.x}px` : "";
      toolbar.style.top = free ? `${free.y}px` : "";
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(toolbar);
    observer.observe(host);
    view.addEventListener("scroll", place);
    view.addEventListener("canvaszoom", place);
    return () => {
      observer.disconnect();
      view.removeEventListener("scroll", place);
      view.removeEventListener("canvaszoom", place);
    };
  }, [bounds, obstacles, canvas, zoom]);
  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label="Canvas selection"
      className="er-selection-tools"
      data-canvas-controls=""
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        const more =
          event.currentTarget.querySelector<HTMLDetailsElement>(
            "details[open]",
          );
        if (more) {
          more.open = false;
          more.querySelector("summary")?.focus();
        } else {
          onEscape();
          canvas.current?.focus({ preventScroll: true });
        }
      }}
    >
      {children}
    </div>
  );
}
