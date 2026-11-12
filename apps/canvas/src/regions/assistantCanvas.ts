/** Canvas-specific assistant adapters over existing drawing, scene and worksheet owners. */
import {
  freeze,
  json,
  reference,
  current,
  type Json,
} from "@manifold/foundation";
import {
  agentCapabilities,
  editWorkspace,
  summarizeWorksheet,
} from "../agent.ts";
import { bindLiveWorkspace } from "../headless.ts";
import type { Point, RegionSession } from "./document.ts";
import {
  createDrawing,
  drawings,
  editDrawings,
  deleteDrawings,
  validateMark,
  type Mark,
} from "./drawing.ts";
import { positions } from "./pageLayout.ts";
import { curve } from "./worksheetProjection.ts";
import { ANALYSIS_RENDERER } from "./modelAnalysis.ts";
import { createModelAnalysis } from "./modelAnalysisCommands.ts";
import { samplingReference } from "./samplingPlans.ts";

export type CanvasImage = {
  mimeType: "image/jpeg";
  data: string;
  documentId: string;
  width: number;
  height: number;
  target?: string;
};
export type AssistantCanvasPort = {
  inspect: () => unknown;
  capture: (args: unknown) => Promise<CanvasImage>;
};
const string = { type: "string", minLength: 1, maxLength: 160 };
const point = {
  type: "object",
  properties: {
    x: { type: "number", minimum: -1e6, maximum: 1e6 },
    y: { type: "number", minimum: -1e6, maximum: 1e6 },
  },
  required: ["x", "y"],
  additionalProperties: false,
};
const anchor = {
  anyOf: [
    { type: "null" },
    {
      type: "object",
      properties: {
        drawing: string,
        u: { type: "number", minimum: 0, maximum: 1 },
        v: { type: "number", minimum: 0, maximum: 1 },
      },
      required: ["drawing", "u", "v"],
      additionalProperties: false,
    },
  ],
};
const mark = {
  type: "object",
  properties: {
    kind: {
      enum: [
        "pen",
        "highlighter",
        "line",
        "arrow",
        "rectangle",
        "ellipse",
        "text",
        "connector",
      ],
    },
    color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
    width: { type: "number", minimum: 0.5, maximum: 40 },
    points: {
      type: "array",
      minItems: 1,
      maxItems: 512,
      items: {
        ...point,
        properties: {
          ...point.properties,
          pressure: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["x", "y", "pressure"],
      },
    },
    text: { type: "string", maxLength: 4096 },
    start: anchor,
    end: anchor,
  },
  required: ["kind", "color", "width", "points", "text", "start", "end"],
  additionalProperties: false,
};
const definitions = {
  createDrawing: {
    properties: { mark, at: point, as: string },
    required: ["mark", "at"],
  },
  updateDrawing: {
    properties: { drawing: string, mark },
    required: ["drawing", "mark"],
  },
  deleteDrawing: { properties: { drawing: string }, required: ["drawing"] },
  placeObjects: {
    properties: {
      placements: {
        type: "array",
        minItems: 1,
        maxItems: 128,
        items: {
          type: "object",
          properties: { id: string, at: point },
          required: ["id", "at"],
          additionalProperties: false,
        },
      },
    },
    required: ["placements"],
  },
  groupObjects: {
    properties: {
      name: { type: "string", minLength: 1, maxLength: 80 },
      members: {
        type: "array",
        minItems: 2,
        maxItems: 128,
        uniqueItems: true,
        items: string,
      },
      layout: { enum: ["row", "stack"] },
    },
    required: ["name", "members", "layout"],
  },
  ungroupObjects: { properties: { group: string }, required: ["group"] },
  createAnalysis: {
    properties: {
      model: string,
      input: string,
      output: string,
      low: { type: "number", minimum: -1e12, maximum: 1e12 },
      high: { type: "number", minimum: -1e12, maximum: 1e12 },
      points: { type: "integer", minimum: 2, maximum: 201 },
      at: point,
      as: string,
    },
    required: ["model", "input", "output", "low", "high", "points", "at"],
  },
  createPlot: {
    properties: { output: string, input: string, at: point, as: string },
    required: ["output", "input"],
  },
} as const;

export function assistantCapabilities() {
  const base = agentCapabilities();
  return freeze({
    ...base,
    canvas: {
      coordinates:
        "Canvas/world pixels, not screen pixels. Use inspect_canvas for representation IDs, geometry, invocation point, viewport and scene. placeObjects uses representation IDs; drawing operations use drawing object IDs. New drawings use local points relative to at. Shapes require exactly two points; text is visual annotation, not engineering source. Optional connector start/end anchors use {drawing: object ID or creation alias, u, v} and must target live rectangle/ellipse drawings. Grouping preserves positions; use placeObjects to arrange members. createPlot creates a derived worksheet curve. createAnalysis creates a scalar-model sweep in the input port's declared units, but its result requires the user's explicit Compute action after approval. No computation is executed.",
      tools: ["inspect_canvas", "inspect_plot", "look_at_canvas"],
    },
    editSchema: {
      ...base.editSchema,
      properties: {
        ...base.editSchema.properties,
        edits: {
          ...base.editSchema.properties.edits,
          maxItems: 50,
          items: {
            oneOf: [
              ...base.editSchema.properties.edits.items.oneOf,
              ...Object.entries(definitions).map(([operation, definition]) => ({
                type: "object",
                properties: {
                  operation: { const: operation },
                  ...definition.properties,
                },
                required: ["operation", ...definition.required],
                additionalProperties: false,
              })),
            ],
          },
        },
      },
    },
  });
}

export function inspectCanvas(session: RegionSession) {
  const page = session.state;
  return freeze({
    documentId: session.document.id,
    coordinates: "canvas/world pixels",
    objects: [
      ...Object.entries(positions(page)).map(([id, at]) => ({ id, at })),
      ...[...session.document.views.entries()].map(([id, view]) => ({
        id,
        object: view.reference.item,
        reference: view.reference,
        renderer: view.renderer,
        at: { x: view.x, y: view.y },
      })),
      ...session.artifacts.flatMap((artifact) => [
        {
          id: artifact.id,
          at: artifact.at,
          width: artifact.width,
          height: artifact.height,
        },
        ...(artifact.views || []),
      ]),
      ...session.scene.tools.map((tool) => ({
        id: tool.id,
        at: tool.at,
        width: tool.width,
        height: tool.height,
      })),
    ],
    drawings: drawings(session.document).map(({ id, view, mark }) => ({
      id,
      view: view.id,
      mark,
    })),
    plots: page.plots,
    analyses: [...session.document.views.entries()]
      .filter(([, view]) => view.renderer === ANALYSIS_RENDERER)
      .map(([id, view]) => ({
        id,
        object: view.reference.item,
        label: session.document.items.get(view.reference.item)?.label,
        baselineDefinition: current(session.document, view.reference.item)
          ?.body,
        alternative: view.alternative,
      })),
    artifacts: session.artifacts.map(
      ({ id, input, output, low, high, renderer, views }) => ({
        id,
        input,
        output,
        low,
        high,
        renderer,
        views,
      }),
    ),
    scene: session.scene,
  });
}

export function summarizeCanvas(session: RegionSession, args: unknown) {
  const options = object(args);
  fields(options, ["offset", "limit"]);
  const offset = options.offset ?? 0,
    limit = options.limit ?? 100;
  if (
    !Number.isInteger(offset) ||
    Number(offset) < 0 ||
    !Number.isInteger(limit) ||
    Number(limit) < 1 ||
    Number(limit) > 100
  )
    throw Error("Use an offset ≥0 and a limit of 1–100 objects");
  const snapshot = inspectCanvas(session);
  const objects = snapshot.objects.slice(
    Number(offset),
    Number(offset) + Number(limit),
  );
  const ids = new Set(objects.map((object) => object.id));
  return freeze({
    ...snapshot,
    objects,
    pagination: {
      offset,
      limit,
      total: snapshot.objects.length,
      hasMore: Number(offset) + Number(limit) < snapshot.objects.length,
    },
    drawings: snapshot.drawings
      .filter((entry) => ids.has(entry.view))
      .map((entry) => ({
        ...entry,
        pointCount: entry.mark.points.length,
        pointsTruncated: entry.mark.points.length > 64,
        mark: { ...entry.mark, points: entry.mark.points.slice(0, 64) },
      })),
    plots: snapshot.plots.filter((entry) => ids.has(entry.id)),
    analyses: snapshot.analyses.filter((entry) => ids.has(entry.id)),
    artifacts: snapshot.artifacts.filter(
      (entry) =>
        ids.has(entry.id) || entry.views?.some((view) => ids.has(view.id)),
    ),
    scene: {
      ...snapshot.scene,
      viewpoints: snapshot.scene.viewpoints.map(
        ({ id, name, camera, scope }) => ({ id, name, camera, scope }),
      ),
    },
  });
}

export function inspectPlot(session: RegionSession, args: unknown) {
  const value = object(args);
  fields(value, ["id"]);
  const id = text(value.id);
  const plot = session.state.plots.find((plot) => plot.id === id);
  if (plot) {
    const workspace = bindLiveWorkspace(session);
    try {
      const worksheet = summarizeWorksheet(workspace);
      return freeze({
        documentId: session.document.id,
        id,
        status: "derived-not-checked",
        plot,
        input: worksheet.regions.find((region) => region.id === plot.input),
        output: worksheet.regions.find((region) => region.id === plot.output),
        ...curve(session.state, plot),
      });
    } finally {
      workspace.dispose();
    }
  }
  const view = [...session.document.views.entries()]
    .map(([, view]) => view)
    .find(
      (view) =>
        view.renderer === ANALYSIS_RENDERER &&
        (view.id === id || view.reference.item === id),
    );
  const artifact = session.artifacts.find(
    (artifact) =>
      artifact.id === id || artifact.views?.some((view) => view.id === id),
  );
  if (!view && !artifact)
    throw Error(
      "Unknown plot. Discover plot or analysis IDs with inspect_canvas first.",
    );
  const result = view
    ? session.foundation.result(
        view.reference,
        view.alternative ? { alternative: view.alternative } : "baseline",
      )
    : session.foundation.result(
        samplingReference(
          session.document,
          artifact!.id,
          artifact!.compareContext || session.state.active,
        ),
        "baseline",
      );
  const receipt = "receipt" in result ? result.receipt : undefined;
  return freeze({
    documentId: session.document.id,
    id,
    status: result.status,
    ...("reason" in result ? { reason: result.reason } : {}),
    ...(artifact
      ? {
          input: artifact.input,
          output: artifact.output,
          low: artifact.low,
          high: artifact.high,
        }
      : {}),
    receipt: receipt ? { id: receipt.id, outcome: receipt.outcome } : null,
  });
}

export function canvasChanges(
  before: ReturnType<typeof inspectCanvas>,
  after: ReturnType<typeof inspectCanvas>,
) {
  const changed = (
    a: readonly { id: string }[],
    b: readonly { id: string }[],
  ) => {
    const left = new Map(a.map((entry) => [entry.id, entry]));
    const right = new Map(b.map((entry) => [entry.id, entry]));
    return [...new Set([...left.keys(), ...right.keys()])].flatMap((id) =>
      JSON.stringify(left.get(id)) === JSON.stringify(right.get(id))
        ? []
        : [{ id, before: left.get(id) ?? null, after: right.get(id) ?? null }],
    );
  };
  return freeze({
    objects: changed(before.objects, after.objects),
    drawings: changed(before.drawings, after.drawings),
    plots: changed(before.plots, after.plots),
    analyses: changed(before.analyses, after.analyses),
    scene:
      JSON.stringify(before.scene) === JSON.stringify(after.scene)
        ? null
        : { before: before.scene, after: after.scene },
  });
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Expected an object");
  return value as Record<string, unknown>;
}
function fields(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw Error("Unknown canvas edit field");
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 160)
    throw Error("Expected a bounded object ID");
  return value;
}
function at(value: unknown): Point {
  const p = object(value);
  fields(p, ["x", "y"]);
  if (
    typeof p.x !== "number" ||
    typeof p.y !== "number" ||
    !Number.isFinite(p.x + p.y) ||
    Math.abs(p.x) > 1e6 ||
    Math.abs(p.y) > 1e6
  )
    throw Error("Expected canvas coordinates within ±1,000,000");
  return { x: p.x, y: p.y };
}
function drawingMark(
  value: unknown,
  session: RegionSession,
  target: (value: unknown) => string,
): Mark {
  json(value);
  const raw = object(structuredClone(value));
  for (const field of ["start", "end"])
    if (raw[field] !== null) {
      const anchor = object(raw[field]);
      fields(anchor, ["drawing", "u", "v"]);
      raw[field] = {
        target: reference(session.document.document, target(anchor.drawing)),
        u: anchor.u,
        v: anchor.v,
      };
    }
  const data = raw as Json;
  validateMark(data);
  if (data.points.length > 512)
    throw Error("Assistant drawings support at most 512 points");
  return data;
}

