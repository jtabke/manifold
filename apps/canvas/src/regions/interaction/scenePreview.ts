import type { RefObject } from "react";
import type { Point } from "../document";
import type { CanvasGroup } from "../canvasScene";
import type { AlignmentGuide } from "../alignment";
import { frameBounds, type CanvasFrame } from "../selection";

const attributes = [
  "data-region-id",
  "data-plot-id",
  "data-view-id",
  "data-tool-id",
  "data-data-relation-id",
  "data-model-id",
  "data-drawing-id",
  "data-selection-object",
];
type Target = HTMLElement | SVGElement;

/** Gesture-only presentation. Authored geometry remains in the session, and
 * completion still validates fresh bounds before publishing one atomic edit. */
export function createScenePreview(
  root: HTMLElement,
  frames: CanvasFrame[],
  groups: readonly CanvasGroup[],
  compact: (group: CanvasGroup) => boolean,
  guideLayer: RefObject<HTMLDivElement | null>,
  zoom: number,
) {
  const byId = new Map(frames.map((frame) => [frame.id, frame]));
  const targets = new Map<string, Target[]>();
  const translated = new Map<Target, string>();
  const resized = new Set<HTMLElement>();
  const groupNodes = new Map<string, HTMLElement>();
  let positions: Record<string, Point> = {};
  let drawingActive = false;
  const drawings = root.querySelector<SVGSVGElement>(".drawing-surface");
  const translate = (node: Target, x: number, y: number) => {
    if (!translated.has(node)) translated.set(node, node.style.translate);
    node.style.translate = `${x}px ${y}px`;
  };
  const draw = () => {
    for (const [id, at] of Object.entries(positions)) {
      const before = byId.get(id);
      if (!before || before.kind === "drawing") continue;
      for (const node of targets.get(id) || [])
        translate(node, at.x - before.x, at.y - before.y);
    }
    for (const group of groups) {
      if (!group.members.some((id) => positions[id])) continue;
      const node = groupNodes.get(group.id);
      if (!node) continue;
      const members = group.members.flatMap((id) => {
        const frame = byId.get(id);
        return frame ? [frame] : [];
      });
      const before = frameBounds(members);
      const after = frameBounds(
        members.map((frame) => ({ ...frame, ...positions[frame.id] })),
      );
      if (!before || !after) continue;
      translate(
        node,
        after.x - before.x,
        Math.max(4, after.y - 40) - Math.max(4, before.y - 40),
      );
      if (!compact(group)) {
        resized.add(node);
        node.style.setProperty("--gesture-width", `${after.width + 24}px`);
        node.style.setProperty("--gesture-height", `${after.height + 52}px`);
      }
    }
  };
  const refresh = () => {
    targets.clear();
    for (const node of root.querySelectorAll<Target>(
      attributes.map((attribute) => `[${attribute}]`).join(","),
    )) {
      const id = attributes
        .map((attribute) => node.getAttribute(attribute))
        .find((id) => id !== null);
      if (id) targets.set(id, [...(targets.get(id) || []), node]);
    }
    groupNodes.clear();
    for (const node of root.querySelectorAll<HTMLElement>("[data-group-id]"))
      groupNodes.set(node.dataset.groupId!, node);
    draw();
  };
  refresh();
  return {
    refresh,
    show(next: Record<string, Point>, guides: AlignmentGuide[]) {
      // A peer may leave the preview when a group/gesture is cancelled or changes.
      for (const [node, original] of translated)
        node.style.translate = original;
      for (const node of resized) {
        node.style.removeProperty("--gesture-width");
        node.style.removeProperty("--gesture-height");
      }
      positions = next;
      draw();
      const drawingPositions = Object.fromEntries(
        Object.entries(next).filter(([id]) => byId.get(id)?.kind === "drawing"),
      );
      if (drawingActive || Object.keys(drawingPositions).length) {
        drawingActive = Object.keys(drawingPositions).length > 0;
        drawings?.dispatchEvent(
          new CustomEvent("canvasscenepreview", { detail: drawingPositions }),
        );
      }
      const layer = guideLayer.current;
      if (!layer) return;
      for (const node of [...layer.children]) {
        if (
          !guides.some(
            (guide) =>
              guide.axis === (node as HTMLElement).dataset.alignmentAxis,
          )
        )
          node.remove();
      }
      for (const guide of guides) {
        let node = layer.querySelector<HTMLDivElement>(
          `[data-alignment-axis="${guide.axis}"]`,
        );
        if (!node) {
          node = document.createElement("div");
          node.className = "er-alignment-guide";
          node.dataset.alignmentAxis = guide.axis;
          layer.append(node);
        }
        Object.assign(
          node.style,
          guide.axis === "x"
            ? {
                left: `${guide.at}px`,
                top: `${guide.from}px`,
                height: `${guide.to - guide.from}px`,
                borderLeftWidth: `${1 / zoom}px`,
              }
            : {
                top: `${guide.at}px`,
                left: `${guide.from}px`,
                width: `${guide.to - guide.from}px`,
                borderTopWidth: `${1 / zoom}px`,
              },
        );
      }
    },
    clear() {
      for (const [node, original] of translated)
        node.style.translate = original;
      for (const node of resized) {
        node.style.removeProperty("--gesture-width");
        node.style.removeProperty("--gesture-height");
      }
      guideLayer.current?.replaceChildren();
      if (drawingActive)
        drawings?.dispatchEvent(
          new CustomEvent("canvasscenepreview", { detail: {} }),
        );
      drawingActive = false;
      translated.clear();
      resized.clear();
      positions = {};
    },
  };
}
