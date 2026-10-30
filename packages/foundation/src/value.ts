export type Json =
  | null
  | boolean
  | number
  | string
  | readonly Json[]
  | { readonly [key: string]: Json };
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw Error(message);
}
export function object(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
export function fields(v: Record<string, unknown>, allowed: readonly string[]) {
  assert(
    Object.keys(v).every((k) => allowed.includes(k)),
    "Unknown contract field",
  );
}
export function identity(v: unknown): asserts v is string {
  assert(
    typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/.test(v),
    "Invalid identity",
  );
}
export function freeze<T>(v: T): T {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    for (const child of Object.values(v)) freeze(child);
    Object.freeze(v);
  }
  return v;
}
/** Reject non-JSON values, cycles, nonfinite numbers and prototype-bearing objects before cloning. */
export function json(
  v: unknown,
  path = "$",
  ancestors = new Set<object>(),
): asserts v is Json {
  if (v === null || typeof v === "boolean" || typeof v === "string") return;
  if (typeof v === "number") {
    assert(Number.isFinite(v), "Nonfinite JSON at " + path);
    return;
  }
  assert(typeof v === "object" && v !== null, "Non-JSON value at " + path);
  assert(!ancestors.has(v), "Cyclic JSON");
  assert(
    Array.isArray(v) ||
      Object.getPrototypeOf(v) === Object.prototype ||
      Object.getPrototypeOf(v) === null,
    "Non-plain JSON",
  );
  assert(ancestors.size < 128, "JSON nesting limit exceeded");
  // Snapshot siblings before descending, including Proxy side effects; avoid bulk reflection.
  const descriptorOf = Object.getOwnPropertyDescriptor;
  let names = Reflect.ownKeys(v);
  let descriptors: PropertyDescriptor[] = [];
  let size = 0;
  for (const key of names) {
    const descriptor = descriptorOf(v, key);
    if (descriptor) {
      names[size++] = key;
      descriptors.push(descriptor);
    }
  }
  names.length = size;
  assert(
    names.every((k) => typeof k === "string"),
    "Symbol properties are not JSON",
  );
  // Ordinary ownKeys are already ordered. A Proxy may require the old snapshot-map ordering.
  let lastIndex = -1,
    strings = false;
  for (const raw of names) {
    // Array-index keys exclude noncanonical numbers and 2**32 - 1 itself.
    const key = raw as string,
      first = key[0];
    const index = first && first >= "0" && first <= "9" ? +key : NaN;
    if (
      index >= 0 &&
      index < 4294967295 &&
      Number.isInteger(index) &&
      String(index) === key
    ) {
      if (strings || index < lastIndex) {
        const snapshot: Record<PropertyKey, PropertyDescriptor> =
          Object.create(null);
        for (let i = 0; i < names.length; i++)
          snapshot[names[i]!] = descriptors[i]!;
        names = Reflect.ownKeys(snapshot);
        descriptors = names.map((key) => snapshot[key]!);
        break;
      }
      lastIndex = index;
    } else strings = true;
  }
  if (Array.isArray(v)) {
    assert(
      Object.keys(v).length === v.length,
      "Sparse or decorated JSON array",
    );
    for (let i = 0; i < v.length; i++)
      assert(Object.hasOwn(v, i), "Sparse JSON array");
  }
  ancestors.add(v);
  for (let i = 0; i < names.length; i++) {
    const k = names[i]!;
    if (Array.isArray(v) && k === "length") continue;
    const property = descriptors[i]!;
    assert(
      property.enumerable && "value" in property,
      "Accessors/non-enumerable properties are not JSON",
    );
    json(property.value, path + "." + String(k), ancestors);
  }
  ancestors.delete(v);
}
/** Only deeply frozen plain JSON graphs may establish identity-based validation reuse. */
const immutable = new WeakSet<object>();
/** Private: the clone has just passed JSON validation and has no caller-owned nodes. */
function freezeRetained<T>(v: T): T {
  if (v && typeof v === "object" && !immutable.has(v)) {
    for (const child of Object.values(v)) freezeRetained(child);
    Object.freeze(v);
    immutable.add(v);
  }
  return v;
}
export function retained<T extends Json>(v: T): T {
  json(v);
  return freezeRetained(structuredClone(v));
}
/** Stable keys across object field order; array order remains meaningful. */
export function canonical(v: Json): string {
  json(v);
  const order = (x: Json): Json => {
    if (Array.isArray(x)) return x.map(order);
    if (!object(x)) return x;
    const out: Record<string, Json> = {};
    for (const key of Object.keys(x).sort()) {
      const value = order(x[key] as Json);
      // Preserve ordinary prototypes and data-property semantics even for inherited setters/readonly keys.
      if (key in out) {
        const descriptor = {
          __proto__: null,
          value,
          enumerable: true,
          writable: true,
          configurable: true,
        };
        Object.defineProperty(out, key, descriptor);
      } else out[key] = value;
    }
    return out;
  };
  return JSON.stringify(order(v));
}
export type Result<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: string }>;
export const failure = (error: unknown) => ({
  ok: false as const,
  error: String(error),
});

export function deeplyFrozen(value: unknown): boolean {
  const visiting = new Set<object>();
  function visit(v: unknown): boolean {
    if (v === null || typeof v === "string" || typeof v === "boolean")
      return true;
    if (typeof v === "number") return Number.isFinite(v);
    if (typeof v !== "object" || !v) return false;
    if (immutable.has(v)) return true;
    if (visiting.has(v) || !Object.isFrozen(v)) return false;
    const proto = Object.getPrototypeOf(v);
    if (!Array.isArray(v) && proto !== Object.prototype && proto !== null)
      return false;
    if (Array.isArray(v) && Object.keys(v).length !== v.length) return false;
    if (Array.isArray(v))
      for (let i = 0; i < v.length; i++) if (!Object.hasOwn(v, i)) return false;
    visiting.add(v);
    const descriptors = Object.getOwnPropertyDescriptors(v);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (Array.isArray(v) && key === "length") continue;
      const d = descriptors[key as string]!;
      if (
        typeof key !== "string" ||
        !d.enumerable ||
        !("value" in d) ||
        !visit(d.value)
      ) {
        visiting.delete(v);
        return false;
      }
    }
    visiting.delete(v);
    immutable.add(v);
    return true;
  }
  return visit(value);
}
