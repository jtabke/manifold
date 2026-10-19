import { X, ArrowUpRight } from "lucide-react";
import { ancestors, project } from "./document";
import { modelParent } from "./models";
import {
  balanceInputs,
  engineeringValue,
  findBalance,
  quantityTitle,
} from "./systemExploration";
import { assessConstraint, systemAssessment } from "./systemAssessment";
import type { InvestigationProps } from "./SystemInvestigation";

/** A failed authored check is a navigation surface, not a separate study. */
export function SystemFailure(o: InvestigationProps & { failure: string }) {
  const p = project(o.page),
    assessment = systemAssessment(o.page),
    check = assessConstraint(o.page, o.failure);
  if (!check)
    return (
      <section
        className="sx-investigation sx-failure"
        style={{ left: o.at?.x, top: o.at?.y }}
        aria-label="Investigate failed check"
        role="status"
        data-failure={o.failure}
        data-context={o.page.active}
        data-evaluation={assessment.key}
        data-evaluation-state="blocked"
      >
        Check unavailable in this evaluation.{" "}
        <button onClick={() => o.follow(o.failure)}>Open definition</button>
        <button onClick={o.dismissInvestigation}>Close</button>
      </section>
    );
  const definition = check.definition,
    balance = definition ? findBalance(o.page, definition) : undefined;
  const inputs = balance
    ? balanceInputs(o.page, balance)
    : ancestors(p, o.failure).filter(
        (id) =>
          p.kinds[id] === "quantity" &&
          !o.page.regions.find((r) => r.id === id)?.interfaceHidden,
      );
  const preferred =
    o.page.models?.flatMap((m) =>
      m.presentation?.exploreInput ? [m.presentation.exploreInput] : [],
    ) || [];
  inputs.sort(
    (a, b) => Number(preferred.includes(b)) - Number(preferred.includes(a)),
  );
  const direct = definition
    ? Object.values(p.bindings[definition] || {}).filter(
        (id) => !o.page.regions.find((r) => r.id === id)?.interfaceHidden,
      )
    : [];
  // Expose adjacent model contributions through local intermediate definitions.
  // More distant causes remain behind Trace rather than filling this view.
  const owner = modelParent(o.page, o.failure);
  const sources = [
    ...new Set(
      direct.flatMap((id) =>
        modelParent(o.page, id) === owner
          ? Object.values(p.bindings[id] || {})
          : [id],
      ),
    ),
  ].filter((id) => !o.page.regions.find((r) => r.id === id)?.interfaceHidden);
  const models = [
    ...new Set(
      sources
        .map((id) => modelParent(o.page, id))
        .filter(
          (id): id is string => !!id && id !== modelParent(o.page, o.failure),
        ),
    ),
  ];
  const reference =
    o.compare && o.comparisonContext
      ? assessConstraint({ ...o.page, active: o.comparisonContext }, o.failure)
      : undefined;
  return (
    <section
      className="sx-investigation is-contextual is-context-tool sx-failure"
      style={{ left: o.at?.x, top: o.at?.y }}
      aria-label="Investigate failed check"
      data-failure={o.failure}
      data-source-model={o.sourceOwner}
      data-response={o.response}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (
          e.key === "Escape" &&
          !(e.target as Element).closest("input,textarea,select")
        ) {
          e.preventDefault();
          e.stopPropagation();
          o.dismissInvestigation();
        }
      }}
      data-context={o.page.active}
      data-evaluation={assessment.key}
      data-evaluation-state={o.preview ? "preview" : "current"}
    >
      <button
        className="sx-dismiss"
        aria-label="Close investigation"
        onClick={o.dismissInvestigation}
      >
        <X size={15} />
      </button>
      <small className="sx-evaluation-context">
        {assessment.label} · {o.preview ? "Preview" : "Current"}
        {check.provisional ? " · provisional limit" : ""}
      </small>
      <h2>{quantityTitle(o.failure, o.page)}</h2>
      <strong
        className={`sx-failure-headline ${check.condition.pass ? "is-pass" : ""}`}
      >
        {check.condition.pass ? "Check satisfied" : check.summary}
      </strong>
      <div className="sx-failure-values">
        <span>
          Calculated{" "}
          <b>
            {definition ? engineeringValue(o.page, definition) : "Unresolved"}
          </b>
        </span>
        <button onClick={() => o.follow(o.failure)}>
          Inspect limit <ArrowUpRight size={12} />
        </button>
      </div>
      {balance ? (
        <div className="sx-failure-balance" aria-label="Balance sources">
          <button onClick={() => o.follow(balance.positive)}>
            <span>{quantityTitle(balance.positive, o.page)}</span>
            <b>{engineeringValue(o.page, balance.positive)}</b>
            <ArrowUpRight size={13} />
          </button>
          <button onClick={() => o.follow(balance.negative)}>
            <span>{quantityTitle(balance.negative, o.page)}</span>
            <b>{engineeringValue(o.page, balance.negative)}</b>
            <ArrowUpRight size={13} />
          </button>
        </div>
      ) : (
        <div className="sx-failure-sources" aria-label="Governing inputs">
          {direct.slice(0, 5).map((id) => (
            <button key={id} onClick={() => o.follow(id)}>
              {quantityTitle(id, o.page)} <b>{engineeringValue(o.page, id)}</b>
              <ArrowUpRight size={12} />
            </button>
          ))}
        </div>
      )}
      <div className="sx-failure-actions">
        <button aria-pressed={o.tracePaths} onClick={o.toggleTrace}>
          Trace causes
        </button>
        <button aria-pressed={o.compare} onClick={o.toggleCompare}>
          Compare candidate
        </button>
        {definition && (
          <button onClick={() => o.follow(definition)}>
            Open calculation <ArrowUpRight size={12} />
          </button>
        )}
      </div>
      {!!models.length && (
        <div className="sx-failure-models" aria-label="Contributing models">
          {models.map((id) => (
            <button
              key={id}
              onClick={() =>
                o.follow(sources.find((r) => modelParent(o.page, r) === id)!)
              }
            >
              {o.page.models
                ?.find((m) => m.id === id)
                ?.name.replace(/^\d+\s*·\s*/, "")}{" "}
              <ArrowUpRight size={12} />
            </button>
          ))}
        </div>
      )}
      {!!inputs.length && (
        <details className="sx-failure-inputs">
          <summary>Explore assigned inputs</summary>
          {inputs.slice(0, 10).map((id) => (
            <button key={id} onClick={() => o.choose(id)}>
              {quantityTitle(id, o.page)} <b>{engineeringValue(o.page, id)}</b>
            </button>
          ))}
        </details>
      )}
      {reference && (
        <div className="sx-failure-reference" aria-label="Comparison check">
          <span>
            {o.page.contexts.find((c) => c.id === o.comparisonContext)?.label}
          </span>
          <b>
            {reference.definition
              ? engineeringValue(
                  { ...o.page, active: o.comparisonContext! },
                  reference.definition,
                )
              : "Unresolved"}
          </b>
          <span>
            {reference.condition.pass ? "Check satisfied" : reference.summary}
          </span>
        </div>
      )}
      <small className="sx-local-system-distinction">
        {assessment.blocked
          ? "System calculation blocked"
          : assessment.failures.length
            ? `${assessment.failures.length} system checks exceeded${assessment.provisional ? ` · ${assessment.provisional} provisional` : ""}`
            : "All authored system checks pass · screening only"}
      </small>
    </section>
  );
}
