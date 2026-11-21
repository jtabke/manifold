import type { Point } from "../document";
import type { DrawingEntry } from "../drawing";
import type { drawingGeometry } from "../drawingGeometry";
import {
  joinedAngle,
  radialGeometry,
  selectedAngle,
} from "../drawingDimensions";
import { formatDrawingLength } from "../drawingScale";

const polar = (from: Point, radius: number, angle: number): Point => ({
  x: from.x + radius * Math.cos(angle),
  y: from.y + radius * Math.sin(angle),
});
const xy = (point: Point) => `${point.x},${point.y}`;

/** Unlike the line placement handles, these annotations follow their source
 * geometry. No measured value is stored in the drawing record. */
export function DrawingGeometricDimensions({
  entries,
  geometry,
  selection,
  zoom,
}: {
  entries: readonly DrawingEntry[];
  geometry: ReturnType<typeof drawingGeometry>;
  selection: ReadonlySet<string>;
  zoom: number;
}) {
  const scaleFor = (entry: DrawingEntry) =>
    entry.mark.area && geometry.byId.get(entry.mark.area.item)?.mark.scale;
  let visible: Set<string> | undefined;
  const isVisible = (id: string) =>
    (visible ??= new Set(entries.map((entry) => entry.id))).has(id);
  const pair = selectedAngle(geometry, selection);
  const angles = new Map<
    string,
    { angle: NonNullable<ReturnType<typeof joinedAngle>>; pinned: boolean }
  >();
  const addAngle = (a: DrawingEntry, b: DrawingEntry, pinned: boolean) => {
    if (scaleFor(a)?.dimensions === false || scaleFor(b)?.dimensions === false)
      return;
    const key = JSON.stringify([a.id, b.id].sort());
    if (angles.has(key)) return;
    const angle = joinedAngle(geometry.points(a), geometry.points(b));
    if (angle) angles.set(key, { angle, pinned });
  };
  for (const entry of entries)
    for (const ref of entry.mark.angleDimensions ?? []) {
      const other = geometry.byId.get(ref.item);
      if (other && isVisible(other.id)) addAngle(entry, other, true);
    }
  if (pair && isVisible(pair.a.id) && isVisible(pair.b.id))
    addAngle(pair.a, pair.b, false);
  return (
    <>
      {entries.map((entry) => {
        if (entry.mark.kind !== "arc" && entry.mark.kind !== "ellipse")
          return null;
        const scale = scaleFor(entry);
        if (
          scale?.dimensions === false ||
          !(
            entry.mark.radialDimension ||
            selection.has(entry.id) ||
            (entry.mark.kind === "arc" && scale?.allDimensions)
          )
        )
          return null;
        const circle = radialGeometry(entry.mark.kind, geometry.points(entry));
        if (!circle) return null;
        const { center, radius, direction } = circle;
        const diameter = entry.mark.radialDimension === "diameter";
        const mode = diameter ? "Diameter" : "Radius";
        const span = radius * (diameter ? 2 : 1);
        const measure = scale
          ? formatDrawingLength(span * scale.metresPerUnit, scale.unit)
          : `${Number(span.toPrecision(4))} cu`;
        const a = diameter ? polar(center, -radius, direction) : center;
        const rim = polar(center, radius, direction);
        const label = polar(rim, 16 / zoom, direction);
        return (
          <g
            key={entry.id}
            role="img"
            aria-label={`${mode} ${scale ? measure : `${Number(span.toPrecision(4))} canvas units`}`}
            data-dimension-axis={diameter ? "diameter" : "radius"}
            data-dimension-pinned={!!entry.mark.radialDimension}
            className="drawing-geometric-dimension"
          >
            <path
              d={`M${xy(a)} L${xy(label)}`}
              strokeWidth={1 / zoom}
              strokeDasharray={`${4 / zoom} ${3 / zoom}`}
            />
            <circle cx={rim.x} cy={rim.y} r={2.5 / zoom} />
            <text
              x={label.x}
              y={label.y - 5 / zoom}
              fontSize={12 / zoom}
              strokeWidth={4 / zoom}
              textAnchor={Math.cos(direction) < -0.1 ? "end" : "start"}
              aria-hidden="true"
            >
              {diameter ? "⌀" : "R"} {measure}
            </text>
          </g>
        );
      })}
      {[...angles].map(([key, { angle, pinned }]) => {
        const { vertex, reach, start, sweep, degrees } = angle;
        const radius = Math.min(34 / zoom, reach * 0.75);
        const a = polar(vertex, radius, start);
        const b = polar(vertex, radius, start + sweep);
        const label = polar(vertex, radius + 15 / zoom, start + sweep / 2);
        const measured = `${Number(degrees.toFixed(2))}°`;
        return (
          <g
            key={key}
            role="img"
            aria-label={`Included angle ${measured}`}
            data-dimension-axis="angle"
            data-dimension-pinned={pinned}
            className="drawing-geometric-dimension"
          >
            <path
              d={`M${xy(a)} A${radius},${radius} 0 0 ${sweep > 0 ? 1 : 0} ${xy(b)}`}
              strokeWidth={1.3 / zoom}
            />
            <text
              x={label.x}
              y={label.y}
              fontSize={12 / zoom}
              strokeWidth={4 / zoom}
              textAnchor="middle"
              dominantBaseline="central"
              aria-hidden="true"
            >
              {measured}
            </text>
          </g>
        );
      })}
    </>
  );
}
