/** Assistant diagram content never supplies rendering policy or external resources. */
export const ASSISTANT_DIAGRAM_LIMITS = Object.freeze({
  characters: 12000,
  lines: 160,
  edges: 100,
});
export const ASSISTANT_DIAGRAM_CSP =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";

export function checkAssistantDiagram(source: string) {
  if (
    source.length > ASSISTANT_DIAGRAM_LIMITS.characters ||
    source.split("\n").length > ASSISTANT_DIAGRAM_LIMITS.lines
  )
    throw Error(
      "This diagram is too large to preview. View or copy its source.",
    );
  if (!source.trim()) throw Error("Waiting for diagram source.");
  if (/^\s*---/.test(source) || /%%\s*\{/.test(source))
    throw Error("Diagram configuration is omitted. View or copy its source.");
  if (
    /<\s*\/?\s*[a-z!]/i.test(source) ||
    /(?:&|#(?:x[\da-f]+|\d+|amp|lt|gt|quot|apos)|%(?:[\da-f]{2}|u[\da-f]{4})|\\(?:u[\da-f]{4}|x[\da-f]{2})|!\[|~)/i.test(
      source,
    ) ||
    /^\s*(?:click|callback|links?)\s+\S/im.test(source) ||
    /(?:@\s*\{|@import|url\s*\(|\b(?:img|image|icon)\s*:)/i.test(source)
  )
    throw Error(
      "Embedded content and diagram links are omitted. View or copy the source.",
    );
}
