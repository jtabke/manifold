import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";

const clients = { claude: "Claude Code", codex: "Codex" } as const;
type KnownClient = keyof typeof clients;
type Discovery = {
  shell: "posix" | "powershell";
  agents: Record<KnownClient, string | null>;
  mcp: { command: string | null; args: string[] };
};
const knownClients = Object.keys(clients) as KnownClient[];

function absolutePath(value: string, shell: Discovery["shell"]) {
  return (
    !/[\x00-\x1f\x7f]/.test(value) &&
    (shell === "powershell"
      ? /^(?:[a-z]:[\\/]|\\\\)/i.test(value)
      : value.startsWith("/"))
  );
}

function setupCommand(
  client: KnownClient,
  executable: string,
  { shell, mcp }: Discovery,
  canvasUrl: string,
) {
  if (
    !mcp.command ||
    ![executable, mcp.command, ...mcp.args].every((path) =>
      absolutePath(path, shell),
    )
  )
    return "";
  const quote = (value: string) =>
    shell === "powershell"
      ? `'${value.replace(/['‘’]/g, "$&$&")}'`
      : `'${value.replaceAll("'", "'\\''")}'`;
  return [
    shell === "powershell" ? `& ${quote(executable)}` : quote(executable),
    "mcp add --env",
    quote(`MANIFOLD_CANVAS_URL=${canvasUrl}`),
    ...(client === "claude" ? ["--transport stdio --scope local"] : []),
    "manifold --",
    ...[mcp.command, ...mcp.args].map(quote),
  ].join(" ");
}

