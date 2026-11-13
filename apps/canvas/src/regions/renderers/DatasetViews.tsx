import { useEffect, useMemo, useState } from "react";
import { GripVertical, X, Link2, Maximize2 } from "lucide-react";
import { display, references, unitLabel } from "../../notebook/math";
import { project, type Page, type Point } from "../document";
import { readCsv } from "../dataSources";
import { evaluateDataset, type DatasetComputation } from "../datasetModel";
import { sampleDatasetPlot } from "../datasetPlot";
import {
  recordFeedback,
  selectionKind,
  type DataSelection,
} from "../dataFeedback";
export type { DataSelection } from "../dataFeedback";
export function RecordFeedback({
  page,
  relation,
  records,
  selection,
  follow,
  clear,
  requirement,
}: {
  page: Page;
  relation: DatasetComputation;
  records: ReturnType<typeof evaluateDataset>["records"];
  selection: DataSelection;
  follow: (row: number) => void;
  clear: () => void;
  requirement?: string;
}) {
  const chosen = records.filter((r) => selection.rows.includes(r.row)),
    kind = selectionKind(selection);
  if (!chosen.length)
    return (
      <div className="er-data-trace er-record-feedback">
        <small>
          Selected measurement is outside this calculation’s record scope.
        </small>
        <button aria-label="Close data trace" onClick={clear}>
          <X size={12} />
        </button>
      </div>
    );
  return (
    <div
      className="er-data-trace er-record-feedback"
      aria-label={
        chosen.length > 1
          ? "Selected record comparison"
          : "Selected record calculation"
      }
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {chosen.length > 1 && (
        <div className="er-record-feedback-head">
          <span>
            {kind === "cell"
              ? "Measured value in context"
              : chosen.length > 1
                ? "Comparing records"
                : "Selected measurement"}
          </span>
          <button aria-label="Close data trace" onClick={clear}>
            <X size={12} />
          </button>
        </div>
      )}
      <div className="er-record-comparison">
        {chosen.slice(0, 3).map((r) => {
          const story = recordFeedback(page, relation, r);
          return (
            <div
              className={`er-record-story ${r.pass === false ? "is-fail" : "is-pass"}`}
              key={r.row}
              data-feedback-row={r.row}
            >
              <button
                className="er-observation-link"
                aria-label={`Follow source row ${r.row + 1}`}
                onClick={() => follow(r.row)}
              >
                {story.observation} ↗
              </button>
              {!requirement && chosen.length > 1 && (
                <div className="er-record-inputs">
                  {story.inputs.map((input) => (
                    <span key={input.name}>
                      <b>{input.name}</b> {input.value}
                    </span>
                  ))}
                </div>
              )}
              {!requirement && <strong>{story.expression}</strong>}
              {requirement && <strong>{display(r.value)}</strong>}
              {story.checks
                .filter((c) => !requirement || c.id === requirement)
                .map((c) => (
                  <span
                    className={`er-record-margin ${c.pass ? "is-pass" : "is-fail"}`}
                    key={c.id}
                  >
                    {c.text} <small>({display(c.bound)} limit)</small>
                  </span>
                ))}
            </div>
          );
        })}
      </div>
      {chosen.length > 3 && (
        <small>{chosen.length - 3} more records selected</small>
      )}
    </div>
  );
}
export function DatasetReview({
  page,
  dataset,
  columns,
  rows,
  output,
  at,
  close,
  accept,
  kind,
}: {
  page: Page;
  dataset: string;
  columns: number[];
  rows: number[];
  output?: string;
  kind?: DataSelection["kind"];
  at: Point;
  close: () => void;
  accept: (r: DatasetComputation, placement: "model" | "source") => void;
}) {
  const source = page.regions.find((r) => r.id === dataset)!.data!,
    table = readCsv(source),
    p = project(page);
  const models = [...p.statements].filter(
    ([id, s]) => s.relation === "=" && p.kinds[id] === "equation",
  );
  const [target, setTarget] = useState(output || models[0]?.[0] || ""),
    [scope, setScope] = useState<"all" | "records">(
      kind === "cell" || kind === "record" ? "records" : "all",
    ),
    [paired, setPaired] = useState(false),
    [placement, setPlacement] = useState<"model" | "source">("model");
  const symbols = target
    ? references(p.statements.get(target)!.expression)
    : [];
  const [mapping, setMapping] = useState<Record<number, string>>(() =>
    Object.fromEntries(
      columns.map((c, i) => {
        const header = table.headers[c]
          .replace(/\[[^\]]*\]/g, "")
          .trim()
          .toLowerCase();
        return [
          c,
          symbols.find((s) => s.toLowerCase() === header) || symbols[i] || "",
        ];
      }),
    ),
  );
  const [units, setUnits] = useState<Record<number, string>>(() =>
    Object.fromEntries(
      columns.map((c) => [
        c,
        table.headers[c].match(/\[([^\]]+)\]/)?.[1] || "",
      ]),
    ),
  );
  const relation: DatasetComputation = {
    id: "data-relation-preview",
    dataset,
    output: target,
    bindings: columns.map((column) => ({
      column,
      symbol: mapping[column] || "",
      unit: units[column] || "",
      quantity: p.bindings[target]?.[mapping[column]],
    })),
    scope: scope === "all" ? { kind: "all" } : { kind: "records", rows },
    paired: true,
  };
  let result: ReturnType<typeof evaluateDataset> | undefined,
    error = "";
  try {
    result = evaluateDataset(page, relation);
  } catch (e) {
    error = (e as Error).message;
  }
  return (
    <aside
      className="er-link-popover er-dataset-review"
      role="dialog"
      aria-label="Connect dataset to model"
      style={{ left: at.x, top: at.y }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") close();
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !error && paired) {
          e.preventDefault();
          accept(relation, placement);
        }
      }}
    >
      <header>
        <Link2 size={16} />
        <strong>Connect measurements</strong>
        <button aria-label="Close dataset connection" onClick={close}>
          <X size={15} />
        </button>
      </header>
      <label>
        Relationship
        <select
          aria-label="Dataset model"
          autoFocus
          value={target}
          onChange={(e) => {
            setTarget(e.target.value);
            setMapping({});
          }}
        >
          <option value="">Choose equation</option>
          {models.map(([id, s]) => (
            <option key={id} value={id}>
              {s.raw}
            </option>
          ))}
        </select>
      </label>
      <span className="er-link-kind">
        Computation · paired records → calculated dataset
      </span>
      <div className="er-column-map er-map-head">
        <span>CSV column</span>
        <span>Model input</span>
        <span>Units</span>
      </div>
      {columns.map((c) => (
        <div className="er-column-map" key={c}>
          <span>{table.headers[c]} →</span>
          <select
            aria-label={`Bind ${table.headers[c]} to input`}
            value={mapping[c] || ""}
            onChange={(e) => setMapping({ ...mapping, [c]: e.target.value })}
          >
            <option value="">Choose input</option>
            {symbols.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <input
            aria-label={`Units for ${table.headers[c]}`}
            value={units[c] || ""}
            placeholder="Units, or 1"
            onChange={(e) => setUnits({ ...units, [c]: e.target.value })}
          />
        </div>
      ))}
      <fieldset>
        <legend>Use</legend>
        <label>
          <input
            type="radio"
            name="dataset-scope"
            checked={scope === "records"}
            disabled={!rows.length}
            onChange={() => setScope("records")}
          />
          {rows.length === 1
            ? "Selected record (scalar)"
            : `Selected records (${rows.length})`}
        </label>
        <label>
          <input
            type="radio"
            name="dataset-scope"
            checked={scope === "all"}
            onChange={() => setScope("all")}
          />
          All {table.rows.length} rows (vector)
        </label>
      </fieldset>
      <label className="er-pair-confirm">
        <input
          type="checkbox"
          checked={paired}
          onChange={(e) => setPaired(e.target.checked)}
        />
        These columns describe paired measurements in the same row.
      </label>
      {error ? (
        <p className="er-link-error" role="status">
          {error}
        </p>
      ) : (
        result && (
          <div
            className="er-dataset-preview"
            aria-label="Dataset calculation preview"
          >
            <div className="er-mapping-outcome" aria-label="Connection outcome">
              <span>Units compatible · no unresolved inputs</span>
              <span>
                {paired ? "Pairing confirmed" : "Confirm pairing by record"}
              </span>
              <span>Produces a linked {result.output} plot and table</span>
            </div>
            <strong>
              {result.records.length}{" "}
              {result.records.length === 1 ? "record" : "records"} →{" "}
              {result.output}
            </strong>
            {result.records.slice(0, 3).map((r) => (
              <span key={r.row}>
                Row {r.row + 1} <b>{display(r.value)}</b>
                {r.pass !== undefined && (
                  <em className={r.pass ? "is-pass" : "is-fail"}>
                    {r.pass ? "Within limit" : "Outside limit"}
                  </em>
                )}
              </span>
            ))}
            {result.records.length > 3 && (
              <small>… {result.records.length - 3} more, all validated</small>
            )}
            <details>
              <summary>Model context & assumptions</summary>
              <p>
                {page.contexts.find((c) => c.id === page.active)?.label}; same
                equation applied to each row. No interpolation or fitting.
              </p>
              {result.assumptions.map((a, i) => (
                <code key={i}>{a}</code>
              ))}
              <p>
                {result.requirements.map((r) => r.text).join(" · ") ||
                  "No requirement on this output."}
              </p>
            </details>
          </div>
        )
      )}
      <label className="er-data-placement">
        Place result
        <select
          aria-label="Place calculated result"
          value={placement}
          onChange={(e) => setPlacement(e.target.value as "model" | "source")}
        >
          <option value="model">Near equation</option>
          <option value="source">Near source data</option>
        </select>
      </label>
      <footer>
        <button onClick={close}>Cancel</button>
        <button
          disabled={!!error || !paired}
          onClick={() => accept(relation, placement)}
        >
          Connect & calculate
        </button>
      </footer>
    </aside>
  );
}
export function DatasetResult({
  page,
  relation,
  at,
  selected,
  selection,
  inspect,
  move,
  remove,
  hidden,
  focus,
  showSource,
}: {
  page: Page;
  relation: DatasetComputation;
  at: Point;
  selected: boolean;
  selection?: DataSelection;
  inspect: (row: number, column?: number, additive?: boolean) => void;
  move: (e: React.PointerEvent) => void;
  remove: () => void;
  hidden?: boolean;
  focus: () => void;
  showSource: (row: number) => void;
}) {
  const [view, setView] = useState<"plot" | "table">("plot"),
    [axis, setAxis] = useState(relation.bindings.at(-1)?.symbol || ""),
    [start, setStart] = useState(0),
    [failureFilter, setFailureFilter] = useState<{ requirement?: string }>();
  const state = useMemo(() => {
    try {
      return { result: evaluateDataset(page, relation) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [page, relation]);
  const { result, error } = state,
    source = page.regions.find((r) => r.id === relation.dataset)?.data;
  const symbol =
    relation.bindings.find((b) => b.symbol === axis) || relation.bindings[0];
  const p = project(page),
    name = symbol?.quantity
      ? p.statements.get(symbol.quantity)?.name || symbol.symbol
      : symbol?.symbol;
  const records = result?.records || [],
    xq = records[0]?.inputs[name],
    yq = records[0]?.value;
  const failures = useMemo(
      () => records.filter((r) => r.pass === false),
      [records],
    ),
    filteredFailures = useMemo(
      () =>
        failureFilter?.requirement
          ? records.filter(
              (r) => r.conditions[failureFilter.requirement!] === false,
            )
          : failures,
      [records, failures, failureFilter],
    ),
    tableRecords = failureFilter ? filteredFailures : records,
    selectedRows =
      selection?.dataset === relation.dataset &&
      selectionKind(selection) !== "series"
        ? selection.rows
        : [],
    activeRecord = records.find((r) => r.row === selectedRows.at(-1)),
    activeFailure = filteredFailures.findIndex(
      (r) => r.row === activeRecord?.row,
    ),
    pageStart = Math.min(
      start,
      Math.max(0, Math.floor((tableRecords.length - 1) / 40) * 40),
    );
  useEffect(() => {
    const index = tableRecords.findIndex((r) => r.row === selectedRows.at(-1));
    if (index >= 0) setStart(Math.floor(index / 40) * 40);
  }, [selection, tableRecords]);
  useEffect(() => {
    if (
      failureFilter?.requirement &&
      !result?.requirements.some((r) => r.id === failureFilter.requirement)
    ) {
      setFailureFilter(undefined);
      setStart(0);
    }
  }, [failureFilter, result]);
  const showFailures = (requirement?: string) => {
    const first = requirement
      ? records.find((r) => r.conditions[requirement] === false)
      : failures[0];
    setFailureFilter({ requirement });
    setView("table");
    setStart(0);
    if (first) inspect(first.row);
  };
  const nextFailure = (direction: -1 | 1) => {
    if (!filteredFailures.length) return;
    const index =
      activeFailure < 0
        ? direction === 1
          ? 0
          : filteredFailures.length - 1
        : (activeFailure + direction + filteredFailures.length) %
          filteredFailures.length;
    inspect(filteredFailures[index].row);
  };
  const xs = records.map((r) => r.inputs[name].value),
    ys = records.map((r) =>
      r.value.absolute ? r.value.value - 273.15 : r.value.value,
    );
  const selectedRecords =
    selection?.dataset === relation.dataset &&
    selectionKind(selection) !== "series"
      ? records.filter((r) => selection.rows.includes(r.row))
      : [];
  const limits = records[0]
    ? Object.entries(records[0].limits).filter(([id, { bound }]) =>
        records.every((r) => r.limits[id]?.bound.value === bound.value),
      )
    : [];
  const scalar = (q: typeof yq) =>
    q?.absolute ? q.value - 273.15 : q?.value || 0;
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minY = Math.min(0, ...ys, ...limits.map(([, l]) => scalar(l.bound))),
    maxY = Math.max(...ys, ...limits.map(([, l]) => scalar(l.bound))),
    dx = maxX - minX || Math.abs(maxX) * 0.2 || 1,
    dy = maxY - minY || 1;
  const sampled = sampleDatasetPlot(records, name, selectedRows),
    plotted = sampled.records;
  const px = (x: number) => 65 + ((x - minX + dx * 0.1) / (dx * 1.2)) * 420,
    py = (y: number) => 240 - ((y - minY) / (dy * 1.15)) * 190;
  return (
    <section
      className={`er-data-result ${selected ? "is-selected" : ""}`}
      data-data-relation-id={relation.id}
      style={{ left: at.x, top: at.y, display: hidden ? "none" : undefined }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <header>
        <button aria-label="Move calculated dataset" onPointerDown={move}>
          <GripVertical size={15} />
        </button>
        <strong>
          {result?.output || "Calculated dataset"} from measurements
        </strong>
        <button
          aria-label="Focus calculated dataset"
          className="er-data-focus"
          onClick={focus}
        >
          <Maximize2 size={13} />
        </button>
        <span className="er-data-result-actions">
          <button
            aria-pressed={view === "plot"}
            onClick={() => {
              setView("plot");
              setFailureFilter(undefined);
              setStart(0);
            }}
          >
            Plot
          </button>
          <button
            aria-pressed={view === "table"}
            onClick={() => setView("table")}
          >
            Table
          </button>
          <button aria-label="Remove dataset relationship" onClick={remove}>
            <X size={14} />
          </button>
        </span>
      </header>
      <small className="er-data-context">
        {source?.name} · {records.length} paired{" "}
        {records.length === 1 ? "record" : "records"} ·{" "}
        {page.contexts.find((c) => c.id === page.active)?.label}
      </small>
      {error ? (
        <p role="status" className="er-link-error">
          Blocked · {error}
        </p>
      ) : (
        <>
          <div className="er-data-result-caption">
            <i />
            Calculated from measured inputs{" "}
            <span>
              {records.length > 1000
                ? `${plotted.length} of ${records.length} points shown`
                : ""}
            </span>
          </div>
          {!!result?.requirements.length && (
            <div
              className="er-data-failure-controls"
              role="group"
              aria-label="Requirement failures"
            >
              <button
                aria-pressed={!!failureFilter}
                disabled={!failures.length}
                onClick={() => showFailures()}
              >
                Show failing records ({failures.length})
              </button>
              {failureFilter && (
                <button
                  onClick={() => {
                    setFailureFilter(undefined);
                    setStart(0);
                  }}
                >
                  Show all records
                </button>
              )}
              <button
                aria-label="Previous failing record"
                disabled={!filteredFailures.length}
                onClick={() => nextFailure(-1)}
              >
                Previous failure
              </button>
              <span role="status" aria-live="polite">
                {activeFailure >= 0
                  ? `Failure ${activeFailure + 1} of ${filteredFailures.length} · Row ${activeRecord!.row + 1}`
                  : `${filteredFailures.length} failing records`}
              </span>
              <button
                aria-label="Next failing record"
                disabled={!filteredFailures.length}
                onClick={() => nextFailure(1)}
              >
                Next failure
              </button>
            </div>
          )}
          {activeRecord && (
            <button
              className="er-data-source-record"
              aria-label={`Show source row ${activeRecord.row + 1}`}
              onClick={() => showSource(activeRecord.row)}
            >
              Show source record · Row {activeRecord.row + 1}
            </button>
          )}
          {view === "plot" ? (
            <>
              {!!(
                sampled.omittedFailureCount || sampled.omittedSelectedCount
              ) && (
                <p className="er-data-sampling-notice" role="status">
                  {sampled.omittedFailureCount > 0 &&
                    `${sampled.omittedFailureCount} failing records are not shown individually. Use Show failing records to inspect every failure. `}
                  {sampled.omittedSelectedCount > 0 &&
                    `${sampled.omittedSelectedCount} selected records are not shown individually.`}
                </p>
              )}
              <svg
                viewBox="0 0 530 295"
                role="group"
                aria-label="Calculated measurements plot"
              >
                {limits.map(([id, l]) => (
                  <g key={id} className="er-data-feasibility">
                    <rect
                      x="65"
                      y={l.relation.startsWith("<") ? py(scalar(l.bound)) : 35}
                      width="425"
                      height={Math.max(
                        0,
                        l.relation.startsWith("<")
                          ? 240 - py(scalar(l.bound))
                          : py(scalar(l.bound)) - 35,
                      )}
                      fill="#6c92700b"
                    />
                    <path
                      d={`M65 ${py(scalar(l.bound))} H490`}
                      stroke="#889282"
                      strokeDasharray="5 5"
                    />
                    <text x="490" y={py(scalar(l.bound)) - 9} textAnchor="end">
                      {display(l.bound)} limit
                    </text>
                  </g>
                ))}
                <path d="M65 35 V240 H490" fill="none" stroke="#b4b5bf" />
                <text x="65" y="20">
                  {result?.output} ({yq && unitLabel(yq)})
                </text>
                <text x="270" y="283" textAnchor="middle">
                  {name} ({xq && unitLabel(xq)})
                </text>
                {[0, 0.5, 1].map((t) => (
                  <g key={t}>
                    <text x="54" y={py(minY + dy * t) + 4} textAnchor="end">
                      {Number((minY + dy * t).toPrecision(4))}
                    </text>
                    <text x={px(minX + dx * t)} y="260" textAnchor="middle">
                      {Number(
                        (
                          minX +
                          dx * t -
                          (xq?.absolute ? 273.15 : 0)
                        ).toPrecision(4),
                      )}
                    </text>
                  </g>
                ))}
                {selectedRecords.slice(0, 3).map((r) => (
                  <g
                    key={`selected-${r.row}`}
                    className="er-point-selected-mark"
                  >
                    <circle
                      cx={px(r.inputs[name].value)}
                      cy={py(scalar(r.value))}
                      r="15"
                      fill={r.pass === false ? "#bc644914" : "#74619414"}
                    />
                    <text
                      x={px(r.inputs[name].value)}
                      y={py(scalar(r.value)) - 23}
                      textAnchor="middle"
                    >
                      Row {r.row + 1} · {display(r.value)}
                    </text>
                  </g>
                ))}
                {plotted.map((r) => (
                  <circle
                    key={r.row}
                    role="button"
                    tabIndex={0}
                    aria-label={`Inspect measured row ${r.row + 1}: ${display(r.value)}`}
                    data-measurement-row={r.row}
                    cx={px(r.inputs[name].value)}
                    cy={py(
                      r.value.absolute ? r.value.value - 273.15 : r.value.value,
                    )}
                    r={
                      selection?.dataset === relation.dataset &&
                      selection.rows.includes(r.row)
                        ? 9
                        : 6
                    }
                    fill={
                      selection?.dataset === relation.dataset &&
                      selectionKind(selection) === "series"
                        ? r.pass === false
                          ? "#fbebe4"
                          : "#efeaf5"
                        : "white"
                    }
                    stroke={r.pass === false ? "#bd6745" : "#417b98"}
                    strokeWidth="2.5"
                    onClick={(e) => inspect(r.row, undefined, e.shiftKey)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        inspect(r.row, undefined, e.shiftKey);
                      }
                    }}
                  >
                    <title>{`Row ${r.row + 1} · ${display(r.value)}${r.pass === undefined ? "" : r.pass ? " · Within limit" : " · Outside limit"}`}</title>
                  </circle>
                ))}
              </svg>
              <label className="er-data-axis">
                Horizontal axis{" "}
                <select
                  aria-label="Measurement plot horizontal axis"
                  value={axis}
                  onChange={(e) => setAxis(e.target.value)}
                >
                  {relation.bindings.map((b) => (
                    <option key={b.symbol} value={b.symbol}>
                      {b.symbol}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <>
              {failureFilter && (
                <p className="er-data-filter-status" role="status">
                  {failureFilter.requirement
                    ? `Showing ${tableRecords.length} records outside ${result?.requirements.find((r) => r.id === failureFilter.requirement)?.text || "this requirement"}.`
                    : `Showing ${tableRecords.length} records outside one or more requirements.`}
                </p>
              )}
              <div className="er-data-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Row</th>
                      {relation.bindings.map((b) => (
                        <th key={b.symbol}>{b.symbol}</th>
                      ))}
                      <th>{result?.output}</th>
                      <th>Requirement</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRecords.slice(pageStart, pageStart + 40).map((r) => (
                      <tr
                        key={r.row}
                        data-calculated-row={r.row}
                        className={
                          selection?.dataset === relation.dataset &&
                          selection.rows.includes(r.row)
                            ? "is-record-selected"
                            : ""
                        }
                        onClick={(e) => inspect(r.row, undefined, e.shiftKey)}
                      >
                        <td>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              inspect(r.row, undefined, e.shiftKey);
                            }}
                            aria-label={`Inspect calculated row ${r.row + 1}`}
                          >
                            {r.row + 1}
                          </button>
                        </td>
                        {Object.entries(r.inputs).map(([s, q]) => (
                          <td
                            key={s}
                            className={
                              selection?.dataset === relation.dataset &&
                              selectionKind(selection) === "series" &&
                              relation.bindings.some(
                                (b) =>
                                  (b.quantity
                                    ? p.statements.get(b.quantity)?.name
                                    : b.symbol) === s &&
                                  selection.columns.includes(b.column),
                              )
                                ? "is-input-selected"
                                : ""
                            }
                          >
                            {display(q)}
                          </td>
                        ))}
                        <td data-derived-value>{display(r.value)}</td>
                        <td>
                          {r.pass === undefined
                            ? "—"
                            : r.pass
                              ? "Within limit"
                              : "Outside limit"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!tableRecords.length && (
                <p role="status">No failing records for this filter.</p>
              )}
              {tableRecords.length > 40 && (
                <div className="er-data-paging">
                  <button
                    disabled={!pageStart}
                    onClick={() => setStart(Math.max(0, pageStart - 40))}
                  >
                    Previous
                  </button>
                  <span>
                    {pageStart + 1}–
                    {Math.min(pageStart + 40, tableRecords.length)} of{" "}
                    {tableRecords.length}
                  </span>
                  <button
                    disabled={pageStart + 40 >= tableRecords.length}
                    onClick={() => setStart(pageStart + 40)}
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
          <footer>
            {result?.requirements.map((r) => (
              <button
                key={r.id}
                className="er-data-requirement"
                aria-label={`Show failing records for ${r.text}`}
                aria-pressed={failureFilter?.requirement === r.id}
                disabled={
                  !records.some((row) => row.conditions[r.id] === false)
                }
                onClick={() => showFailures(r.id)}
              >
                {r.text} ·{" "}
                {records.filter((row) => row.conditions[r.id]).length}/
                {records.length} within limit
              </button>
            ))}
            <details>
              <summary>Source & model</summary>
              <code>{p.texts[relation.output]}</code>
              <p>
                Row-aligned computation from {source?.name}. Inputs are
                evidence; outputs are calculated. Selecting a point inspects its
                record.
              </p>
              {result?.assumptions.map((a, i) => (
                <code key={i}>{a}</code>
              ))}
            </details>
          </footer>
        </>
      )}
    </section>
  );
}
