import { canvasScroll, canvasZoom } from "../interaction/canvasViewport";
import type { CanvasFrame } from "../selection";
import { canvasObjectId, canvasObjectSelector } from "./useCanvasOverlaps";

/** Drawings already have exact geometry; only worksheet/HTML objects need DOM sizes. */
export function measureCanvasObjects(
  node: HTMLElement,
  zoom: number,
  targets: Iterable<HTMLElement>,
  regionHeight?: (id: string, height: number) => void,
) {
  const origin = node.getBoundingClientRect(),
    scroll = canvasScroll(node),
    scale = canvasZoom(node, zoom);
  const frames: CanvasFrame[] = [];
  for (const el of targets) {
    if (!el.getClientRects().length) continue;
    const rect = el.getBoundingClientRect(),
      region = el.dataset.regionId;
    let right = rect.right,
      bottom = rect.bottom;
    if (region) {
      if (rect.height > 0 && !el.matches(".is-editing"))
        regionHeight?.(region, rect.height / scale);
      const parts = [
        ...el.querySelectorAll(
          "math,.er-result,.er-condition,.er-region-error,textarea,.er-data,.er-external-reference,.er-source-caption,.er-record-feedback",
        ),
      ].map((part) => part.getBoundingClientRect());
      const note = el.querySelector(".er-note");
      if (note) {
        const range = document.createRange();
        range.selectNodeContents(note);
        parts.push(range.getBoundingClientRect());
      }
      if (parts.length) {
        right = Math.max(...parts.map((r) => r.right));
        bottom = Math.max(rect.top + 50 * scale, ...parts.map((r) => r.bottom));
      }
    }
    frames.push({
      id: canvasObjectId(el)!,
      kind: region ? "region" : "plot",
      x: (rect.left - origin.left + scroll.x) / scale,
      y: (rect.top - origin.top + scroll.y) / scale,
      width: Math.max(30, (right - rect.left) / scale),
      height: Math.max(30, (bottom - rect.top) / scale),
    });
  }
  return frames;
}

/** Keep observers with the mounted HTML nodes, not with a document revision.
 * Inner math/notes may reflow inside a fixed-width region without resizing its
 * outer box; measure the changed host as well as native resize notifications. */
export function observeCanvasObjects(
  canvas: HTMLElement,
  measure: (elements: Iterable<HTMLElement>) => void,
) {
  const targets = new Set<HTMLElement>();
  let cull = false;
  const visibility = new IntersectionObserver(
    (entries) => {
      for (const { target, isIntersecting } of entries) {
        const element = target as HTMLElement;
        if (!targets.has(element)) continue;
        if (!cull || isIntersecting) delete element.dataset.canvasOffscreen;
        else element.dataset.canvasOffscreen = "";
      }
    },
    { root: canvas, rootMargin: "800px" },
  );
  const resize = new ResizeObserver((entries) => {
    const live = entries.filter((entry) =>
      targets.has(entry.target as HTMLElement),
    );
    measure(
      live
        .map(({ target }) => target as HTMLElement)
        .filter((target) => !target.matches(".is-editing")),
    );
    if (cull)
      for (const {
        target,
        contentRect: { width, height },
      } of live) {
        if (width <= 0 || height <= 0) continue;
        const element = target as HTMLElement;
        element.style.setProperty("--canvas-object-width", `${width}px`);
        element.style.setProperty("--canvas-object-height", `${height}px`);
        element.dataset.canvasCull = "";
      }
  });
  const enroll = (target: HTMLElement) => {
    if (targets.has(target)) return;
    targets.add(target);
    resize.observe(target);
    if (cull) visibility.observe(target);
  };
  const threshold = () => {
    const shouldCull = targets.size >= 64;
    if (cull === shouldCull) return;
    cull = shouldCull;
    for (const target of targets) {
      if (cull) {
        visibility.observe(target);
        resize.unobserve(target);
        resize.observe(target); // obtain current intrinsic sizes on crossing the threshold
      } else {
        visibility.unobserve(target);
        delete target.dataset.canvasCull;
        delete target.dataset.canvasOffscreen;
      }
    }
  };
  const refresh = (nodes: Iterable<HTMLElement>) => {
    const dirty = [...nodes].filter(
      (el) => targets.has(el) && !el.matches(".is-editing"),
    );
    if (!dirty.length) return;
    const skipped = dirty.filter((el) => el.dataset.canvasCull !== undefined);
    for (const el of skipped) delete el.dataset.canvasCull;
    measure(dirty);
    for (const el of skipped) el.dataset.canvasCull = "";
  };
  const visit = (node: Node, act: (target: HTMLElement) => void) => {
    if (!(node instanceof HTMLElement)) return;
    if (node.matches(canvasObjectSelector)) act(node);
    for (const target of node.querySelectorAll<HTMLElement>(
      canvasObjectSelector,
    ))
      act(target);
  };
  const changes = new MutationObserver((records) => {
    const dirty = new Set<HTMLElement>();
    for (const record of records) {
      const el =
        record.target instanceof Element
          ? record.target
          : record.target.parentElement;
      const object = el?.closest<HTMLElement>(canvasObjectSelector);
      if (object) dirty.add(object);
      for (const removed of record.removedNodes)
        visit(removed, (target) => {
          if (canvas.contains(target) || !targets.delete(target)) return;
          resize.unobserve(target);
          visibility.unobserve(target);
          delete target.dataset.canvasCull;
          delete target.dataset.canvasOffscreen;
        });
      for (const added of record.addedNodes)
        visit(added, (target) => {
          if (!canvas.contains(target)) return;
          enroll(target);
          dirty.add(target);
        });
    }
    threshold();
    refresh(dirty);
  });
  for (const target of canvas.querySelectorAll<HTMLElement>(
    canvasObjectSelector,
  ))
    enroll(target);
  threshold();
  changes.observe(canvas, {
    childList: true,
    characterData: true,
    subtree: true,
  });
  return {
    refresh: () => refresh(targets),
    disconnect: () => {
      changes.disconnect();
      resize.disconnect();
      visibility.disconnect();
      for (const target of targets) {
        delete target.dataset.canvasCull;
        delete target.dataset.canvasOffscreen;
      }
    },
  };
}
