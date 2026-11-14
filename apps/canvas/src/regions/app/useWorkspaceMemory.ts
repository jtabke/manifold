import {
  canvasScroll,
  canvasZoom,
  scrollCanvasTo,
} from "../interaction/canvasViewport";
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import {
  documentKey,
  MEMORY_STORAGE,
  type WorkspaceMemory,
} from "../workspaceMemory";
import type { Page } from "../document";
import type { Camera } from "../canvasScene";
export function useWorkspaceMemory(o: {
  enabled: boolean;
  canvas: RefObject<HTMLDivElement | null>;
  page: Page;
  document?: string;
  zoom: number;
  scope?: string;
  selected?: string;
  selection: string[];
  cameras: Map<string, Camera>;
  history: WorkspaceMemory["history"];
  initial?: WorkspaceMemory;
  stable: boolean;
  system?: WorkspaceMemory["system"];
}) {
  const ready = useRef(!o.initial),
    latest = useRef(o),
    scheduleSave = useRef<(() => void) | undefined>(undefined);
  latest.current = o;
  useLayoutEffect(() => {
    if (!o.initial) return;
    let token = requestAnimationFrame(() => {
      token = requestAnimationFrame(() => {
        scrollCanvasTo(o.canvas.current, {
          left: o.initial!.camera.x,
          top: o.initial!.camera.y,
        });
        ready.current = true;
      });
    });
    return () => cancelAnimationFrame(token);
  }, []);
  useEffect(() => {
    if (!o.enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined,
      saved: string | undefined;
    const save = () => {
      clearTimeout(timer);
      timer = undefined;
      const next = latest.current,
        node = next.canvas.current;
      if (!ready.current || !node || !next.stable) return;
      const memory: WorkspaceMemory = {
        version: next.document ? 2 : 1,
        document: next.document ?? documentKey(next.page),
        scope: next.scope,
        camera: {
          x: canvasScroll(node).x,
          y: canvasScroll(node).y,
          zoom: canvasZoom(node, next.zoom),
        },
        selected: next.selected,
        selection: next.selection,
        cameras: Object.fromEntries(next.cameras),
        history: next.history,
        ...(next.system ? { system: next.system } : {}),
      };
      try {
        const serialized = JSON.stringify(memory);
        if (serialized === saved) return;
        localStorage.setItem(MEMORY_STORAGE, serialized);
        saved = serialized;
      } catch {
        /* Navigation remains usable without optional view storage. */
      }
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(save, 120);
    };
    scheduleSave.current = schedule;
    const node = o.canvas.current;
    node?.addEventListener("scroll", schedule);
    node?.addEventListener("canvaszoom", schedule);
    window.addEventListener("pagehide", save);
    const visibility = () => {
      if (document.hidden) save();
    };
    document.addEventListener("visibilitychange", visibility);
    schedule();
    return () => {
      save();
      scheduleSave.current = undefined;
      node?.removeEventListener("scroll", schedule);
      node?.removeEventListener("canvaszoom", schedule);
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [o.enabled, o.canvas]);
  // Updating the snapshot must not run the listener cleanup: that flushes on
  // exit, not on every camera/selection change during a gesture.
  useEffect(
    () => scheduleSave.current?.(),
    [
      o.enabled,
      o.document,
      o.page,
      o.zoom,
      o.scope,
      o.selected,
      o.selection,
      o.history,
      o.stable,
      o.system?.open,
      o.system?.investigating,
      o.system?.anchor,
      o.system?.response,
      o.system?.positions,
      o.system?.input,
      o.system?.output,
      o.system?.failure,
    ],
  );
}
