import * as f from "@manifold/foundation";
import type { RegionSession, Point } from "./document.ts";
import {
  createDrawing,
  drawings,
  editDrawings,
  type DrawingEntry,
  type Mark,
} from "./drawing.ts";
import { drawingGeometry, pointBounds } from "./drawingGeometry.ts";
import {
  defaultDrawingScale,
  snapDrawingPoint,
  parseDrawingLength,
  validateDrawingScale,
  type DrawingScale,
} from "./drawingScale.ts";
import {
  dimensionAxes,
  type DimensionAxis,
  type DimensionPlacement,
} from "./drawingDimensions.ts";
export function setDimensionPlacement(
  session: RegionSession,
  id: string,
  axis: DimensionAxis,
  placement: DimensionPlacement | null,
  expected = session.document,
) {
  const entry = drawings(expected).find((e) => e.id === id);
  f.assert(
    entry?.mark.area && dimensionAxes(entry.mark.kind).includes(axis),
    "Choose a dimension on a live scaled drawing",
  );
  const mark = { ...entry.mark },
    placements = { ...mark.dimensionPlacement };
  if (placement) placements[axis] = placement;
  else delete placements[axis];
  if (Object.keys(placements).length) mark.dimensionPlacement = placements;
  else delete mark.dimensionPlacement;
  editDrawings(session, [{ entry, mark }], expected);
}
export function resetDimensionPlacements(
  session: RegionSession,
  ids: readonly string[],
) {
  editDrawings(
    session,
    drawings(session.document)
      .filter(
        (entry) => ids.includes(entry.id) && entry.mark.dimensionPlacement,
      )
      .map((entry) => {
        const mark = { ...entry.mark };
        delete mark.dimensionPlacement;
        return { entry, mark };
      }),
  );
}
const p = (x: number, y: number) => ({ x, y, pressure: 0.5 });
export function createScaledArea(
  session: RegionSession,
  at: Point,
  width = 800,
  height = 500,
  scale = defaultDrawingScale(),
) {
  validateDrawingScale(scale);
  return createDrawing(
    session,
    {
      kind: "area",
      color: "#64748b",
      width: 1,
      points: [p(0, 0), p(width, height)],
      text: "",
      start: null,
      end: null,
      scale,
    },
    at,
  );
}
export function drawingArea(entries: readonly DrawingEntry[], id: string) {
  const area = entries.find((e) => e.id === id);
  if (!area?.mark.scale || area.mark.kind !== "area")
    throw Error("Choose a live scaled drawing area first.");
  return area;
}
export function assignDrawingArea(
  session: RegionSession,
  ids: readonly string[],
  areaId: string,
) {
  const entries = drawings(session.document);
  drawingArea(entries, areaId);
  const selected = entries.filter(
    (e) => ids.includes(e.id) && e.mark.kind !== "area",
  );
  if (!selected.length) throw Error("Select drawings to assign to this area.");
  if (selected.some((e) => e.mark.area && e.mark.area.item !== areaId))
    throw Error(
      "These drawings already use a different area's scale. Keep their original area to preserve their dimensions.",
    );
  editDrawings(
    session,
    selected.map((entry) => ({
      entry,
      mark: {
        ...entry.mark,
        area: f.reference(session.document.document, areaId),
      },
    })),
  );
}
export function updateDrawingScale(
  session: RegionSession,
  areaId: string,
  scale: DrawingScale,
) {
  validateDrawingScale(scale);
  const entry = drawingArea(drawings(session.document), areaId);
  editDrawings(session, [{ entry, mark: { ...entry.mark, scale } }]);
}
/** Calibration changes the physical interpretation of every member, never the camera or geometry. */
export function calibrateDrawingSelection(
  session: RegionSession,
  ids: readonly string[],
  knownLength: string,
  unit: string,
) {
  const entries = drawings(session.document),
    selected = entries.filter(
      (e) => ids.includes(e.id) && e.mark.kind !== "area",
    );
  const lines = selected.filter((e) => e.mark.kind === "line");
  if (lines.length !== 1)
    throw Error(
      "Select exactly one reference line, optionally with other drawings to calibrate.",
    );
  const line = lines[0],
    points = drawingGeometry(entries).points(line);
  const span = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
  if (span < 1e-6)
    throw Error("The reference line must have a nonzero length.");
  const metresPerUnit = parseDrawingLength(knownLength, unit) / span;
  const old = line.mark.area
    ? drawingArea(entries, line.mark.area.item)
    : undefined;
  const scale = {
    ...(old?.mark.scale ?? defaultDrawingScale()),
    unit,
    metresPerUnit,
    ...(!old ? { gridMetres: parseDrawingLength(knownLength, unit) / 20 } : {}),
  };
  validateDrawingScale(scale);
  return session.atomic((staged) => {
    let areaId = old?.id;
    if (!areaId) {
      const bounds = pointBounds(
        selected.flatMap((e) => drawingGeometry(entries).points(e)),
      );
      areaId = createScaledArea(
        staged,
        { x: bounds.x - 40, y: bounds.y - 40 },
        bounds.width + 80,
        bounds.height + 80,
        scale,
      );
    } else updateDrawingScale(staged, areaId, scale);
    assignDrawingArea(
      staged,
      selected.map((e) => e.id),
      areaId,
    );
    return areaId;
  });
}
export function exactDrawing(
  session: RegionSession,
  areaId: string,
  kind: "line" | "rectangle",
  width: string,
  height: string,
  angle: number,
  entryId?: string,
) {
  const entries = drawings(session.document),
    area = drawingArea(entries, areaId),
    scale = area.mark.scale!;
  const x = parseDrawingLength(width, scale.unit) / scale.metresPerUnit;
  const y =
    kind === "rectangle"
      ? parseDrawingLength(height, scale.unit) / scale.metresPerUnit
      : 0;
  if (!Number.isFinite(angle) || Math.abs(angle) > 360)
    throw Error("Angle must be between -360 and 360 degrees.");
  const entry = entryId ? entries.find((e) => e.id === entryId) : undefined;
  if (entryId && (!entry || entry.mark.kind !== kind))
    throw Error("The selected drawing changed; select it again.");
  if (entry?.mark.area && entry.mark.area.item !== areaId)
    throw Error("Keep the selected drawing's original scale.");
  const g = drawingGeometry(entries),
    bounds = g.bounds(entry ?? area);
  const origin = entry
    ? kind === "line"
      ? g.points(entry)[0]
      : bounds
    : snapDrawingPoint({ x: bounds.x + 40, y: bounds.y + 40 }, bounds, scale);
  const at = entry?.view ?? { x: 0, y: 0 };
  const a = p(origin.x - at.x, origin.y - at.y);
  const radians = (-angle * Math.PI) / 180;
  const mark: Mark = {
    ...(entry?.mark ?? {
      color: "#c5d3e8",
      width: 3,
      text: "",
      start: null,
      end: null,
    }),
    kind,
    area: f.reference(session.document.document, areaId),
    points: [
      a,
      p(
        a.x + (kind === "line" ? x * Math.cos(radians) : x),
        a.y + (kind === "line" ? x * Math.sin(radians) : y),
      ),
    ],
  };
  if (entry) {
    editDrawings(session, [{ entry, mark }]);
    return entry.id;
  }
  return createDrawing(session, mark);
}
