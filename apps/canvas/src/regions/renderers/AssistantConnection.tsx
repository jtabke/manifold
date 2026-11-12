import { useEffect, useRef, useState } from "react";
import type { AssistantConnectionState as Connection } from "../app/useCanvasAssistant";

type Configuration = {
  defaultProvider: string;
  defaultModel: string;
  providers: {
    id: string;
    name: string;
    configured: boolean;
    models: { id: string; name: string }[];
  }[];
};

/** Configuration stays mounted independently of whether its settings surface is visible. */
export function useAssistantSetup(
  connection: Connection,
  connect: (url: string) => Promise<boolean>,
) {
  const [configuration, setConfiguration] = useState<Configuration>();
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [manualUrl, setManualUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const discovery = useRef<AbortController | undefined>(undefined);
  const pending = useRef<AbortController | undefined>(undefined);
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
      const providers = [...result.providers].sort(
        (a, b) =>
          Number(b.configured) - Number(a.configured) ||
          a.name.localeCompare(b.name),
      );
      const selected =
        providers.find((item) => item.id === result.defaultProvider) ||
        providers.find((item) => item.configured) ||
        providers[0];
      setConfiguration({ ...result, providers });
      setProvider(selected?.id ?? "");
      setModel(
        selected?.models.find((item) => item.id === result.defaultModel)?.id ||
          selected?.models[0]?.id ||
          "",
      );
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
  const selected = configuration?.providers.find(
    (item) => item.id === provider,
  );
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
          provider,
          model,
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
    apiKey,
    manualUrl,
    loading,
    starting,
    error,
    selected,
    canConnect,
    locked: starting || connection !== "offline",
    load,
    start,
    chooseProvider(id: string) {
      const next = configuration?.providers.find((item) => item.id === id);
      setProvider(id);
      setApiKey("");
      setError("");
      setModel(
        configuration &&
          next?.id === configuration.defaultProvider &&
          next?.models.some((item) => item.id === configuration.defaultModel)
          ? configuration.defaultModel
          : next?.models[0]?.id || "",
      );
    },
    chooseModel: setModel,
    changeKey: setApiKey,
    changeManualUrl: setManualUrl,
  };
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
    model,
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
        provider. Edits require your approval. No shell access or automatic
        computation.
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
              {configuration?.providers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {item.configured ? " · Pi credentials found" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Model
            <select
              aria-label="Model"
              value={model}
              disabled={locked || !selected}
              onChange={(event) => setup.chooseModel(event.target.value)}
            >
              <option value="" disabled>
                Choose a model
              </option>
              {selected?.models.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.id}
                </option>
              ))}
            </select>
          </label>
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
