/** Read-only links issued by canvas inspections, never name-based lookups or edit commands. */
export type AssistantObjectReference = Readonly<{
  id: string;
  input?: string;
  label: string;
  href: string;
}>;

export const ASSISTANT_OBJECT_LINK = "manifold:object/";

export function assistantObjectReference(
  id: string,
  label: string,
  input?: string,
): AssistantObjectReference {
  return Object.freeze({
    id,
    ...(input === undefined ? {} : { input }),
    label,
    href: `${ASSISTANT_OBJECT_LINK}${encodeURIComponent(id)}${input === undefined ? "" : `?input=${encodeURIComponent(input)}`}`,
  });
}
