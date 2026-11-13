/** Transport and diagnostics share the same loopback-only boundary. */
export function localCanvasUrl(value) {
  const page = new URL(value);
  if (
    page.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(page.hostname) ||
    page.username ||
    page.password
  )
    throw Error("Canvas URL must be a local HTTP URL");
  return page;
}
