import {
  canvasScroll,
  scrollCanvasTo,
  revealCanvasElement,
} from "./canvasViewport";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { WorkspaceMemory, ModelLocation } from "./workspaceMemory";
import { modelParent, modelPath } from "./models";
import { positions, type Page, type Point } from "./document";
import type { Artifact } from "./artifacts";
import type { CanvasTool, Camera } from "./canvasScene";
import { frameBounds, type CanvasFrame } from "./selection";
export function useModels(o: {
  page: Page;
  artifacts: Artifact[];
  tools: CanvasTool[];
  canvas: RefObject<HTMLDivElement | null>;
  zoom: number;
  setZoom: (n: number) => void;
  frames: () => CanvasFrame[];
  initial?: WorkspaceMemory;
  clear: () => void;
  select: (id: string) => void;
  view?: () => "system" | "canvas";
  restoreView?: (view: "system" | "canvas") => void;
}) {
  const [scope, setScope] = useState<string | undefined>(o.initial?.scope),
    [history, setHistory] = useState<ModelLocation[]>(o.initial?.history || []),
    [transitioning, setTransitioning] = useState(false),
    [detail, setDetail] = useState<
      Record<string, "auto" | "compact" | "interface" | "detail">
    >({});
  const cameras = useRef(
      new Map<string, Camera>(Object.entries(o.initial?.cameras || {})),
    ),
    serial = useRef(0);
  const camera = (): Camera => ({
    x: canvasScroll(o.canvas.current).x,
    y: canvasScroll(o.canvas.current).y,
    zoom: o.zoom,
  });
  const canonical = (id: string) =>
    o.artifacts.find((a) => a.views?.some((v) => v.id === id))?.id ||
    o.tools.find((t) => t.id === id)?.artifact ||
    o.tools.find((t) => t.id === id)?.object ||
    id;
  const owner = (id: string) => modelParent(o.page, canonical(id));
  const visible = (id: string) => owner(id) === scope;
  const apply = (
    target: string | undefined,
    saved?: Camera,
    object?: string,
  ) => {
    const token = ++serial.current;
    setTransitioning(true);
    o.clear();
    setScope(target);
    if (saved) o.setZoom(saved.zoom);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (token !== serial.current) return;
        if (object) {
          o.select(object);
          revealCanvasElement(
            o.canvas.current?.querySelector(
              `[data-region-id="${object}"],[data-model-id="${object}"],[data-plot-id="${object}"],[data-data-relation-id="${object}"],[data-view-id="${object}"]`,
            ),
            { block: "center", inline: "center" },
          );
          setTransitioning(false);
          return;
        }
        if (saved) {
          scrollCanvasTo(o.canvas.current, { left: saved.x, top: saved.y });
          setTransitioning(false);
          return;
        }
        const bounds = frameBounds(
          o.frames().filter((f) => owner(f.id) === target),
        );
        const viewport = o.canvas.current;
        if (!bounds || !viewport) {
          setTransitioning(false);
          return;
        }
        const z = Math.max(
          0.55,
          Math.min(
            1,
            (viewport.clientWidth - 120) / bounds.width,
            (viewport.clientHeight - 160) / bounds.height,
          ),
        );
        o.setZoom(z);
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (token !== serial.current) return;
            scrollCanvasTo(viewport, {
              left: bounds.x * z - 60,
              top: bounds.y * z - 110,
            });
            setTransitioning(false);
          }),
        );
      }),
    );
  };
  useEffect(() => {
    // A deliberate gesture takes ownership of the camera immediately. Delayed
    // scope framing must never pull the engineer away from their next action.
    const interrupt = () => {
      ++serial.current;
      setTransitioning(false);
    };
    const node = o.canvas.current;
    node?.addEventListener("pointerdown", interrupt, true);
    node?.addEventListener("wheel", interrupt, true);
    window.addEventListener("keydown", interrupt, true);
    return () => {
      node?.removeEventListener("pointerdown", interrupt, true);
      node?.removeEventListener("wheel", interrupt, true);
      window.removeEventListener("keydown", interrupt, true);
    };
  }, [o.canvas]);
  const go = (target?: string, object?: string) => {
    if (target === scope && !object) return;
    if (target && !o.page.models?.some((m) => m.id === target)) return;
    const prior: ModelLocation = {
      scope,
      camera: camera(),
      ...(o.view?.() === "system" ? { view: "system" } : {}),
    };
    cameras.current.set(scope || "root", prior.camera);
    setHistory((h) => [...h, prior].slice(-32));
    apply(target, cameras.current.get(target || "root"), object);
  };
  const back = () => {
    const prior = history.at(-1);
    if (!prior) return;
    cameras.current.set(scope || "root", camera());
    if (!prior.scope) o.restoreView?.(prior.view || "canvas");
    setHistory((h) => h.slice(0, -1));
    apply(prior.scope, prior.camera);
  };
  // Undoing model creation while inside returns to a surviving scope.
  useEffect(() => {
    if (scope && !o.page.models?.some((m) => m.id === scope)) {
      const prior = [...history]
        .reverse()
        .find((h) => !h.scope || o.page.models?.some((m) => m.id === h.scope));
      apply(prior?.scope, prior?.camera);
      setHistory([]);
    }
  }, [o.page]);
  const at = (id: string): Point =>
    o.page.layout[id] || positions(o.page)[id] || { x: 120, y: 140 };
  return {
    scope,
    transitioning,
    cameras: cameras.current,
    history,
    path: modelPath(o.page, scope),
    visible,
    owner,
    canonical,
    at,
    go,
    back,
    canBack: !!history.length,
    reveal: (id: string) => go(owner(id), id),
    detail,
    setDetail,
    level: (id: string) =>
      detail[id] && detail[id] !== "auto"
        ? detail[id]
        : o.zoom < 0.65 ||
            (o.zoom <= 1.2 &&
              (o.page.models?.find((m) => m.id === id)?.inputs.length || 0) > 4)
          ? "compact"
          : o.zoom > 1.2
            ? "detail"
            : "interface",
  };
}
