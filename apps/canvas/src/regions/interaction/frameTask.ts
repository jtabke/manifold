import { useEffect, useLayoutEffect, useRef, useState } from "react";

type FrameClock = {
  request: (callback: FrameRequestCallback) => number;
  cancel: (handle: number) => void;
};

/** Keep the newest input, not a queue of obsolete pointer/wheel events. */
export function createFrameTask<T>(
  apply: (value: T) => void,
  clock: FrameClock = {
    request: (callback) => requestAnimationFrame(callback),
    cancel: (handle) => cancelAnimationFrame(handle),
  },
) {
  let frame: number | undefined;
  let pending: { value: T } | undefined;
  const cancel = () => {
    if (frame !== undefined) clock.cancel(frame);
    frame = undefined;
    pending = undefined;
  };
  const flush = () => {
    const next = pending;
    cancel();
    if (next) apply(next.value);
  };
  return {
    schedule(value: T) {
      pending = { value };
      if (frame === undefined) frame = clock.request(flush);
    },
    flush,
    cancel,
  };
}

export function useFrameTask<T>(apply: (value: T) => void) {
  const latest = useRef(apply);
  useLayoutEffect(() => {
    latest.current = apply;
  });
  const [task] = useState(() =>
    createFrameTask<T>((value) => latest.current(value)),
  );
  useEffect(() => task.cancel, [task]);
  return task;
}
