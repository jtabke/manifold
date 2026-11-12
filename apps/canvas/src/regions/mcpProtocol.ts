/** Shared wire errors and permissions. Neither the transport nor tool hints grant authority. */
export const MCP_SCOPES = [
  "read-only",
  "proposal-only",
  "edit",
  "full-control",
] as const;
export type McpScope = (typeof MCP_SCOPES)[number];
export type McpErrorData = { code: string; message: string; recovery: string };
export class McpError extends Error {
  readonly code: string;
  readonly recovery: string;
  constructor(
    code: string,
    message: string,
    recovery = "Inspect current state and correct the request before retrying.",
  ) {
    super(message);
    this.name = "McpError";
    this.code = code;
    this.recovery = recovery;
  }
  toJSON(): McpErrorData {
    return { code: this.code, message: this.message, recovery: this.recovery };
  }
}
export function mcpErrorData(
  error: unknown,
  fallback = "OPERATION_REJECTED",
): McpErrorData {
  if (error instanceof McpError) return error.toJSON();
  return new McpError(
    fallback,
    (error instanceof Error ? error.message : String(error)).slice(0, 1000),
  ).toJSON();
}
export const MCP_MUTATIONS = [
  "edit_canvas",
  "apply_proposal",
  "undo",
  "redo",
  "compute",
  "start_compute",
  "cancel_compute",
] as const;
export function mcpAllowed(scope: McpScope, tool: string) {
  if (["compute", "start_compute", "cancel_compute"].includes(tool))
    return scope === "full-control";
  if (["edit_canvas", "apply_proposal", "undo", "redo"].includes(tool))
    return scope === "edit" || scope === "full-control";
  if (tool === "prepare_edit") return scope !== "read-only";
  return true;
}
