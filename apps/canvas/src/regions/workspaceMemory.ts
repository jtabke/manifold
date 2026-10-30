import { canonical, type Json } from "@manifold/foundation";
import { workspaceStorage } from "./workspaceStorage.ts";
import type { Page } from "./document.ts";
import type { Camera } from "./canvasScene.ts";
export const MEMORY_STORAGE = workspaceStorage("manifold.canvas-attention.v1");
export type ModelLocation = {
  scope?: string;
  camera: Camera;
  view?: "system" | "canvas";
};
export type WorkspaceMemory = ModelLocation & {
  version: 1 | 2;
  document: string;
  selected?: string;
  selection: string[];
  cameras: Record<string, Camera>;
  history: ModelLocation[];
  system?: {
    investigating?: boolean;
    inspectionVersion?: 2;
    response?: "contextual" | "compact" | "expanded" | "detached" | "internal";
    anchor?: string;
    positions?: Record<string, { x: number; y: number }>;
    open: boolean;
    input?: string;
    output?: string;
    failure?: string;
    canvas?: Camera;
  };
};
// A resume point belongs to the saved calculation, not to another imported page
// which happens to reuse region-1, region-2, etc. Presentation is deliberately absent.
function hashDocument(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++)
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(36);
}
function content(page: Page) {
  return [
    page.regions.map(
      ({
        label,
        displayUnit,
        interfaceHidden,
        requirement,
        provisional,
        ...region
      }) => region,
    ),
    page.models?.map(({ presentation, ...model }) => model),
    page.dataRelations,
  ];
}
export function documentKey(page: Page): string {
  return hashDocument(
    canonical(JSON.parse(JSON.stringify(content(page))) as Json),
  );
}
export function restoreMemory(
  raw: string | null,
  page: Page,
  representations: string[] = [],
  document?: string,
): WorkspaceMemory | undefined {
  try {
    if (!raw || raw.length > 64000) return;
    const value = JSON.parse(raw);
    const camera = (c: Camera) =>
      c &&
      [c.x, c.y, c.zoom].every(Number.isFinite) &&
      c.zoom >= 0.1 &&
      c.zoom <= 2;
    const scope = (id: unknown) =>
      id === undefined || page.models?.some((m) => m.id === id);
    if (
      (value.version === 2
        ? !document || value.document !== document
        : value.version !== 1 ||
          ![
            documentKey(page),
            hashDocument(JSON.stringify(content(page))),
            hashDocument(
              JSON.stringify([page.regions, page.models, page.dataRelations]),
            ),
          ].includes(value.document)) ||
      !camera(value.camera) ||
      !scope(value.scope)
    )
      return;
    const ids = new Set([
      ...page.regions.map((r) => r.id),
      ...page.plots.map((p) => p.id),
      ...(page.models || []).map((m) => m.id),
      ...(page.dataRelations || []).map((r) => r.id),
      ...representations,
    ]);
    return {
      version: document ? 2 : 1,
      document: document ?? documentKey(page),
      camera: value.camera,
      scope: value.scope,
      selected:
        typeof value.selected === "string" && ids.has(value.selected)
          ? value.selected
          : undefined,
      selection: Array.isArray(value.selection)
        ? value.selection
            .filter((id: unknown) => typeof id === "string" && ids.has(id))
            .slice(0, 256)
        : [],
      cameras: Object.fromEntries(
        Object.entries(value.cameras || {}).filter(
          ([key, c]) => (key === "root" || scope(key)) && camera(c as Camera),
        ),
      ) as Record<string, Camera>,
      ...(value.system && typeof value.system.open === "boolean"
        ? {
            system: {
              open: value.system.open,
              positions: Object.fromEntries(
                Object.entries(value.system.positions || {})
                  .filter(([id, at]) => {
                    const p = at as { x: number; y: number };
                    return (
                      (scope(id) || id === "$investigation") &&
                      p &&
                      [p.x, p.y].every(Number.isFinite) &&
                      Math.abs(p.x) <= 1e12 &&
                      Math.abs(p.y) <= 1e12
                    );
                  })
                  .slice(0, 256),
              ) as Record<string, { x: number; y: number }>,
              investigating: value.system.investigating === true,
              inspectionVersion:
                value.system.inspectionVersion === 2 ? 2 : undefined,
              response: [
                "contextual",
                "compact",
                "expanded",
                "detached",
                "internal",
              ].includes(value.system.response)
                ? value.system.response
                : "contextual",
              anchor:
                typeof value.system.anchor === "string" &&
                scope(value.system.anchor)
                  ? value.system.anchor
                  : undefined,
              input: ids.has(value.system.input)
                ? value.system.input
                : undefined,
              output: ids.has(value.system.output)
                ? value.system.output
                : undefined,
              failure: ids.has(value.system.failure)
                ? value.system.failure
                : undefined,
              canvas: camera(value.system.canvas)
                ? value.system.canvas
                : undefined,
            },
          }
        : {}),
      history: Array.isArray(value.history)
        ? value.history
            .filter(
              (h: ModelLocation) =>
                h &&
                scope(h.scope) &&
                camera(h.camera) &&
                (h.view === undefined ||
                  h.view === "system" ||
                  h.view === "canvas"),
            )
            .slice(-32)
        : [],
    };
  } catch {
    return;
  }
}
