import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ArrowLeft, ArrowLeftRight, ChevronRight } from "lucide-react";
import "../styles/canvasActionMenu.css";

type AxisVariable = { name: string; unit: string };
export type CanvasAction = {
  id: string;
  key: string;
  label: string;
  icon: ReactNode;
  dividerBefore?: boolean;
  unavailable?: string;
  hint?: string;
  group?: string;
  badge?: string;
  variable?: AxisVariable;
  response?: AxisVariable;
  pressed?: boolean;
} & (
  | { run: (swapped?: boolean) => void; page?: never }
  | { page: CanvasActionPage; run?: never }
);
export type CanvasActionPage = {
  title: string;
  actions: CanvasAction[];
  focusKey?: string;
  axes?: { output?: AxisVariable };
};
export type ActionMenuLocation = {
  x: number;
  y: number;
  world: { x: number; y: number };
  target?: string;
  /** Only the visual anchor; world and target always describe the invocation on the canvas. */
  anchor?: DOMRect;
  held: boolean;
  mode: "pie" | "context";
};

const size = 240;
const center = size / 2;
const point = (angle: number, radius: number) => ({
  x: center + Math.sin(angle) * radius,
  y: center - Math.cos(angle) * radius,
});
function sector(index: number, count: number) {
  const step = (Math.PI * 2) / count;
  const start = index * step - step / 2 + 0.025;
  const end = start + step - 0.05;
  const a = point(start, 112),
    b = point(end, 112);
  const c = point(end, 40),
    d = point(start, 40);
  return `M ${a.x} ${a.y} A 112 112 0 0 1 ${b.x} ${b.y} L ${c.x} ${c.y} A 40 40 0 0 0 ${d.x} ${d.y} Z`;
}

