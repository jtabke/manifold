/** Signed camera coordinates over a bounded, recentering browser scroll surface.
 * The floating DOM origin is presentation only; authored positions never move.
 */
export const SCROLL_SURFACE = 65536;
const CENTER = SCROLL_SURFACE / 2;
const origins = new WeakMap<HTMLElement, { x: number; y: number }>();
export function canvasOrigin(node: HTMLElement | null) {
  return (node && origins.get(node)) || { x: 0, y: 0 };
}
export function canvasScroll(node: HTMLElement | null) {
  const origin = canvasOrigin(node);
  return {
    x: (node?.scrollLeft || 0) - origin.x,
    y: (node?.scrollTop || 0) - origin.y,
  };
}
function applyOrigin(node: HTMLElement, origin: { x: number; y: number }) {
  origins.set(node, origin);
  node.dataset.canvasOriginX = String(origin.x);
  node.dataset.canvasOriginY = String(origin.y);
  const world = node.querySelector<HTMLElement>(".er-world");
  if (world) world.style.transform = `translate(${origin.x}px, ${origin.y}px)`;
}
export function attachCanvasViewport(node: HTMLElement) {
  if (origins.has(node)) return;
  const before = canvasScroll(node);
  applyOrigin(node, { x: CENTER, y: CENTER });
  node.scrollTo(CENTER + before.x, CENTER + before.y);
}
export function scrollCanvasTo(
  node: HTMLElement | null,
  options: ScrollToOptions,
) {
  if (!node) return;
  const before = canvasScroll(node),
    origin = canvasOrigin(node);
  const x = options.left ?? before.x,
    y = options.top ?? before.y;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  if (!origins.has(node)) {
    node.scrollTo(options);
    return;
  }
  const outside = (v: number, size: number) =>
    v < CENTER / 2 || v + size > SCROLL_SURFACE - CENTER / 2;
  const next = {
    x: outside(x + origin.x, node.clientWidth) ? CENTER - x : origin.x,
    y: outside(y + origin.y, node.clientHeight) ? CENTER - y : origin.y,
  };
  if (next.x !== origin.x || next.y !== origin.y) {
    applyOrigin(node, next);
    // Compensate the browser camera before scrolling to the requested world
    // position. Recentring cannot interpolate through an unrelated DOM origin.
    node.scrollTo({ left: x + next.x, top: y + next.y, behavior: "instant" });
  } else node.scrollTo({ ...options, left: x + next.x, top: y + next.y });
}
/** Native scrolling and scrollIntoView also pass through this compensation. */
export function recenterCanvas(node: HTMLElement) {
  const camera = canvasScroll(node);
  if (
    node.scrollLeft < CENTER / 2 ||
    node.scrollTop < CENTER / 2 ||
    node.scrollLeft + node.clientWidth > SCROLL_SURFACE - CENTER / 2 ||
    node.scrollTop + node.clientHeight > SCROLL_SURFACE - CENTER / 2
  )
    scrollCanvasTo(node, {
      left: camera.x,
      top: camera.y,
      behavior: "instant",
    });
  return camera;
}
export function scrollCanvasBy(node: HTMLElement, x: number, y: number) {
  const before = canvasScroll(node);
  scrollCanvasTo(node, { left: before.x + x, top: before.y + y });
}
/** Follow a reference even when its world position is outside the current DOM window. */
export function revealCanvasElement(
  target: Element | null | undefined,
  options: ScrollIntoViewOptions = {},
) {
  if (!target) return;
  const root = target.closest<HTMLElement>(".er-canvas");
  if (!root) {
    target.scrollIntoView(options);
    return;
  }
  // First reveal a table row or other nested scroll content locally. The outer
  // canvas is then placed through its signed camera, including distant objects.
  target.scrollIntoView({ ...options, behavior: "instant" });
  const camera = canvasScroll(root),
    r = root.getBoundingClientRect(),
    t = target.getBoundingClientRect();
  const align = (
    start: number,
    end: number,
    size: number,
    mode: ScrollLogicalPosition | undefined,
  ) =>
    mode === "center"
      ? (start + end - size) / 2
      : mode === "end"
        ? end - size
        : mode === "start"
          ? start
          : start < 0
            ? start
            : end > size
              ? end - size
              : 0;
  scrollCanvasTo(root, {
    left:
      camera.x +
      align(
        t.left - r.left,
        t.right - r.left,
        root.clientWidth,
        options.inline,
      ),
    top:
      camera.y +
      align(t.top - r.top, t.bottom - r.top, root.clientHeight, options.block),
    behavior: options.behavior,
  });
}