/** External setup only prints instructions; CanvasMcp still owns the grant. */
export function ExternalAgentSetup({
  close,
  requestConnection,
}: {
  close: () => void;
  requestConnection: (link: string) => string;
}) {
  const [attempt, setAttempt] = useState(1);
  const [check, setCheck] = useState<{
    attempt: number;
    discovery?: Discovery;
  }>();
  const [choice, setChoice] = useState<KnownClient | "other">();
  const [overrides, setOverrides] = useState<
    Partial<Record<KnownClient, string>>
  >({});
  const [copy, setCopy] = useState<{ value: string; message: string }>();
  const [link, setLink] = useState("");
  const [linkError, setLinkError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const setupOutput = useRef<HTMLTextAreaElement>(null);
  const linkInput = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    dialog.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/agent-setup", {
          signal: controller.signal,
        });
        if (!response.ok) throw Error("Discovery unavailable");
        const discovery: Discovery = await response.json();
        if (!controller.signal.aborted) setCheck({ attempt, discovery });
      } catch {
        if (!controller.signal.aborted) setCheck({ attempt });
      }
    })();
    return () => controller.abort();
  }, [attempt]);

  const checking = attempt !== check?.attempt;
  const discovery = checking ? undefined : check?.discovery;
  const client =
    choice ?? knownClients.find((id) => discovery?.agents[id]) ?? "other";
  const detected = client === "other" ? null : discovery?.agents[client];
  const override = client === "other" ? "" : (overrides[client] ?? "");
  const executable = override || detected || "";
  const canvasUrl = `${window.location.origin}/`;
  const config = discovery?.mcp.command && {
    mcpServers: {
      manifold: {
        ...discovery.mcp,
        env: { MANIFOLD_CANVAS_URL: canvasUrl },
      },
    },
  };
  const output =
    client === "other"
      ? config
        ? JSON.stringify(config, null, 2)
        : ""
      : discovery && executable
        ? setupCommand(client, executable, discovery, canvasUrl)
        : "";
  const outputLabel =
    client === "other" ? "MCP configuration" : "Setup command";
  const request = () => {
    const error = requestConnection(link);
    if (!error) return;
    setLinkError(error);
    linkInput.current?.focus();
  };
  return (
    <dialog
      ref={dialog}
      open
      tabIndex={-1}
      className="er-mcp-control er-agent-setup"
      aria-labelledby={title}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <header>
        <h2 id={title}>Connect an external agent</h2>
        <button
          type="button"
          aria-label="Close external agent setup"
          onClick={close}
        >
          <X size={16} />
        </button>
      </header>
      <ol className="er-agent-setup-steps">
        <li>
          <h3>Choose a client</h3>
          <p>
            Detection checks the local server’s PATH, not the client’s sign-in
            or access.
          </p>
          <label>
            External agent
            <select
              aria-label="External agent"
              value={client}
              onChange={(event) =>
                setChoice(event.target.value as typeof client)
              }
            >
              {knownClients.map((id) => (
                <option key={id} value={id}>
                  {clients[id]}
                  {discovery
                    ? discovery.agents[id]
                      ? " · Detected on PATH"
                      : " · Not on PATH"
                    : ""}
                </option>
              ))}
              <option value="other">Other client</option>
            </select>
          </label>
          <button
            type="button"
            disabled={checking}
            onClick={() => setAttempt((value) => value + 1)}
          >
            Refresh installed agents
          </button>
          {checking ? (
            <p role="status">Checking for installed agents…</p>
          ) : !discovery ? (
            <p role="status">
              Local discovery is unavailable. You can still configure a client
              manually.
            </p>
          ) : null}
          {client !== "other" && discovery && (
            <>
              <p role="status">
                {override
                  ? "Using the path you entered. Manifold does not check it."
                  : detected
                    ? `${clients[client]} detected on PATH. Sign-in has not been checked.`
                    : `${clients[client]} was not found on the local server’s PATH.`}
              </p>
              <label>
                {detected
                  ? "Use a different executable path (optional)"
                  : "Executable path"}
                <input
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={4096}
                  value={override}
                  placeholder={
                    detected ??
                    (discovery.shell === "powershell"
                      ? "C:\\path\\to\\agent.exe"
                      : "/path/to/agent")
                  }
                  onChange={(event) =>
                    setOverrides({ ...overrides, [client]: event.target.value })
                  }
                />
              </label>
              {override && !absolutePath(override, discovery.shell) && (
                <p>
                  Enter an absolute executable path without control characters.
                </p>
              )}
            </>
          )}
        </li>
        <li>
          <h3>Configure your client</h3>
          {output ? (
            <>
              <p>
                {client === "other"
                  ? "Add this Manifold stdio server using your client’s MCP settings. Adapt the format if your client does not use mcpServers JSON."
                  : `Run this command in ${discovery?.shell === "powershell" ? "PowerShell" : "a terminal"}${client === "claude" ? " from the project directory where you use Claude Code" : ""}. It adds Manifold to your client’s MCP configuration.`}
              </p>
              <label>
                {outputLabel}
                <textarea
                  rows={client === "other" ? 8 : 3}
                  readOnly
                  ref={setupOutput}
                  value={output}
                  spellCheck={false}
                />
              </label>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(output);
                    setCopy({
                      value: output,
                      message:
                        "Setup instructions copied. Finish setup in your client.",
                    });
                  } catch {
                    if (setupOutput.current?.value !== output) return;
                    setupOutput.current.focus();
                    setupOutput.current.select();
                    setCopy({
                      value: output,
                      message: "Text selected. Copy it manually.",
                    });
                  }
                }}
              >
                Copy {outputLabel.toLowerCase()}
              </button>
              {copy?.value === output && (
                <span role="status"> {copy.message}</span>
              )}
            </>
          ) : !checking && !config ? (
            <p>
              If you have the Manifold tools installed, run{" "}
              <code>manifold mcp-config</code> and add its output to your
              client. Set <code>MANIFOLD_CANVAS_URL</code> to{" "}
              <code>{canvasUrl}</code> in the server entry’s environment.
            </p>
          ) : !checking ? (
            <p>
              Choose a detected client, enter its executable path, or choose
              Other client for generic MCP settings.
            </p>
          ) : null}
        </li>
        <li>
          <h3>Request a connection</h3>
          <p>
            Restart or reconnect your client, then ask it to call{" "}
            <code>connect_canvas</code>. Paste its private link to request
            access to this tab. Pasting the link grants nothing.
          </p>
          <label>
            Private canvas connection link
            <input
              ref={linkInput}
              type="password"
              autoComplete="off"
              maxLength={4096}
              value={link}
              aria-invalid={!!linkError || undefined}
              aria-describedby={linkError ? `${title}-error` : undefined}
              onChange={(event) => {
                setLink(event.target.value);
                setLinkError("");
              }}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.nativeEvent.isComposing &&
                  link.trim()
                ) {
                  event.preventDefault();
                  request();
                }
              }}
            />
          </label>
          <button type="button" disabled={!link.trim()} onClick={request}>
            Review agent permissions
          </button>
          {linkError && (
            <p id={`${title}-error`} role="alert">
              {linkError}
            </p>
          )}
        </li>
      </ol>
    </dialog>
  );
}
