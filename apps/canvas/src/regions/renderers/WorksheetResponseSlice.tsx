import { useState } from "react";
import type { DesignResponseMap } from "../worksheetOptimization";
import type { responseSlice } from "../worksheetResponseSlice";
import { num, unitValue } from "./WorksheetMapComparison";
import "../styles/worksheetResponseSlice.css";

const chart = { left: 56, right: 321, top: 17, bottom: 113, status: 126 };
const ticks = (lo: number, hi: number) =>
  lo === hi ? [lo] : [lo, lo / 2 + hi / 2, hi];
const fraction = (n: number, lo: number, hi: number) =>
  lo === hi
    ? 0.5
    : Number.isFinite(hi - lo)
      ? (n - lo) / (hi - lo)
      : (n / 2 - lo / 2) / (hi / 2 - lo / 2);
const label = ({ name, unit }: { name: string; unit: string }) =>
  unit ? `${name} (${unit})` : name;

export function WorksheetResponseSlice({
  id,
  map,
  slice,
  fixed,
  setFixed,
  select,
  close,
}: {
  id: string;
  map: DesignResponseMap;
  slice: ReturnType<typeof responseSlice>;
  fixed: string;
  setFixed: (input: string) => void;
  select: (index: number) => void;
  close: () => void;
}) {
  const [quantity, setQuantity] = useState(map.outputs[0].id);
  const outputIndex = Math.max(
    0,
    map.outputs.findIndex(({ id }) => id === quantity),
  );
  const output = map.outputs[outputIndex];
  const samples = slice?.samples ?? [];
  const values = samples.flatMap(({ point }) =>
    point.values[outputIndex] === null ? [] : [point.values[outputIndex]!],
  );
  const low = values.length ? Math.min(...values) : 0;
  const high = values.length ? Math.max(...values) : 1;
  const x = (i: number) =>
    chart.left + (i / (map.size - 1)) * (chart.right - chart.left);
  const y = (v: number) =>
    chart.bottom - 4 - fraction(v, low, high) * (chart.bottom - chart.top - 8);
  let continuing = false;
  const path = samples
    .map(({ point }, i) => {
      const value = point.values[outputIndex];
      if (value === null) {
        continuing = false;
        return "";
      }
      const segment = `${continuing ? "L" : "M"}${x(i)},${y(value)}`;
      continuing = true;
      return segment;
    })
    .join(" ");
  const active = slice?.samples[slice.active];
  const setSample = (i: number) => {
    if (!slice) return;
    select(slice.samples[Math.min(map.size - 1, Math.max(0, i))].index);
  };
  return (
    <section id={id} className="design-slice" aria-labelledby={`${id}-heading`}>
      <div className="design-slice-heading">
        <h4 id={`${id}-heading`} tabIndex={-1}>
          Slice at probe
        </h4>
        <button type="button" onClick={close}>
          Close slice
        </button>
      </div>
      <div className="design-slice-controls">
        <label>
          Hold fixed{" "}
          <select value={fixed} onChange={(e) => setFixed(e.target.value)}>
            {[map.xAxis, map.yAxis].map((axis) => (
              <option key={axis.id} value={axis.id}>
                {label(axis)}
              </option>
            ))}
          </select>
        </label>
        {map.outputs.length > 1 && (
          <label>
            Response{" "}
            <select
              value={output.id}
              onChange={(e) => setQuantity(e.target.value)}
            >
              {map.outputs.map((option) => (
                <option key={option.id} value={option.id}>
                  {label(option)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {!slice || !active ? (
        <p>Inspect a point inside a response map to see its slice.</p>
      ) : (
        <>
          <p className="design-slice-condition" id={`${id}-condition`}>
            <strong>
              {output.name} vs. {slice.varied.name}
            </strong>
            <span>
              At {slice.fixed.name}{" "}
              {unitValue(slice.fixedValue, slice.fixed.unit)}
              {slice.fixedSnapped ? " · nearest sampled value" : ""}
            </span>
          </p>
          <small id={`${id}-guide`}>
            {map.size} existing map samples
            {map.preview ? " · Limit preview" : ""} · Tap a point or use
            Left/Right to inspect.
          </small>
          <svg
            className="design-slice-chart"
            viewBox="0 0 342 174"
            role="img"
            aria-label={`${output.name} slice across ${slice.varied.name}`}
            aria-describedby={`${id}-condition ${id}-guide`}
            tabIndex={0}
            onKeyDown={(e) => {
              const key = e.key;
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(key))
                return;
              e.preventDefault();
              e.stopPropagation();
              setSample(
                key === "Home"
                  ? 0
                  : key === "End"
                    ? map.size - 1
                    : slice.active + (key === "ArrowLeft" ? -1 : 1),
              );
            }}
          >
            <path
              className="design-slice-axis"
              d={`M${chart.left},${chart.top}V${chart.bottom}H${chart.right}`}
            />
            {values.length > 0 &&
              ticks(low, high).map((value) => (
                <g key={value}>
                  <path
                    className="design-slice-gridline"
                    d={`M${chart.left},${y(value)}H${chart.right}`}
                  />
                  <text x={chart.left - 6} y={y(value) + 4} textAnchor="end">
                    {num(value)}
                  </text>
                </g>
              ))}
            <text x={chart.left} y="12">
              {label(output)}
            </text>
            {[0, Math.floor(map.size / 2), map.size - 1].map((i) => (
              <text key={i} x={x(i)} y="143" textAnchor="middle">
                {num(slice.samples[i].input)}
              </text>
            ))}
            <text
              x={(chart.left + chart.right) / 2}
              y="164"
              textAnchor="middle"
            >
              {label(slice.varied)}
            </text>
            <path
              className="design-slice-guide"
              d={`M${x(slice.active)},${chart.top}V${chart.status + 5}`}
            />
            {path && <path className="design-slice-response" d={path} />}
            {samples.map(({ point, input, index }, i) => {
              const result = point.values[outputIndex];
              return (
                <g
                  key={index}
                  className="design-slice-sample"
                  data-active={i === slice.active || undefined}
                >
                  <title>{`${unitValue(input, slice.varied.unit)}: ${result === null ? "Undefined" : unitValue(result, output.unit)}`}</title>
                  {result !== null && (
                    <circle
                      className="design-slice-dot"
                      cx={x(i)}
                      cy={y(result)}
                      r={i === slice.active ? 4 : 2.1}
                    />
                  )}
                  {map.requirements.length > 0 &&
                    (point.pass === null ? (
                      <text x={x(i)} y={chart.status + 3} textAnchor="middle">
                        ?
                      </text>
                    ) : point.pass ? (
                      <circle
                        className="design-slice-passes"
                        cx={x(i)}
                        cy={chart.status}
                        r="2.3"
                      />
                    ) : (
                      <path
                        className="design-slice-fails"
                        d={`M${x(i) - 2.5},${chart.status - 2.5}l5,5m0,-5l-5,5`}
                      />
                    ))}
                </g>
              );
            })}
            <rect
              className="design-slice-hit"
              fill="transparent"
              x={chart.left}
              y={chart.top}
              width={chart.right - chart.left}
              height={chart.status + 6 - chart.top}
              data-canvas-tap=""
              onClick={(e) => {
                const matrix = e.currentTarget.getScreenCTM();
                if (!matrix) return;
                const { x } = new DOMPoint(
                  e.clientX,
                  e.clientY,
                ).matrixTransform(matrix.inverse());
                setSample(
                  Math.round(
                    ((x - chart.left) / (chart.right - chart.left)) *
                      (map.size - 1),
                  ),
                );
              }}
            />
          </svg>
          {!values.length && (
            <p>No defined values for {output.name} on this slice.</p>
          )}
          <p className="design-slice-value">
            <strong>{slice.snapped ? "Nearest sample" : "Probe sample"}</strong>
            <span>
              {slice.varied.name} {unitValue(active.input, slice.varied.unit)}
            </span>
            <span>
              {output.name}{" "}
              {active.point.values[outputIndex] === null
                ? "undefined"
                : unitValue(active.point.values[outputIndex]!, output.unit)}
            </span>
          </p>
          {map.requirements.length > 0 && (
            <>
              <small className="design-slice-key">
                <span className="design-slice-passes">○ Passes</span>
                <span className="design-slice-fails">× Fails</span>
                <span>? Undefined</span>
              </small>
              {slice.crossings.length > 0 ? (
                <details className="design-slice-crossings" open>
                  <summary>Sampled limit crossings</summary>
                  <ul>
                    {slice.crossings.map(({ requirement, brackets }) => (
                      <li key={requirement.id}>
                        <strong>{requirement.label}</strong>
                        {brackets.map(({ low, high, enters }) => (
                          <span key={low}>
                            {enters ? "Starts passing" : "Starts failing"}{" "}
                            between {unitValue(low, slice.varied.unit)} and{" "}
                            {unitValue(high, slice.varied.unit)}
                          </span>
                        ))}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : (
                <small>
                  No pass/fail change between adjacent checked samples.
                </small>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
