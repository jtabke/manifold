/** Note source is plain text. Only aliases with explicit worksheet identity links
 * can render live content; braces do not evaluate expressions or resolve by name. */
export type NoteReference = {
  start: number;
  end: number;
  alias: string;
  id: string;
  mode: "name" | "value" | "status";
};
export function noteReferences(
  text: string,
  links: Readonly<Record<string, string>>,
): NoteReference[] {
  const result: NoteReference[] = [];
  for (const match of text.matchAll(
    /\{\{(\??)([A-Za-z_][A-Za-z_0-9]*)\}\}|(?<![A-Za-z_0-9])([A-Za-z_][A-Za-z_0-9]*)/g,
  )) {
    const alias = match[2] ?? match[3];
    if (Object.hasOwn(links, alias))
      result.push({
        start: match.index,
        end: match.index + match[0].length,
        id: links[alias],
        alias,
        mode: match[2] === undefined ? "name" : match[1] ? "status" : "value",
      });
  }
  return result;
}
export const noteToken = (alias: string, mode: NoteReference["mode"]) =>
  mode === "name" ? alias : `{{${mode === "status" ? "?" : ""}${alias}}}`;
export function freeNoteAlias(
  base: string,
  source: string,
  links: Readonly<Record<string, string>>,
) {
  let name = base,
    n = 2;
  while (Object.hasOwn(links, name) && links[name] !== source)
    name = `${base}_${n++}`;
  return name;
}
