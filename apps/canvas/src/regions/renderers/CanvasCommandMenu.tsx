import {
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ChevronDown } from "lucide-react";

/** A disclosure of ordinary controls, with normal Tab navigation (not an ARIA menu). */
export function CanvasCommandMenu({
  label,
  displayLabel,
  icon,
  children,
  align = "left",
  active = false,
  activeTool,
  iconOnlyWhenActive = false,
  description,
  closeOnAction = true,
  panelClassName,
}: {
  label: string;
  displayLabel?: string;
  icon?: ReactNode;
  children: ReactNode;
  align?: "left" | "right";
  active?: boolean;
  activeTool?: string;
  iconOnlyWhenActive?: boolean;
  description?: string;
  closeOnAction?: boolean;
  panelClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      const bounds = panel.current?.getBoundingClientRect();
      if (!anchor || !bounds) return;
      const dock = trigger.current?.closest(".wc-toolbar-slot")?.classList;
      const side =
        dock?.contains("wc-toolbar-left") || dock?.contains("wc-toolbar-right");
      const left = side
        ? dock?.contains("wc-toolbar-left")
          ? anchor.right + 6
          : anchor.left - bounds.width - 6
        : align === "right"
          ? anchor.right - bounds.width
          : anchor.left;
      const top = side
        ? anchor.top
        : anchor.bottom + bounds.height + 8 > window.innerHeight &&
            anchor.top >= bounds.height + 8
          ? anchor.top - bounds.height - 8
          : anchor.bottom + 8;
      setPosition({
        left: Math.max(8, Math.min(left, window.innerWidth - bounds.width - 8)),
        top: Math.max(8, Math.min(top, window.innerHeight - bounds.height - 8)),
      });
    };
    place();
    const observer = new ResizeObserver(place);
    if (panel.current) observer.observe(panel.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, align]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);
  return (
    <div
      ref={root}
      className={`er-command-menu is-${align}`}
      data-canvas-controls={open ? "" : undefined}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        title={description ?? label}
        data-active={active}
        aria-label={active && activeTool ? `${label}: ${activeTool}` : label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        {icon}
        {(!active || !iconOnlyWhenActive) && (
          <span>{(active && activeTool) || displayLabel || label}</span>
        )}
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <div
          id={id}
          ref={panel}
          style={position}
          className={
            panelClassName
              ? `er-command-panel ${panelClassName}`
              : "er-command-panel"
          }
          role="group"
          aria-label={`${label} commands`}
          onClick={(event) => {
            const button = (event.target as Element).closest("button");
            if (!closeOnAction || !button || button.disabled) return;
            trigger.current?.focus({ preventScroll: true });
            setOpen(false);
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
