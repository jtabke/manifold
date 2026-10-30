/** Internal storage hint, outside the public exports. It never replaces domain validation. */
import type { Document } from "./document.ts";
import type { Receipt } from "./execution.ts";
import type { SharedMap } from "./shared-map.ts";
type Contents = Readonly<{ document: Document; receipts: SharedMap<Receipt> }>;
const layouts = new WeakMap<object, (validated: Contents) => Contents>();
export function rememberLayout(
  source: object,
  restore: (validated: Contents) => Contents,
) {
  layouts.set(source, restore);
}
/** Runtime calls this only after cloning and validating the complete incoming contract. */
export function restoreLayout(source: object, validated: Contents): Contents {
  return layouts.get(source)?.(validated) ?? validated;
}
