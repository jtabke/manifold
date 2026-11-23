import { webHash } from "@manifold/foundation";
import { useEffect, useRef, useState } from "react";
import { decodeWorkspace } from "../artifacts.ts";
import {
  fileVersion,
  sameFileVersion,
  saveWorkspaceFileLink,
  type FileVersion,
  type WorkspaceFileLink,
} from "./workspaceFileLink.ts";
import { checkWorkspaceFileSize } from "./workspaceCodec.ts";
import type { canvasWorkspace, WorkspaceEdits } from "./workspaceFiles.ts";

type Status =
  | "watching"
  | "waiting"
  | "permission"
  | "unavailable"
  | "invalid"
  | "different-file"
  | "local-changes"
  | "link-save-failed";
type Candidate = {
  version: FileVersion;
  digest?: string;
  data?: Awaited<ReturnType<typeof decodeWorkspace>>;
};

export function useLinkedWorkspaceFile(
  source: WorkspaceFileLink | undefined,
  key: string,
  workspace: ReturnType<typeof canvasWorkspace>,
  edits: WorkspaceEdits,
  busy: () => boolean,
) {
  const [status, setStatus] = useState<Status>("watching"),
    current = useRef({ edits, busy }),
    checkNow = useRef<() => void>(undefined);
  current.current = { edits, busy };
  useEffect(() => {
    if (!source) return;
    let link = source,
      candidate: Candidate | undefined,
      active = true,
      reading = false,
      linkSaveFailed = false,
      timer: ReturnType<typeof setTimeout> | undefined;
    const watching = () =>
      setStatus(linkSaveFailed ? "link-save-failed" : "watching");
    const check = async () => {
      if (!active || document.hidden || reading) return;
      clearTimeout(timer);
      reading = true;
      try {
        const file = await link.handle.getFile();
        if (!active) return;
        if (sameFileVersion(file, link.version)) {
          candidate = undefined;
          watching();
          return;
        }
        if (!candidate || !sameFileVersion(file, candidate.version)) {
          const next: Candidate = { version: fileVersion(file) };
          try {
            checkWorkspaceFileSize(file.size);
            const text = await file.text();
            next.digest = await webHash(text);
            if (next.digest !== link.digest)
              next.data = await decodeWorkspace(text);
          } catch {
            // An editor may still be saving. Retry on the next observed version.
            if (next.digest === undefined) {
              if (active) setStatus("invalid");
              return;
            }
          }
          candidate = next;
        }
        if (!active || document.hidden) return;
        if (candidate.digest === link.digest) {
          // A touch or byte-for-byte rewrite is not a new workspace snapshot.
          link = { ...link, version: candidate.version };
          candidate = undefined;
          watching();
          return;
        }
        if (!candidate.data || !candidate.digest) {
          setStatus("invalid");
          return;
        }
        // The underlying file may have changed while we validated these bytes.
        if (!sameFileVersion(await link.handle.getFile(), candidate.version))
          return;
        if (!active || document.hidden) return;
        let result;
        try {
          result = workspace.refreshLinkedFile(
            candidate.data,
            link.base,
            current.current.edits,
            current.current.busy(),
          );
        } catch {
          candidate.data = undefined;
          setStatus("invalid");
          return;
        }
        if (typeof result === "string") {
          setStatus(result);
          return;
        }
        link = {
          ...link,
          base: result,
          version: candidate.version,
          digest: candidate.digest,
        };
        candidate = undefined;
        setStatus("watching");
        // Never acknowledge the disk version durably before the local snapshot commits.
        if (await workspace.save()) {
          linkSaveFailed = await saveWorkspaceFileLink(key, link).then(
            () => false,
            () => true,
          );
          if (active) watching();
        }
      } catch (error) {
        if (active)
          setStatus(
            (error as Error).name === "NotAllowedError"
              ? "permission"
              : "unavailable",
          );
      } finally {
        reading = false;
        if (active && !document.hidden) timer = setTimeout(check, 1000);
      }
    };
    const wake = () => void check();
    checkNow.current = wake;
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    wake();
    return () => {
      active = false;
      clearTimeout(timer);
      checkNow.current = undefined;
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [source, key, workspace]);
  return {
    status,
    async resume() {
      try {
        await source?.handle.requestPermission?.({ mode: "read" });
      } finally {
        checkNow.current?.();
      }
    },
  };
}
