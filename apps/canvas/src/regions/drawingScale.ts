/** Physical drawing lengths are SI values; canvas coordinates and camera zoom stay independent. */
import { scientificLengthUnit } from "../notebook/scientific.ts";
import type { Point } from "./document.ts";
import type { DrawingEntry } from "./drawing.ts";
export function withAreaMembers(
  entries: readonly DrawingEntry[],
  ids: ReadonlySet<string>,
) {
  return new Set([
    ...ids,
    ...entries
      .filter((e) => e.mark.area && ids.has(e.mark.area.item))
      .map((e) => e.id),
  ]);
}
export type DrawingScale = {
  name: string;
  unit: string;
  /** Metres per canvas/world coordinate unit, NOT per display unit. */
  metresPerUnit: number;
  gridMetres: number;
  snap: boolean;
  dimensions: boolean;
  allDimensions?: boolean;
};
const unitMetres = new Map<string, number>();
export function lengthUnit(unit: string) {
  const cached = unitMetres.get(unit);
  if (cached !== undefined) return cached;
  const value = scientificLengthUnit(unit);
  if (unitMetres.size < 64) unitMetres.set(unit, value);
  return value;
}
/** Suggestions, not an allowlist: other supported length-unit names may be typed. */
export const drawingLengthUnits = [
  "nm",
  "um",
  "mm",
  "cm",
  "m",
  "km",
  "in",
  "ft",
  "yd",
  "mi",
];
export const defaultDrawingScale = (): DrawingScale => ({
  name: "Drawing area",
  unit: "mm",
  metresPerUnit: 0.001,
  gridMetres: 0.005,
  snap: true,
  dimensions: true,
});
export function validateDrawingScale(
  value: unknown,
): asserts value is DrawingScale {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Invalid drawing scale.");
  const s = value as DrawingScale;
  if (
    Object.keys(s).some(
      (key) =>
        ![
          "name",
          "unit",
          "metresPerUnit",
          "gridMetres",
          "snap",
          "dimensions",
          "allDimensions",
        ].includes(key),
    ) ||
    typeof s.name !== "string" ||
    !s.name.trim() ||
    s.name.length > 80 ||
    /[\u0000-\u001f\u007f]/.test(s.name) ||
    typeof s.unit !== "string" ||
    !Number.isFinite(s.metresPerUnit) ||
    s.metresPerUnit < 1e-12 ||
    s.metresPerUnit > 1e9 ||
    !Number.isFinite(s.gridMetres) ||
    s.gridMetres < 1e-12 ||
    s.gridMetres > 1e12 ||
    typeof s.snap !== "boolean" ||
    typeof s.dimensions !== "boolean" ||
    (s.allDimensions !== undefined && typeof s.allDimensions !== "boolean")
  )
    throw Error("Invalid drawing scale.");
  lengthUnit(s.unit);
}
/** Deliberately not a worksheet expression: finite literals/fractions, optionally followed by a length unit. */
export function parseDrawingLength(text: string, defaultUnit: string): number {
  if (text.length > 100) throw Error("Length is too long.");
  const match = text
    .trim()
    .match(
      /^([+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(?:\s*\/\s*(\d+(?:\.\d*)?))?\s*([A-Za-zµμ]+)?$/i,
    );
  if (!match)
    throw Error("Enter a positive length, for example 120 mm, 6 ft or 1/2 in.");
  const metres =
    (Number(match[1]) / (match[2] === undefined ? 1 : Number(match[2]))) *
    lengthUnit(match[3] ?? defaultUnit);
  if (!Number.isFinite(metres) || metres < 1e-12 || metres > 1e12)
    throw Error("Length must be finite, positive and between 1 pm and 1e12 m.");
  return metres;
}
export function formatDrawingLength(metres: number, unit: string) {
  return `${Number((metres / lengthUnit(unit)).toPrecision(8))} ${unit}`;
}
export function snapDrawingPoint<T extends Point>(
  p: T,
  origin: Point,
  scale: DrawingScale,
): T {
  if (!scale.snap) return p;
  const step = scale.gridMetres / scale.metresPerUnit;
  return {
    ...p,
    x: origin.x + Math.round((p.x - origin.x) / step) * step,
    y: origin.y + Math.round((p.y - origin.y) / step) * step,
  };
}
export function drawingGridStep(scale: DrawingScale, zoom: number) {
  const step = scale.gridMetres / scale.metresPerUnit;
  return step * 2 ** Math.max(0, Math.ceil(Math.log2(10 / (step * zoom))));
}
