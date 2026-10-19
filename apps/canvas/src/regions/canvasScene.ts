import { workspaceStorage } from "./workspaceStorage.ts";
/** Saved views and groups refer to representations; they never contain engineering definitions. */
import type { Point } from "./document.ts";
import { frameBounds, type CanvasFrame } from "./selection.ts";
export type CanvasTool = {
  collapsed?: boolean;
  id: string;
  editor: "python" | "dependencies" | "response" | "table";
  object: string;
  artifact?: string;
  context?: string;
  at: Point;
  width: number;
  height: number;
};
export type CanvasGroup = {
  id: string;
  name: string;
  members: string[];
  layout: "row" | "stack";
  collapsed?: boolean;
  auto?: boolean;
};
export type Camera = { x: number; y: number; zoom: number };
export type Viewpoint = {
  id: string;
  name: string;
  camera: Camera;
  positions: Record<string, Point>;
  groups: CanvasGroup[];
  tools: CanvasTool[];
  closed?: string[];
  pins?: Record<string, string>;
};
export type CanvasScene = {
  version: 1;
  groups: CanvasGroup[];
  tools: CanvasTool[];
  viewpoints: Viewpoint[];
  closed?: string[];
  pins?: Record<string, string>;
};
export const SCENE_STORAGE = workspaceStorage("manifold.canvas-scene.v1");
export const emptyScene = (): CanvasScene => ({
  version: 1,
  groups: [],
  tools: [],
  viewpoints: [],
});
export function restoreScene(raw: string): CanvasScene {
  const s = JSON.parse(raw) as CanvasScene;
  const object = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === "object" && !Array.isArray(v);
  const id = (v: unknown): v is string =>
    typeof v === "string" &&
    /^[a-z][a-zA-Z0-9-]{0,100}$/.test(v) &&
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
        g.members.every(id) &&
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
        id(t.object) &&
        [t.artifact, t.context].every((x) => x === undefined || id(x)) &&
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
      Object.entries(v).every(([k, c]) => id(k) && id(c)));
  const closed = (v: unknown) =>
    v === undefined || (Array.isArray(v) && v.length <= 128 && v.every(id));
  if (!pins(s.pins) || !closed(s.closed))
    throw Error("Invalid canvas visibility.");
  if (
    raw.length > 500_000 ||
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
        point(v.camera) &&
        typeof v.camera.zoom === "number" &&
        v.camera.zoom >= 0.1 &&
        v.camera.zoom <= 2 &&
        object(v.positions) &&
        Object.entries(v.positions).length <= 256 &&
        Object.entries(v.positions).every(([k, p]) => id(k) && point(p)) &&
        groups(v.groups) &&
        tools(v.tools) &&
        pins(v.pins) &&
        closed(v.closed),
    )
  )
    throw Error("Unsupported canvas arrangement.");
  return structuredClone({
    version: 1,
    groups: s.groups,
    tools: s.tools,
    viewpoints: s.viewpoints,
    ...(s.closed ? { closed: s.closed } : {}),
    ...(s.pins ? { pins: s.pins } : {}),
  });
}
export function groupMembers(groups: CanvasGroup[], id: string): string[] {
  return (
    groups.find((g) => g.id === id || g.members.includes(id))?.members || [id]
  );
}
export function detachMember(groups: CanvasGroup[], id: string): CanvasGroup[] {
  return groups
    .map((g) => ({ ...g, members: g.members.filter((m) => m !== id) }))
    .filter((g) => g.members.length > 1);
}
export function dockObjects(
  groups: CanvasGroup[],
  source: string,
  target: string,
  layout: CanvasGroup["layout"],
): CanvasGroup[] {
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
): Record<string, Point> {
  const ordered = group.members
      .map((id) => frames.find((f) => f.id === id))
      .filter((f): f is CanvasFrame => !!f),
    bounds = frameBounds(ordered);
  if (!bounds) return {};
  const out: Record<string, Point> = {};
  let x = bounds.x,
    y = bounds.y;
  for (const frame of ordered) {
    out[frame.id] = { x, y };
    if (group.layout === "row") x += Math.max(160, frame.width) + 24;
    else y += frame.height + 24;
  }
  return out;
}
export function dockTarget(
  source: string,
  point: Point,
  frames: CanvasFrame[],
  groups: CanvasGroup[],
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
