/** Transient assistant preferences; credentials never belong in this snapshot. */
export type AssistantPermission = "read-only" | "reviewed-edits";
export type AssistantSettings = {
  provider: string;
  model: string;
  thinking: string;
  permissions: AssistantPermission;
};
