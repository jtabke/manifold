import { useEffect, useLayoutEffect, useRef, useState } from "react";
import "../styles/assistant.css";
import { AssistantConnection, useAssistantSetup } from "./AssistantConnection";
import {
  ArrowDown,
  ArrowUp,
  MessageSquare,
  Settings,
  ShieldCheck,
  Square,
  X,
  Info,
  Minus,
  PanelRight,
  PanelsTopLeft,
  Move,
  Maximize2,
} from "lucide-react";
import type { Point, RegionSession } from "../document";
import { useCanvasAssistant } from "../app/useCanvasAssistant";
import { AssistantConversation } from "./AssistantConversation";
import type { WorkspaceEdits } from "../app/workspaceFiles";
import type { AssistantCanvasPort } from "../assistantCanvas";
import { useAssistantWindow } from "../app/useAssistantWindow";

const starters = [
  {
    label: "Explain this work",
    prompt:
      "Explain the selected work, or the worksheet if nothing is selected. Summarize the relationships and assumptions.",
  },
  {
    label: "Review assumptions",
    prompt:
      "Review the assumptions and units in this work. Point out missing information without inventing results.",
  },
  {
    label: "Suggest a next step",
    prompt:
      "Inspect this work and suggest a useful next step. Explain your reasoning before proposing any edits.",
  },
];

