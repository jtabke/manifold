import { useMemo, useState } from "react";
import { display } from "../../notebook/math";
import { resolve, object } from "@manifold/foundation";
import { readCsv } from "../dataSources";
import type { RegionSession } from "../document";
import { RECENT_LIMITS, type WorksheetReceipt } from "../worksheetHistory";
import type { SourceEvidence } from "../resultSnapshot";
import "../styles/calculationHistory.css";
function Source({
  session,
  source,
}: {
  session: RegionSession;
  source: SourceEvidence;
}) {
  const [open, setOpen] = useState(false),
    got = resolve(session.document, source.reference);
  const value =
    got.status === "resolved" &&
    object(got.revision.body) &&
    object(got.revision.body.value)
      ? got.revision.body.value
      : undefined;
  const data =
    value &&
    object(value.data) &&
    typeof value.data.name === "string" &&
    typeof value.data.csv === "string"
      ? { name: value.data.name, csv: value.data.csv }
      : undefined;
  const table = open && data ? readCsv(data) : undefined;
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        {data?.name || "Unavailable source"} · row {source.row + 1}, column{" "}
        {source.column + 1}
      </summary>
      <p>
        Recorded cell: {source.raw} {source.unit}. This is the original source
        revision.
      </p>
      {table && (
        <div className="calculation-source-table">
          <table>
            <thead>
              <tr>
                {table.headers.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {table.rows[source.row]?.map((v, i) => (
                  <td
                    key={i}
                    className={i === source.column ? "is-source-cell" : ""}
                  >
                    {v.length > 200 ? v.slice(0, 200) + "…" : v}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {table?.rows[source.row]?.some((v) => v.length > 200) && (
        <p>
          Long cells are abbreviated. Download the CSV for the complete record.
        </p>
      )}
      {data && (
        <button
          onClick={() => {
            const url = URL.createObjectURL(
                new Blob([data.csv], { type: "text/csv;charset=utf-8" }),
              ),
              a = document.createElement("a");
            a.href = url;
            a.download = data.name;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          Download original CSV
        </button>
      )}
    </details>
  );
}
function Record({
  session,
  receipt,
  currentKey,
  kept,
  keep,
  remove,
}: {
  session: RegionSession;
  receipt: WorksheetReceipt;
  currentKey: string;
  kept?: boolean;
  keep?: (label: string) => void;
  remove?: () => void;
}) {
  const [label, setLabel] = useState(`${receipt.contextLabel} calculation`);
  return (
    <details className="calculation-record">
      <summary>
        {receipt.contextLabel} · {new Date(receipt.time).toLocaleTimeString()}
        <small>
          {receipt.key === currentKey
            ? "Matches current mathematics"
            : "Earlier mathematics"}
          {kept ? " · Kept" : ""}
        </small>
      </summary>
      <dl>
        {Object.entries(receipt.values).map(([name, q]) => (
          <div key={name}>
            <dt>{name.startsWith("__expr_") ? "Expression" : name}</dt>
            <dd>{display(q)}</dd>
          </div>
        ))}
      </dl>
      {Object.entries(receipt.errors).map(([id, message]) => (
        <p key={id} className="calculation-error">
          {receipt.definitions.find((r) => r.id === id)?.text}: {message}
        </p>
      ))}
      {Object.entries(receipt.conditions).map(([id, c]) => (
        <p key={id}>
          {receipt.definitions.find((r) => r.id === id)?.text} ·{" "}
          {c.pass ? "Condition met" : "Condition not met"}
        </p>
      ))}
      <details>
        <summary>Definitions and source records</summary>
        {receipt.definitions.map((r) => (
          <p key={r.id}>
            <code>{r.text}</code>
          </p>
        ))}
        {receipt.sources.map((s) => (
          <Source key={s.region} session={session} source={s} />
        ))}
        {receipt.unavailableSources.map((s) => (
          <p key={s.region}>
            Source unavailable · row {s.row + 1}, column {s.column + 1}: {s.raw}{" "}
            {s.unit}
          </p>
        ))}
      </details>
      {keep && !kept && (
        <div className="calculation-actions">
          <input
            aria-label="Calculation name"
            maxLength={160}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <button
            disabled={!label.trim() || !receipt.definitions.length}
            onClick={() => keep(label)}
          >
            Keep calculation
          </button>
        </div>
      )}
      {remove && <button onClick={remove}>Remove kept calculation</button>}
    </details>
  );
}
export default function CalculationHistory({
  session,
  close,
}: {
  session: RegionSession;
  close: () => void;
}) {
  const [tab, setTab] = useState<"recent" | "kept">(
      session.state.calculations?.length && !session.receipts.length
        ? "kept"
        : "recent",
    ),
    [error, setError] = useState("");
  const current = useMemo(
    () => session.currentCalculation(),
    [session, session.document],
  );
  const kept = session.state.calculations ?? [],
    recent = session.recentHistory;
  const act = (operation: () => void) => {
    try {
      operation();
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <aside
      className="er-popover er-history calculation-history"
      aria-label="Calculation history"
    >
      <header>
        <b>Calculations</b>
        <button onClick={close} aria-label="Close history">
          Close
        </button>
      </header>
      <p>
        Typed mathematics only. Condition checks do not establish physical
        validity.
      </p>
      <button
        disabled={!current.definitions.length}
        onClick={() =>
          act(() => {
            session.keepCurrentCalculation();
            setTab("kept");
          })
        }
      >
        Keep current calculation
      </button>
      <div role="group" aria-label="Calculation history views">
        <button
          aria-pressed={tab === "recent"}
          onClick={() => setTab("recent")}
        >
          Recent ({session.receipts.length})
        </button>
        <button aria-pressed={tab === "kept"} onClick={() => setTab("kept")}>
          Kept ({kept.length})
        </button>
      </div>
      {tab === "recent" ? (
        <>
          <p>
            Temporary history for this session: up to {RECENT_LIMITS.entries}{" "}
            states and 8 MB of recorded data. Keep a calculation to include it
            in saved work.
          </p>
          <button
            disabled={!current.definitions.length}
            onClick={() => act(() => session.evaluate())}
          >
            Capture current calculation
          </button>
          <button
            disabled={!session.receipts.length && !recent.omitted}
            onClick={() => session.clearRecentCalculations()}
          >
            Clear recent calculations
          </button>
          {!!recent.omitted && (
            <p role="status">
              {recent.omitted} calculation snapshots exceeded temporary
              history's size limit. Current mathematics remains available.
            </p>
          )}
          {!session.receipts.length && (
            <p>No recent calculations in this session.</p>
          )}
          {[...session.receipts].reverse().map((receipt) => (
            <Record
              key={receipt.id}
              session={session}
              receipt={receipt}
              currentKey={current.key}
              kept={kept.some((c) => c.snapshot.id === receipt.id)}
              keep={(label) =>
                act(() => {
                  session.keepCalculation(receipt.id, label);
                  setTab("kept");
                })
              }
            />
          ))}
        </>
      ) : (
        <>
          <p>
            Kept calculations travel with this document, including their
            original definitions and available source records. Remove uses
            ordinary Undo.
          </p>
          {!kept.length && <p>No kept calculations yet.</p>}
          {[...kept].reverse().map((c) => (
            <section key={c.id} aria-label={c.label}>
              <h3>{c.label}</h3>
              <Record
                session={session}
                receipt={c.snapshot}
                currentKey={current.key}
                kept
                remove={() => act(() => session.removeCalculation(c.id))}
              />
            </section>
          ))}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </aside>
  );
}
