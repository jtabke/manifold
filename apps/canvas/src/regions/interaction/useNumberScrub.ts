/** Number representations delegate input to a stable element; AST leaves own no gesture state. */
import {
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type FocusEvent,
} from "react";
import type { Quantity } from "../../notebook/math";
import { boundedValue, type VariationRange } from "../exploration";
import { useValueGesture } from "./useValueGesture";

export type Scrub = {
  quantity: Quantity;
  range?: VariationRange;
  explore: (value: number, anchor?: Element) => void;
  finish: () => void;
  revert: () => void;
};
export type NumberInput = {
  scrub?: Scrub;
  edit?: (anchor?: Element, point?: { x: number; y: number }) => void;
};
export const numberScrubAttributes = (
  name: string,
  scrub?: Scrub,
  title?: string,
) => ({
  role: "button",
  tabIndex: 0,
  "aria-label": name,
  className: `er-number ${scrub ? "er-scrubbable" : ""}`,
  title: title || (scrub ? "Drag to vary · click to edit" : "Click to edit"),
});

export function useNumberScrub(options: {
  read: (control: Element) => NumberInput | undefined;
}) {
  const latest = useRef(options);
  latest.current = options;
  const active = useRef<
    { control: Element; anchor: Element; revert: () => void } | undefined
  >(undefined);
  const click = useRef<{ port: NumberInput; control: Element } | undefined>(
    undefined,
  );
  // Logical focus outlives a completed key cycle and survives replacement of its leaf.
  const focused = useRef<Element | undefined>(undefined);
  const suppress = useRef(false);
  const readActive = () =>
    active.current && latest.current.read(active.current.control);
  const gesture = useValueGesture<{ x: number; start: number }>({
    finish: () => {
      const port = readActive();
      active.current = undefined;
      port?.scrub?.finish();
    },
    revert: () => {
      const revert = readActive()?.scrub?.revert || active.current?.revert;
      active.current = undefined;
      click.current = undefined;
      suppress.current = true;
      revert?.();
    },
  });
  useLayoutEffect(() => {
    if (active.current && !readActive()?.scrub) gesture.cancel();
  });
  return {
    cancel() {
      gesture.cancel();
      focused.current = undefined;
    },
    events: {
      onPointerDown(event: PointerEvent<Element>) {
        if (active.current) {
          event.preventDefault();
          event.stopPropagation();
          return true;
        }
        const control = event.target as Element,
          port = latest.current.read(control);
        if (
          !port?.scrub ||
          !gesture.startPointer(event, {
            x: event.clientX,
            start: port.scrub.quantity.value,
          })
        )
          return false;
        active.current = {
          control,
          anchor: event.currentTarget,
          revert: port.scrub.revert,
        };
        focused.current = control;
        suppress.current = true;
        click.current = undefined;
        // Focus/capture belong to the stable host, never the replaceable MathML leaf.
        event.preventDefault();
        (event.currentTarget as HTMLElement).focus({ preventScroll: true });
        return true;
      },
      onPointerMove(event: PointerEvent<Element>) {
        const input = gesture.pointer(event);
        if (!input) return false;
        event.stopPropagation();
        const port = readActive();
        if (!port?.scrub) {
          gesture.cancel(event);
          return true;
        }
        if (!input.moved && Math.abs(event.clientX - input.data.x) < 4)
          return true;
        gesture.movePointer(event);
        const q = port.scrub.quantity,
          base = q.absolute ? input.data.start - 273.15 : input.data.start,
          step =
            (port.scrub.range?.step || Math.abs(base) / 180 || 0.01) *
            (event.shiftKey ? 0.1 : 1),
          value = input.data.start + (event.clientX - input.data.x) * step;
        port.scrub.explore(
          port.scrub.range ? boundedValue(value, port.scrub.range) : value,
          active.current!.anchor,
        );
        return true;
      },
      onPointerUp(event: PointerEvent<Element>) {
        const input = gesture.pointer(event);
        if (!input) return false;
        event.stopPropagation();
        suppress.current = input.moved;
        const port = readActive();
        if (!input.moved && port)
          click.current = { port, control: active.current!.control };
        gesture.finishPointer(event);
        active.current = undefined;
        return true;
      },
      onPointerCancel: gesture.cancel,
      onLostPointerCapture: gesture.cancel,
      onBlur(event: FocusEvent<Element>) {
        // Only the deliberate leaf-to-host handoff retains ownership. Navigation to any
        // other element, including another descendant of this row, ends held input.
        if (event.relatedTarget === event.currentTarget) return;
        gesture.cancel();
        focused.current = undefined;
      },
      onClick(event: MouseEvent<Element>) {
        if (suppress.current) {
          suppress.current = false;
          click.current = undefined;
          event.preventDefault();
          event.stopPropagation();
          return true;
        }
        const control = click.current?.control || (event.target as Element);
        const port = click.current?.port || latest.current.read(control);
        click.current = undefined;
        if (!port?.edit) return false;
        event.stopPropagation();
        port.edit(control, { x: event.clientX, y: event.clientY });
        return true;
      },
      onKeyDown(event: KeyboardEvent<Element>) {
        if (event.key === "Tab") {
          gesture.cancel();
          focused.current = undefined;
          return false; // Preserve the browser's sequential focus navigation.
        }
        const target = event.target as Element,
          direct = latest.current.read(target),
          control = direct
            ? target
            : active.current?.control || focused.current,
          port = direct || (control && latest.current.read(control));
        if (port?.scrub && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          if (!gesture.startKey(event.key)) return true;
          focused.current = control;
          active.current ??= {
            control: control!,
            anchor: event.currentTarget,
            revert: port.scrub.revert,
          };
          (event.currentTarget as HTMLElement).focus({ preventScroll: true });
          const q = port.scrub.quantity,
            base = q.absolute ? q.value - 273.15 : q.value;
          port.scrub.explore(
            q.value +
              (event.key === "ArrowRight" ? 1 : -1) *
                (port.scrub.range?.step || Math.abs(base) / 100 || 0.01) *
                (event.shiftKey ? 0.1 : 1),
            event.currentTarget,
          );
          return true;
        }
        if (event.key === "Enter" && port?.edit) {
          event.preventDefault();
          event.stopPropagation();
          gesture.cancel();
          port.edit(event.currentTarget);
          return true;
        }
        if (event.key === "Escape" && port?.scrub) {
          gesture.cancel();
          port.scrub.revert();
          return true;
        }
        return false;
      },
      onKeyUp(event: KeyboardEvent<Element>) {
        if (!active.current || !["ArrowLeft", "ArrowRight"].includes(event.key))
          return;
        event.stopPropagation();
        gesture.finishKey(event.key);
      },
    },
  };
}