/** Called only within RegionSession.prepare; no new accepted state or mutation engine. */
export function editCanvas(session: RegionSession, payload: unknown) {
  json(payload);
  const batch = object(payload);
  fields(batch, ["expectedDocumentId", "edits"]);
  if (batch.expectedDocumentId !== session.document.id)
    throw Error("Canvas changed; inspect it again before proposing edits");
  if (
    !Array.isArray(batch.edits) ||
    !batch.edits.length ||
    batch.edits.length > 50
  )
    throw Error("Expected 1–50 edits");
  const aliases = new Map<string, string>();
  const representation = (id: string) => {
    const known = inspectCanvas(session).objects;
    if (known.some((entry) => entry.id === id)) return id;
    const choices = [...session.document.views.entries()].filter(
      ([, view]) => view.reference.item === id,
    );
    if (choices.length !== 1)
      throw Error("Expected one known representation ID");
    return choices[0][0];
  };
  const target = (value: unknown) => {
    const id = text(value);
    return id.startsWith("$")
      ? aliases.get(id.slice(1)) ||
          (() => {
            throw Error("Unknown or forward creation alias");
          })()
      : id;
  };
  for (const raw of batch.edits) {
    const edit = object(raw);
    const operation = text(edit.operation);
    const definition = definitions[operation as keyof typeof definitions];
    if (!Object.hasOwn(definitions, operation)) {
      const editor = bindLiveWorkspace(session);
      try {
        const resolved = { ...edit };
        for (const field of ["region", "model"])
          if (resolved[field] !== undefined)
            resolved[field] = target(resolved[field]);
        const result = editWorkspace(editor, {
          expectedDocumentId: session.document.id,
          edits: [resolved],
        });
        for (const [name, id] of Object.entries(result.aliases)) {
          if (aliases.has(name)) throw Error("Duplicate creation alias");
          aliases.set(name, id);
        }
      } finally {
        editor.dispose();
      }
      continue;
    }
    fields(edit, ["operation", ...Object.keys(definition.properties)]);
    for (const required of definition.required)
      if (!Object.hasOwn(edit, required)) throw Error(`Missing ${required}`);
    let created: string | undefined;
    if (operation === "createDrawing")
      created = createDrawing(
        session,
        drawingMark(edit.mark, session, target),
        at(edit.at),
      );
    else if (operation === "updateDrawing" || operation === "deleteDrawing") {
      const entry = drawings(session.document).find(
        (entry) => entry.id === target(edit.drawing),
      );
      if (!entry) throw Error("Unknown drawing object");
      if (operation === "updateDrawing")
        editDrawings(session, [
          { entry, mark: drawingMark(edit.mark, session, target) },
        ]);
      else deleteDrawings(session, [entry.id]);
    } else if (operation === "placeObjects") {
      if (
        !Array.isArray(edit.placements) ||
        !edit.placements.length ||
        edit.placements.length > 128
      )
        throw Error("Expected 1–128 placements");
      const placements: Record<string, Point> = Object.create(null);
      for (const raw of edit.placements) {
        const placement = object(raw);
        fields(placement, ["id", "at"]);
        const id = representation(target(placement.id));
        if (Object.hasOwn(placements, id))
          throw Error("Unknown or duplicate representation ID");
        placements[id] = at(placement.at);
      }
      session.arrange(placements);
      const place = <T extends { id: string; at: Point }>(entry: T): T =>
        placements[entry.id] ? { ...entry, at: placements[entry.id] } : entry;
      session.setArtifacts((items) =>
        items.map((artifact) => ({
          ...place(artifact),
          ...(artifact.views ? { views: artifact.views.map(place) } : {}),
        })),
      );
      session.setScene((scene) => ({
        ...scene,
        tools: scene.tools.map(place),
      }));
    } else if (operation === "groupObjects") {
      if (
        typeof edit.name !== "string" ||
        !edit.name.trim() ||
        edit.name.length > 80 ||
        !["row", "stack"].includes(edit.layout as string) ||
        !Array.isArray(edit.members) ||
        edit.members.length < 2 ||
        edit.members.length > 128
      )
        throw Error(
          "Expected a named row/stack group of 2–128 representations",
        );
      const members = edit.members.map((id) => representation(target(id)));
      const known = new Set(
        inspectCanvas(session).objects.map((object) => object.id),
      );
      if (
        new Set(members).size !== members.length ||
        members.some(
          (id) =>
            !known.has(id) ||
            session.scene.groups.some((group) => group.members.includes(id)),
        )
      )
        throw Error(
          "Group members must be known, distinct, ungrouped representations",
        );
      session.setScene((scene) => ({
        ...scene,
        groups: [
          ...scene.groups,
          {
            id: `group-${crypto.randomUUID()}`,
            name: edit.name as string,
            members,
            layout: edit.layout as "row" | "stack",
            auto: false,
          },
        ],
      }));
    } else if (operation === "ungroupObjects") {
      const id = target(edit.group);
      if (!session.scene.groups.some((group) => group.id === id))
        throw Error("Unknown group");
      session.setScene((scene) => ({
        ...scene,
        groups: scene.groups.filter((group) => group.id !== id),
      }));
    } else if (operation === "createAnalysis") {
      created = createModelAnalysis(
        session,
        target(edit.model),
        {
          input: text(edit.input),
          output: text(edit.output),
          low: edit.low as number,
          high: edit.high as number,
          points: edit.points as number,
        },
        at(edit.at),
      );
    } else if (operation === "createPlot") {
      created = session.addPlot(target(edit.output), target(edit.input));
      if (edit.at !== undefined) session.arrange({ [created]: at(edit.at) });
    }
    if (edit.as !== undefined) {
      const name = text(edit.as);
      if (
        !created ||
        !/^[A-Za-z][A-Za-z0-9_-]*$/.test(name) ||
        aliases.has(name)
      )
        throw Error("Invalid or duplicate creation alias");
      aliases.set(name, created);
    }
  }
}
