import { useId, useMemo, type KeyboardEvent, type MouseEvent } from "react";
import type {
  DesignMapPoint,
  DesignResponseMap,
  DesignReview,
} from "../worksheetOptimization";
import "../styles/worksheetResponseMaps.css";

const plot = { left: 46, top: 10, width: 222, height: 132 };
const bins = 32;
const ticks = [0, 0.5, 1];
const colors = [
  "var(--canvas-text)",
  "var(--canvas-warning)",
  "var(--canvas-accent)",
  "var(--canvas-success)",
];
const num = (v: number, precision = 4) =>
  String(Number(v.toPrecision(precision)));
const unitValue = (v: number, unit: string) => `${num(v)} ${unit}`.trim();
const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));
const pos = (x: number, y: number) =>
  [plot.left + x * plot.width, plot.top + (1 - y) * plot.height] as const;
const svgPoint = (x: number, y: number) =>
  pos(x, y)
    .map((v) => v.toFixed(2))
    .join(",");
const styleFor = (i: number) => ({
  stroke: colors[i % colors.length],
  strokeDasharray:
    i === 0
      ? undefined
      : `${3 + Math.floor(i / colors.length) * 2} ${2 + (i % colors.length)}`,
});

function tiles(size: number) {
  const last = size - 1;
  return Array.from({ length: size * size }, (_, i) => {
    const x = i % size,
      y = Math.floor(i / size),
      [left, top] = pos(
        clamp(x - 0.5, last) / last,
        clamp(y + 0.5, last) / last,
      ),
      [right, bottom] = pos(
        clamp(x + 0.5, last) / last,
        clamp(y - 0.5, last) / last,
      );
    return `M${left.toFixed(2)},${top.toFixed(2)}H${right.toFixed(2)}V${bottom.toFixed(2)}H${left.toFixed(2)}Z`;
  });
}

function boundaries(map: DesignResponseMap) {
  const last = map.size - 1;
  return map.labels.map((_, index) => {
    let path = "";
    for (let y = 0; y < last; ++y)
      for (let x = 0; x < last; ++x) {
        const corners = [
          [x, y],
          [x + 1, y],
          [x + 1, y + 1],
          [x, y + 1],
        ];
        const samples = corners.map(([a, b]) => map.points[b * map.size + a]);
        if (samples.some((p) => p.checks[index] === null)) continue;
        // Interpolate the transition on an edge; do not infer feasibility between samples.
        const edges = corners.flatMap(([a, b], k) => {
          const next = (k + 1) % corners.length,
            [c, d] = corners[next];
          if (samples[k].checks[index] === samples[next].checks[index])
            return [];
          const from = samples[k].distances[index] ?? 0,
            to = samples[next].distances[index] ?? 0;
          const sum = from + to,
            t = sum > 0 && Number.isFinite(sum) ? from / sum : 0.5;
          return [svgPoint((a + (c - a) * t) / last, (b + (d - b) * t) / last)];
        });
        for (let i = 0; i < edges.length; i += 2)
          path += `M${edges[i]}L${edges[i + 1]}`;
      }
    return path;
  });
}

function prepareMaps(map: DesignResponseMap) {
  const cells = tiles(map.size);
  const failed = map.points
    .map((p, i) => (p.pass === false ? cells[i] : ""))
    .join("");
  const contours = boundaries(map);
  const layers = map.outputs.map((_, k) => {
    const values = map.points.flatMap((p) =>
      p.values[k] === null ? [] : [p.values[k]],
    );
    const low = Math.min(...values),
      high = Math.max(...values);
    const log = low > 0 && high / low >= 25;
    const scale = log ? Math.log : (v: number) => v;
    const range = scale(high) - scale(low);
    const paths = Array<string>(bins + 1).fill("");
    let unknown = "";
    map.points.forEach((p, i) => {
      const value = p.values[k];
      if (value !== null) {
        const span = Number.isFinite(range)
          ? (scale(value) - scale(low)) / range
          : (value / 2 - low / 2) / (high / 2 - low / 2);
        const bin =
          range === 0 ? bins / 2 : clamp(Math.round(span * bins), bins);
        paths[bin] += cells[i];
      }
      if (value === null || p.pass === null) unknown += cells[i];
    });
    return { paths, unknown, low, high, log, defined: values.length > 0 };
  });
  return { failed, contours, layers };
}

function candidatePoint(
  map: DesignResponseMap,
  review?: DesignReview,
): DesignMapPoint | undefined {
  if (!review) return;
  const values = new Map(review.rows.map((r) => [r.id, r.value]));
  return {
    x: values.get(map.xAxis.id)! / map.xAxis.scale,
    y: values.get(map.yAxis.id)! / map.yAxis.scale,
    values: map.outputs.map(({ id, scale, offset }) => {
      const v = (Number(values.get(id)) - offset) / scale;
      return Number.isFinite(v) ? v : null;
    }),
    checks: map.labels.map(() => true),
    pass: true,
  };
}

export type MapInspection = number | "current" | "candidate";

