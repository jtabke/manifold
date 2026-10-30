/** A renderer's transient input participates in the existing workspace transition guard. */
import { useEffect, useRef } from "react";
import type { EditBuffers } from "./workspaceFiles";
export function useEditBuffer(
  buffers: EditBuffers,
  id: string,
  port: { read: () => string | undefined; finish: () => boolean },
  enabled = true,
) {
  const latest = useRef(port);
  latest.current = port;
  useEffect(
    () =>
      enabled
        ? buffers.register(id, {
            read: () => latest.current.read(),
            finish: () => latest.current.finish(),
          })
        : undefined,
    [buffers, id, enabled],
  );
}
