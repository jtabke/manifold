/** Compile the consumer-facing agent exports without application-internal imports. */
import { createHeadlessWorkspace } from "manifold-canvas/headless";
import {
  AGENT_PROTOCOL_VERSION,
  agentCapabilities,
  inspectWorkspace,
  summarizeWorkspace,
  summarizeWorksheet,
  type CompactAgentSnapshot,
  editWorkspace,
  validateWorkspace,
  compareWorkspaces,
  type AgentSnapshot,
} from "manifold-canvas/agent";

const workspace = createHeadlessWorkspace();
const snapshot: AgentSnapshot = inspectWorkspace(workspace);
const version: number = AGENT_PROTOCOL_VERSION;
const schema = agentCapabilities().editSchema;
const result = editWorkspace(workspace, {
  expectedDocumentId: snapshot.documentId,
  edits: [
    { operation: "createNote", text: "Engineering assumption", as: "note" },
  ],
});
const id: string = result.aliases.note;
const clean: boolean = validateWorkspace(workspace).clean;
const changes = compareWorkspaces(workspace, workspace).regions;
const compact: CompactAgentSnapshot = summarizeWorkspace(workspace);
const view: "compact" = compact.view;
const rows = summarizeWorksheet(workspace).regions;
void [version, schema, id, clean, changes, view, rows];
workspace.dispose();
