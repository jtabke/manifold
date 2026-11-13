import { useRef, useState } from "react";
import {
  CHROME_STORAGE,
  defaultChrome,
  movePanel,
  panelSide,
  restoreChrome,
  type ChromeLayout,
  type ChromePreferences,
  type DockSide,
  type PanelId,
} from "../workspaceChrome";

export function useWorkspaceChrome() {
  const [initial] = useState(() => {
    try {
      const raw = localStorage.getItem(CHROME_STORAGE);
      return {
        value: raw
          ? restoreChrome(raw)
          : { version: 1 as const, layout: defaultChrome(), presets: [] },
        error: "",
      };
    } catch {
      return {
        value: { version: 1 as const, layout: defaultChrome(), presets: [] },
        error:
          "Saved workspace preferences could not be opened. Reset workspace to replace them.",
      };
    }
  });
  const [preferences, setPreferences] = useState<ChromePreferences>(
    initial.value,
  );
  const current = useRef(preferences);
  const [error, setError] = useState(initial.error);
  const blocked = useRef(!!initial.error);
  const publish = (next: ChromePreferences, reset = false) => {
    if (blocked.current && !reset) {
      setError(initial.error);
      return false;
    }
    try {
      restoreChrome(JSON.stringify(next));
      localStorage.setItem(CHROME_STORAGE, JSON.stringify(next));
      current.current = next;
      blocked.current = false;
      setPreferences(next);
      setError("");
      return true;
    } catch {
      setError(
        "Workspace preferences could not be saved. The layout has not changed. Free browser storage and try again.",
      );
      return false;
    }
  };
  const update = (fn: (layout: ChromeLayout) => ChromeLayout) =>
    publish({ ...current.current, layout: fn(current.current.layout) });
  return {
    preferences,
    error,
    update,
    show(id: PanelId, visible: boolean) {
      return update((layout) =>
        movePanel(
          layout,
          id,
          visible ? panelSide(layout, id) || "right" : undefined,
        ),
      );
    },
    move(id: PanelId, side: DockSide) {
      update((layout) => movePanel(layout, id, side));
    },
    reset() {
      publish({ ...current.current, layout: defaultChrome() }, true);
    },
    save(name: string) {
      const trimmed = name.trim().slice(0, 60);
      if (!trimmed) return;
      const prev = current.current;
      const presets = prev.presets.filter((p) => p.name !== trimmed);
      if (presets.length >= 12) {
        setError("Up to 12 workspace presets can be saved. Delete one first.");
        return;
      }
      publish({
        ...prev,
        presets: [
          ...presets,
          { name: trimmed, layout: structuredClone(prev.layout) },
        ],
      });
    },
    load(name: string) {
      const preset = current.current.presets.find((p) => p.name === name);
      if (preset)
        publish({ ...current.current, layout: structuredClone(preset.layout) });
    },
    remove(name: string) {
      publish({
        ...current.current,
        presets: current.current.presets.filter((p) => p.name !== name),
      });
    },
  };
}
export type WorkspaceChromeState = ReturnType<typeof useWorkspaceChrome>;
