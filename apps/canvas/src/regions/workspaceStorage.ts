/** Each canvas URL keeps its own document and navigation memory. */
export function workspaceStorage(
  key: string,
  search = typeof window === "undefined" ? "" : window.location.search,
): string {
  const canvas = new URLSearchParams(search).get("canvas");
  return canvas && /^[a-f0-9-]{36}$/.test(canvas)
    ? `${key}.canvas-${canvas}`
    : key;
}