export function WorksheetResponseMaps({
  map,
  review,
  heading,
  selected,
  select,
}: {
  map: DesignResponseMap;
  review?: DesignReview;
  heading: string;
  selected?: MapInspection;
  select: (value: MapInspection) => void;
}) {
  const { failed, contours, layers } = useMemo(() => prepareMaps(map), [map]);
  const candidate = candidatePoint(map, review);
  const active =
    selected === "candidate" && !candidate
      ? "current"
      : (selected ?? (candidate ? "candidate" : "current"));
  const point =
    typeof active === "number"
      ? map.points[active]
      : active === "candidate"
        ? candidate!
        : map.current;
  const axisX = map.xAxis,
    axisY = map.yAxis,
    last = map.size - 1;
  const coordinates = (p: DesignMapPoint) =>
    [
      (p.x - axisX.bounds[0]) / (axisX.bounds[1] - axisX.bounds[0]),
      (p.y - axisY.bounds[0]) / (axisY.bounds[1] - axisY.bounds[0]),
    ] as const;
  const onPlot = (p: DesignMapPoint) =>
    coordinates(p).every((v) => v >= -1e-12 && v <= 1 + 1e-12);
  const markerXY = (p: DesignMapPoint) => {
    const [x, y] = coordinates(p);
    return pos(clamp(x, 1), clamp(y, 1));
  };
  const [px, py] = markerXY(point);
  const pick = (event: MouseEvent<SVGRectElement>) => {
    const transform = event.currentTarget.getScreenCTM();
    if (!transform) return;
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      transform.inverse(),
    );
    const i = clamp(Math.round((last * (p.x - plot.left)) / plot.width), last),
      j = clamp(Math.round(last * (1 - (p.y - plot.top) / plot.height)), last);
    select(j * map.size + i);
  };
  const move = (event: KeyboardEvent<SVGSVGElement>) => {
    if (!Object.hasOwn(directions, event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const [dx, dy] = directions[event.key],
      [x, y] = coordinates(point);
    select(
      clamp(Math.round(y * last) + dy, last) * map.size +
        clamp(Math.round(x * last) + dx, last),
    );
  };
  const id = useId();
  const axisLabel = ({ name, unit }: DesignResponseMap["xAxis"]) =>
    unit ? `${name} (${unit})` : name;
  return (
    <section className="design-maps" aria-labelledby={heading}>
      <div className="design-map-bar">
        <h3 id={heading} tabIndex={-1}>
          Response maps
        </h3>
        <div
          className="design-map-buttons"
          aria-label="Inspect a design"
          role="group"
        >
          <button
            type="button"
            aria-pressed={active === "current"}
            onClick={() => select("current")}
          >
            <span aria-hidden="true">○ </span>Current
          </button>
          {candidate && (
            <button
              type="button"
              aria-pressed={active === "candidate"}
              onClick={() => select("candidate")}
            >
              <span aria-hidden="true">◆ </span>Candidate
            </button>
          )}
        </div>
      </div>
      <div className="design-map-probe" role="status">
        <div>
          <strong>
            {active === "current"
              ? "Current design"
              : active === "candidate"
                ? "Checked candidate"
                : "Sampled design"}
          </strong>
          {" · "}
          {axisX.name} {unitValue(point.x, axisX.unit)} · {axisY.name}{" "}
          {unitValue(point.y, axisY.unit)}
        </div>
        <span data-pass={point.pass ?? "unknown"}>
          {!onPlot(point) && "Outside map · "}
          {point.pass === null
            ? "Feasibility undefined"
            : point.pass === false
              ? "Fails selected requirements"
              : map.labels.length
                ? "Passes selected requirements"
                : "No requirements selected"}
        </span>
        <span className="design-map-announcement">
          {map.outputs.map(
            (o, k) =>
              `${o.name}: ${point.values[k] === null ? "undefined" : unitValue(point.values[k], o.unit)}. `,
          )}
        </span>
      </div>
      <ul className="design-map-key" aria-label="Map legend">
        {map.labels.map((label, k) => (
          <li
            key={k}
            title={
              point.checks[k] === null
                ? "Undefined here"
                : point.checks[k]
                  ? "Passes here"
                  : "Fails here"
            }
          >
            <svg width="20" height="8" aria-hidden="true">
              <path d="M0,4H20" style={styleFor(k)} strokeWidth="2" />
            </svg>
            <span>
              {label}
              {point.checks[k] === false ? (
                <b> · fails here</b>
              ) : point.checks[k] === null ? (
                <b> · undefined here</b>
              ) : active === "candidate" && review?.limits[k]?.active ? (
                <b> · at limit</b>
              ) : null}
            </span>
          </li>
        ))}
        {map.labels.length > 0 && (
          <li>
            <i className="design-map-failed" />
            Fails a limit
          </li>
        )}
        <li>
          <i className="design-map-unknown" />
          Undefined
        </li>
      </ul>
      <small className="design-map-guide" id={`${id}-guide`}>
        {map.size} × {map.size} worksheet samples. Click, tap, or use arrow keys
        to inspect the same point across maps. Boundaries are approximate.
      </small>
      <div className="design-map-grid">
        {map.outputs.map((output, k) => {
          const layer = layers[k],
            key = `${id}-${k}`,
            value = point.values[k];
          return (
            <div
              className="design-map-card"
              key={output.id}
              role="group"
              aria-labelledby={`${key}-title`}
            >
              <div className="design-map-title">
                <h4 id={`${key}-title`}>{output.name}</h4>
                <span>
                  {value === null ? "Undefined" : unitValue(value, output.unit)}
                </span>
              </div>
              <svg
                viewBox="0 0 282 179"
                role="img"
                aria-label={`${output.name} response map`}
                aria-describedby={`${id}-guide`}
                tabIndex={0}
                onKeyDown={move}
              >
                <defs>
                  <pattern
                    id={`${key}-fail`}
                    width="5"
                    height="5"
                    patternUnits="userSpaceOnUse"
                  >
                    <path
                      d="M-1,1L1,-1 M0,5L5,0 M4,6L6,4"
                      className="design-map-hatch"
                    />
                  </pattern>
                  <pattern
                    id={`${key}-unknown`}
                    width="5"
                    height="5"
                    patternUnits="userSpaceOnUse"
                  >
                    <rect
                      width="5"
                      height="5"
                      fill="var(--canvas-surface)"
                      opacity=".7"
                    />
                    <circle
                      cx="2.5"
                      cy="2.5"
                      r=".7"
                      fill="var(--canvas-muted)"
                    />
                  </pattern>
                </defs>
                {layer.paths.map(
                  (d, i) =>
                    d && (
                      <path
                        d={d}
                        key={i}
                        shapeRendering="crispEdges"
                        fill={`color-mix(in oklab, var(--design-map-high) ${(i * 100) / bins}%, var(--design-map-low))`}
                      />
                    ),
                )}
                <path d={failed} fill={`url(#${key}-fail)`} />
                <path d={layer.unknown} fill={`url(#${key}-unknown)`} />
                <rect
                  x={plot.left}
                  y={plot.top}
                  width={plot.width}
                  height={plot.height}
                  className="design-map-frame"
                />
                {contours.map(
                  (d, i) =>
                    d && (
                      <g key={i}>
                        <path d={d} className="design-map-outline" />
                        <path
                          d={d}
                          fill="none"
                          strokeWidth="1.6"
                          style={styleFor(i)}
                        />
                      </g>
                    ),
                )}
                {ticks.map((t) => {
                  const [x, y] = pos(t, t);
                  return (
                    <g key={t} className="design-map-tick">
                      <text
                        x={x}
                        y={plot.top + plot.height + 13}
                        textAnchor="middle"
                      >
                        {num(
                          axisX.bounds[0] +
                            t * (axisX.bounds[1] - axisX.bounds[0]),
                          5,
                        )}
                      </text>
                      <text x={plot.left - 4} y={y + 3} textAnchor="end">
                        {num(
                          axisY.bounds[0] +
                            t * (axisY.bounds[1] - axisY.bounds[0]),
                          5,
                        )}
                      </text>
                    </g>
                  );
                })}
                <text
                  className="design-map-axis"
                  x={plot.left + plot.width / 2}
                  y={174}
                  textAnchor="middle"
                >
                  {axisLabel(axisX)}
                </text>
                <text
                  className="design-map-axis"
                  transform={`translate(11 ${plot.top + plot.height / 2}) rotate(-90)`}
                  textAnchor="middle"
                >
                  {axisLabel(axisY)}
                </text>
                {onPlot(point) && (
                  <path
                    d={`M${plot.left},${py}H${plot.left + plot.width} M${px},${plot.top}V${plot.top + plot.height}`}
                    className="design-map-cursor"
                  />
                )}
                {onPlot(map.current) && (
                  <circle
                    cx={markerXY(map.current)[0]}
                    cy={markerXY(map.current)[1]}
                    r="3.5"
                    className="design-map-current"
                  />
                )}
                {candidate && onPlot(candidate) && (
                  <path
                    d={`M${markerXY(candidate).join(",")}m0,-5l5,5l-5,5l-5,-5Z`}
                    className="design-map-candidate"
                  />
                )}
                {typeof active === "number" && (
                  <circle
                    cx={px}
                    cy={py}
                    r="4.5"
                    className="design-map-sample"
                  />
                )}
                <rect
                  x={plot.left}
                  y={plot.top}
                  width={plot.width}
                  height={plot.height}
                  fill="transparent"
                  className="design-map-hit"
                  onClick={pick}
                />
              </svg>
              {layer.defined ? (
                <div
                  className="design-map-scale"
                  aria-label={`${output.name} color scale${layer.log ? ", logarithmic" : ""}`}
                >
                  <span>{unitValue(layer.low, output.unit)}</span>
                  <i />
                  <span>{unitValue(layer.high, output.unit)}</span>
                  {layer.log && (
                    <span className="design-map-log">Log scale</span>
                  )}
                </div>
              ) : (
                <small>No defined samples</small>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

const directions: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowDown: [0, -1],
  ArrowUp: [0, 1],
};
