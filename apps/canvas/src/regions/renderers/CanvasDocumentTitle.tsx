import { useRef, useState } from "react";
import type { RegionSession } from "../document";
import type { EditBuffers } from "../app/workspaceFiles";
import { useEditBuffer } from "../app/useEditBuffer";

export function CanvasDocumentTitle({
  title,
  session,
  buffers,
}: {
  title: string;
  session: RegionSession;
  buffers: EditBuffers;
}) {
  const [draft, setDraft] = useState<string>();
  const pending = useRef<string | undefined>(undefined);
  const change = (value: string | undefined) => {
    pending.current = value;
    setDraft(value);
  };
  const finish = () => {
    if (pending.current !== undefined) {
      session.renameDocument(pending.current);
      change(undefined);
    }
    return true;
  };
  useEditBuffer(buffers, "document-title", {
    read: () => pending.current,
    finish,
  });
  return (
    <input
      aria-label="Document title"
      title="Rename document · Enter to keep · Escape to cancel"
      maxLength={160}
      placeholder="Untitled document"
      value={draft ?? title}
      onChange={(event) => change(event.target.value)}
      onBlur={finish}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (event.key === "Escape") change(undefined);
          else finish();
          event.currentTarget.blur();
        }
      }}
    />
  );
}
