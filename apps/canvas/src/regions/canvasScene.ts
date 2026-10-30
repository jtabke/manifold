import { workspaceStorage } from "./workspaceStorage.ts";
/** Saved views and groups refer to representations; they never contain engineering definitions. */
import type { Point } from "./document.ts";
import { frameBounds, type CanvasFrame } from "./selection.ts";
export type CanvasTool = Readonly<{
  collapsed?: boolean;
  id: string;
  editor: "python" | "dependencies" | "response" | "table";
  object: string;
  artifact?: string;
  context?: string;
  at: Readonly<Point>;
  width: number;
  height: number;
}>;
export type CanvasGroup = Readonly<{
  id: string;
  name: string;
  members: readonly string[];
  layout: "row" | "stack";
  collapsed?: boolean;
  auto?: boolean;
}>;
export type Camera = Readonly<{ x: number; y: number; zoom: number }>;
export type Viewpoint = Readonly<{
  id: string;
  name: string;
  camera: Camera;
  scope?: string;
  positions: Readonly<Record<string, Readonly<Point>>>;
  groups: readonly CanvasGroup[];
  tools: readonly CanvasTool[];
  closed?: readonly string[];
  pins?: Readonly<Record<string, string>>;
}>;
export type CanvasScene = Readonly<{
  version: 1;
  groups: readonly CanvasGroup[];
  tools: readonly CanvasTool[];
  viewpoints: readonly Viewpoint[];
  closed?: readonly string[];
  pins?: Readonly<Record<string, string>>;
}>;
export const SCENE_STORAGE = workspaceStorage("manifold.canvas-scene.v1");
export const emptyScene = (): CanvasScene => ({
  version: 1,
  groups: [],
  tools: [],
  viewpoints: [],
});
export function validateScene(value: unknown): asserts value is CanvasScene {
  const s = value as CanvasScene;
  const object = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === "object" && !Array.isArray(v);
  const id = (v: unknown): v is string =>
    typeof v === "string" &&
    /^[a-z][a-zA-Z0-9-]{0,100}$/.test(v) &&
    !["constructor", "prototype"].includes(v);
  const refId = (v: unknown): v is string =>
    typeof v === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/.test(v) &&
    !["constructor", "prototype"].includes(v);
  const point = (v: unknown) =>
    object(v) &&
    typeof v.x === "number" &&
    typeof v.y === "number" &&
    Number.isFinite(v.x + v.y) &&
    Math.abs(v.x) + Math.abs(v.y) < 1e12;
  const groups = (v: unknown): v is CanvasGroup[] =>
    Array.isArray(v) &&
    v.length <= 32 &&
    v.every(
      (g) =>
        object(g) &&
        id(g.id) &&
        typeof g.name === "string" &&
        g.name.length <= 80 &&
        ["row", "stack"].includes(g.layout as string) &&
        Array.isArray(g.members) &&
        g.members.length >= 2 &&
        g.members.length <= 128 &&
        g.members.every(refId) &&
        (g.collapsed === undefined || typeof g.collapsed === "boolean") &&
        (g.auto === undefined || typeof g.auto === "boolean"),
    ) &&
    new Set(v.flatMap((g) => g.members)).size ===
      v.reduce((sum, g) => sum + g.members.length, 0) &&
    new Set(v.map((g) => g.id)).size === v.length;
  const tools = (v: unknown): v is CanvasTool[] =>
    Array.isArray(v) &&
    v.length <= 24 &&
    v.every(
      (t) =>
        object(t) &&
        id(t.id) &&
        (t.collapsed === undefined || typeof t.collapsed === "boolean") &&
        refId(t.object) &&
        [t.artifact, t.context].every((x) => x === undefined || refId(x)) &&
        ["python", "dependencies", "response", "table"].includes(
          t.editor as string,
        ) &&
        point(t.at) &&
        typeof t.width === "number" &&
        typeof t.height === "number" &&
        t.width >= 320 &&
        t.width <= 1100 &&
        t.height >= 180 &&
        t.height <= 750,
    ) &&
    new Set(v.map((t) => t.id)).size === v.length;
  const pins = (v: unknown) =>
    v === undefined ||
    (object(v) &&
      Object.entries(v).length <= 128 &&
      Object.entries(v).every(([k, c]) => refId(k) && refId(c)));
  const closed = (v: unknown) =>
    v === undefined || (Array.isArray(v) && v.length <= 128 && v.every(refId));
  if (!object(s) || !pins(s.pins) || !closed(s.closed))
    throw Error("Invalid canvas visibility.");
  if (
    !object(s) ||
    s.version !== 1 ||
    !groups(s.groups) ||
    !tools(s.tools) ||
    !Array.isArray(s.viewpoints) ||
    s.viewpoints.length > 12 ||
    !s.viewpoints.every(
      (v) =>
        object(v) &&
        id(v.id) &&
        typeof v.name === "string" &&
        !!v.name.trim() &&
        v.name.length <= 80 &&
        (v.scope === undefined || refId(v.scope)) &&
        object(v.camera) &&
        point(v.camera) &&
        typeof v.camera.zoom === "number" &&
        v.camera.zoom >= 0.1 &&
        v.camera.zoom <= 2 &&
        object(v.positions) &&
        Object.entries(v.positions).length <= 1024 &&
        Object.entries(v.positions).every(([k, p]) => refId(k) && point(p)) &&
        groups(v.groups) &&
        tools(v.tools) &&
        pins(v.pins) &&
        closed(v.closed),
    )
  )
    throw Error("Unsupported canvas arrangement.");
}
export function restoreScene(raw: string): CanvasScene {
  if (raw.length > 500_000) throw Error("Unsupported canvas arrangement.");
  const s: unknown = JSON.parse(raw);
  validateScene(s);
  return structuredClone({
    version: 1,
    groups: s.groups,
    tools: s.tools,
    viewpoints: s.viewpoints,
    ...(s.closed ? { closed: s.closed } : {}),
    ...(s.pins ? { pins: s.pins } : {}),
  });
}
export function groupMembers(
  groups: readonly CanvasGroup[],
  id: string,
): readonly string[] {
  return (
    groups.find((g) => g.id === id || g.members.includes(id))?.members || [id]
  );
}
export function detachMember(
  groups: readonly CanvasGroup[],
  id: string,
): CanvasGroup[] {
  return groups
    .map((g) => ({ ...g, members: g.members.filter((m) => m !== id) }))
    .filter((g) => g.members.length > 1);
}
export function dockObjects(
  groups: readonly CanvasGroup[],
  source: string,
  target: string,
  layout: CanvasGroup["layout"],
): readonly CanvasGroup[] {
  const members = [
    ...new Set([
      ...groupMembers(groups, target),
      ...groupMembers(groups, source),
    ]),
  ];
  if (members.length < 2) return groups;
  const targetGroup = groups.find(
    (g) => g.id === target || g.members.includes(target),
  );
  return [
    ...groups.filter((g) => !g.members.some((id) => members.includes(id))),
    {
      id: targetGroup?.id || `group-${crypto.randomUUID()}`,
      name: targetGroup?.name || "Analysis",
      members,
      layout,
      auto: true,
    },
  ];
}
export function groupPlacements(
  group: CanvasGroup,
  frames: CanvasFrame[],
  anchor?: Point,
): Record<string, Point> {
  const ordered = group.members
      .map((id) => frames.find((f) => f.id === id))
      .filter((f): f is CanvasFrame => !!f),
    bounds = frameBounds(ordered);
  if (!bounds) return {};
  const out: Record<string, Point> = Object.create(null);
  let x = anchor?.x ?? bounds.x,
    y = anchor?.y ?? bounds.y;
  for (const frame of ordered) {
    out[frame.id] = { x, y };
    if (group.layout === "row") x += Math.max(160, frame.width) + 24;
    else y += frame.height + 24;
  }
  return out;
}
export type GroupLayoutPlan = Readonly<{
  groups: readonly CanvasGroup[];
  placements: Record<string, Point>;
  destinations: CanvasFrame[];
}>;
/** Include every remaining peer: even dissolving a two-item group must not snap it back. */
export function planDetach(
  groups: readonly CanvasGroup[],
  moving: readonly string[],
  frames: CanvasFrame[],
): GroupLayoutPlan | undefined {
  const selected = new Set(moving),
    partial = groups.filter(
      (g) =>
        g.members.some((id) => selected.has(id)) &&
        !g.members.every((id) => selected.has(id)),
    ),
    peers = new Set(
      partial.flatMap((g) => g.members.filter((id) => !selected.has(id))),
    );
  if ([...peers].some((id) => !frames.some((f) => f.id === id))) return;
  const next = groups.flatMap((g) => {
    if (!partial.includes(g)) return [g];
    const members = g.members.filter((id) => !selected.has(id));
    return members.length > 1 ? [{ ...g, members }] : [];
  });
  const placements: Record<string, Point> = Object.create(null);
  for (const previous of partial) {
    const remaining = next.find((g) => g.id === previous.id);
    if (remaining?.auto)
      Object.assign(placements, groupPlacements(remaining, frames));
  }
  for (const f of frames)
    if (peers.has(f.id) && !Object.hasOwn(placements, f.id))
      placements[f.id] = { x: f.x, y: f.y };
  return {
    groups: next,
    placements,
    destinations: frames
      .filter((f) => peers.has(f.id))
      .map((f) => ({ ...f, ...placements[f.id] })),
  };
}
/** Proposed geometry only; callers accept this same plan as one authored operation. */
export function planDock(
  groups: readonly CanvasGroup[],
  source: string,
  target: string,
  layout: CanvasGroup["layout"],
  frames: CanvasFrame[],
  asGroup = false,
): GroupLayoutPlan | undefined {
  const moving = asGroup ? groupMembers(groups, source) : [source],
    targets = groupMembers(groups, target);
  if (
    moving.some((id) => targets.includes(id)) ||
    [...moving, ...targets].some((id) => !frames.some((f) => f.id === id))
  )
    return;
  const departure = planDetach(groups, moving, frames),
    anchor = frameBounds(frames.filter((f) => targets.includes(f.id)));
  if (!departure || !anchor) return;
  const next = dockObjects(departure.groups, source, target, layout),
    merged = next.find((g) => g.members.includes(moving[0]));
  if (!merged) return;
  const placements = Object.assign(
    departure.placements,
    groupPlacements(merged, frames, anchor),
  );
  return {
    groups: next,
    placements,
    destinations: frames
      .filter((f) => Object.hasOwn(placements, f.id))
      .map((f) => ({ ...f, ...placements[f.id] })),
  };
}
export function dockTarget(
  source: string,
  point: Point,
  frames: CanvasFrame[],
  groups: readonly CanvasGroup[],
): { id: string; layout: CanvasGroup["layout"] } | undefined {
  const own = new Set(groupMembers(groups, source));
  const candidates = frames
    .filter(
      (f) =>
        !own.has(f.id) &&
        f.id !== source &&
        point.x >= f.x - 28 &&
        point.x <= f.x + f.width + 28 &&
        point.y >= f.y - 28 &&
        point.y <= f.y + f.height + 28,
    )
    .map((f) => ({
      f,
      dx: Math.min(Math.abs(point.x - f.x), Math.abs(point.x - f.x - f.width)),
      dy: Math.min(Math.abs(point.y - f.y), Math.abs(point.y - f.y - f.height)),
    }))
    .filter((v) => Math.min(v.dx, v.dy) < 32)
    .sort((a, b) => Math.min(a.dx, a.dy) - Math.min(b.dx, b.dy));
  const v = candidates[0];
  return v ? { id: v.f.id, layout: v.dy <= v.dx ? "stack" : "row" } : undefined;
}
