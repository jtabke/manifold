import { useMemo } from "react";
import { ArrowLeft, MoreHorizontal, Scan, Waypoints } from "lucide-react";
import { display } from "../notebook/math";
import { project, type Page, type Point } from "./document";
import { recordFeedback, type DataSelection } from "./dataFeedback";
import { evaluateDataset, type DatasetComputation } from "./datasetModel";
import {
  relationshipObjects,
  type RelationshipLocation,
} from "./relationshipNavigation";
export function RelationshipTrail({
  page,
  selection,
  relation,
  at,
  follow,
  back,
  canBack,
  trace,
  toggleTrace,
  focus,
  arrange,
  mode,
  restore,
  keep,
  clear,
}: {
  page: Page;
  selection: DataSelection;
  relation: DatasetComputation;
  at: Point;
  follow: (r: DatasetComputation, to: RelationshipLocation) => void;
  back: () => void;
  canBack: boolean;
  trace: boolean;
  toggleTrace: () => void;
  focus: () => void;
  arrange: () => void;
  mode?: "frame" | "arrange";
  restore: () => void;
  keep: () => void;
  clear: () => void;
}) {
  const p = project(page),
    name = p.statements.get(relation.output)?.name || "Calculation";
  const result = useMemo(() => {
    try {
      return evaluateDataset(page, relation);
    } catch {
      return undefined;
    }
  }, [page, relation]);
  const record = result?.records.find((r) => selection.rows.includes(r.row)),
    story = record ? recordFeedback(page, relation, record) : undefined;
  const objects = relationshipObjects(page, relation),
    uses = (page.dataRelations || []).filter(
      (r) => r.dataset === relation.dataset,
    );
  return (
    <aside
      className="er-relationship-trail"
      aria-label="Relationship navigation"
      style={{ left: at.x, top: at.y }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="er-follow-chain">
        <button
          aria-label="Follow measurement source"
          aria-current={
            selection.view === relation.dataset && !selection.columns.length
              ? "location"
              : undefined
          }
          onClick={() => follow(relation, { kind: "source" })}
        >
          ↗ {record ? `Row ${record.row + 1}` : "Source"}
        </button>
        <span>→</span>
        {relation.bindings.map((b) => {
          const symbol = b.quantity
            ? p.statements.get(b.quantity)?.name || b.symbol
            : b.symbol;
          return (
            <button
              key={symbol}
              aria-label={`Follow input ${symbol}`}
              aria-current={
                selection.columns.includes(b.column) ? "location" : undefined
              }
              onClick={() => follow(relation, { kind: "input", symbol })}
            >
              {symbol}
              {story?.inputs.find((i) => i.name === symbol) && (
                <small>
                  {story.inputs.find((i) => i.name === symbol)!.value}
                </small>
              )}
            </button>
          );
        })}
        <span>→</span>
        <button
          aria-label={`Follow calculation ${name}`}
          aria-current={
            selection.detail === "calculation" ? "location" : undefined
          }
          onClick={() => follow(relation, { kind: "calculation" })}
        >
          {name}
          {record && <b>{display(record.value)}</b>}
        </button>
        {!!objects.requirements.length && (
          <>
            <span>→</span>
            <button
              className={record?.pass === false ? "is-fail" : ""}
              aria-label={`Follow requirement ${name}`}
              aria-current={
                selection.detail === "requirement" ? "location" : undefined
              }
              onClick={() =>
                follow(relation, {
                  kind: "requirement",
                  requirement: objects.requirements[0],
                })
              }
            >
              {story?.checks[0]?.text || "Requirement"}
            </button>
          </>
        )}
      </div>
      {trace && (
        <div className="er-trace-legend">
          <span>⋯ source input</span>
          <span>─ computation</span>
          <span>╌ requirement</span>
        </div>
      )}
      <div className="er-relationship-actions">
        <button
          disabled={!canBack}
          aria-label="Back to previous location"
          title="Back · Alt+←"
          onClick={back}
        >
          <ArrowLeft size={13} />
        </button>
        <button
          aria-label="Trace relationship"
          aria-pressed={trace}
          onClick={toggleTrace}
        >
          <Waypoints size={13} />
          Trace
        </button>
        <button
          aria-label="Frame relationship"
          title="Fit the relationship in view without moving objects"
          onClick={focus}
        >
          <Scan size={13} />
          Frame relationship
        </button>
        {mode && (
          <button
            onClick={restore}
            aria-label="Restore canvas"
            title="Return to your previous view · Escape"
          >
            Return to canvas
          </button>
        )}
        {mode === "arrange" && (
          <span className="er-arrangement-state">Temporary arrangement</span>
        )}
        <details
          onClick={(e) => {
            if ((e.target as Element).closest("button"))
              e.currentTarget.open = false;
          }}
        >
          <summary aria-label="More relationship actions">
            <MoreHorizontal size={15} />
          </summary>
          <div>
            <button onClick={arrange}>Arrange relationship</button>
            {mode === "arrange" && (
              <button onClick={keep}>Keep arrangement</button>
            )}
            <b>Uses · {uses.length}</b>
            {uses.map((r) => (
              <button
                key={r.id}
                aria-label={`Follow use ${p.statements.get(r.output)?.name}`}
                onClick={() => follow(r, { kind: "calculation" })}
              >
                {p.statements.get(r.output)?.name} · calculated dataset
              </button>
            ))}
            {!!objects.assumptions.length && <b>Working assumptions</b>}
            {objects.assumptions.map((id) => (
              <button
                key={id}
                onClick={() =>
                  follow(relation, { kind: "assumption", object: id })
                }
              >
                {p.statements.get(id)?.name} ·{" "}
                {p.statements.get(id) &&
                p.solved.values.get(p.statements.get(id)!.name)
                  ? display(p.solved.values.get(p.statements.get(id)!.name)!)
                  : "Inspect definition"}
              </button>
            ))}
          </div>
        </details>
        <button
          aria-label="Clear relationship selection"
          className="er-relationship-clear"
          onClick={clear}
        >
          ×
        </button>
      </div>
    </aside>
  );
}
