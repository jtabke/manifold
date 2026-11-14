import { useLayoutEffect, useRef, type ReactNode } from "react";
import type { Point } from "../document";
import { canvasScroll, canvasZoom } from "../interaction/canvasViewport";
import { useFrameTask } from "../interaction/frameTask";

/** Clamp an open connection dialog without rerendering the scene while panning. */
export function CanvasConnectionPopover({
  at,
  zoom,
  label,
  children,
}: {
  at: Point;
  zoom: number;
  label: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const place = () => {
    const node = ref.current;
    const canvas = node?.closest<HTMLElement>(".er-canvas");
    if (!node || !canvas) return;
    const camera = canvasScroll(canvas),
      size = node.getBoundingClientRect(),
      margin = 12,
      scale = canvasZoom(canvas, zoom);
    node.style.left = `${Math.max((camera.x + margin) / scale, Math.min(at.x, (camera.x + canvas.clientWidth - size.width - margin) / scale))}px`;
    node.style.top = `${Math.max((camera.y + margin) / scale, Math.min(at.y, (camera.y + canvas.clientHeight - size.height - margin) / scale))}px`;
  };
  const frame = useFrameTask(place);
  useLayoutEffect(() => {
    const node = ref.current,
      canvas = node?.closest<HTMLElement>(".er-canvas");
    if (!node || !canvas) return;
    place();
    const schedule = () => frame.schedule(undefined);
    const observer = new ResizeObserver(schedule);
    observer.observe(node);
    observer.observe(canvas);
    canvas.addEventListener("scroll", schedule);
    canvas.addEventListener("canvaszoom", schedule);
    return () => {
      frame.cancel();
      observer.disconnect();
      canvas.removeEventListener("scroll", schedule);
      canvas.removeEventListener("canvaszoom", schedule);
    };
  }, [at, zoom, frame]);
  return (
    <div
      ref={ref}
      className="er-link-popover"
      role="dialog"
      aria-label={label}
      style={{ transform: `scale(calc(1 / var(--canvas-zoom, ${zoom})))` }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}
