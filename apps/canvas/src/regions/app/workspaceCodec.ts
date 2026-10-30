/** One native wrapper for live export and validated saved-work rescue. */
import {
  byteLength,
  encode,
  type Loaded,
  type Schemas,
  type Envelope,
} from "@manifold/foundation";
import { MAX_CANVAS_FILE_BYTES } from "./canvasStorageBudget.ts";
export function checkWorkspaceFileSize(bytes: number) {
  if (
    !Number.isSafeInteger(bytes) ||
    bytes < 0 ||
    bytes > MAX_CANVAS_FILE_BYTES
  )
    throw Error("Workspace file exceeds the 128 MiB transport limit.");
}
export function archiveLoaded(state: Loaded, schemas: Schemas): string {
  return archive(
    JSON.parse(
      encode(
        state.document,
        state.receipts,
        state.resources,
        schemas,
        state.original,
      ),
    ),
  );
}
export function archive(foundation: Envelope): string {
  // Compact JSON keeps the transport below the conservative retained-state bound.
  const text = JSON.stringify({
    format: "manifold-region-artifacts",
    version: 7,
    foundation,
  });
  checkWorkspaceFileSize(byteLength(text));
  return text;
}
