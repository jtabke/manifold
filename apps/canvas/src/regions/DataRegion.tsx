import { useEffect, useState } from "react";
import { Link2, ChevronDown, ChevronRight } from "lucide-react";
import { readCsv, numericCell, type CsvData } from "./dataSources";
import { selectionKind, type DataSelection } from "./dataFeedback";
export function DataRegion({
  data,
  bound,
  select,
  selected,
  define,
  dataset,
  selection,
  choose,
  connect,
  collapsed,
  toggleCollapsed,
  trace,
  navigating,
}: {
  data: CsvData;
  dataset: string;
  selection?: DataSelection;
  collapsed?: boolean;
  toggleCollapsed: () => void;
  trace?: () => void;
  navigating?: boolean;
  choose: (
    rows: number[],
    columns: number[],
    kind: DataSelection["kind"],
  ) => void;
  connect: (columns: number[], rows: number[]) => void;
  bound: { row: number; column: number; id: string; name: string }[];
  select: (id: string) => void;
  selected?: string;
  define: (row: number, column: number, name: string, unit: string) => void;
}) {
  const table = readCsv(data),
    [cell, setCell] = useState<{ row: number; column: number }>(),
    [name, setName] = useState(""),
    [unit, setUnit] = useState(""),
    [error, setError] = useState(""),
    [start, setStart] = useState(0);
  const picked =
    selection?.dataset === dataset
      ? selection
      : { dataset, rows: [], columns: [], kind: "series" as const };
  const kind = selectionKind(picked),
    hasSelection = !!picked.rows.length || !!picked.columns.length;
  const linkColumns =
    kind === "record"
      ? table.headers
          .map((_, c) => c)
          .filter((c) => numericCell(table.rows[picked.rows[0]]?.[c] || ""))
      : picked.columns;
  const openCell = () => {
    const row = picked.rows[0],
      column = picked.columns[0];
    if (row === undefined || column === undefined) return;
    setCell({ row, column });
    setUnit(table.headers[column].match(/\[([^\]]+)\]/)?.[1] || "");
    setName(
      table.headers[column]
        .replace(/\[[^\]]*\]/g, "")
        .trim()
        .replace(/[^A-Za-z_0-9]/g, "_")
        .replace(/^[^A-Za-z_]+/, "") + "_measured",
    );
    setError("");
  };
  useEffect(() => {
    if (picked.rows.length === 1)
      setStart(Math.floor(picked.rows[0] / 40) * 40);
    setCell(undefined);
  }, [
    selection?.dataset,
    selection?.rows.join(","),
    selection?.columns.join(","),
    selection?.kind,
  ]);
  return (
    <div
      className="er-data"
      aria-label={`Data source ${data.name}`}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <header>
        <button
          className="er-data-collapse"
          aria-label={collapsed ? "Expand dataset" : "Collapse dataset"}
          aria-expanded={!collapsed}
          onClick={toggleCollapsed}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>
        <b>{data.name}</b>
        <span>{table.rows.length} measurements</span>
      </header>
      {!collapsed && (
        <>
          <div className="er-data-scroll">
            <table>
              <thead>
                <tr>
                  <th>Row</th>
                  {table.headers.map((h, j) => (
                    <th key={h}>
                      <button
                        aria-label={`Select column ${h}`}
                        aria-pressed={
                          kind === "series" && picked.columns.includes(j)
                        }
                        data-source-column={j}
                        onClick={() =>
                          choose(
                            picked.rows,
                            picked.columns.includes(j)
                              ? picked.columns.filter((c) => c !== j)
                              : [...picked.columns, j],
                            "series",
                          )
                        }
                      >
                        {h}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.slice(start, start + 40).map((row, offset) => {
                  const i = start + offset;
                  return (
                    <tr
                      key={i}
                      data-source-row={i}
                      className={
                        picked.rows.includes(i) && kind !== "series"
                          ? kind === "record"
                            ? "is-record-selected"
                            : "has-selected-cell"
                          : ""
                      }
                    >
                      <td>
                        <button
                          aria-label={`Select measurement row ${i + 1}`}
                          aria-pressed={
                            kind !== "series" && picked.rows.includes(i)
                          }
                          onClick={(e) =>
                            choose(
                              e.shiftKey
                                ? [...new Set([...picked.rows, i])]
                                : [i],
                              [],
                              "record",
                            )
                          }
                        >
                          {i + 1}
                        </button>
                      </td>
                      {row.map((value, j) => (
                        <td
                          key={j}
                          data-source-cell={`${i}-${j}`}
                          data-linked-quantity={
                            bound.find(
                              (b) =>
                                b.row === i &&
                                b.column === j &&
                                b.id === selected,
                            )?.id
                          }
                          className={
                            kind === "series" && picked.columns.includes(j)
                              ? "is-column-selected"
                              : kind === "cell" &&
                                  picked.rows.includes(i) &&
                                  picked.columns.includes(j)
                                ? "is-cell-selected"
                                : ""
                          }
                        >
                          {numericCell(value) ? (
                            <button
                              aria-label={`Use row ${i + 1}, ${table.headers[j]}`}
                              data-link-source={
                                bound.find((b) => b.row === i && b.column === j)
                                  ?.id
                              }
                              title={
                                bound.find((b) => b.row === i && b.column === j)
                                  ?.name
                              }
                              aria-pressed={
                                kind === "cell" &&
                                picked.rows.includes(i) &&
                                picked.columns.includes(j)
                              }
                              onClick={() => choose([i], [j], "cell")}
                            >
                              {value}
                              <Link2 size={11} />
                            </button>
                          ) : (
                            value
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {table.rows.length > 40 && (
            <div className="er-data-paging">
              <button
                disabled={!start}
                onClick={() => setStart(Math.max(0, start - 40))}
              >
                Previous
              </button>
              <span>
                {start + 1}–{Math.min(start + 40, table.rows.length)} of{" "}
                {table.rows.length}
              </span>
              <button
                disabled={start + 40 >= table.rows.length}
                onClick={() => setStart(start + 40)}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
      {hasSelection && !(navigating && kind !== "cell") && (
        <div className="er-data-link-tools" aria-label="Dataset selection">
          <span className="er-data-selection-kind">
            {kind === "cell"
              ? `Cell · ${table.headers[picked.columns[0]]} · Row ${picked.rows[0] + 1}`
              : kind === "record"
                ? `${picked.rows.length === 1 ? "Record" : "Records"} · ${picked.rows.map((r) => r + 1).join(", ")}`
                : `Series · ${picked.columns.length} ${picked.columns.length === 1 ? "column" : "columns"}`}
          </span>
          {!!linkColumns.length && (
            <button
              data-dataset-link={dataset}
              data-columns={linkColumns.join(",")}
              data-selection-kind={kind}
              title="Drag to connect to an equation"
              aria-label={
                kind === "series"
                  ? "Drag selected columns to equation"
                  : kind === "cell"
                    ? "Drag selected value to equation"
                    : "Drag selected record to equation"
              }
            >
              <Link2 size={14} />
            </button>
          )}
          {kind === "cell" ? (
            <button
              onClick={() => {
                const existing = bound.find(
                  (b) =>
                    b.row === picked.rows[0] && b.column === picked.columns[0],
                );
                if (existing) select(existing.id);
                else openCell();
              }}
            >
              Reference value
            </button>
          ) : (
            <button onClick={() => connect(linkColumns, picked.rows)}>
              {kind === "record" && trace
                ? "Show calculation"
                : "Connect to equation…"}
            </button>
          )}
        </div>
      )}
      {cell && (
        <form
          className="er-cell-definition"
          aria-label="Define measurement quantity"
          onSubmit={(e) => {
            e.preventDefault();
            try {
              define(cell.row, cell.column, name, unit);
              setCell(undefined);
              setError("");
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <small>
            Row {cell.row + 1} · {table.headers[cell.column]}
          </small>
          <label>
            Quantity
            <input
              aria-label="Measurement quantity name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </label>
          <label>
            Units
            <input
              aria-label="Measurement units"
              placeholder="1 for dimensionless"
              value={unit}
              onChange={(e) =>
                setUnit(e.target.value === "1" ? "" : e.target.value)
              }
            />
          </label>
          <span className="er-cell-value">
            {table.rows[cell.row][cell.column]}
          </span>
          <button type="button" onClick={() => setCell(undefined)}>
            Cancel
          </button>
          <button type="submit">Define quantity</button>
          {error && <p role="status">{error}</p>}
        </form>
      )}
    </div>
  );
}
