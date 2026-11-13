export const UNTITLED_DOCUMENT = "Untitled document";

export function documentTitle(value: string): string {
  return (
    value
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim()
      .slice(0, 160) || UNTITLED_DOCUMENT
  );
}

export function titleFromFilename(name: string): string {
  return documentTitle(name.replace(/\.(manifold|json)$/i, ""));
}

export function documentFilename(title?: string): string {
  const name =
    title && title !== UNTITLED_DOCUMENT
      ? title
          .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "-")
          .replace(/^\.+|[. ]+$/g, "")
          .trim()
      : "";
  return `${name || "manifold-workspace"}.manifold`;
}
