import { toCanvas } from "html-to-image";
import { selectionPng } from "./selectionPng";
import { canvasImageStyles } from "./canvasImageStyles";
import { canvasScroll } from "../interaction/canvasViewport";
import type { CanvasImage } from "../assistantCanvas";

/** Read-only raster of this canvas, never the assistant, settings, page chrome or another tab. */
export async function captureAssistantCanvas(
  root: HTMLElement,
  zoom: number,
  documentId: string,
  args: unknown,
): Promise<CanvasImage> {
  if (
    !args ||
    typeof args !== "object" ||
    Array.isArray(args) ||
    Object.keys(args).some((key) => key !== "id")
  )
    throw Error("Expected an optional representation ID");
  const id = (args as { id?: unknown }).id;
  if (id !== undefined && (typeof id !== "string" || !id || id.length > 160))
    throw Error("Expected a bounded representation ID");
  const camera = canvasScroll(root);
  const bounds = root.getBoundingClientRect();
  const transform =
    root.querySelector<HTMLElement>(".er-paper")?.style.transform;
  let source: HTMLCanvasElement;
  if (typeof id === "string") {
    const blob = await selectionPng(
      root,
      { kind: "selection", ids: [id] },
      zoom,
    );
    const bitmap = await createImageBitmap(blob);
    try {
      source = document.createElement("canvas");
      source.width = bitmap.width;
      source.height = bitmap.height;
      source.getContext("2d")!.drawImage(bitmap, 0, 0);
    } finally {
      bitmap.close();
    }
  } else {
    const world = root.querySelector<HTMLElement>(".er-world");
    if (!world) throw Error("Canvas is not visible");
    const width = root.clientWidth,
      height = root.clientHeight;
    if (!width || !height || width * height > 16_000_000)
      throw Error("Canvas viewport is unavailable or too large");
    const ratio = Math.min(1, 1280 / width, 960 / height);
    source = await toCanvas(world, {
      fontEmbedCSS: await canvasImageStyles(world),
      width,
      height,
      pixelRatio: ratio,
      skipAutoScale: true,
      filter: (node) =>
        !(
          node instanceof Element &&
          node.matches(
            "button,input[type=password],textarea,[contenteditable=true],[role=dialog],[role=tooltip],.er-actions,.er-object-actions,.er-selection-tools",
          )
        ),
      style: {
        position: "relative",
        left: "0",
        top: "0",
        width: `${width}px`,
        height: `${height}px`,
        transform: `translate(${-camera.x}px, ${-camera.y}px)`,
      },
    });
  }
  const ratio = Math.min(1, 1280 / source.width, 960 / source.height);
  const output = document.createElement("canvas");
  output.width = Math.max(1, Math.round(source.width * ratio));
  output.height = Math.max(1, Math.round(source.height * ratio));
  const context = output.getContext("2d");
  if (!context) throw Error("Canvas image capture is unavailable");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, output.width, output.height);
  context.drawImage(source, 0, 0, output.width, output.height);
  const data = output.toDataURL("image/jpeg", 0.8).split(",")[1];
  if (!data || data.length > 1_500_000)
    throw Error("Canvas image is too large; request one object instead");
  const after = canvasScroll(root);
  const afterBounds = root.getBoundingClientRect();
  if (
    camera.x !== after.x ||
    camera.y !== after.y ||
    bounds.width !== afterBounds.width ||
    bounds.height !== afterBounds.height ||
    transform !== root.querySelector<HTMLElement>(".er-paper")?.style.transform
  )
    throw Error("Canvas camera changed during capture; look again");
  return {
    mimeType: "image/jpeg",
    data,
    documentId,
    width: output.width,
    height: output.height,
    ...(typeof id === "string" ? { target: id } : {}),
  };
}
