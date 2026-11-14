import { Hand, HelpCircle } from "lucide-react";
import { useSyncExternalStore } from "react";
import type { ZoomDisplay } from "../interaction/useCanvasNavigation";
export function CanvasNavigationControls({
  visible,
  hand,
  setHand,
  display,
  zoomBy,
  fit,
  shortcuts,
  fitShortcut,
}: {
  visible: boolean;
  hand: boolean;
  setHand: (value: boolean) => void;
  display: ZoomDisplay;
  zoomBy: (delta: number) => void;
  fit: () => void;
  shortcuts: () => void;
  fitShortcut: string;
}) {
  const zoom = useSyncExternalStore(display.subscribe, display.read);
  return (
    <div
      className="er-zoom"
      role="group"
      aria-label="Canvas navigation"
      onPointerDown={(e) => {
        if ((e.target as Element).closest("button")) e.preventDefault();
      }}
      style={{
        display: visible ? undefined : "none",
      }}
    >
      <button
        aria-label="Pan canvas"
        aria-pressed={hand}
        title="Pan canvas · Space-drag or middle-button drag"
        onClick={() => setHand(!hand)}
      >
        <Hand size={15} />
      </button>
      <button
        aria-label="Zoom out"
        onClick={() => zoomBy(-0.1)}
        title="Zoom out (−)"
        disabled={zoom <= 0.1}
      >
        −
      </button>
      <button
        aria-label="Fit page"
        title={`Fit page (double middle-click${fitShortcut === "Unassigned" ? "" : ` or ${fitShortcut}`})`}
        onClick={fit}
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        aria-label="Zoom in"
        onClick={() => zoomBy(0.1)}
        title="Zoom in (+)"
        disabled={zoom >= 2}
      >
        +
      </button>
      <button
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts and canvas gestures"
        onClick={(event) => {
          // Zoom controls preserve editor focus on pointer-down. Help preserves that
          // draft too, but otherwise restores focus to its own invoker on dismissal.
          if (
            !document.activeElement?.closest(
              "input,textarea,select,[contenteditable=true]",
            )
          )
            event.currentTarget.focus({ preventScroll: true });
          shortcuts();
        }}
      >
        <HelpCircle size={14} />
      </button>
    </div>
  );
}
