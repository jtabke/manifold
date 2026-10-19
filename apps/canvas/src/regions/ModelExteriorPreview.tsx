import { useMemo, type ReactNode } from "react";
import { curve, project, type Page, type Plot } from "./document";
import { display, unitLabel } from "../notebook/math";
import { readCsv } from "./dataSources";
import type { NestedModel } from "./models";
import { exteriorSource } from "./modelExteriorView";
import { ExternalReferenceView } from "./ExternalReferenceView";

function ResponsePreview({ page, plot }: { page: Page; plot: Plot }) {
  const p = project(page),
    input = p.statements.get(plot.input),
    output = p.statements.get(plot.output);
  const inputQuantity = input && p.solved.values.get(input.name);
  const sample = useMemo(() => curve(page, plot, page.active), [page, plot]);
  const points = sample.points.filter(
    (p) => p.y !== undefined && Number.isFinite(p.y),
  );
  if (!points.length)
    return (
      <p className="mx-unavailable">
        Resolve the response's inputs and definitions.
      </p>
    );
  const low = Math.min(...points.map((p) => p.y!)),
    high = Math.max(...points.map((p) => p.y!));
  const y = (v: number) => 100 - ((v - low) / (high - low || 1)) * 80;
  let open = false;
  const path = sample.points
    .map((p) => {
      if (p.y === undefined || !Number.isFinite(p.y)) {
        open = false;
        return "";
      }
      const segment = `${open ? "L" : "M"}${20 + ((p.x - plot.low) / (plot.high - plot.low)) * 270},${y(p.y)}`;
      open = true;
      return segment;
    })
    .join(" ");
  return (
    <>
      <div className="mx-response-labels">
        <span>
          {output?.name} · {sample.unit ? unitLabel(sample.unit) : ""}
        </span>
        <span>
          {input?.name} · {inputQuantity ? unitLabel(inputQuantity) : ""}
        </span>
      </div>
      <svg
        className="mx-response"
        viewBox="0 0 310 130"
        role="img"
        aria-label="Model response preview"
      >
        <path className="mx-axis" d="M20 12V104H295" />
        <path className="mx-curve" d={path} />
        <text x="20" y="123">
          {plot.low}
        </text>
        <text x="290" y="123" textAnchor="end">
          {plot.high}
        </text>
        <title>
          Response from the original definitions in the active context; open
          source for axes, units and manipulation.
        </title>
      </svg>
    </>
  );
}

/** A read-only view of an existing source, with explicit navigation back to it. */
export function ModelExteriorPreview({
  page,
  model,
  follow,
  math,
  distant = false,
}: {
  page: Page;
  model: NestedModel;
  follow: (id: string) => void;
  math?: (id: string) => ReactNode;
  distant?: boolean;
}) {
  const view = model.presentation?.exterior;
  if (!view || view.kind === "interface") return null;
  const source = exteriorSource(page, model),
    p = project(page);
  if (!source)
    return (
      <div className="mx-preview mx-unavailable" role="status">
        {view.source
          ? "Preview source unavailable"
          : "Choose a preview source in Appearance"}
      </div>
    );
  const region = page.regions.find((r) => r.id === source.id),
    plot = page.plots.find((p) => p.id === source.id);
  const statement = p.statements.get(source.id);
  const value =
    statement?.relation === "=" && !p.errors.has(source.id)
      ? p.solved.values.get(statement.name)
      : undefined;
  const data = region?.data ? readCsv(region.data) : undefined;
  return (
    <div
      className={`mx-preview mx-${view.kind}`}
      data-exterior-source={source.id}
    >
      {plot ? (
        <ResponsePreview page={page} plot={plot} />
      ) : region?.external ? (
        <ExternalReferenceView
          name={region.label || region.text}
          reference={region.external}
          edit={() => follow(region.id)}
        />
      ) : data ? (
        <div className="mx-data">
          <strong>{region!.data!.name}</strong>
          <small>
            {data.rows.length} records · {data.headers.length} columns
          </small>
          {!distant && (
            <table>
              <thead>
                <tr>
                  {data.headers.slice(0, 3).map((c, i) => (
                    <th key={i}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.slice(0, 3).map((row, i) => (
                  <tr key={i}>
                    {row.slice(0, 3).map((cell, j) => (
                      <td key={j}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : view.kind === "equation" && math && p.statements.has(source.id) ? (
        <div className="mx-math" inert>
          {math(source.id)}
        </div>
      ) : (
        <p
          className={view.kind === "equation" ? "mx-equation-text" : "mx-note"}
        >
          {p.texts[source.id]}
        </p>
      )}
      {view.kind === "equation" && value && (
        <output
          className="mx-evaluated"
          aria-label={`Evaluated equation ${statement!.name}`}
        >
          = {display(value)}
        </output>
      )}
      {p.errors.has(source.id) && (
        <small className="mx-unavailable">
          Unresolved · {p.errors.get(source.id)}
        </small>
      )}
      <button
        className="mx-source"
        aria-label={`Open preview source ${source.label}`}
        onClick={(e) => {
          e.stopPropagation();
          follow(source.id);
        }}
      >
        Open source · {source.label}
      </button>
    </div>
  );
}
