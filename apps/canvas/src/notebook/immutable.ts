/** Read-only collection views: freezing a native Map alone does not protect its entries. */
class ReadMap<K, V> implements ReadonlyMap<K, V> {
  readonly #entries: Map<K, V>;
  constructor(entries: Map<K, V>) {
    this.#entries = entries;
    Object.freeze(this);
  }
  get size() {
    return this.#entries.size;
  }
  get(key: K) {
    return this.#entries.get(key);
  }
  has(key: K) {
    return this.#entries.has(key);
  }
  entries() {
    return this.#entries.entries();
  }
  keys() {
    return this.#entries.keys();
  }
  values() {
    return this.#entries.values();
  }
  [Symbol.iterator]() {
    return this.entries();
  }
  forEach(
    callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void,
    thisArg?: unknown,
  ) {
    for (const [key, value] of this.#entries)
      callback.call(thisArg, value, key, this);
  }
}
/** Publish an exclusively owned map. The caller must not retain a mutable alias. */
export const ownMap = <K, V>(entries: Map<K, V>): ReadonlyMap<K, V> =>
  new ReadMap(entries);
export const readMap = <K, V>(
  entries: Iterable<readonly [K, V]>,
): ReadonlyMap<K, V> => ownMap(new Map(entries));
export function immutable<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(immutable);
    Object.freeze(value);
  }
  return value;
}
