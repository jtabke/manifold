import { getFontEmbedCSS } from "html-to-image";

/** Raster clones render all requested content, including native viewport-cull
 * placeholders. Never alter the live camera, document, or input buffers. */
export async function canvasImageStyles(node: HTMLElement) {
  return `${await getFontEmbedCSS(node)}
[data-canvas-cull] {
  content-visibility: visible !important;
  contain-intrinsic-size: none !important;
}`;
}
