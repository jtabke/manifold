import { useEffect, useLayoutEffect, useRef, useState } from "react";
import "../styles/assistant.css";
import { AssistantConnection, useAssistantSetup } from "./AssistantConnection";
import { ArrowUp, Settings, Square } from "lucide-react";
import type { Point, RegionSession } from "../document";
import { useCanvasAssistant } from "../app/useCanvasAssistant";
import { AssistantConversation } from "./AssistantConversation";
import type { WorkspaceEdits } from "../app/workspaceFiles";

export function CanvasAssistant({
  session,
  selection,
  edits,
  close,
  anchor,
}: {
  anchor: Point;
  session: RegionSession;
  selection: string[];
  edits: WorkspaceEdits;
  close: () => void;
}) {
  const assistant = useCanvasAssistant(session, edits);
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
  const [position, setPosition] = useState(anchor);
  useLayoutEffect(() => {
    const element = popup.current;
    if (!element) return;
    const place = () => {
      const x = Math.max(
        8,
        Math.min(anchor.x + 12, window.innerWidth - element.offsetWidth - 8),
      );
      const y = Math.max(
        8,
        Math.min(anchor.y + 12, window.innerHeight - element.offsetHeight - 8),
      );
      setPosition((previous) =>
        previous.x === x && previous.y === y ? previous : { x, y },
      );
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(element);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [anchor.x, anchor.y]);
  useLayoutEffect(() => {
    const input = requestInput.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = Math.min(100, input.scrollHeight) + "px";
  }, [prompt]);
  useEffect(() => {
    requestInput.current?.focus();
    if (connection === "ready") setSettingsOpen(false);
  }, [connection]);
  const setup = useAssistantSetup(connection, connect);
  const send = async () => {
    if (setup.loading) return;
    const text = prompt;
    const sent = await assistant.send(text, selection, async () => {
      const ready = await setup.start();
      if (!ready) setSettingsOpen(true);
      return ready;
    });
    if (sent) setPrompt((draft) => (draft === text ? "" : draft));
  };
  return (
    <dialog
      open
      ref={popup}
      className="canvas-assistant"
      style={{ left: position.x, top: position.y }}
      aria-labelledby="canvas-assistant-title"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <h2 id="canvas-assistant-title" className="assistant-visually-hidden">
        Canvas assistant <small>Pi · experimental</small>
      </h2>
      <form
        className="assistant-composer-row"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
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
            placeholder="Ask agent…"
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
            rows={1}
          />
        </label>
        <span
          id="assistant-input-context"
          className="assistant-visually-hidden"
        >
          {selection.length
            ? `${selection.length} selected object(s) will be attached. `
            : "Worksheet context. "}
          Sends canvas context to your model; edits need approval.
        </span>
        <div className="assistant-inline-actions">
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
            <Settings size={14} />
          </button>
          {busy ? (
            <button
              type="button"
              onClick={stop}
              aria-label="Stop request"
              title="Stop request"
            >
              <Square size={15} />
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
              <ArrowUp size={15} />
            </button>
          )}
          <button
            type="button"
            onClick={close}
            aria-label="Close canvas assistant"
            title="Close · Escape"
          >
            ×
          </button>
        </div>
      </form>
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
      <AssistantConversation
        turns={turns}
        proposals={proposals}
        busy={busy}
        connection={connection}
        resolve={resolve}
      />
      {error && (
        <p role="alert" className="assistant-error">
          {error}
        </p>
      )}
      {(submitting || activity) && (
        <p role="status">{submitting ? "Connecting…" : activity}</p>
      )}
    </dialog>
  );
}
