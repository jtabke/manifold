/** Focused reads use existing semantic projections; no computation or DOM access. */
import { current } from "@manifold/foundation";
import type { HeadlessWorkspace } from "../headless.ts";
import { inspectCanvas } from "./assistantCanvas.ts";
import { canvasSchemas } from "./app/canvasDocument.ts";
import { project } from "./worksheetProjection.ts";
import type { RegionSession } from "./document.ts";
import { McpError } from "./mcpProtocol.ts";

export function inspectMcpFocus(
  session: RegionSession,
  workspace: HeadlessWorkspace,
  name: string,
  args: Record<string, unknown>,
  attention: unknown,
) {
  const documentId = session.document.id;
  const id = args.id as string;
  const equation = (regionId: string) => {
    const region = workspace
      .worksheet()
      .regions.find((entry) => entry.id === regionId);
    if (!region)
      throw new McpError("ITEM_NOT_FOUND", "Worksheet region not found");
    return region;
  };
  if (name === "inspect_model")
    return { documentId, model: workspace.describeModel(id) };
  if (name === "inspect_equation") return { documentId, region: equation(id) };
  if (name === "inspect_selection") {
    const selected = (attention as { selection?: unknown } | undefined)
      ?.selection;
    const ids = args.ids ?? selected ?? [];
    if (
      !Array.isArray(ids) ||
      ids.length > 50 ||
      ids.some((value) => typeof value !== "string")
    )
      throw new McpError("INVALID_ARGUMENTS", "Select at most 50 object IDs");
    const snapshot = inspectCanvas(session);
    return {
      documentId,
      selection: ids,
      objects: ids.map((selectedId: string) => {
        const representation = snapshot.objects.find(
          (entry) => entry.id === selectedId,
        );
        const itemId =
          session.document.views.get(selectedId)?.reference.item ?? selectedId;
        const regionId = session.state.regions.find(
          (entry) => entry.id === itemId || "region:" + entry.id === itemId,
        )?.id;
        if (regionId)
          return { id: selectedId, representation, region: equation(regionId) };
        if (
          current(session.document, itemId)?.schema ===
          "scalar-model-instance@1"
        )
          return {
            id: selectedId,
            representation,
            model: workspace.describeModel(itemId),
          };
        const drawing = snapshot.drawings.find(
          (entry) => entry.id === selectedId || entry.view === selectedId,
        );
        if (drawing)
          return {
            id: selectedId,
            representation,
            drawing: {
              ...drawing,
              pointCount: drawing.mark.points.length,
              pointsTruncated: drawing.mark.points.length > 64,
              mark: {
                ...drawing.mark,
                points: drawing.mark.points.slice(0, 64),
              },
            },
          };
        if (representation) return { id: selectedId, representation };
        return {
          id: selectedId,
          error: {
            code: "ITEM_NOT_FOUND",
            message: "Selected object no longer exists",
          },
        };
      }),
    };
  }
  if (name === "inspect_dependencies") {
    const depth = args.depth ?? 2,
      limit = args.limit ?? 50,
      direction = args.direction ?? "upstream";
    if (
      !Number.isInteger(depth) ||
      Number(depth) < 1 ||
      Number(depth) > 8 ||
      !Number.isInteger(limit) ||
      Number(limit) < 1 ||
      Number(limit) > 100 ||
      !["upstream", "downstream"].includes(String(direction))
    )
      throw new McpError(
        "INVALID_ARGUMENTS",
        "Use depth 1–8, limit 1–100 and upstream/downstream direction",
      );
    const graph = new Map<string, string[]>();
    const projection = project(session.state);
    for (const region of session.state.regions)
      graph.set(region.id, [
        ...new Set(Object.values(projection.bindings[region.id] ?? {})),
      ]);
    for (const [itemId] of session.document.items.entries()) {
      const revision = current(session.document, itemId);
      if (!revision) continue;
      const refs =
        canvasSchemas.get(revision.schema)?.references(revision.body) ?? [];
      graph.set(itemId, [
        ...new Set(
          refs
            .filter(
              (ref) =>
                ref.document === session.document.document &&
                ref.selection.kind === "follow",
            )
            .map((ref) => ref.item),
        ),
      ]);
    }
    if (!graph.has(id))
      throw new McpError("ITEM_NOT_FOUND", "Dependency target not found");
    const links = (target: string) =>
      direction === "upstream"
        ? (graph.get(target) ?? [])
        : [...graph]
            .filter(([, values]) => values.includes(target))
            .map(([key]) => key);
    const visited = new Set([id]);
    const queue = [{ id, depth: 0 }];
    const nodes: { id: string; depth: number }[] = [];
    const edges: { from: string; to: string }[] = [];
    let truncated = false;
    while (queue.length) {
      const node = queue.shift()!;
      const adjacent = links(node.id);
      if (node.depth >= Number(depth)) {
        if (adjacent.some((value) => !visited.has(value))) truncated = true;
        continue;
      }
      for (const next of adjacent) {
        if (!visited.has(next)) {
          if (nodes.length >= Number(limit)) {
            truncated = true;
            continue;
          }
          visited.add(next);
          const entry = { id: next, depth: node.depth + 1 };
          nodes.push(entry);
          queue.push(entry);
        }
        // Only return edges whose endpoints are included in this bounded response.
        if (edges.length < 500)
          edges.push(
            direction === "upstream"
              ? { from: node.id, to: next }
              : { from: next, to: node.id },
          );
        else truncated = true;
      }
    }
    return {
      documentId,
      id,
      direction,
      nodes,
      edges,
      truncated,
      semantics:
        "Worksheet bindings and current local follow references. Pinned history and cross-document references are not traversed; visual connectors are not computational dependencies.",
    };
  }
  throw new McpError("UNKNOWN_TOOL", "Unknown focused inspection tool");
}
