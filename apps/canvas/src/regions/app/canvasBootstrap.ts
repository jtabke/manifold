import { decodeWorkspace, STORAGE } from "../artifacts.ts";
import { openCanvasStore, type CanvasLocalStore } from "./canvasLocalStore.ts";
import type { CanvasRecovery } from "./canvasDocument.ts";
import { SCENE_STORAGE } from "../canvasScene.ts";
export type InitialWorkspace = {
  data?: Awaited<ReturnType<typeof decodeWorkspace>> & {
    recovery?: CanvasRecovery;
  };
  store?: CanvasLocalStore;
  error?: string;
  blocked?: boolean;
  legacyRescue?: string;
  legacyScene?: string;
};
export const primaryMarkerKey = (key: string) => key + ".indexed-primary.v1";
/** This small best-effort marker prevents treating an older native backup as a new primary. */
export function markCanvasPrimary(key: string) {
  try {
    if (localStorage.getItem(primaryMarkerKey(key)) !== "1")
      localStorage.setItem(primaryMarkerKey(key), "1");
  } catch {
    /* The committed IndexedDB head remains authoritative. */
  }
}
/** The new durable head wins. An unreadable head never silently falls back to an older backup. */
export async function bootstrapCanvas(): Promise<InitialWorkspace> {
  const params = new URLSearchParams(window.location.search);
  if (params.has("trial") && !params.has("artifacts")) return {};
  let legacyScene: string | undefined;
  try {
    legacyScene = localStorage.getItem(SCENE_STORAGE) ?? undefined;
  } catch {
    /* Optional legacy layout remains separate from work availability. */
  }
  let store: CanvasLocalStore;
  try {
    store = await openCanvasStore(STORAGE);
  } catch (error) {
    let data: InitialWorkspace["data"];
    let text: string | null = null;
    try {
      if (localStorage.getItem(primaryMarkerKey(STORAGE)) !== "1") {
        text = localStorage.getItem(STORAGE);
        if (text) data = await decodeWorkspace(text, legacyScene);
      }
    } catch {
      return {
        error:
          "Saved workspace could not be opened. Its raw copy is preserved; try Export saved work to recover a validated copy.",
        blocked: true,
        legacyRescue: text ?? undefined,
        legacyScene,
      };
    }
    return {
      data,
      error: `Local storage is unavailable: ${(error as Error).message}. Export workspace to keep new work.`,
    };
  }
  try {
    const loaded = await store.load({}, legacyScene);
    if (loaded) {
      markCanvasPrimary(STORAGE);
      return { data: loaded, store };
    }
  } catch (error) {
    return {
      store,
      error: `Saved workspace could not be opened: ${(error as Error).message}. Its data is preserved; try Export saved work to recover a validated copy.`,
      blocked: true,
      legacyScene,
    };
  }
  let legacyText: string | null = null;
  try {
    if (localStorage.getItem(primaryMarkerKey(STORAGE)) === "1")
      return {
        store,
        blocked: true,
        error:
          "Saved primary storage is missing. The older native backup is preserved and has not replaced it.",
      };
    legacyText = localStorage.getItem(STORAGE);
    return {
      store,
      ...(legacyText
        ? { data: await decodeWorkspace(legacyText, legacyScene) }
        : {}),
    };
  } catch {
    return {
      store,
      error:
        "Saved workspace could not be opened. Its raw copy is preserved; try Export saved work to recover a validated copy.",
      blocked: true,
      legacyRescue: legacyText ?? undefined,
      legacyScene,
    };
  }
}
