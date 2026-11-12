import { toCanvas } from "html-to-image";
import type { CommandTarget } from "../interaction/commands";

const attributes = [
  "data-region-id",
  "data-plot-id",
  "data-view-id",
  "data-data-relation-id",
  "data-model-id",
  "data-tool-id",
];
const chrome = [
  "button:not(.er-result)",
  ".er-grip",
  ".er-actions",
  ".er-object-actions",
  ".er-region-actions",
  ".er-link-handle",
  ".er-resize-handle",
  ".er-data-result-actions",
  ".er-data-paging",
  ".er-data-link-tools",
  ".er-reference-menu",
  ".er-artifact-controls",
  ".er-artifact-menu",
  ".er-artifact-resize",
  ".er-point-halo",
  ".er-point-selected-mark",
  "[role=tooltip]",
].join(",");
const ratio = 2;
const padding = 16;
const maxPixels = 32_000_000;

/** Visual-only export: never changes the document, camera or live DOM. */
export async function selectionPng(
  root: HTMLElement,
  target: CommandTarget,
  zoom: number,
): Promise<Blob> {
  const ids = target.ids || [target.view || target.owner || target.id];
  const nodes = ids.map((id) => {
    const node =
      id &&
      root.querySelector<HTMLElement>(
        attributes
          .map((attribute) => `[${attribute}="${CSS.escape(id)}"]`)
          .join(","),
      );
    if (!node)
      throw new Error("The selected object is not visible on this canvas.");
    return node;
  });
  await document.fonts.ready;
  const bounds = nodes.map((node) => node.getBoundingClientRect());
  const left = Math.min(...bounds.map((b) => b.left));
  const top = Math.min(...bounds.map((b) => b.top));
  const width = Math.ceil(
    (Math.max(...bounds.map((b) => b.right)) - left) / zoom,
  );
  const height = Math.ceil(
    (Math.max(...bounds.map((b) => b.bottom)) - top) / zoom,
  );
  if (
    !width ||
    !height ||
    width * ratio + padding * 2 > 16384 ||
    height * ratio + padding * 2 > 16384 ||
    (width * ratio + padding * 2) * (height * ratio + padding * 2) > maxPixels
  )
    throw new Error(
      "Selection is too large to export. Select fewer or closer objects.",
    );
  const canvas = document.createElement("canvas");
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context)
    throw new Error("PNG rendering is unavailable in this browser.");
  // Positioned canvas objects paint by z-index, then DOM order.
  const ordered = nodes
    .map((node, index) => ({ node, bounds: bounds[index] }))
    .sort(
      (a, b) =>
        (Number.parseInt(getComputedStyle(a.node).zIndex) || 0) -
          (Number.parseInt(getComputedStyle(b.node).zIndex) || 0) ||
        (a.node === b.node
          ? 0
          : a.node.compareDocumentPosition(b.node) &
              Node.DOCUMENT_POSITION_FOLLOWING
            ? -1
            : 1),
    );
  for (const { node, bounds: b } of ordered) {
    const image = await toCanvas(node, {
      width: Math.ceil(b.width / zoom),
      height: Math.ceil(b.height / zoom),
      pixelRatio: ratio,
      skipAutoScale: true,
      filter: (child) => !(child instanceof Element && child.matches(chrome)),
      style: {
        transform: "none",
        position: "relative",
        left: "0",
        top: "0",
        insetBlock: "0 auto",
        insetInline: "0 auto",
        margin: "0",
        opacity: "1",
        outline: "none",
        boxShadow: "none",
      },
    });
    context.drawImage(
      image,
      Math.round(((b.left - left) / zoom) * ratio),
      Math.round(((b.top - top) / zoom) * ratio),
    );
  }
  // Crop actual painted pixels, not the generous interaction hit boxes.
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let x0 = canvas.width,
    y0 = canvas.height,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (pixels[(y * canvas.width + x) * 4 + 3]) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
  }
  if (x1 < x0)
    throw new Error("The selection has no visible content to export.");
  const output = document.createElement("canvas");
  output.width = x1 - x0 + 1 + padding * 2;
  output.height = y1 - y0 + 1 + padding * 2;
  output
    .getContext("2d")!
    .drawImage(
      canvas,
      x0,
      y0,
      x1 - x0 + 1,
      y1 - y0 + 1,
      padding,
      padding,
      x1 - x0 + 1,
      y1 - y0 + 1,
    );
  return new Promise((resolve, reject) =>
    output.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("PNG encoding failed.")),
      "image/png",
    ),
  );
}

function downloadPng(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "manifold-selection.png";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Start clipboard writing during the user gesture, even while rendering is pending. */
export async function exportSelectionPng(
  root: HTMLElement,
  target: CommandTarget,
  zoom: number,
  copy: boolean,
): Promise<string> {
  const png = selectionPng(root, target, zoom);
  if (
    copy &&
    navigator.clipboard?.write &&
    typeof ClipboardItem !== "undefined"
  ) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": png }),
      ]);
      return "Copied transparent PNG.";
    } catch {
      // Reuse the same image: permissions and browser support must not lose the export.
    }
  }
  downloadPng(await png);
  return copy
    ? "Clipboard unavailable. Saved transparent PNG instead."
    : "Saved transparent PNG.";
}
