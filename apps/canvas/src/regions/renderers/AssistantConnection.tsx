import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { AssistantConnectionState as Connection } from "../app/useCanvasAssistant";
import type {
  AssistantPermission,
  AssistantSettings,
} from "../assistantSettings";

type ConfiguredModel = {
  id: string;
  name: string;
  thinkingLevels: string[];
  defaultThinking: string;
};
type Configuration = {
  defaultProvider: string;
  defaultModel: string;
  providers: {
    id: string;
    name: string;
    configured: boolean;
    models: ConfiguredModel[];
  }[];
};
function modelSettings(model: ConfiguredModel): ConfiguredModel {
  const levels = Array.isArray(model.thinkingLevels)
    ? [
        ...new Set(
          model.thinkingLevels.filter(
            (level) => typeof level === "string" && level,
          ),
        ),
      ]
    : [];
  const thinkingLevels = levels.length ? levels : ["off"];
  return {
    ...model,
    thinkingLevels,
    defaultThinking: thinkingLevels.includes(model.defaultThinking)
      ? model.defaultThinking
      : thinkingLevels.includes("off")
        ? "off"
        : thinkingLevels[0],
  };
}
type SetupOptions = {
  busy?: boolean;
  permissions: AssistantPermission;
  setPermissions: (value: AssistantPermission) => void;
  activeSettings?: AssistantSettings;
};

