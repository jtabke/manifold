import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { isDialogEvent } from "../interaction/modalInput";
import {
  defaultBindings,
  parseShortcutConfiguration,
  resolveShortcut,
  shortcutConfiguration,
  SHORTCUT_STORAGE,
  type ShortcutAction,
  type ShortcutBindings,
} from "../interaction/shortcutBindings";

export const ShortcutBindingsContext =
  createContext<ShortcutBindings>(defaultBindings);
export function canvasShortcut(
  event: KeyboardEvent,
  bindings: ShortcutBindings,
): ShortcutAction | undefined {
  if (
    isDialogEvent(event) ||
    (event.target instanceof Element &&
      event.target.closest(
        'input,textarea,select,[contenteditable=true],[role=separator],[role=menu],.mw-area:not([data-editor="canvas"])',
      ))
  )
    return;
  return resolveShortcut(event, bindings);
}
export function useShortcutMatcher() {
  const bindings = useContext(ShortcutBindingsContext);
  return useCallback(
    (event: KeyboardEvent) => canvasShortcut(event, bindings),
    [bindings],
  );
}
export function useShortcutPreferences() {
  const [state, setState] = useState(() => {
    try {
      const text = localStorage.getItem(SHORTCUT_STORAGE);
      return {
        bindings: text ? parseShortcutConfiguration(text) : defaultBindings,
        warning: "",
      };
    } catch (error) {
      return {
        bindings: defaultBindings,
        warning: `Saved shortcut preferences could not be loaded; defaults are active. ${String(error)}`,
      };
    }
  });
  const revision = useRef(0);
  const current = useRef(state.bindings);
  const publish = (bindings: ShortcutBindings) => {
    current.current = bindings;
    revision.current++;
    setState({ bindings, warning: "" });
    return bindings;
  };
  const apply = (text: string) => {
    const bindings = parseShortcutConfiguration(text);
    // Web Storage writes are atomic; on failure both live and saved preferences stay unchanged.
    localStorage.setItem(SHORTCUT_STORAGE, shortcutConfiguration(bindings));
    return publish(bindings);
  };
  const replace = (action: ShortcutAction, keys: readonly string[]) => {
    const proposed = { ...current.current, [action]: [...keys] };
    return apply(shortcutConfiguration(proposed));
  };
  const reset = () => {
    localStorage.removeItem(SHORTCUT_STORAGE);
    return publish(defaultBindings);
  };
  return {
    ...state,
    current,
    revision,
    apply,
    replace,
    reset,
    resolve: (event: KeyboardEvent) => canvasShortcut(event, state.bindings),
  };
}
export type ShortcutPreferences = ReturnType<typeof useShortcutPreferences>;
