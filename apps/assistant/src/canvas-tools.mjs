import { CANVAS_PERMISSIONS, canvasToolAllowed } from "./canvas-settings.mjs";

const emptyParameters = {
  type: "object",
  properties: {},
  additionalProperties: false,
};
export function canvasTools(
  call,
  { images = true, permissions = "reviewed-edits" } = {},
) {
  if (!CANVAS_PERMISSIONS.includes(permissions))
    throw Error("Unknown canvas permission mode");
  return [
    {
      name: "inspect_workspace",
      label: "Inspect canvas",
      description:
        "Read the live worksheet, models, units, diagnostics, projections and checked result currency. Includes exact read-only references for objects and model inputs; copy their label and href into Markdown answer links rather than guessing IDs.",
      parameters: emptyParameters,
    },
    {
      name: "inspect_canvas",
      label: "Inspect canvas objects",
      description:
        "Read paged drawing marks, representation IDs/world geometry, groups, plots, cursor invocation point and current viewport. At most 100 objects per page; use pagination.hasMore and offset to continue. Long strokes show 64 points and their full pointCount; use images for complete appearance. No edits or execution.",
      parameters: {
        type: "object",
        properties: {
          offset: { type: "integer", minimum: 0 },
          limit: { type: "integer", minimum: 1, maximum: 100 },
        },
        additionalProperties: false,
      },
    },
    {
      name: "inspect_plot",
      label: "Read plot data",
      description:
        "Read exact worksheet curve points or retained analysis/sampling outcomes and their actual currency. Never runs a computation. Discover the ID with inspect_canvas.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", minLength: 1, maxLength: 160 } },
        required: ["id"],
        additionalProperties: false,
      },
    },
    {
      name: "look_at_canvas",
      label: "Look at canvas",
      description:
        "Read a bounded image of the current canvas viewport, or one visible representation by ID. Excludes assistant/settings and page chrome. Images go to the configured provider. Read inspect_canvas alongside the image for exact IDs and world coordinates.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", minLength: 1, maxLength: 160 } },
        additionalProperties: false,
      },
    },
    {
      name: "capabilities",
      label: "Read edit capabilities",
      description:
        "Discover the supported edit operations and exact JSON batch schema.",
      parameters: emptyParameters,
    },
    {
      name: "prepare_edit",
      label: "Prepare canvas edit",
      description:
        "Validate and stage 1–50 edits for human review. Does not apply, save or execute. Read capabilities for the batch schema first.",
      parameters: {
        type: "object",
        properties: {
          explanation: { type: "string", maxLength: 5000 },
          batch: {
            type: "object",
            properties: {
              expectedDocumentId: { type: "string" },
              edits: {
                type: "array",
                minItems: 1,
                maxItems: 50,
                items: { type: "object", additionalProperties: true },
              },
            },
            required: ["expectedDocumentId", "edits"],
            additionalProperties: false,
          },
        },
        required: ["explanation", "batch"],
        additionalProperties: false,
      },
    },
  ]
    .filter((tool) => images || tool.name !== "look_at_canvas")
    .filter((tool) => canvasToolAllowed(tool.name, permissions))
    .map((tool) => ({
      ...tool,
      async execute(_id, args, signal) {
        const result = await call(tool.name, args, signal);
        if (tool.name === "look_at_canvas") {
          if (
            result?.mimeType !== "image/jpeg" ||
            typeof result.data !== "string" ||
            !result.data.length ||
            result.data.length > 1_500_000 ||
            !/^[A-Za-z0-9+/]+={0,2}$/.test(result.data)
          )
            throw Error("Invalid bounded canvas image");
          const { data, ...metadata } = result;
          return {
            content: [
              { type: "text", text: JSON.stringify(metadata) },
              { type: "image", data, mimeType: result.mimeType },
            ],
            details: metadata,
          };
        }
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          details: {},
        };
      },
    }));
}
