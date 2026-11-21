import type { Point } from "./document.ts";
import type { CanvasRect } from "./selection.ts";
/** A segment on the edge of a clearance box is allowed; its interior is not. */
export const crosses = (a: Point, b: Point, r: CanvasRect) =>
  a.x === b.x
    ? a.x > r.x &&
      a.x < r.x + r.width &&
      Math.max(a.y, b.y) > r.y &&
      Math.min(a.y, b.y) < r.y + r.height
    : a.y > r.y &&
      a.y < r.y + r.height &&
      Math.max(a.x, b.x) > r.x &&
      Math.min(a.x, b.x) < r.x + r.width;
/** Orthogonal visibility search with a bend cost. No fallback wires through objects. */
export function routeConnection(
  start: Point,
  end: Point,
  obstacles: readonly CanvasRect[],
  padding = 12,
): Point[] | undefined {
  const boxes = obstacles.map((r) => ({
    ...r,
    x: r.x - padding,
    y: r.y - padding,
    width: r.width + padding * 2,
    height: r.height + padding * 2,
  }));
  const xs = [
    ...new Set([start.x, end.x, ...boxes.flatMap((r) => [r.x, r.x + r.width])]),
  ].sort((a, b) => a - b);
  const ys = [
    ...new Set([
      start.y,
      end.y,
      ...boxes.flatMap((r) => [r.y, r.y + r.height]),
    ]),
  ].sort((a, b) => a - b);
  const nodes = xs.flatMap((x) => ys.map((y) => ({ x, y }))),
    usable = nodes.map(
      (p) =>
        !boxes.some(
          (r) =>
            p.x > r.x &&
            p.x < r.x + r.width &&
            p.y > r.y &&
            p.y < r.y + r.height,
        ),
    );
  const first = nodes.findIndex((p) => p.x === start.x && p.y === start.y),
    last = nodes.findIndex((p) => p.x === end.x && p.y === end.y);
  if (!usable[first] || !usable[last]) return;
  const neighbors = nodes.map((a, i) =>
    usable[i]
      ? [i - 1, i + 1, i - ys.length, i + ys.length].filter(
          (j) =>
            j >= 0 &&
            j < nodes.length &&
            usable[j] &&
            (a.x === nodes[j].x || a.y === nodes[j].y) &&
            !boxes.some((r) => crosses(a, nodes[j], r)),
        )
      : [],
  );
  const cost = new Map<string, number>([[`${first}:0`, 0]]),
    previous = new Map<string, string>();
  const pending = [
    { node: first, axis: 0, key: `${first}:0`, cost: 0, priority: 0 },
  ];
  let finish: string | undefined;
  while (pending.length) {
    pending.sort((a, b) => b.priority - a.priority);
    const at = pending.pop()!;
    if (at.cost !== cost.get(at.key)) continue;
    if (at.node === last) {
      finish = at.key;
      break;
    }
    for (const next of neighbors[at.node]) {
      const a = nodes[at.node],
        b = nodes[next],
        axis = a.x === b.x ? 1 : 2,
        key = `${next}:${axis}`;
      const value =
        at.cost +
        Math.abs(a.x - b.x) +
        Math.abs(a.y - b.y) +
        (at.axis && at.axis !== axis ? 24 : 0);
      if (value >= (cost.get(key) ?? Infinity)) continue;
      cost.set(key, value);
      previous.set(key, at.key);
      pending.push({
        node: next,
        axis,
        key,
        cost: value,
        priority: value + Math.abs(b.x - end.x) + Math.abs(b.y - end.y),
      });
    }
  }
  if (!finish) return;
  const path: Point[] = [];
  for (let key: string | undefined = finish; key; key = previous.get(key))
    path.unshift(nodes[Number(key.split(":")[0])]);
  return path.filter(
    (p, i) =>
      i === 0 ||
      i === path.length - 1 ||
      !(
        (path[i - 1].x === p.x && p.x === path[i + 1].x) ||
        (path[i - 1].y === p.y && p.y === path[i + 1].y)
      ),
  );
}
export const pathData = (points: Point[]) =>
  points.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