export function CanvasAssistant({
  session,
  selection,
  edits,
  close,
  anchor,
  canvas,
  floating,
  minimized,
  changePresentation,
  reveal,
}: {
  floating: boolean;
  minimized: boolean;
  changePresentation: (value: {
    floating: boolean;
    minimized: boolean;
  }) => void;
  reveal: (id: string, input?: string) => Promise<boolean>;
  canvas: AssistantCanvasPort;
  anchor: Point;
  session: RegionSession;
  selection: string[];
  edits: WorkspaceEdits;
  close: () => void;
}) {
  const assistant = useCanvasAssistant(session, edits, canvas);
  const {
    connection,
    connect,
    disconnect,
    turns,
    proposals,
    busy,
    submitting,
    error,
    activity,
    stop,
    resolve,
  } = assistant;
  const [prompt, setPrompt] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const requestInput = useRef<HTMLTextAreaElement>(null);
  const popup = useRef<HTMLDialogElement>(null);
  const conversation = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const changingPresentation = useRef(false);
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  const windowControls = useAssistantWindow(anchor);
  const movable = floating && !windowControls.compact;
  const [excluded, setExcluded] = useState<string[]>([]);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const attached = selection.filter((id) => !excluded.includes(id));
  const contextName = (id: string) =>
    session.document.items.get(id)?.label ||
    session.state.regions
      .find((region) => region.id === id)
      ?.text.slice(0, 60) ||
    "Canvas object";
  const minimize = () => {
    changePresentation({ floating, minimized: true });
    requestAnimationFrame(() =>
      document.getElementById("assistant-restore")?.focus(),
    );
  };
  useLayoutEffect(() => {
    const input = requestInput.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = Math.min(100, input.scrollHeight) + "px";
  }, [prompt]);
  useLayoutEffect(() => {
    // Hidden metrics and host reparenting are not evidence of user scrolling.
    changingPresentation.current = true;
    if (minimized) return;
    let settled = 0;
    const frame = requestAnimationFrame(() => {
      const element = conversation.current;
      if (element?.getClientRects().length && followLatest.current)
        element.scrollTop = element.scrollHeight;
      settled = requestAnimationFrame(() => {
        changingPresentation.current = false;
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(settled);
    };
  }, [minimized, floating]);
  useLayoutEffect(() => {
    const element = conversation.current;
    if (
      !minimized &&
      !changingPresentation.current &&
      element?.getClientRects().length &&
      followLatest.current
    )
      element.scrollTop = element.scrollHeight;
  }, [turns, proposals, activity, settingsOpen, minimized, floating]);
  useLayoutEffect(() => {
    const element = conversation.current;
    const content = element?.firstElementChild;
    if (minimized || !element || !content) return;
    const observer = new ResizeObserver(() => {
      if (
        !changingPresentation.current &&
        followLatest.current &&
        element.getClientRects().length
      )
        element.scrollTop = element.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [turns.length > 0, minimized]);
  useEffect(() => {
    if (!minimized) requestInput.current?.focus();
    if (connection === "ready") setSettingsOpen(false);
  }, [connection, minimized]);
  const setup = useAssistantSetup(connection, connect);
  const send = async () => {
    if (setup.loading || submitting || busy || !prompt.trim()) return;
    const text = prompt;
    followLatest.current = true;
    setAwayFromLatest(false);
    const sent = await assistant.send(text, attached, async () => {
      const ready = await setup.start();
      if (!ready) setSettingsOpen(true);
      return ready;
    });
    if (sent) setPrompt((draft) => (draft === text ? "" : draft));
  };
  const pendingCount = proposals.filter(
    (proposal) => proposal.status === "pending",
  ).length;
  return (
    <>
      {minimized && (
        <button
          id="assistant-restore"
          type="button"
          className="assistant-restore"
          aria-label="Restore canvas assistant"
          onClick={() => changePresentation({ floating, minimized: false })}
        >
          <MessageSquare size={17} aria-hidden="true" /> Agent
          <span role="status">
            {busy || submitting
              ? activity || "Working…"
              : error
                ? "Needs attention"
                : pendingCount
                  ? `${pendingCount} to review`
                  : "Resume conversation"}
          </span>
        </button>
      )}
      <dialog
        open
        hidden={minimized}
        ref={popup}
        className={`canvas-assistant ${floating ? "is-floating" : "is-embedded"}`}
        style={floating ? windowControls.bounds : undefined}
        aria-labelledby="canvas-assistant-title"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.stopPropagation();
            if (!windowControls.cancel()) minimize();
          }
        }}
      >
        <header className="assistant-header">
          <div
            className="assistant-heading"
            {...(movable ? windowControls.move : {})}
            tabIndex={movable ? 0 : undefined}
            role={movable ? "button" : undefined}
            aria-label={movable ? "Move floating assistant" : undefined}
            title={
              movable
                ? "Drag to move · Arrow keys move · Shift for larger steps"
                : undefined
            }
          >
            {movable ? (
              <Move size={18} aria-hidden="true" />
            ) : (
              <MessageSquare size={18} aria-hidden="true" />
            )}
            <div>
              <h2 id="canvas-assistant-title">
                Canvas assistant <small>Pi · experimental</small>
              </h2>
              <span className={`assistant-connection-state is-${connection}`}>
                {submitting || setup.starting || connection === "connecting"
                  ? "Connecting…"
                  : connection === "ready"
                    ? "Connected"
                    : "Connects when you send"}
              </span>
            </div>
          </div>
          <div className="assistant-inline-actions">
            <button
              type="button"
              aria-label={
                floating ? "Dock assistant panel" : "Float assistant panel"
              }
              title={
                floating ? "Dock assistant panel" : "Float assistant panel"
              }
              onClick={() =>
                changePresentation({ floating: !floating, minimized: false })
              }
            >
              {floating ? (
                <PanelRight size={16} aria-hidden="true" />
              ) : (
                <PanelsTopLeft size={16} aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              aria-label="Assistant settings"
              title="Assistant settings"
              aria-expanded={settingsOpen}
              aria-controls="assistant-settings"
              onClick={() => {
                setSettingsOpen(!settingsOpen);
                if (settingsOpen) requestInput.current?.focus();
              }}
            >
              <Settings size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={minimize}
              aria-label="Minimize canvas assistant"
              title="Minimize · Escape · keeps the session running"
            >
              <Minus size={17} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={close}
              aria-label="End assistant session"
              title="End session and discard conversation"
            >
              <X size={17} aria-hidden="true" />
            </button>
          </div>
        </header>
        <div className="assistant-body">
          <section
            id="assistant-settings"
            hidden={!settingsOpen}
            aria-label="Assistant settings"
          >
            <AssistantConnection
              setup={setup}
              connection={connection}
              connect={connect}
              disconnect={disconnect}
            />
          </section>
          <div
            className="assistant-conversation-scroll"
            ref={conversation}
            tabIndex={0}
            role="region"
            aria-label="Conversation history"
            onWheel={(event) => {
              changingPresentation.current = false;
              if (event.deltaY < 0) followLatest.current = false;
            }}
            onKeyDown={(event) => {
              if (
                !event.nativeEvent.isComposing &&
                ["Home", "PageUp", "ArrowUp"].includes(event.key)
              ) {
                changingPresentation.current = false;
                followLatest.current = false;
              }
            }}
            onScroll={(event) => {
              if (
                minimized ||
                changingPresentation.current ||
                !event.currentTarget.getClientRects().length
              )
                return;
              const element = event.currentTarget;
              followLatest.current =
                element.scrollHeight -
                  element.clientHeight -
                  element.scrollTop <
                48;
              setAwayFromLatest(!followLatest.current);
            }}
          >
            {!turns.length ? (
              <section
                className="assistant-welcome"
                aria-label="Get started with the assistant"
              >
                <span className="assistant-welcome-icon">
                  <MessageSquare size={24} aria-hidden="true" />
                </span>
                <h3>Think it through, together.</h3>
                <p>
                  Ask about your equations, inspect assumptions, or plan a
                  change to your canvas.
                </p>
                <div className="assistant-starters">
                  {starters.map((starter) => (
                    <button
                      key={starter.label}
                      type="button"
                      disabled={!!prompt.trim() || submitting}
                      onClick={() => {
                        setPrompt(starter.prompt);
                        requestInput.current?.focus();
                      }}
                    >
                      {starter.label}
                      <ArrowUp size={14} aria-hidden="true" />
                    </button>
                  ))}
                </div>
                <p className="assistant-privacy">
                  Start with a suggestion or write your own request. Suggestions
                  fill the draft; nothing is sent until you choose.
                </p>
              </section>
            ) : (
              <AssistantConversation
                turns={turns}
                proposals={proposals}
                busy={busy}
                connection={connection}
                resolve={resolve}
                reveal={reveal}
              />
            )}
          </div>
          {awayFromLatest && (
            <button
              type="button"
              className="assistant-jump"
              onClick={() => {
                const element = conversation.current;
                if (element) element.scrollTop = element.scrollHeight;
                followLatest.current = true;
                setAwayFromLatest(false);
              }}
            >
              <ArrowDown size={14} aria-hidden="true" /> Latest response
            </button>
          )}
        </div>
        <footer className="assistant-footer">
          {error && (
            <p role="alert" className="assistant-error">
              {error}
            </p>
          )}
          <div className="assistant-activity" role="status">
            {submitting
              ? "Connecting…"
              : activity ||
                (pendingCount
                  ? `${pendingCount} proposed edit${pendingCount === 1 ? "" : "s"} ready for review`
                  : "")}
          </div>
          <form
            className="assistant-composer-row"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <div className="assistant-context">
              <div className="assistant-context-chips">
                {attached.length ? (
                  attached.map((id) => (
                    <button
                      key={id}
                      type="button"
                      className="assistant-context-chip"
                      aria-label={`Remove ${contextName(id)} from request focus`}
                      title="Remove from request focus; worksheet remains inspectable"
                      onClick={() => setExcluded((prior) => [...prior, id])}
                    >
                      {contextName(id)}
                      <X size={12} aria-hidden="true" />
                    </button>
                  ))
                ) : (
                  <span>Worksheet focus</span>
                )}
                {attached.length < selection.length && (
                  <button type="button" onClick={() => setExcluded([])}>
                    Use selection
                  </button>
                )}
              </div>
            </div>
            <span
              className="assistant-visually-hidden"
              id="assistant-input-context"
            >
              {attached.length
                ? `${attached.length} selected object(s) will be attached. `
                : "Worksheet context. "}
              The whole worksheet remains inspectable. Context and requested
              images go to your model; edits need approval.
            </span>
            {
              <p
                hidden={!privacyOpen}
                id="assistant-access-details"
                className="assistant-privacy"
              >
                Selection is a focus hint, not an access restriction. The
                assistant can inspect the worksheet and request canvas images.
                Inspected content goes to your model provider. Credentials are
                excluded from images. No shell access or automatic computation;
                every edit requires approval.
              </p>
            }
            <label className="assistant-composer">
              <span className="assistant-visually-hidden">
                Ask about or edit the canvas
              </span>
              <textarea
                ref={requestInput}
                maxLength={10000}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                aria-describedby="assistant-input-context"
                placeholder={
                  busy
                    ? "Draft your next question…"
                    : "Ask about or edit the canvas…"
                }
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    void send();
                  }
                }}
                rows={2}
              />
            </label>
            <div className="assistant-composer-toolbar">
              <span className="assistant-keyboard-hint">
                Enter to send · Shift+Enter for newline
              </span>
              <button
                type="button"
                className="assistant-access"
                aria-label="What the assistant can access"
                aria-expanded={privacyOpen}
                aria-controls="assistant-access-details"
                onClick={() => setPrivacyOpen(!privacyOpen)}
              >
                <Info size={14} aria-hidden="true" />
              </button>
              <div className="assistant-inline-actions">
                {busy ? (
                  <button
                    type="button"
                    onClick={stop}
                    aria-label="Stop request"
                    title="Stop request"
                  >
                    <Square size={15} aria-hidden="true" />
                  </button>
                ) : (
                  <button
                    type="submit"
                    aria-label="Send request"
                    title="Send request · Enter"
                    disabled={
                      setup.loading ||
                      submitting ||
                      setup.starting ||
                      connection === "connecting" ||
                      !prompt.trim()
                    }
                  >
                    <ArrowUp size={17} aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
          </form>
          <p className="assistant-safety">
            <ShieldCheck size={13} aria-hidden="true" />
            You review every edit. Check engineering results independently.
          </p>
        </footer>
        {floating && (
          <button
            type="button"
            className="assistant-window-resize"
            aria-label="Resize floating assistant"
            title="Drag to resize · Arrow keys resize"
            {...windowControls.resize}
          >
            <Maximize2 size={12} aria-hidden="true" />
          </button>
        )}
      </dialog>
    </>
  );
}
