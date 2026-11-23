import { useEffect, useLayoutEffect, useRef, useState } from "react";
import "../styles/assistant.css";
import {
  AssistantConnection,
  AssistantModelPicker,
  AssistantPermissions,
  useAssistantSetup,
} from "./AssistantConnection";
import {
  ArrowDown,
  ArrowUp,
  MessageSquare,
  Settings,
  ShieldCheck,
  Square,
  X,
  Info,
  Expand,
  Shrink,
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
import { assistantLiveLabel } from "../assistantTimeline";

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
  readingExpanded,
  changePresentation,
  reveal,
}: {
  floating: boolean;
  minimized: boolean;
  readingExpanded: boolean;
  changePresentation: (value: {
    floating: boolean;
    minimized: boolean;
    readingExpanded?: boolean;
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
    stop,
    resolve,
  } = assistant;
  const [prompt, setPrompt] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const cancelledSend = useRef(false);
  const readingHold = useRef(false);
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
  const holdReading = () => {
    changingPresentation.current = false;
    readingHold.current = true;
    followLatest.current = false;
    setAwayFromLatest(true);
  };
  const setReadingExpanded = (readingExpanded: boolean) =>
    changePresentation({ floating, minimized: false, readingExpanded });
  const minimize = () => {
    changePresentation({ floating, minimized: true });
    requestAnimationFrame(() =>
      document.getElementById("assistant-restore")?.focus(),
    );
  };
  useLayoutEffect(() => {
    const input = requestInput.current;
    if (!input) return;
    const fit = () => {
      if (!input.getClientRects().length) return;
      input.style.height = "auto";
      input.style.height = Math.min(144, input.scrollHeight) + "px";
    };
    fit();
    let width = input.clientWidth;
    const observer = new ResizeObserver(() => {
      if (input.clientWidth === width) return;
      width = input.clientWidth;
      fit();
    });
    observer.observe(input);
    return () => observer.disconnect();
  }, [prompt, minimized]);
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
  }, [minimized, floating, readingExpanded]);
  useLayoutEffect(() => {
    const element = conversation.current;
    if (
      !minimized &&
      !changingPresentation.current &&
      element?.getClientRects().length &&
      followLatest.current
    )
      element.scrollTop = element.scrollHeight;
  }, [turns, proposals, settingsOpen, minimized, floating, readingExpanded]);
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
    observer.observe(element);
    return () => observer.disconnect();
  }, [turns.length > 0, minimized]);
  useEffect(() => {
    if (minimized) return;
    const selectedHistory = () => {
      const range = window.getSelection();
      if (
        range &&
        !range.isCollapsed &&
        conversation.current?.contains(range.anchorNode)
      )
        holdReading();
    };
    document.addEventListener("selectionchange", selectedHistory);
    return () =>
      document.removeEventListener("selectionchange", selectedHistory);
  }, [minimized]);
  useEffect(() => {
    if (!minimized) requestInput.current?.focus();
  }, [anchor, connection, minimized]);
  useEffect(() => {
    if (connection === "ready") setSettingsOpen(false);
  }, [connection, minimized]);
  const setup = useAssistantSetup(connection, connect, {
    busy: busy || submitting,
    permissions: assistant.permissions,
    setPermissions: assistant.setPermissions,
    activeSettings: assistant.settings,
  });
  const readOnly = setup.permissions === "read-only";
  const activeTurn = busy ? turns.at(-1) : undefined;
  const connecting =
    submitting || setup.starting || connection === "connecting";
  const cancelSend = () => {
    cancelledSend.current = true;
    setup.cancelStart();
    disconnect();
  };
  const send = async () => {
    if (setup.loading || submitting || busy || !prompt.trim()) return;
    const text = prompt;
    cancelledSend.current = false;
    readingHold.current = false;
    followLatest.current = true;
    setAwayFromLatest(false);
    const sent = await assistant.send(
      text,
      attached,
      async () => {
        const ready = await setup.start();
        if (!ready && !cancelledSend.current) setSettingsOpen(true);
        return ready && !cancelledSend.current;
      },
      setup.preferences,
    );
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
              ? activeTurn
                ? `${assistantLiveLabel(activeTurn.phase, activeTurn.tools)}…`
                : "Connecting…"
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
        className={`canvas-assistant ${floating ? "is-floating" : "is-embedded"}${readingExpanded ? " is-reading" : ""}`}
        style={floating && !readingExpanded ? windowControls.bounds : undefined}
        aria-labelledby="canvas-assistant-title"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.stopPropagation();
            if (windowControls.cancel()) return;
            if (readingExpanded) setReadingExpanded(false);
            else minimize();
          }
        }}
      >
        <header className="assistant-header">
          <div
            className="assistant-heading"
            {...(movable && !readingExpanded ? windowControls.move : {})}
            tabIndex={movable && !readingExpanded ? 0 : undefined}
            role={movable && !readingExpanded ? "button" : undefined}
            aria-label={
              movable && !readingExpanded
                ? "Move floating assistant"
                : undefined
            }
            title={
              movable && !readingExpanded
                ? "Drag to move · Arrow keys move · Shift for larger steps"
                : undefined
            }
          >
            {movable && !readingExpanded ? (
              <Move size={18} aria-hidden="true" />
            ) : (
              <MessageSquare size={18} aria-hidden="true" />
            )}
            <div>
              <h2 id="canvas-assistant-title">
                Canvas assistant{" "}
                <small className="assistant-visually-hidden">
                  Pi · experimental
                </small>
              </h2>
              <span className={`assistant-connection-state is-${connection}`}>
                {connecting
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
                readingExpanded ? "Exit expanded chat" : "Expand chat"
              }
              aria-pressed={readingExpanded}
              title={
                readingExpanded
                  ? "Exit expanded chat"
                  : "Expand chat for reading"
              }
              onClick={() => setReadingExpanded(!readingExpanded)}
            >
              {readingExpanded ? (
                <Shrink size={16} aria-hidden="true" />
              ) : (
                <Expand size={16} aria-hidden="true" />
              )}
            </button>
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
            onPointerDownCapture={(event) => {
              if ((event.target as Element).closest("summary")) holdReading();
            }}
            onWheel={(event) => {
              changingPresentation.current = false;
              if (event.deltaY < 0) followLatest.current = false;
              if (event.deltaY > 0) readingHold.current = false;
            }}
            onKeyDown={(event) => {
              if (
                ["Enter", " "].includes(event.key) &&
                (event.target as Element).closest("summary")
              ) {
                holdReading();
                return;
              }
              if (["ArrowDown", "PageDown", "End"].includes(event.key))
                readingHold.current = false;
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
                !readingHold.current &&
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
                <h3>Work through this canvas</h3>
                <p>
                  Ask about an equation, check an assumption, or propose a
                  change. You decide what gets applied.
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
              </section>
            ) : (
              <AssistantConversation
                turns={turns}
                proposals={proposals}
                busy={busy}
                connection={connection}
                resolve={resolve}
                reveal={reveal}
                hasDraft={!!prompt.trim()}
                editPrompt={(value) => {
                  setPrompt((draft) => (draft.trim() ? draft : value));
                  requestInput.current?.focus({ preventScroll: true });
                }}
              />
            )}
          </div>
          {awayFromLatest && (
            <button
              type="button"
              className="assistant-jump"
              onClick={() => {
                const element = conversation.current;
                readingHold.current = false;
                followLatest.current = true;
                if (element) element.scrollTop = element.scrollHeight;
                setAwayFromLatest(false);
              }}
            >
              <ArrowDown size={14} aria-hidden="true" /> Jump to latest
            </button>
          )}
        </div>
        <footer className="assistant-footer">
          {error && (
            <p role="alert" className="assistant-error">
              {error}
            </p>
          )}
          <form
            className="assistant-composer-form"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <div className="assistant-composer-surface">
              {selection.length > 0 && (
                <div
                  className="assistant-context assistant-context-chips"
                  aria-label="Canvas context"
                  role="group"
                >
                  {attached.map((id) => (
                    <button
                      key={id}
                      type="button"
                      className="assistant-context-chip"
                      aria-label={`Remove ${contextName(id)} from request focus`}
                      title="Remove from request focus; worksheet remains inspectable"
                      onClick={() => setExcluded((prior) => [...prior, id])}
                    >
                      <span>{contextName(id)}</span>
                      <X size={12} aria-hidden="true" />
                    </button>
                  ))}
                  {attached.length < selection.length && (
                    <button
                      type="button"
                      className="assistant-context-chip"
                      onClick={() => setExcluded([])}
                    >
                      Use selection
                    </button>
                  )}
                </div>
              )}
              <span
                className="assistant-visually-hidden"
                id="assistant-input-context"
              >
                {attached.length
                  ? `${attached.length} selected object(s) will be attached. `
                  : "Worksheet context. "}
                The whole worksheet remains inspectable. Context and requested
                images go to your model. Enter to send. Shift+Enter for a new
                line.{" "}
                {readOnly
                  ? "Read-only access; editing tools are disabled."
                  : "Every edit needs your approval."}
              </span>
              <label className="assistant-composer">
                <span className="assistant-visually-hidden">
                  {readOnly
                    ? "Ask about the canvas"
                    : "Ask about or edit the canvas"}
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
                      : readOnly
                        ? "Ask about the canvas…"
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
                <AssistantModelPicker setup={setup} />
                <div className="assistant-composer-actions">
                  {busy ? (
                    <button
                      type="button"
                      onClick={stop}
                      className="assistant-stop"
                      disabled={activeTurn?.phase === "stopping"}
                      aria-label="Stop request"
                      title={
                        activeTurn?.phase === "stopping"
                          ? "Waiting for Stop acknowledgement"
                          : "Stop request"
                      }
                    >
                      <Square size={13} aria-hidden="true" /> Stop
                    </button>
                  ) : connecting ? (
                    <button
                      type="button"
                      className="assistant-stop"
                      onClick={cancelSend}
                      aria-label="Cancel send"
                      title="Cancel connection and keep the draft"
                    >
                      <Square size={13} aria-hidden="true" /> Cancel
                    </button>
                  ) : (
                    <button
                      type="submit"
                      aria-label="Send request"
                      title="Send · Enter. New line · Shift+Enter"
                      disabled={setup.loading || !prompt.trim()}
                    >
                      <ArrowUp size={19} aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
            </div>
            <div className="assistant-access-bar">
              <div className="assistant-access-mode">
                <ShieldCheck size={15} aria-hidden="true" />
                <AssistantPermissions
                  setup={setup}
                  label="Assistant permissions"
                />
              </div>
              <button
                type="button"
                className="assistant-access"
                aria-label="What the assistant can access"
                aria-expanded={privacyOpen}
                aria-controls="assistant-access-details"
                onClick={() => setPrivacyOpen(!privacyOpen)}
              >
                <Info size={13} aria-hidden="true" /> Access details
              </button>
            </div>
            <p
              hidden={!privacyOpen}
              id="assistant-access-details"
              className="assistant-privacy assistant-access-note"
            >
              <strong>
                {readOnly
                  ? "Canvas edits are disabled."
                  : "Every edit requires your approval."}
              </strong>{" "}
              Selection is a focus hint, not an access restriction. The
              assistant can inspect the worksheet and request canvas images.
              Inspected content goes to your model provider. Credentials are
              excluded from images. No shell access or automatic computation.
            </p>
          </form>
        </footer>
        {floating && !readingExpanded && (
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