/** Configuration stays mounted independently of whether its settings surface is visible. */
export function useAssistantSetup(
  connection: Connection,
  connect: (url: string) => Promise<boolean>,
  options?: SetupOptions,
) {
  const [configuration, setConfiguration] = useState<Configuration>();
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [thinking, setThinking] = useState("off");
  const [localPermissions, setLocalPermissions] =
    useState<AssistantPermission>("reviewed-edits");
  const [apiKey, setApiKey] = useState("");
  const [manualUrl, setManualUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const discovery = useRef<AbortController | undefined>(undefined);
  const pending = useRef<AbortController | undefined>(undefined);
  const activeSettings = options?.activeSettings;
  const acknowledged = useRef(activeSettings);
  acknowledged.current = connection === "ready" ? activeSettings : undefined;
  const permissions = options?.permissions ?? localPermissions;
  const choosePermissions = (value: AssistantPermission) => {
    if (preferencesLocked) return;
    if (options) options.setPermissions(value);
    else setLocalPermissions(value);
  };
  const load = async () => {
    discovery.current?.abort();
    const request = new AbortController();
    discovery.current = request;
    setLoading(true);
    setError("");
    setApiKey("");
    try {
      const response = await fetch("/api/assistant/configuration", {
        signal: request.signal,
      });
      const data = await response.json();
      if (!response.ok)
        throw Error(data.error || "Could not read local Pi configuration");
      if (request.signal.aborted) return;
      const result = data as Configuration;
      const providers = result.providers
        .map((item) => ({
          ...item,
          models: item.models.map(modelSettings),
        }))
        .sort(
          (a, b) =>
            Number(b.configured) - Number(a.configured) ||
            a.name.localeCompare(b.name),
        );
      const current = acknowledged.current;
      const selected =
        providers.find((item) => item.id === current?.provider) ||
        providers.find((item) => item.id === result.defaultProvider) ||
        providers.find((item) => item.configured) ||
        providers[0];
      setConfiguration({ ...result, providers });
      if (current) {
        setProvider(current.provider);
        setModel(current.model);
        setThinking(current.thinking);
      } else {
        const selectedModel =
          selected?.models.find((item) => item.id === result.defaultModel) ||
          selected?.models[0];
        setProvider(selected?.id ?? "");
        setModel(selectedModel?.id || "");
        setThinking(selectedModel?.defaultThinking || "off");
      }
    } catch (failure) {
      if (!request.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : "Assistant configuration is unavailable",
        );
    } finally {
      if (!request.signal.aborted) setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    return () => {
      discovery.current?.abort();
      pending.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (connection !== "ready" || !activeSettings) return;
    setProvider(activeSettings.provider);
    setModel(activeSettings.model);
    setThinking(activeSettings.thinking);
    if (options) options.setPermissions(activeSettings.permissions);
    else setLocalPermissions(activeSettings.permissions);
    // Only new acknowledgements synchronize preferences. A local permission
    // change must not be replaced by settings acknowledged on a previous turn.
  }, [
    connection,
    activeSettings?.provider,
    activeSettings?.model,
    activeSettings?.thinking,
    activeSettings?.permissions,
  ]);
  const selected = configuration?.providers.find(
    (item) => item.id === provider,
  );
  const models = [...(selected?.models ?? [])];
  if (model && !models.some((item) => item.id === model))
    models.push({
      id: model,
      name: model,
      thinkingLevels: [thinking || "off"],
      defaultThinking: thinking || "off",
    });
  const selectedModel = models.find((item) => item.id === model);
  const thinkingLevels = [...(selectedModel?.thinkingLevels ?? ["off"])];
  if (
    activeSettings?.provider === provider &&
    activeSettings.model === model &&
    activeSettings.thinking === thinking &&
    !thinkingLevels.includes(thinking)
  )
    thinkingLevels.push(thinking);
  const preferencesLocked =
    !!options?.busy || starting || loading || connection === "connecting";
  const preferences: AssistantSettings = {
    provider,
    model,
    thinking,
    permissions,
  };
  const canConnect =
    !!provider && !!model && (!!selected?.configured || !!apiKey.trim());
  const start = async (): Promise<boolean> => {
    if (connection === "ready") return true;
    if (pending.current || loading || connection === "connecting") return false;
    if (!canConnect) {
      setError(
        error ||
          "Choose a provider and model, then configure credentials to send your request.",
      );
      return false;
    }
    const request = new AbortController();
    pending.current = request;
    setStarting(true);
    setError("");
    const key = apiKey.trim();
    setApiKey("");
    try {
      const response = await fetch("/api/assistant/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: request.signal,
        body: JSON.stringify({
          ...preferences,
          ...(key ? { apiKey: key } : {}),
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw Error(result.error || "Could not connect the assistant");
      return !request.signal.aborted && (await connect(result.url));
    } catch (failure) {
      if (!request.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : "Could not connect the assistant",
        );
      return false;
    } finally {
      if (!request.signal.aborted) setStarting(false);
      if (pending.current === request) pending.current = undefined;
    }
  };
  return {
    configuration,
    provider,
    model,
    models,
    thinking,
    thinkingLevels,
    permissions,
    preferences,
    apiKey,
    manualUrl,
    loading,
    starting,
    error,
    selected,
    canConnect,
    locked: preferencesLocked || connection !== "offline",
    preferencesLocked,
    load,
    start,
    chooseProvider(id: string) {
      if (preferencesLocked || connection !== "offline") return;
      const next = configuration?.providers.find((item) => item.id === id);
      setProvider(id);
      setApiKey("");
      setError("");
      const selectedModel =
        configuration &&
        next?.id === configuration.defaultProvider &&
        next?.models.some((item) => item.id === configuration.defaultModel)
          ? next.models.find((item) => item.id === configuration.defaultModel)
          : next?.models[0];
      setModel(selectedModel?.id || "");
      setThinking(selectedModel?.defaultThinking || "off");
    },
    chooseModel(id: string) {
      if (preferencesLocked) return;
      const next = models.find((item) => item.id === id);
      if (!next) return;
      setModel(id);
      setThinking((previous) =>
        next.thinkingLevels.includes(previous)
          ? previous
          : next.defaultThinking,
      );
      setError("");
    },
    chooseThinking(value: string) {
      if (!preferencesLocked && thinkingLevels.includes(value))
        setThinking(value);
    },
    choosePermissions,
    changeKey: setApiKey,
    changeManualUrl: setManualUrl,
  };
}

function thinkingLabel(level: string) {
  return level === "off"
    ? "Off"
    : level.charAt(0).toUpperCase() + level.slice(1);
}

function ComposerPreferences({
  setup,
}: {
  setup: ReturnType<typeof useAssistantSetup>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const [pickerHeight, setPickerHeight] = useState(300);
  const [pickerWidth, setPickerWidth] = useState(300);
  const surface = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const id = useId();
  const models = setup.models.filter((item) =>
    `${item.name} ${item.id}`
      .toLowerCase()
      .includes(query.toLowerCase().trim()),
  );
  const selectedModel = setup.models.find((item) => item.id === setup.model);
  const dismiss = (restore = true) => {
    setOpen(false);
    if (restore) trigger.current?.focus();
  };
  const choose = (model: string) => {
    setup.chooseModel(model);
    dismiss();
  };
  useLayoutEffect(() => {
    if (!open) return;
    const dialog = surface.current?.closest("dialog");
    if (!dialog) return;
    const measure = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      if (anchor) {
        const bounds = dialog.getBoundingClientRect();
        setPickerHeight(
          Math.max(72, Math.min(360, anchor.top - bounds.top - 8)),
        );
        setPickerWidth(
          Math.max(
            0,
            Math.min(
              340,
              bounds.right - anchor.left - 10,
              window.innerWidth - anchor.left - 10,
            ),
          ),
        );
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(dialog);
    return () => observer.disconnect();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!surface.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [open]);
  useEffect(() => {
    if (setup.preferencesLocked) setOpen(false);
  }, [setup.preferencesLocked]);
  useEffect(() => {
    if (open)
      document.getElementById(`${id}-model-${highlighted}`)?.scrollIntoView({
        block: "nearest",
      });
  }, [open, highlighted, id]);
  return (
    <div
      className="assistant-preferences is-compact"
      role="group"
      aria-label="Request settings"
    >
      <div className="assistant-model-choice" ref={surface}>
        <button
          ref={trigger}
          type="button"
          className="assistant-model-trigger"
          aria-label="Choose assistant model and thinking"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={`${id}-picker`}
          disabled={setup.preferencesLocked || !setup.models.length}
          onClick={() => {
            setQuery("");
            setHighlighted(
              Math.max(
                0,
                setup.models.findIndex((item) => item.id === setup.model),
              ),
            );
            setOpen(!open);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setQuery("");
              setHighlighted(
                Math.max(
                  0,
                  setup.models.findIndex((item) => item.id === setup.model),
                ),
              );
              setOpen(true);
            }
          }}
          title={`${setup.provider}/${setup.model} · Thinking ${thinkingLabel(setup.thinking)}`}
        >
          <span>{selectedModel?.name || setup.model || "Choose a model"}</span>
          <small>Thinking {thinkingLabel(setup.thinking)} ▾</small>
        </button>
        {open && (
          <div
            id={`${id}-picker`}
            className="assistant-model-picker"
            style={{ maxHeight: pickerHeight, width: pickerWidth }}
            role="dialog"
            aria-label="Assistant model and thinking"
            onKeyDown={(event) => {
              if (event.key === "Escape" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.stopPropagation();
                dismiss();
              }
            }}
            onBlur={(event) => {
              if (
                !surface.current?.contains(event.relatedTarget as Node | null)
              )
                setOpen(false);
            }}
          >
            <input
              ref={search}
              type="search"
              role="combobox"
              aria-label="Search assistant models"
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls={`${id}-models`}
              aria-activedescendant={
                models[highlighted] ? `${id}-model-${highlighted}` : undefined
              }
              placeholder="Search models…"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setHighlighted(0);
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  if (models.length)
                    setHighlighted(
                      (previous) =>
                        (previous +
                          (event.key === "ArrowDown" ? 1 : models.length - 1)) %
                        models.length,
                    );
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  if (models[highlighted]) choose(models[highlighted].id);
                }
              }}
            />
            <div
              id={`${id}-models`}
              className="assistant-model-options"
              role="listbox"
              aria-label="Available assistant models"
            >
              {models.map((item, index) => (
                <button
                  id={`${id}-model-${index}`}
                  key={item.id}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={item.id === setup.model}
                  data-highlighted={index === highlighted}
                  onMouseMove={() => setHighlighted(index)}
                  onClick={() => choose(item.id)}
                >
                  <span>{item.name || item.id}</span>
                  {item.name !== item.id && <small>{item.id}</small>}
                </button>
              ))}
            </div>
            {!models.length && <p role="status">No matching models.</p>}
            <label>
              Thinking effort
              <select
                aria-label="Assistant thinking"
                value={setup.thinking}
                disabled={
                  setup.preferencesLocked || setup.thinkingLevels.length < 2
                }
                onChange={(event) => setup.chooseThinking(event.target.value)}
              >
                {setup.thinkingLevels.map((level) => (
                  <option key={level} value={level}>
                    {thinkingLabel(level)}
                  </option>
                ))}
              </select>
            </label>
            {setup.thinkingLevels.length < 2 && (
              <small>
                This model uses {thinkingLabel(setup.thinking).toLowerCase()}{" "}
                thinking.
              </small>
            )}
            <button
              type="button"
              className="assistant-picker-done"
              onClick={() => dismiss()}
            >
              Done
            </button>
          </div>
        )}
      </div>
      <label>
        <span className="assistant-visually-hidden">Request access</span>
        <select
          aria-label="Assistant permissions"
          value={setup.permissions}
          disabled={setup.preferencesLocked}
          title={
            setup.permissions === "read-only"
              ? "Inspect and explain; editing tools are disabled"
              : "Propose edits; you approve each change"
          }
          onChange={(event) =>
            setup.choosePermissions(event.target.value as AssistantPermission)
          }
        >
          <option value="read-only">Read-only</option>
          <option value="reviewed-edits">Review edits</option>
        </select>
      </label>
    </div>
  );
}

export function AssistantPreferences({
  setup,
  compact = false,
}: {
  setup: ReturnType<typeof useAssistantSetup>;
  compact?: boolean;
}) {
  if (compact) return <ComposerPreferences setup={setup} />;
  return (
    <div
      className={
        compact ? "assistant-preferences is-compact" : "assistant-preferences"
      }
      role="group"
      aria-label={compact ? "Request settings" : "Assistant preferences"}
    >
      <label>
        Model
        <select
          aria-label={compact ? "Assistant model" : "Model"}
          value={setup.model}
          disabled={setup.preferencesLocked || !setup.models.length}
          onChange={(event) => setup.chooseModel(event.target.value)}
        >
          <option value="" disabled>
            Choose a model
          </option>
          {setup.models.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name || item.id}
            </option>
          ))}
        </select>
      </label>
      <label>
        Thinking
        <select
          aria-label={compact ? "Assistant thinking" : "Thinking"}
          value={setup.thinking}
          disabled={setup.preferencesLocked || setup.thinkingLevels.length < 2}
          onChange={(event) => setup.chooseThinking(event.target.value)}
        >
          {setup.thinkingLevels.map((level) => (
            <option key={level} value={level}>
              {thinkingLabel(level)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Access
        <select
          aria-label={compact ? "Assistant permissions" : "Permissions"}
          value={setup.permissions}
          disabled={setup.preferencesLocked}
          onChange={(event) =>
            setup.choosePermissions(event.target.value as AssistantPermission)
          }
        >
          <option value="read-only">Read-only</option>
          <option value="reviewed-edits">Review edits</option>
        </select>
      </label>
    </div>
  );
}

export function AssistantConnection({
  setup,
  connection,
  connect,
  disconnect,
}: {
  setup: ReturnType<typeof useAssistantSetup>;
  connection: Connection;
  connect: (url: string) => Promise<boolean>;
  disconnect: () => void;
}) {
  const {
    configuration,
    provider,
    apiKey,
    manualUrl,
    loading,
    starting,
    error,
    selected,
    locked,
  } = setup;
  return (
    <div className="assistant-settings">
      <h3>Assistant settings</h3>
      <p className="assistant-privacy">
        Requests and inspected canvas content go to your configured model
        provider. Requested canvas images also reach that provider; assistant
        settings and credentials are excluded from capture.{" "}
        {setup.permissions === "read-only"
          ? "Read-only access allows inspection and explanations; editing tools are disabled."
          : "Edits are proposed for your review and require your approval."}{" "}
        No shell access or automatic computation.
      </p>
      {loading ? (
        <p role="status">Reading your local Pi configuration…</p>
      ) : (
        <>
          <label>
            Provider
            <select
              aria-label="Provider"
              value={provider}
              disabled={locked || !configuration}
              onChange={(event) => setup.chooseProvider(event.target.value)}
            >
              <option value="" disabled>
                Choose a provider
              </option>
              {provider &&
                !configuration?.providers.some(
                  (item) => item.id === provider,
                ) && (
                  <option value={provider}>
                    {provider} · connected companion
                  </option>
                )}
              {configuration?.providers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {item.configured ? " · Pi credentials found" : ""}
                </option>
              ))}
            </select>
          </label>
          <AssistantPreferences setup={setup} />
          {selected?.configured ? (
            <p>
              Using your existing Pi credentials. No additional login needed.
            </p>
          ) : (
            selected && (
              <p>
                No saved Pi credentials detected. Enter an API key below, or
                sign in with Pi and refresh.
              </p>
            )
          )}
          <details>
            <summary>
              {selected?.configured
                ? "Use a different API key"
                : "Configure an API key"}
            </summary>
            <label>
              Provider API key
              <input
                type="password"
                autoComplete="off"
                value={apiKey}
                disabled={locked}
                onChange={(event) => setup.changeKey(event.target.value)}
              />
            </label>
            <small>
              Optional. Kept only in this assistant connection’s memory—not
              written to Pi, browser storage, or your canvas. Existing Pi
              credentials are used when blank.
            </small>
          </details>
          {connection === "offline" ? (
            <button
              type="button"
              disabled={starting || !setup.canConnect}
              onClick={() => void setup.start()}
            >
              {starting ? "Connecting…" : "Connect assistant"}
            </button>
          ) : (
            <button type="button" onClick={disconnect}>
              Disconnect
            </button>
          )}
          {!locked && (
            <button type="button" onClick={() => void setup.load()}>
              Refresh Pi configuration
            </button>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="assistant-error">
          {error}
        </p>
      )}
      <details>
        <summary>Advanced: connect a separate companion</summary>
        <label>
          Companion connection URL
          <input
            type="password"
            autoComplete="off"
            value={manualUrl}
            disabled={locked}
            onChange={(event) => setup.changeManualUrl(event.target.value)}
          />
        </label>
        <button
          type="button"
          onClick={() => void connect(manualUrl)}
          disabled={locked || !manualUrl}
        >
          Connect
        </button>
      </details>
    </div>
  );
}
