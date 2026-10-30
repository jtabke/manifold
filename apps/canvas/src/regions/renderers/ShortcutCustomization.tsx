import { useEffect, useRef, useState } from "react";
import type { ShortcutPreferences } from "../app/useShortcutPreferences";
import {
  defaultBindings,
  normalizeShortcut,
  shortcutActions,
  shortcutConfiguration,
  shortcutFromEvent,
  shortcutLabel,
  MAX_SHORTCUT_CONFIG_BYTES,
  type ShortcutAction,
  type ShortcutBindings,
} from "../interaction/shortcutBindings";

export function ShortcutCustomization({
  preferences,
}: {
  preferences: ShortcutPreferences;
}) {
  const [capture, setCapture] = useState<{
    action: ShortcutAction;
    key: string;
    origin: HTMLButtonElement;
  }>();
  const [json, setJson] = useState<string>();
  const [feedback, setFeedback] = useState<{ message: string; error?: true }>();
  const report = (failure: unknown) =>
    setFeedback({
      message: failure instanceof Error ? failure.message : String(failure),
      error: true,
    });
  const [loading, setLoading] = useState(false);
  const file = useRef<HTMLInputElement>(null),
    request = useRef(0);
  const finishCapture = () => {
    setCapture(undefined);
    capture?.origin.focus({ preventScroll: true });
  };
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  const interruptImport = () => {
    request.current++;
    setLoading(false);
  };
  const accept = (run: () => ShortcutBindings, message: string) => {
    interruptImport();
    try {
      const bindings = run();
      setFeedback({ message });
      if (json !== undefined) setJson(shortcutConfiguration(bindings));
      return true;
    } catch (failure) {
      report(failure);
      return false;
    }
  };
  const importFile = async (incoming: File) => {
    const token = ++request.current,
      revision = preferences.revision.current;
    setFeedback(undefined);
    setLoading(false);
    if (incoming.size > MAX_SHORTCUT_CONFIG_BYTES) {
      report("Shortcut configuration must be at most 64 KiB.");
      return;
    }
    setLoading(true);
    try {
      const text = await incoming.text();
      if (token !== request.current) return;
      if (revision !== preferences.revision.current)
        throw Error(
          "Shortcut settings changed during import. Import the file again.",
        );
      // Completion shares the UI mutation path, including invalidating this read and clearing loading.
      accept(() => preferences.apply(text), "Imported shortcut configuration.");
    } catch (failure) {
      if (token === request.current) report(failure);
    } finally {
      if (token === request.current) setLoading(false);
    }
  };
  const exportFile = () => {
    const url = URL.createObjectURL(
      new Blob([shortcutConfiguration(preferences.current.current) + "\n"], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "manifold-shortcuts.json";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  return (
    <section
      className="shortcut-customization"
      aria-label="Customize canvas shortcuts"
    >
      <p>
        Canvas focus only. Text-editor keys and gestures stay fixed.{" "}
        <kbd>Mod</kbd> means ⌘ or Ctrl. Some browser/OS combinations are
        protected or may not reach the canvas.
      </p>
      <div className="shortcut-settings-actions">
        <button onClick={() => file.current?.click()} disabled={loading}>
          {loading ? "Reading…" : "Import JSON…"}
        </button>
        <button onClick={exportFile}>Export JSON</button>
        <button
          aria-expanded={json !== undefined}
          onClick={() => {
            interruptImport();
            setJson(
              json === undefined
                ? shortcutConfiguration(preferences.current.current)
                : undefined,
            );
          }}
        >
          Edit configuration
        </button>
        <button
          onClick={() =>
            accept(preferences.reset, "Default canvas shortcuts restored.")
          }
        >
          Reset all shortcuts
        </button>
        <input
          ref={file}
          type="file"
          accept=".json,application/json"
          aria-label="Import shortcut configuration"
          hidden
          onChange={(event) => {
            const incoming = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (incoming) void importFile(incoming);
          }}
        />
      </div>
      <div className="shortcut-binding-list">
        {shortcutActions.map((action) => (
          <div key={action.id} className="shortcut-binding-row">
            <div>
              <strong>{action.label}</strong>
              <kbd>{shortcutLabel(preferences.bindings[action.id])}</kbd>
            </div>
            <div className="shortcut-settings-actions">
              <button
                aria-label={`Change ${action.label} shortcut`}
                onClick={(event) => {
                  interruptImport();
                  setCapture({
                    action: action.id,
                    key: "",
                    origin: event.currentTarget,
                  });
                  setFeedback(undefined);
                }}
              >
                Change
              </button>
              {(["Clear", "Reset"] as const).map((label) => (
                <button
                  key={label}
                  aria-label={`${label} ${action.label} shortcut`}
                  onClick={() =>
                    accept(
                      () =>
                        preferences.replace(
                          action.id,
                          label === "Clear" ? [] : defaultBindings[action.id],
                        ),
                      `${action.label} ${label === "Clear" ? "is unassigned" : "reset to default"}.`,
                    )
                  }
                >
                  {label}
                </button>
              ))}
            </div>
            {capture?.action === action.id && (
              <label className="shortcut-capture">
                Press a replacement for {action.label}
                <input
                  autoFocus
                  readOnly
                  aria-label={`Record ${action.label} shortcut`}
                  aria-describedby="shortcut-capture-help"
                  value={capture.key}
                  placeholder="Press a shortcut…"
                  onKeyDown={(event) => {
                    if (event.key === "Tab") return;
                    event.stopPropagation();
                    if (
                      event.nativeEvent.isComposing ||
                      event.keyCode === 229 ||
                      event.getModifierState("AltGraph")
                    )
                      return;
                    event.preventDefault();
                    if (event.key === "Escape") {
                      finishCapture();
                      return;
                    }
                    if (["Shift", "Control", "Meta", "Alt"].includes(event.key))
                      return;
                    const combo = shortcutFromEvent(event.nativeEvent);
                    setCapture({ ...capture, key: combo || event.key });
                    if (
                      accept(() => {
                        if (!combo)
                          throw Error(
                            "Use a modified letter/digit or F1/F2/F8/F9; typing and editing keys are protected.",
                          );
                        return preferences.replace(action.id, [
                          normalizeShortcut(combo),
                        ]);
                      }, `${action.label} shortcut updated.`)
                    )
                      finishCapture();
                  }}
                />
                <small id="shortcut-capture-help">
                  Escape cancels capture. Conflicting or protected keys leave
                  the current settings unchanged.
                </small>
              </label>
            )}
          </div>
        ))}
      </div>
      {json !== undefined && (
        <section className="shortcut-json" aria-label="Shortcut JSON editor">
          <label>
            Configuration (JSON)
            <textarea
              spellCheck={false}
              aria-label="Shortcut configuration JSON"
              value={json}
              onChange={(event) => {
                interruptImport();
                setJson(event.target.value);
              }}
            />
          </label>
          <p>
            Version 1; context must be <code>canvas</code>. Omitted actions use
            defaults; <code>keys: []</code> disables a binding. Changes apply
            together, only after validation and a successful local save.
          </p>
          <button
            onClick={() =>
              accept(
                () => preferences.apply(json),
                "Shortcut configuration applied.",
              )
            }
          >
            Apply JSON
          </button>
        </section>
      )}
      {feedback && (
        <p
          role={feedback.error ? "alert" : "status"}
          className={feedback.error ? "shortcut-settings-error" : undefined}
        >
          {feedback.message}
          {feedback.error && " No shortcuts were changed."}
        </p>
      )}
    </section>
  );
}
