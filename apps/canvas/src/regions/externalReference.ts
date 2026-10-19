/** A reviewed reference, not an imported model or computational binding. */
export type ExternalReference = { url: string; revision?: string };
export function validateExternalReference(value: ExternalReference) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof value.url !== "string" ||
    value.url.length > 2048 ||
    (value.revision !== undefined &&
      (typeof value.revision !== "string" || value.revision.length > 160))
  )
    throw Error("Use a web address and a revision of at most 160 characters.");
  let url: URL;
  try {
    url = new URL(value.url);
  } catch {
    throw Error("Use a full http or https source address.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw Error("Use an http or https source address without credentials.");
}
