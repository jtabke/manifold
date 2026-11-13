import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import type { Point } from "../document";

type Bounds = { left: number; top: number; width: number; height: number };
function constrain(bounds: Bounds): Bounds {
  const width = Math.max(
    Math.min(320, window.innerWidth - 16),
    Math.min(bounds.width, window.innerWidth - 16),
  );
  const height = Math.max(
    Math.min(360, window.innerHeight - 16),
    Math.min(bounds.height, window.innerHeight - 16),
  );
  return {
    width,
    height,
    left: Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8)),
    top: Math.max(8, Math.min(bounds.top, window.innerHeight - height - 8)),
  };
}

/** Personal window geometry only; never writes canvas placement or document history. */
export function useAssistantWindow(anchor: Point) {
  const [compact, setCompact] = useState(() => window.innerWidth <= 600);
  const [bounds, setBounds] = useState(() =>
    constrain({
      left: anchor.x + 12,
      top: anchor.y + 12,
      width: 400,
      height: 640,
    }),
  );
  const gesture = useRef<
    | {
        pointer: number;
        x: number;
        y: number;
        bounds: Bounds;
        kind: "move" | "resize";
      }
    | undefined
  >(undefined);
  const cancel = () => {
    const current = gesture.current;
    if (!current) return false;
    gesture.current = undefined;
    setBounds(constrain(current.bounds));
    return true;
  };
  useEffect(() => {
    const resize = () => {
      gesture.current = undefined;
      setCompact(window.innerWidth <= 600);
      setBounds((value) => constrain(value));
    };
    const blur = () => {
      cancel();
    };
    const visibility = () => {
      if (document.hidden) cancel();
    };
    window.addEventListener("resize", resize);
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  const controls = (kind: "move" | "resize") => ({
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if (event.button !== 0 || gesture.current || window.innerWidth <= 600)
        return;
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      gesture.current = {
        pointer: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        bounds,
        kind,
      };
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const current = gesture.current;
      if (!current || current.pointer !== event.pointerId) return;
      const dx = event.clientX - current.x,
        dy = event.clientY - current.y;
      setBounds(
        constrain(
          current.kind === "move"
            ? {
                ...current.bounds,
                left: current.bounds.left + dx,
                top: current.bounds.top + dy,
              }
            : {
                ...current.bounds,
                width: current.bounds.width + dx,
                height: current.bounds.height + dy,
              },
        ),
      );
    },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      if (gesture.current?.pointer === event.pointerId)
        gesture.current = undefined;
    },
    onPointerCancel(event: PointerEvent<HTMLElement>) {
      if (gesture.current?.pointer === event.pointerId) cancel();
    },
    onLostPointerCapture(event: PointerEvent<HTMLElement>) {
      if (gesture.current?.pointer === event.pointerId) cancel();
    },
    onKeyDown(event: KeyboardEvent<HTMLElement>) {
      if (
        event.nativeEvent.isComposing ||
        !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
          event.key,
        ) ||
        window.innerWidth <= 600
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      const step = event.shiftKey ? 40 : 20;
      const dx =
        event.key === "ArrowLeft"
          ? -step
          : event.key === "ArrowRight"
            ? step
            : 0;
      const dy =
        event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
      setBounds((value) =>
        constrain(
          kind === "move"
            ? { ...value, left: value.left + dx, top: value.top + dy }
            : { ...value, width: value.width + dx, height: value.height + dy },
        ),
      );
    },
  });
  return {
    compact,
    bounds,
    cancel,
    move: controls("move"),
    resize: controls("resize"),
  };
}
