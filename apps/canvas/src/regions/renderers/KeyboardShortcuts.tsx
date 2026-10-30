import { useEffect, useRef, useState } from "react";
import type { ShortcutPreferences } from "../app/useShortcutPreferences";
import { ShortcutCustomization } from "./ShortcutCustomization";
import { Search, X } from "lucide-react";
import {
  findShortcuts,
  keyboardShortcuts,
} from "../interaction/keyboardShortcuts";
import "../styles/keyboardShortcuts.css";

export function KeyboardShortcuts({
  close,
  preferences,
}: {
  close: () => void;
  preferences: ShortcutPreferences;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [customize, setCustomize] = useState(false);
  const matches = findShortcuts(query, preferences.bindings);
  useEffect(() => {
    const previous = document.activeElement;
    const node = dialog.current!;
    node.showModal();
    return () => {
      node.close();
      const target =
        previous instanceof HTMLElement &&
        previous.isConnected &&
        previous !== document.body &&
        previous !== document.documentElement
          ? previous
          : document.querySelector<HTMLButtonElement>(
              '.er-zoom button[aria-label="Keyboard shortcuts"]',
            );
      target?.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    if (!customize) search.current?.focus();
  }, [customize]);
  return (
    <dialog
      ref={dialog}
      className="keyboard-shortcuts"
      aria-labelledby="shortcuts-title"
      aria-describedby="shortcuts-description"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "Tab") {
          const items = [
            ...event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not([disabled]),input:not([disabled]):not([type="hidden"]),textarea:not([disabled]),select:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])',
            ),
          ].filter((node) => node.getClientRects().length);
          const destination =
            event.shiftKey && document.activeElement === items[0]
              ? items.at(-1)
              : !event.shiftKey && document.activeElement === items.at(-1)
                ? items[0]
                : undefined;
          if (destination) {
            event.preventDefault();
            destination.focus();
          }
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          close();
          return;
        }
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === "k"
        ) {
          event.preventDefault();
          setCustomize(false);
          search.current?.focus();
        }
      }}
    >
      <header>
        <h2 id="shortcuts-title">Keyboard shortcuts</h2>
        <button aria-label="Close keyboard shortcuts" onClick={close}>
          <X size={18} />
        </button>
      </header>
      <p id="shortcuts-description">
        ⌘ on Mac · Ctrl on Windows/Linux. Shortcuts depend on focus; text fields
        keep their normal editing keys.
      </p>
      {preferences.warning && <p role="alert">{preferences.warning}</p>}
      <div
        className="shortcut-settings-actions"
        role="group"
        aria-label="Shortcut panel view"
      >
        <button aria-pressed={!customize} onClick={() => setCustomize(false)}>
          Reference
        </button>
        <button aria-pressed={customize} onClick={() => setCustomize(true)}>
          Customize
        </button>
      </div>
      <div hidden={!customize}>
        <ShortcutCustomization preferences={preferences} />
      </div>
      {!customize && (
        <>
          <label className="shortcuts-search">
            <Search size={16} />
            <input
              ref={search}
              type="search"
              aria-label="Search keyboard shortcuts"
              placeholder="Find a key, action or tool…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <p className="shortcuts-count" role="status">
            {matches.length} of {keyboardShortcuts.length} shortcuts
          </p>
          <div className="shortcuts-results">
            {!matches.length && (
              <p>
                No shortcuts match “{query}”. Try “pan”, “drawing” or “undo”.
              </p>
            )}
            {[...new Set(matches.map(([group]) => group))].map((group) => (
              <section key={group} aria-label={group}>
                <h3>{group}</h3>
                <dl>
                  {matches
                    .filter(([category]) => category === group)
                    .map(([, keys, action, scope]) => (
                      <div key={action}>
                        <dt>
                          <span>{action}</span>
                          <kbd>{keys}</kbd>
                        </dt>
                        <dd>{scope}</dd>
                      </div>
                    ))}
                </dl>
              </section>
            ))}
          </div>
        </>
      )}
    </dialog>
  );
}
