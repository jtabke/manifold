type RasterOptions = NonNullable<
  Parameters<typeof import("html-to-image").toCanvas>[1]
>;

/** Only load the rasterizer for an explicit capture. Its clone must include culled
 * content without changing the live camera, document or editing buffers. */
export async function renderCanvasImage(
  node: HTMLElement,
  options: RasterOptions,
) {
  const { getFontEmbedCSS, toCanvas } = await import("html-to-image");
  const fontEmbedCSS = `${await getFontEmbedCSS(node)}
[data-canvas-cull] {
  content-visibility: visible !important;
  contain-intrinsic-size: none !important;
}`;
  return toCanvas(node, { ...options, fontEmbedCSS });
}
