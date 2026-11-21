/** Small presentation-only tools for the system experiment; never an evaluation graph. */
import type { Page, Point } from "./document.ts";
import { modelParent } from "./models.ts";
import { systemArchitecture } from "./systemExploration.ts";
export type ModelRect = Point & { id: string; width: number; height: number };
export function routeLabel(
  points: Point[],
  obstacles: ModelRect[] = [],
  width = 90,
  rows = 1,
): Point | undefined {
  const segments = points
    .slice(1)
    .map((b, i) => ({ a: points[i], b }))
    .filter(({ a, b }) => a.y === b.y)
    .sort((s, t) => Math.abs(t.b.x - t.a.x) - Math.abs(s.b.x - s.a.x));
  for (const { a, b } of segments)
    for (const fraction of [0.5, 0.33, 0.67])
      for (const dy of [-10 - (rows - 1) * 14, 10]) {
        const at = { x: a.x + (b.x - a.x) * fraction, y: a.y + dy },
          box = {
            x: at.x - width / 2,
            y: at.y - 12,
            width,
            height: rows * 14 + 5,
          };
        if (
          !obstacles.some(
            (r) =>
              box.x < r.x + r.width &&
              box.x + box.width > r.x &&
              box.y < r.y + r.height &&
              box.y + box.height > r.y,
          )
        )
          return at;
      }
}
/** Keep mutually dependent model interfaces together; the quantity evaluator remains acyclic. */
export function arrangeSystem(page: Page) {
  const models = (page.models || []).filter((m) => !modelParent(page, m.id)),
    ids = models.map((m) => m.id);
  const edges = systemArchitecture(page).filter(
    (e) => ids.includes(e.from) && ids.includes(e.to),
  );
  const reachable = (from: string, to: string) => {
    const seen = new Set([from]),
      q = [from];
    while (q.length) {
      const id = q.shift()!;
      if (id === to) return true;
      for (const e of edges)
        if (e.from === id && !seen.has(e.to)) {
          seen.add(e.to);
          q.push(e.to);
        }
    }
    return false;
  };
  const groups: string[][] = [];
  for (const id of ids)
    if (!groups.some((g) => g.includes(id)))
      groups.push(
        ids.filter((other) => reachable(id, other) && reachable(other, id)),
      );
  const coupled = groups.filter((g) => g.length > 1),
    positions: Record<string, Point> = {},
    occupied = new Set<string>();
  const put = (id: string, want: Point) => {
    const cells = Array.from(
      { length: Math.max(24, ids.length * 2) },
      (_, i) => ({
        x: 25 + (i % 4) * 360,
        y: 180 + Math.floor(i / 4) * 370,
      }),
    );
    const at = cells
      .filter((p) => !occupied.has(`${p.x},${p.y}`))
      .sort(
        (a, b) =>
          Math.abs(a.x - want.x) * 1.3 +
          Math.abs(a.y - want.y) -
          (Math.abs(b.x - want.x) * 1.3 + Math.abs(b.y - want.y)),
      )[0];
    positions[id] = at;
    occupied.add(`${at.x},${at.y}`);
  };
  for (const group of coupled)
    group.forEach((id, i) => put(id, { x: 25 + i * 360, y: 180 }));
  const remaining = ids.filter((id) => !positions[id]),
    deferred = remaining.filter((id) => !edges.some((e) => e.to === id));
  const pending = remaining.filter((id) => !deferred.includes(id));
  for (let round = 0; pending.length && round < ids.length + 1; round++)
    for (const id of [...pending]) {
      const sources = [
        ...new Set(edges.filter((e) => e.to === id).map((e) => e.from)),
      ];
      if (sources.some((s) => !positions[s] && !deferred.includes(s))) continue;
      const placed = sources.filter((s) => positions[s]),
        sameCluster = coupled.some(
          (g) => placed.length > 0 && placed.every((s) => g.includes(s)),
        );
      put(id, {
        x: placed.length
          ? Math.max(...placed.map((s) => positions[s].x)) +
            (sameCluster ? 0 : 360)
          : 25,
        y: 180,
      });
      pending.splice(pending.indexOf(id), 1);
    }
  for (const id of [...pending, ...deferred]) {
    const target = edges.find((e) => e.from === id && positions[e.to]);
    put(
      id,
      target
        ? { x: positions[target.to].x, y: positions[target.to].y + 370 }
        : { x: 25, y: 180 },
    );
  }
  return { positions, coupled };
}

/** Only the explicit Arrange action uses this spacing pass. Opening a disclosure
 * never moves a neighbor or changes the engineer's saved free-canvas positions. */
export function spaceArrangedModels(
  positions: Record<string, Point>,
  sizes: Record<string, { width: number; height: number }>,
): Record<string, Point> {
  const result: Record<string, Point> = {};
  const rows = [...new Set(Object.values(positions).map((at) => at.y))].sort(
    (a, b) => a - b,
  );
  let bottom = 90;
  for (const row of rows) {
    const y = Math.max(row, bottom + 90);
    let right = -55;
    for (const [id, at] of Object.entries(positions)
      .filter(([, at]) => at.y === row)
      .sort(([, a], [, b]) => a.x - b.x)) {
      const x = Math.max(at.x, right + 80);
      result[id] = { x, y };
      right = x + (sizes[id]?.width || 280);
    }
    bottom = Math.max(
      ...Object.entries(result)
        .filter(([, at]) => at.y === y)
        .map(([id, at]) => at.y + (sizes[id]?.height || 180)),
    );
  }
  return result;
}

/** Place a temporary view in nearby free space. Existing object positions are untouched. */
export function placeInvestigation(
  anchor: ModelRect,
  others: ModelRect[],
  size: { width: number; height: number },
): Point {
  const gap = 36;
  const candidates: Point[] = [
    { x: anchor.x + anchor.width + gap, y: anchor.y },
    { x: anchor.x - size.width - gap, y: anchor.y },
    { x: anchor.x, y: anchor.y + anchor.height + gap },
    { x: anchor.x, y: anchor.y - size.height - gap },
    ...others.flatMap((r) => [
      { x: r.x + r.width + gap, y: anchor.y },
      { x: anchor.x, y: r.y + r.height + gap },
    ]),
  ];
  const free = candidates.filter(
    (at) =>
      at.x >= 20 &&
      at.y >= 170 &&
      !others.some(
        (r) =>
          at.x < r.x + r.width + 16 &&
          at.x + size.width + 16 > r.x &&
          at.y < r.y + r.height + 16 &&
          at.y + size.height + 16 > r.y,
      ),
  );
  return (
    free.find((at) => candidates.indexOf(at) < 4) ||
    free.sort(
      (a, b) =>
        Math.hypot(a.x - anchor.x, a.y - anchor.y) -
        Math.hypot(b.x - anchor.x, b.y - anchor.y),
    )[0] || {
      x:
        Math.max(...others.map((r) => r.x + r.width), anchor.x + anchor.width) +
        gap,
      y: Math.max(170, anchor.y),
    }
  );
}
