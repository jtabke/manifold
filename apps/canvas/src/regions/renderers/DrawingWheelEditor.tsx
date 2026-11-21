import { useEffect, useId, useRef, useState } from "react";
import {
  assignWheelTool,
  defaultWheel,
  wheelPositions,
  type WheelTool,
} from "../interaction/drawingWheel";
import { drawingShortcutActions } from "../interaction/shortcutBindings";

export function DrawingWheelEditor({
  slots,
  save,
  close,
}: {
  slots: readonly WheelTool[];
  save: (next: readonly WheelTool[]) => void;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [draft, setDraft] = useState(slots);
  const [error, setError] = useState(false);
  useEffect(() => {
    const previous = document.activeElement;
    const node = dialog.current!;
    node.showModal();
    return () => {
      node.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="drawing-wheel-editor"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <h2 id={`${id}-title`}>Edit tool wheel</h2>
      <p id={`${id}-description`}>
        Choose a tool for each position. Choosing a tool already on the wheel
        swaps the two positions.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          try {
            save(draft);
            close();
          } catch {
            setError(true);
          }
        }}
      >
        <div className="drawing-wheel-positions">
          {wheelPositions.map(([arrow, position], index) => (
            <label key={position}>
              <span>
                <span aria-hidden="true">{arrow}</span> {position}
              </span>
              <select
                value={draft[index]}
                onChange={(event) => {
                  const choice = drawingShortcutActions.find(
                    ({ tool }) => tool === event.target.value,
                  );
                  if (choice) {
                    setDraft(assignWheelTool(draft, index, choice.tool));
                    setError(false);
                  }
                }}
              >
                {drawingShortcutActions.map(({ tool, label }) => (
                  <option key={tool} value={tool}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        {error && (
          <p role="alert">
            Could not save to this browser. The wheel is unchanged.
          </p>
        )}
        <footer>
          <button
            type="button"
            onClick={() => {
              setDraft(defaultWheel);
              setError(false);
            }}
          >
            Restore defaults
          </button>
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button type="submit">Save wheel</button>
        </footer>
      </form>
    </dialog>
  );
}
