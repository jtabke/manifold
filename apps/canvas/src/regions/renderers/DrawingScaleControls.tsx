import { useEffect, useId, useState } from "react";
import { Ruler } from "lucide-react";
import type { RegionSession } from "../document";
import type { DrawingEntry } from "../drawing";
import { drawingGeometry } from "../drawingGeometry";
import {
  drawingLengthUnits,
  formatDrawingLength,
  parseDrawingLength,
} from "../drawingScale";
import {
  assignDrawingArea,
  calibrateDrawingSelection,
  exactDrawing,
  updateDrawingScale,
  resetDimensionPlacements,
} from "../drawingScaleOperations";
import { CanvasCommandMenu } from "./CanvasCommandMenu";
export function DrawingScaleControls({
  session,
  entries,
  selection,
  areaId,
  setAreaId,
  select,
  report,
  disabled,
  drawArea,
}: {
  session: RegionSession;
  entries: readonly DrawingEntry[];
  selection: ReadonlySet<string>;
  areaId?: string;
  setAreaId: (id: string | undefined) => void;
  select: (ids: string[]) => void;
  report: (message: string) => void;
  disabled: boolean;
  drawArea: () => void;
}) {
  const unitList = useId();
  const areas = entries.filter((e) => e.mark.kind === "area"),
    selected = entries.filter((e) => selection.has(e.id));
  const target =
    selected.length === 1 &&
    ["line", "rectangle"].includes(selected[0].mark.kind)
      ? selected[0]
      : undefined;
  const selectedArea =
    selected.find((e) => e.mark.kind === "area")?.id ??
    selected.find((e) => e.mark.area)?.mark.area?.item;
  const area = areas.find((e) => e.id === (selectedArea ?? areaId)),
    scale = area?.mark.scale;
  const [name, setName] = useState("Drawing area"),
    [unit, setUnit] = useState("mm"),
    [span, setSpan] = useState("100 mm"),
    [grid, setGrid] = useState("5 mm");
  const [spanDirty, setSpanDirty] = useState(false),
    [gridDirty, setGridDirty] = useState(false);
  const [snap, setSnap] = useState(true),
    [dimensions, setDimensions] = useState(true),
    [allDimensions, setAllDimensions] = useState(false);
  const [kind, setKind] = useState<"line" | "rectangle">("line"),
    [width, setWidth] = useState("100 mm"),
    [height, setHeight] = useState("80 mm"),
    [angle, setAngle] = useState("0");
  const [known, setKnown] = useState("1 m"),
    [error, setError] = useState("");
  useEffect(() => {
    setName(scale?.name ?? "Drawing area");
    setUnit(scale?.unit ?? "mm");
    setSpan(
      scale
        ? formatDrawingLength(100 * scale.metresPerUnit, scale.unit)
        : "100 mm",
    );
    setGrid(scale ? formatDrawingLength(scale.gridMetres, scale.unit) : "5 mm");
    setSpanDirty(false);
    setGridDirty(false);
    setSnap(scale?.snap ?? true);
    setDimensions(scale?.dimensions ?? true);
    setAllDimensions(scale?.allDimensions ?? false);
    setError("");
  }, [scale]);
  useEffect(() => {
    const m = scale?.metresPerUnit ?? 0.001,
      u = scale?.unit ?? "mm";
    const points = target && drawingGeometry(entries).points(target);
    setKind(target?.mark.kind === "rectangle" ? "rectangle" : "line");
    setWidth(
      formatDrawingLength(
        points
          ? (target?.mark.kind === "rectangle"
              ? Math.abs(points[1].x - points[0].x)
              : Math.hypot(
                  points[1].x - points[0].x,
                  points[1].y - points[0].y,
                )) * m
          : 100 * m,
        u,
      ),
    );
    setHeight(
      formatDrawingLength(
        points ? Math.abs(points[1].y - points[0].y) * m : 80 * m,
        u,
      ),
    );
    setAngle(
      points
        ? String(
            Number(
              (
                (-Math.atan2(
                  points[1].y - points[0].y,
                  points[1].x - points[0].x,
                ) *
                  180) /
                Math.PI
              ).toFixed(8),
            ),
          )
        : "0",
    );
  }, [target?.mark, target?.view, scale]);
  const run = (operation: () => void) => {
    if (disabled) return;
    try {
      operation();
      setError("");
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      report(message);
    }
  };
  const existing = target?.mark.kind === kind ? target : undefined;
  const referenceLine =
    selected.filter((e) => e.mark.kind === "line").length === 1;
  return (
    <div className="drawing-icon-menu">
      <CanvasCommandMenu
        label="Scaled drawings"
        icon={<Ruler size={17} />}
        closeOnAction={false}
        description="Physical units, dimensions and drawing calibration"
      >
        <div className="drawing-scale-panel">
          <strong>Scaled drawings</strong>
          <p>
            Each area has its own physical scale. Zoom never changes dimensions.
          </p>
          <button type="button" disabled={disabled} onClick={drawArea}>
            Draw new area
          </button>
          <label>
            Drawing area
            <select
              aria-label="Drawing area"
              value={area?.id ?? ""}
              onChange={(e) => {
                setAreaId(e.target.value || undefined);
                select([]);
              }}
            >
              <option value="">Choose an area</option>
              {areas.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.mark.scale!.name} ({e.mark.scale!.unit})
                </option>
              ))}
            </select>
          </label>
          {!area && (
            <small>
              Draw an area boundary, or select an existing reference line and
              calibrate it below. Existing sketches stay unscaled.
            </small>
          )}
          {scale && area && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(() =>
                  updateDrawingScale(session, area.id, {
                    ...scale,
                    name: name.trim(),
                    unit,
                    metresPerUnit: spanDirty
                      ? parseDrawingLength(span, unit) / 100
                      : scale.metresPerUnit,
                    gridMetres: gridDirty
                      ? parseDrawingLength(grid, unit)
                      : scale.gridMetres,
                    snap,
                    dimensions,
                    allDimensions,
                  }),
                );
              }}
            >
              <fieldset disabled={disabled}>
                <legend>Area properties</legend>
                <label>
                  Area name
                  <input
                    aria-label="Drawing area name"
                    value={name}
                    maxLength={80}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <label>
                  Display unit
                  <input
                    aria-label="Drawing display unit"
                    list={unitList}
                    maxLength={24}
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                  />
                  <datalist id={unitList}>
                    {drawingLengthUnits.map((u) => (
                      <option key={u} value={u} />
                    ))}
                  </datalist>
                </label>
                <small>
                  Changing display units converts labels, not geometry. Explicit
                  units in fields are accepted.
                </small>
                <label>
                  100 canvas units represent
                  <input
                    aria-label="Drawing scale span"
                    value={span}
                    onChange={(e) => {
                      setSpan(e.target.value);
                      setSpanDirty(true);
                    }}
                  />
                </label>
                <small>
                  Changing this span recalibrates every drawing in the area.
                </small>
                <label>
                  Grid spacing
                  <input
                    aria-label="Drawing grid spacing"
                    value={grid}
                    onChange={(e) => {
                      setGrid(e.target.value);
                      setGridDirty(true);
                    }}
                  />
                </label>
                <label className="drawing-scale-check">
                  <input
                    type="checkbox"
                    checked={snap}
                    onChange={(e) => setSnap(e.target.checked)}
                  />
                  Snap shapes and pointer moves to grid
                </label>
                <label className="drawing-scale-check">
                  <input
                    type="checkbox"
                    checked={dimensions}
                    onChange={(e) => setDimensions(e.target.checked)}
                  />
                  Show dimensions
                </label>
                <label className="drawing-scale-check">
                  <input
                    type="checkbox"
                    checked={allDimensions}
                    disabled={!dimensions}
                    onChange={(e) => setAllDimensions(e.target.checked)}
                  />
                  Show all dimensions
                </label>
                <small>
                  By default, dimensions appear on selected shapes. Drag a
                  dimension line or label to place it permanently. Placement
                  does not change geometry.
                </small>
                <button type="submit">Apply area properties</button>
              </fieldset>
            </form>
          )}
          {area && (
            <>
              <button
                type="button"
                disabled={
                  disabled || !selected.some((e) => e.mark.kind !== "area")
                }
                onClick={() =>
                  run(() => assignDrawingArea(session, [...selection], area.id))
                }
              >
                Assign selected drawings
              </button>
              <button
                type="button"
                disabled={
                  disabled || !selected.some((e) => e.mark.dimensionPlacement)
                }
                onClick={() =>
                  run(() => resetDimensionPlacements(session, [...selection]))
                }
              >
                Reset dimension placement
              </button>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  run(() => {
                    const id = exactDrawing(
                      session,
                      area.id,
                      kind,
                      width,
                      height,
                      Number(angle),
                      existing?.id,
                    );
                    select([id]);
                  });
                }}
              >
                <fieldset disabled={disabled}>
                  <legend>
                    {existing
                      ? "Selected drawing dimensions"
                      : "Create exact geometry"}
                  </legend>
                  <label>
                    Geometry
                    <select
                      aria-label="Exact geometry"
                      value={kind}
                      onChange={(e) =>
                        setKind(e.target.value as "line" | "rectangle")
                      }
                    >
                      <option value="line">Line</option>
                      <option value="rectangle">Rectangle</option>
                    </select>
                  </label>
                  <label>
                    {kind === "line" ? "Length" : "Width"}
                    <input
                      aria-label="Exact drawing width or length"
                      value={width}
                      onChange={(e) => setWidth(e.target.value)}
                    />
                  </label>
                  {kind === "rectangle" ? (
                    <label>
                      Height
                      <input
                        aria-label="Exact drawing height"
                        value={height}
                        onChange={(e) => setHeight(e.target.value)}
                      />
                    </label>
                  ) : (
                    <label>
                      Angle (degrees, counterclockwise)
                      <input
                        aria-label="Exact drawing angle"
                        type="number"
                        min="-360"
                        max="360"
                        step="any"
                        value={angle}
                        onChange={(e) => setAngle(e.target.value)}
                      />
                    </label>
                  )}
                  <small>
                    For example: 120 mm, 6 ft, or 1/2 in. Dimensions apply only
                    when you press the button below; no CAD constraints are
                    implied.
                  </small>
                  <button type="submit">
                    {existing ? "Apply dimensions" : `Create exact ${kind}`}
                  </button>
                </fieldset>
              </form>
            </>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(() => {
                const id = calibrateDrawingSelection(
                  session,
                  [...selection],
                  known,
                  scale?.unit ??
                    known.trim().match(/[A-Za-zµμ]+$/)?.[0] ??
                    unit,
                );
                setAreaId(id);
              });
            }}
          >
            <fieldset disabled={disabled || !referenceLine}>
              <legend>Calibrate from a line</legend>
              <label>
                Known line length
                <input
                  aria-label="Known line length"
                  value={known}
                  onChange={(e) => setKnown(e.target.value)}
                />
              </label>
              <small>
                Select exactly one line, optionally with other unscaled
                drawings. Calibration changes physical interpretation, not the
                sketch's size. An existing area's other drawings are
                recalibrated too.
              </small>
              <button type="submit">Calibrate selected drawings</button>
            </fieldset>
          </form>
          {error && <p role="alert">{error}</p>}
        </div>
      </CanvasCommandMenu>
    </div>
  );
}
