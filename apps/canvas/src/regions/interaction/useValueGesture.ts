/** Transient numeric input only. Completion delegates acceptance to the existing exploration owner. */
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { isDialogEvent } from "./modalInput";

type PointerInput<T> = {
  kind: "pointer";
  id: number;
  target: Element;
  data: T;
  moved: boolean;
};
type Input<T> = PointerInput<T> | { kind: "keyboard"; key: string };
type Cancellation = Event | { pointerId?: number };

export function useValueGesture<T>(options: {
  finish: () => void;
  revert: () => void;
  cancelKey?: (event: KeyboardEvent) => boolean;
}) {
  // Undefined is idle; a pointer and keyboard can never own this input simultaneously.
  const input = useRef<Input<T> | undefined>(undefined);
  const latest = useRef(options);
  latest.current = options;
  const [moving, setMoving] = useState(false);
  const clear = () => {
    input.current = undefined;
    setMoving(false);
  };
  const cancel = (event?: Cancellation) => {
    const active = input.current;
    if (!active) return;
    if (
      event &&
      "pointerId" in event &&
      (active.kind !== "pointer" || event.pointerId !== active.id)
    )
      return;
    clear();
    // Clear ownership before release: synchronous capture loss is cancellation, not completion.
    if (active.kind === "pointer" && active.target.hasPointerCapture(active.id))
      active.target.releasePointerCapture(active.id);
    latest.current.revert();
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!input.current || isDialogEvent(event)) return;
      if (event.key === "Escape" || latest.current.cancelKey?.(event)) {
        event.preventDefault();
        event.stopPropagation();
        cancel();
      }
    };
    const visibility = () => {
      if (document.hidden) cancel();
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", visibility);
      cancel();
    };
  }, []);
  const pointer = (event: { pointerId: number }) => {
    const active = input.current;
    return active?.kind === "pointer" && active.id === event.pointerId
      ? active
      : undefined;
  };
  return {
    moving,
    startPointer(event: ReactPointerEvent<Element>, data: T) {
      if (event.button !== 0 || input.current) return false;
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      input.current = {
        kind: "pointer",
        id: event.pointerId,
        target: event.currentTarget,
        data,
        moved: false,
      };
      return true;
    },
    pointer,
    movePointer(event: { pointerId: number }) {
      const active = pointer(event);
      if (!active) return;
      active.moved = true;
      setMoving(true);
    },
    finishPointer(event: { pointerId: number }) {
      const active = pointer(event);
      if (!active) return;
      clear();
      // Let native pointer-up release capture; early release can retarget the ensuing click.
      if (active.moved) latest.current.finish();
    },
    startKey(key: string) {
      if (input.current?.kind === "pointer") return false;
      input.current = { kind: "keyboard", key };
      return true;
    },
    finishKey(key: string) {
      const active = input.current;
      if (active?.kind !== "keyboard" || active.key !== key) return;
      clear();
      latest.current.finish();
    },
    cancel,
  };
}
