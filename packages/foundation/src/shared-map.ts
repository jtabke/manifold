/** Promoted from the tested F1b AVL map. Physical nodes never become document identities. */
export type MapWork = {
  nodesRead: number;
  nodesAllocated: number;
  entriesWritten: number;
};
export const mapWork = (): MapWork => ({
  nodesRead: 0,
  nodesAllocated: 0,
  entriesWritten: 0,
});
type Node<V> = Readonly<{
  key: string;
  value: V;
  left: Node<V> | null;
  right: Node<V> | null;
  height: number;
  size: number;
}>;
const height = <V>(node: Node<V> | null) => node?.height ?? 0;
const size = <V>(node: Node<V> | null) => node?.size ?? 0;
function node<V>(
  key: string,
  value: V,
  left: Node<V> | null,
  right: Node<V> | null,
  work?: MapWork,
): Node<V> {
  if (work) {
    work.nodesAllocated++;
    work.entriesWritten++;
  }
  return Object.freeze({
    key,
    value,
    left,
    right,
    height: 1 + Math.max(height(left), height(right)),
    size: 1 + size(left) + size(right),
  });
}
function balance<V>(
  key: string,
  value: V,
  left: Node<V> | null,
  right: Node<V> | null,
  work?: MapWork,
): Node<V> {
  if (height(left) - height(right) > 1) {
    const l = left!;
    if (height(l.left) >= height(l.right))
      return node(
        l.key,
        l.value,
        l.left,
        node(key, value, l.right, right, work),
        work,
      );
    const middle = l.right!;
    return node(
      middle.key,
      middle.value,
      node(l.key, l.value, l.left, middle.left, work),
      node(key, value, middle.right, right, work),
      work,
    );
  }
  if (height(right) - height(left) > 1) {
    const r = right!;
    if (height(r.right) >= height(r.left))
      return node(
        r.key,
        r.value,
        node(key, value, left, r.left, work),
        r.right,
        work,
      );
    const middle = r.left!;
    return node(
      middle.key,
      middle.value,
      node(key, value, left, middle.left, work),
      node(r.key, r.value, middle.right, r.right, work),
      work,
    );
  }
  return node(key, value, left, right, work);
}
function put<V>(
  root: Node<V> | null,
  key: string,
  value: V,
  work?: MapWork,
): Node<V> {
  if (!root) return node(key, value, null, null, work);
  if (work) work.nodesRead++;
  if (key === root.key)
    return root.value === value
      ? root
      : node(key, value, root.left, root.right, work);
  if (key < root.key) {
    const left = put(root.left, key, value, work);
    return left === root.left
      ? root
      : balance(root.key, root.value, left, root.right, work);
  }
  const right = put(root.right, key, value, work);
  return right === root.right
    ? root
    : balance(root.key, root.value, root.left, right, work);
}
function drop<V>(
  root: Node<V> | null,
  key: string,
  work?: MapWork,
): Node<V> | null {
  if (!root) return null;
  if (work) work.nodesRead++;
  if (key < root.key) {
    const left = drop(root.left, key, work);
    return left === root.left
      ? root
      : balance(root.key, root.value, left, root.right, work);
  }
  if (key > root.key) {
    const right = drop(root.right, key, work);
    return right === root.right
      ? root
      : balance(root.key, root.value, root.left, right, work);
  }
  if (!root.left) return root.right;
  if (!root.right) return root.left;
  let successor = root.right;
  while (successor.left) {
    if (work) work.nodesRead++;
    successor = successor.left;
  }
  return balance(
    successor.key,
    successor.value,
    root.left,
    drop(root.right, successor.key, work),
    work,
  );
}
export class SharedMap<V> {
  readonly #root: Node<V> | null;
  private constructor(root: Node<V> | null) {
    this.#root = root;
    Object.freeze(this);
  }
  static empty<V>(): SharedMap<V> {
    return new SharedMap<V>(null);
  }
  static from<V>(entries: Iterable<readonly [string, V]>): SharedMap<V> {
    const sorted = [...new Map(entries)].sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    function build(start: number, end: number): Node<V> | null {
      if (start >= end) return null;
      const mid = (start + end) >>> 1,
        pair = sorted[mid]!;
      return node(pair[0], pair[1], build(start, mid), build(mid + 1, end));
    }
    return new SharedMap(build(0, sorted.length));
  }
  get size(): number {
    return size(this.#root);
  }
  get(key: string, work?: MapWork): V | undefined {
    let current = this.#root;
    while (current) {
      if (work) work.nodesRead++;
      if (key === current.key) return current.value;
      current = key < current.key ? current.left : current.right;
    }
    return undefined;
  }
  set(key: string, value: V, work?: MapWork): SharedMap<V> {
    const root = put(this.#root, key, value, work);
    return root === this.#root ? this : new SharedMap(root);
  }
  delete(key: string, work?: MapWork): SharedMap<V> {
    const root = drop(this.#root, key, work);
    return root === this.#root ? this : new SharedMap(root);
  }
  *entries(): IterableIterator<readonly [string, V]> {
    function* walk(
      root: Node<V> | null,
    ): IterableIterator<readonly [string, V]> {
      if (!root) return;
      yield* walk(root.left);
      yield [root.key, root.value] as const;
      yield* walk(root.right);
    }
    yield* walk(this.#root);
  }
  toRecord(): Readonly<Record<string, V>> {
    return Object.freeze(Object.fromEntries(this.entries()));
  }
  /** Restore a local physical layout using only this map's values; reject changed keys or non-AVL shapes. */
  reshape<T>(
    root: T | null,
    read: (
      token: T,
    ) => Readonly<{ key: string; left: T | null; right: T | null }>,
    remember?: (token: T, identity: object, key: string, value: V) => void,
  ): SharedMap<V> {
    const values = new Map(this.entries()),
      restored: [T, Node<V>][] = [];
    function build(
      token: T | null,
      depth: number,
      low?: string,
      high?: string,
    ): Node<V> | null {
      if (token === null) return null;
      if (depth >= 128 || restored.length >= values.size)
        throw Error("Invalid map layout depth/size");
      const at = read(token);
      if (
        typeof at.key !== "string" ||
        !values.has(at.key) ||
        (low !== undefined && at.key <= low) ||
        (high !== undefined && at.key >= high)
      )
        throw Error("Map layout changes keys/order");
      const left = build(at.left, depth + 1, low, at.key),
        right = build(at.right, depth + 1, at.key, high);
      if (Math.abs(height(left) - height(right)) > 1)
        throw Error("Unbalanced map layout");
      const next = node(at.key, values.get(at.key)!, left, right);
      restored.push([token, next]);
      return next;
    }
    const next = build(root, 0);
    if (size(next) !== values.size) throw Error("Map layout omits keys");
    for (const [token, at] of restored) remember?.(token, at, at.key, at.value);
    return new SharedMap(next);
  }
  /** Local encoders can memoize unchanged physical branches. Tokens never become domain IDs. */
  fold<R>(
    visit: (key: string, value: V, left: R | null, right: R | null) => R,
    memo: {
      has(key: object): boolean;
      get(key: object): R | undefined;
      set(key: object, value: R): unknown;
    },
  ): R | null {
    function walk(root: Node<V> | null): R | null {
      if (!root) return null;
      if (memo.has(root)) return memo.get(root)!;
      const result = visit(
        root.key,
        root.value,
        walk(root.left),
        walk(root.right),
      );
      memo.set(root, result);
      return result;
    }
    return walk(this.#root);
  }
  /** Diagnostics are full traversals outside operation timings. Count physical nodes shared across roots/maps. */
  account(seen: Set<object>): number {
    let added = 0;
    function visit(root: Node<V> | null) {
      if (!root || seen.has(root)) return;
      seen.add(root);
      added++;
      visit(root.left);
      visit(root.right);
    }
    visit(this.#root);
    return added;
  }
  validate(): void {
    function check(root: Node<V> | null, low?: string, high?: string): void {
      if (!root) return;
      if (
        (low !== undefined && root.key <= low) ||
        (high !== undefined && root.key >= high) ||
        Math.abs(height(root.left) - height(root.right)) > 1 ||
        root.height !== 1 + Math.max(height(root.left), height(root.right)) ||
        root.size !== 1 + size(root.left) + size(root.right)
      )
        throw Error("Invalid AVL map");
      check(root.left, low, root.key);
      check(root.right, root.key, high);
    }
    check(this.#root);
  }
}