/** The same actions support explicit clicks, directional gestures and a keyboard. */
export function CanvasActionMenu({
  location,
  subject,
  label,
  actions: rootActions,
  initialPage,
  close,
  search,
}: {
  location: ActionMenuLocation;
  subject: string;
  label?: string;
  actions: CanvasAction[];
  initialPage?: CanvasActionPage;
  close: () => void;
  search: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const origin = useRef<Element | null>(document.activeElement);
  const moved = useRef(false);
  const holding = useRef(location.held);
  const [marking, setMarking] = useState(location.held);
  const [revealed, setRevealed] = useState(!location.held);
  const [active, setActive] = useState<number>();
  const [pageKey, setPageKey] = useState<string>();
  const returnKey = useRef<string>(undefined);
  const [swapped, setSwapped] = useState(false);
  const [previewKey, setPreviewKey] = useState<string>();
  const page =
    initialPage ?? rootActions.find((action) => action.key === pageKey)?.page;
  const axes = page?.axes;
  const plotActions: CanvasAction[] =
    axes && page
      ? [
          {
            id: "menu.swap-axes",
            key: "menu.swap-axes",
            label: "Swap axes",
            icon: <ArrowLeftRight />,
            pressed: swapped,
            run: () => setSwapped((value) => !value),
          },
          ...page.actions,
        ]
      : (page?.actions ?? []);
  const actions: CanvasAction[] = !page
    ? rootActions
    : pageKey
      ? [
          {
            id: "menu.back",
            key: "menu.back",
            label: "Back to actions",
            icon: <ArrowLeft />,
            run: () => {
              returnKey.current = pageKey;
              setPageKey(undefined);
            },
          },
          ...plotActions,
        ]
      : plotActions;
  const current = useRef({ actions, active });
  current.current = { actions, active };
  const pie = !page && location.mode === "pie";
  const touch = window.matchMedia("(pointer: coarse)").matches;
  const touchClose = pie && touch && !marking;
  const closeItem = useRef<HTMLButtonElement>(null);
  const placement = useRef<{ location: ActionMenuLocation; below: boolean }>(
    undefined,
  );
  // A marking gesture stays anchored to its invocation point, even at an edge.
  // A tapped menu may move into view once the shortcut has been released.
  const x = marking
    ? location.x
    : Math.max(130, Math.min(window.innerWidth - 130, location.x));
  const y = marking
    ? location.y
    : Math.max(140, Math.min(window.innerHeight - 150, location.y));
  const dismiss = () => {
    close();
    const trigger = origin.current;
    if (
      !(trigger instanceof HTMLElement || trigger instanceof SVGElement) ||
      !trigger.isConnected
    )
      return;
    trigger.focus({ preventScroll: true });
    // Selection controls are hidden until React removes the menu. Don't steal focus from a command's editor.
    if (document.activeElement !== trigger)
      requestAnimationFrame(() => {
        if (document.activeElement === document.body && trigger.isConnected)
          trigger.focus({ preventScroll: true });
      });
  };
  const choose = (index?: number) => {
    const action =
      index === undefined ? undefined : current.current.actions[index];
    if (!action) return;
    if (action.unavailable) {
      setActive(index);
      return;
    }
    if (action.page) {
      setSwapped(false);
      setPreviewKey(undefined);
      setPageKey(action.key);
      return;
    }
    if (action.id !== "menu.back" && action.id !== "menu.swap-axes") dismiss();
    action.run(!!action.variable && swapped);
  };
  const focusKey = page?.focusKey;
  const title = page?.title;
  const previewInput = page?.actions.find(
    (action) => action.key === previewKey,
  );
  const output = previewInput?.response ?? axes?.output;
  const input = previewInput?.variable;
  const axisText = (variable: AxisVariable | undefined, fallback: string) =>
    variable ? (
      <>
        <span className="cam-variable">{variable.name}</span>
        {variable.unit && <small>{variable.unit}</small>}
      </>
    ) : (
      fallback
    );
  useLayoutEffect(() => {
    const el = menu.current;
    if (!el) return;
    el.scrollTop = 0;
    const key = title ? focusKey : returnKey.current;
    returnKey.current = undefined;
    const index = key
      ? current.current.actions.findIndex((action) => action.key === key)
      : -1;
    if (index >= 0) buttons.current[index]?.focus({ preventScroll: true });
    else {
      setActive(undefined);
      el.focus({ preventScroll: true });
    }
  }, [pageKey, title, focusKey]);
  useLayoutEffect(() => {
    const el = menu.current;
    if (pie || !el) return;
    el.style.maxHeight = "";
    const { width, height } = el.getBoundingClientRect();
    const { anchor } = location;
    let top = location.y;
    if (anchor) {
      const below = window.innerHeight - anchor.bottom - 13;
      const above = anchor.top - 13;
      const useBelow =
        placement.current?.location === location
          ? placement.current.below
          : height <= below || below >= above;
      placement.current = { location, below: useBelow };
      // Keep the same side of the trigger when switching pages.
      el.style.maxHeight = `${Math.max(0, useBelow ? below : above)}px`;
      top = useBelow ? anchor.bottom + 5 : anchor.top - 5 - el.offsetHeight;
    }
    el.style.left = `${Math.max(8, Math.min(anchor?.left ?? location.x, window.innerWidth - width - 8))}px`;
    el.style.top = `${Math.max(8, Math.min(top, window.innerHeight - el.offsetHeight - 8))}px`;
  }, [pie, location, actions.length, title]);
  useEffect(() => {
    if (!pie || !location.held) return;
    const timer = window.setTimeout(() => setRevealed(true), 180);
    return () => window.clearTimeout(timer);
  }, [pie, location.held]);
  useEffect(() => {
    const hit = (event: PointerEvent) => {
      const dx = event.clientX - x,
        dy = event.clientY - y;
      const distance = Math.hypot(dx, dy);
      const count = current.current.actions.length;
      const angle = (Math.atan2(dx, -dy) + Math.PI * 2) % (Math.PI * 2);
      return distance >= 32 && distance <= 240
        ? Math.round(angle / ((Math.PI * 2) / count)) % count
        : undefined;
    };
    const move = (event: PointerEvent) => {
      if (!pie) return;
      if (
        Math.hypot(event.clientX - location.x, event.clientY - location.y) >= 32
      )
        moved.current = true;
      current.current.active = hit(event);
      setActive(current.current.active);
    };
    const up = (event: KeyboardEvent) => {
      if (event.code !== "Space" || !holding.current) return;
      holding.current = false;
      event.preventDefault();
      event.stopPropagation();
      if (moved.current) {
        const index = current.current.active;
        if (index === undefined) dismiss();
        else choose(index);
      } else {
        setMarking(false);
        setRevealed(true);
      }
    };
    const cancel = () => dismiss();
    const wheel = (event: WheelEvent) => {
      if (
        pie ||
        !(event.target instanceof Node && menu.current?.contains(event.target))
      )
        dismiss();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("keyup", up, true);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", cancel);
    window.addEventListener("wheel", wheel, { passive: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("resize", cancel);
      window.removeEventListener("wheel", wheel);
    };
  }, [location, x, y, pie]);
  return (
    <div
      className="cam-backdrop"
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
          dismiss();
        }
      }}
    >
      <div
        ref={menu}
        role="menu"
        data-canvas-controls=""
        aria-label={
          title ?? label ?? (pie ? "Canvas actions" : "Context actions")
        }
        aria-description={title ? undefined : subject}
        data-action-page={title ? "plot" : undefined}
        data-revealed={revealed}
        tabIndex={-1}
        className={pie ? "cam-menu" : "cam-context-menu"}
        style={pie ? { left: x - center, top: y - center } : undefined}
        onClick={(e) => {
          e.stopPropagation();
          if (pie && (e.target as Element).closest("svg")) choose(active);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
            e.preventDefault();
            close();
            search();
            return;
          }
          if (holding.current && e.code === "Space") {
            e.preventDefault();
            return;
          }
          if (e.key === "Escape" || e.key === "Tab") {
            e.preventDefault();
            dismiss();
            return;
          }
          const focused = buttons.current.findIndex(
            (button) => button === e.target,
          );
          const navigationIndex =
            touchClose && e.target === closeItem.current
              ? actions.length
              : focused >= 0
                ? focused
                : active;
          if (
            [
              "ArrowRight",
              "ArrowDown",
              "ArrowLeft",
              "ArrowUp",
              "Home",
              "End",
            ].includes(e.key)
          ) {
            e.preventDefault();
            const count = actions.length + (touchClose ? 1 : 0);
            const index =
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? count - 1
                  : navigationIndex === undefined
                    ? 0
                    : (navigationIndex +
                        (["ArrowLeft", "ArrowUp"].includes(e.key) ? -1 : 1) +
                        count) %
                      count;
            setActive(index);
            (index === actions.length
              ? closeItem.current
              : buttons.current[index]
            )?.focus();
          } else if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (touchClose && e.target === closeItem.current) dismiss();
            else choose(navigationIndex);
          } else if (!title && /^[1-9]$/.test(e.key)) {
            e.preventDefault();
            choose(Number(e.key) - 1);
          }
        }}
      >
        <div className="cam-subject">{title ?? subject}</div>
        {pie && (
          <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
            {actions.map((action, index) => (
              <path
                key={action.key}
                d={sector(index, actions.length)}
                className={`${active === index ? "is-active" : ""} ${action.unavailable ? "is-unavailable" : ""}`}
              />
            ))}
          </svg>
        )}
        {actions.map((action, index) => {
          const at = point((index * Math.PI * 2) / actions.length, 77);
          return (
            <Fragment key={action.key}>
              {action.id === "menu.swap-axes" && (
                <div className="cam-axis-diagram" role="presentation">
                  <svg viewBox="0 0 44 40" aria-hidden="true">
                    <path d="M8 34V5m-4 4 4-4 4 4M8 34h32m-4-4 4 4-4 4" />
                  </svg>
                  <div role="group" aria-label="Vertical axis" data-axis="y">
                    {swapped
                      ? axisText(input, "Choose an input")
                      : axisText(output, "Response")}
                  </div>
                  <div role="group" aria-label="Horizontal axis" data-axis="x">
                    {swapped
                      ? axisText(output, "Response")
                      : axisText(input, "Choose an input")}
                  </div>
                </div>
              )}
              {action.group && action.group !== actions[index - 1]?.group && (
                <div className="cam-choice-group" role="presentation">
                  {action.group}
                </div>
              )}
              <button
                ref={(node) => {
                  buttons.current[index] = node;
                }}
                role={
                  action.pressed === undefined ? "menuitem" : "menuitemcheckbox"
                }
                data-command-id={action.id}
                data-divider-before={action.dividerBefore || undefined}
                aria-label={action.label}
                aria-description={
                  [
                    action.badge ? `${action.badge} input` : "",
                    action.variable?.unit,
                  ]
                    .filter(Boolean)
                    .join(" · ") || undefined
                }
                aria-checked={action.pressed}
                data-axis-choice={!!action.variable || undefined}
                aria-keyshortcuts={
                  !title && index < 9 ? String(index + 1) : undefined
                }
                tabIndex={-1}
                aria-disabled={!!action.unavailable}
                title={action.unavailable || action.hint}
                className={`${pie ? "cam-action" : "cam-context-action"} ${active === index ? "is-active" : ""}`}
                style={pie ? { left: at.x, top: at.y } : undefined}
                onFocus={() => {
                  setActive(index);
                  if (!touch && action.variable && !action.unavailable)
                    setPreviewKey(action.key);
                }}
                onPointerEnter={() => {
                  if (!pie) setActive(index);
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  choose(index);
                }}
              >
                {action.icon}
                <span className={action.variable ? "cam-variable" : undefined}>
                  {action.label}
                </span>
                {action.variable?.unit && (
                  <small className="cam-axis-unit" aria-hidden="true">
                    {action.variable.unit}
                  </small>
                )}
                {action.badge && (
                  <small className="cam-choice-badge" aria-hidden="true">
                    {action.badge}
                  </small>
                )}
                {action.page && (
                  <ChevronRight aria-hidden="true" className="cam-open-page" />
                )}
                {!title && !pie && index < 9 && (
                  <kbd aria-hidden="true">{index + 1}</kbd>
                )}
              </button>
            </Fragment>
          );
        })}
        {touchClose ? (
          <button
            ref={closeItem}
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="cam-close"
            onFocus={() => setActive(actions.length)}
            onClick={dismiss}
          >
            Close
          </button>
        ) : (
          pie && (
            <span className="cam-cancel-hint" aria-hidden="true">
              Esc
            </span>
          )
        )}
        <div className="cam-help" role="status">
          {active !== undefined && actions[active]?.unavailable
            ? actions[active].unavailable
            : pie
              ? (active !== undefined && actions[active]?.hint) ||
                (marking
                  ? "Move & release · Esc cancels"
                  : touch
                    ? "Tap a choice, or tap Close"
                    : "Click or use arrows · Enter runs · Esc closes")
              : title
                ? touch
                  ? "Tap a choice · Tap outside to close"
                  : "↑↓ Choose · Enter open · Esc close"
                : touch
                  ? "Tap an action · Tap outside to close"
                  : "↑↓ Choose · Enter Run · Esc Close"}
        </div>
      </div>
    </div>
  );
}
