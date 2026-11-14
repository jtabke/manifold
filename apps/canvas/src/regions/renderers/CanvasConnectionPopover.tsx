import { useLayoutEffect, useRef, type ReactNode } from "react";
import type { Point } from "../document";
import { canvasScroll } from "../interaction/canvasViewport";
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
      margin = 12;
    node.style.left = `${Math.max((camera.x + margin) / zoom, Math.min(at.x, (camera.x + canvas.clientWidth - size.width - margin) / zoom))}px`;
    node.style.top = `${Math.max((camera.y + margin) / zoom, Math.min(at.y, (camera.y + canvas.clientHeight - size.height - margin) / zoom))}px`;
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
    return () => {
      frame.cancel();
      observer.disconnect();
      canvas.removeEventListener("scroll", schedule);
    };
  }, [at, zoom, frame]);
  return (
    <div
      ref={ref}
      className="er-link-popover"
      role="dialog"
      aria-label={label}
      style={{ transform: `scale(${1 / zoom})` }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}
