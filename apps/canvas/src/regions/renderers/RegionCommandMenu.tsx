import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { revealCanvasElement } from "../interaction/canvasViewport";

/** Resolve and mount commands only while this ordinary disclosure is open. */
export function RegionCommandMenu({ children }: { children: () => ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDetailsElement>(null);
  useLayoutEffect(() => {
    if (open)
      revealCanvasElement(root.current?.querySelector('[role="toolbar"]'), {
        block: "nearest",
        inline: "nearest",
      });
  }, [open]);
  return (
    <details
      ref={root}
      className="er-actions"
      onClick={(event) => event.stopPropagation()}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          event.currentTarget.open = false;
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.open = false;
        event.currentTarget.querySelector("summary")?.focus();
      }}
    >
      <summary aria-label="Region commands" title="Region actions">
        <MoreHorizontal size={17} />
      </summary>
      {open && children()}
    </details>
  );
}
