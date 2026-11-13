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
  icon,
  children,
  align = "left",
}: {
  label: string;
  icon?: ReactNode;
  children: ReactNode;
  align?: "left" | "right";
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
      const left =
        align === "right" ? anchor.right - bounds.width : anchor.left;
      setPosition({
        left: Math.max(8, Math.min(left, window.innerWidth - bounds.width - 8)),
        top: Math.max(
          8,
          Math.min(anchor.bottom + 8, window.innerHeight - bounds.height - 8),
        ),
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
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        title={label}
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        {icon}
        <span>{label}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <div
          id={id}
          ref={panel}
          style={position}
          className="er-command-panel"
          role="group"
          aria-label={`${label} commands`}
          onClick={(event) => {
            const button = (event.target as Element).closest("button");
            if (!button || button.disabled) return;
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
