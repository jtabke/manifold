import { lazy, Suspense, useEffect, useState } from "react";
import {
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  FilePenLine,
  Focus,
  LoaderCircle,
  Square,
} from "lucide-react";
import {
  assistantElapsed,
  assistantLiveLabel,
  assistantToolLabel,
  assistantToolOutcome,
} from "../assistantTimeline";
import type { AssistantProposal } from "../assistant";
import type {
  AssistantConnectionState,
  AssistantTurn,
} from "../app/useCanvasAssistant";
// Rich response dependencies are optional until the assistant actually answers.
const AssistantMessage = lazy(() =>
  import("./AssistantMessage").then((module) => ({
    default: module.AssistantMessage,
  })),
);

type ReviewInput = NonNullable<
  AssistantProposal["diff"]["models"][number]["before"]
>["inputs"][number];
function inputValue(input: ReviewInput | undefined): string {
  if (!input) return "(not present)";
  if (input.binding?.kind === "reference")
    return `Linked source ${input.binding.reference.item}`;
  const value =
    input.binding?.kind === "value" ? input.binding.value : input.defaultValue;
  return value == null
    ? "Not set"
    : `${value}${input.unit ? ` ${input.unit}` : ""}`;
}
function ProposalReview({
  proposal,
  busy,
  connection,
  resolve,
  reveal,
}: {
  proposal: AssistantProposal;
  busy: boolean;
  connection: AssistantConnectionState;
  resolve: (proposal: AssistantProposal, apply: boolean) => void;
  reveal: (id: string, input?: string) => Promise<boolean>;
}) {
  const [feedback, setFeedback] = useState("");
  const show = async (id: string) => {
    setFeedback("Locating object…");
    setFeedback(
      (await reveal(id))
        ? "Highlighted on the canvas. No changes were applied."
        : "This object is not currently visible. New content appears after approval; removed content may no longer be available.",
    );
  };
  const constraints = proposal.diff.regions.filter(
    ({ before, after }) =>
      (before?.constraint || after?.constraint) &&
      before?.constraint?.pass !== after?.constraint?.pass,
  );
  const constraintLabel = (
    region: NonNullable<
      AssistantProposal["diff"]["regions"][number]["before"]
    > | null,
  ) =>
    region?.constraint
      ? region.constraint.pass
        ? "Passes"
        : "Does not hold"
      : region
        ? "Not evaluated"
        : "Not present";
  const warnings = proposal.validation.issues.filter(
    (issue) => issue.kind !== "computation-not-current",
  );
  const nonCurrent = proposal.validation.issues.length - warnings.length;
  const canvasChanges = [
    ...proposal.diff.canvas.drawings.map((change) => ({
      ...change,
      kind: "Drawing",
    })),
    ...proposal.diff.canvas.plots.map((change) => ({
      ...change,
      kind: "Plot",
    })),
    ...proposal.diff.canvas.analyses.map((change) => ({
      ...change,
      kind: "Analysis",
    })),
    ...proposal.diff.canvas.objects.map((change) => ({
      ...change,
      kind: "Placement",
    })),
  ];
  return (
    <article className="assistant-proposal" aria-label="Proposed canvas edit">
      <h4>
        <FilePenLine size={15} aria-hidden="true" /> Proposed edit
        <span className={`assistant-proposal-status is-${proposal.status}`}>
          {
            {
              pending: "Not applied",
              applied: "Applied",
              dismissed: "Dismissed",
              stale: "Stale",
            }[proposal.status]
          }
        </span>
      </h4>
      <p className="assistant-proposal-explanation">{proposal.explanation}</p>
      <p className="assistant-proposal-counts">
        {[
          [
            proposal.diff.regions.length,
            "worksheet change",
            "worksheet changes",
          ],
          [proposal.diff.models.length, "affected model", "affected models"],
          [canvasChanges.length, "canvas change", "canvas changes"],
        ]
          .filter(([count]) => count)
          .map(([count, one, many]) => `${count} ${count === 1 ? one : many}`)
          .join(" · ") || "No semantic changes"}
      </p>
      {constraints.length > 0 && (
        <ul
          className="assistant-constraint-changes"
          aria-label="Constraint changes"
        >
          {constraints.map(({ id, before, after }) => (
            <li key={id}>
              <strong>
                {after?.text || before?.text || "Worksheet constraint"}
              </strong>
              <span>
                {constraintLabel(before)} → {constraintLabel(after)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {proposal.diff.models.map((change) => (
        <div key={change.id} className="assistant-model-diff">
          <div className="assistant-change-heading">
            <strong>{change.after?.label || change.before?.label}</strong>
            <button type="button" onClick={() => show(change.id)}>
              <Focus size={13} aria-hidden="true" /> Show model on canvas
            </button>
          </div>
          {[
            ...new Set([
              ...(change.before?.inputs || []).map((input) => input.id),
              ...(change.after?.inputs || []).map((input) => input.id),
            ]),
          ].map((id) => {
            const before = change.before?.inputs.find(
              (input) => input.id === id,
            );
            const after = change.after?.inputs.find((input) => input.id === id);
            if (
              before &&
              after &&
              JSON.stringify(before.binding) ===
                JSON.stringify(after.binding) &&
              before.defaultValue === after.defaultValue &&
              before.unit === after.unit &&
              before.label === after.label
            )
              return null;
            return (
              <p key={id} className="assistant-input-change">
                <strong>{after?.label || before?.label}:</strong>{" "}
                <del>{inputValue(before)}</del> → <ins>{inputValue(after)}</ins>
              </p>
            );
          })}
        </div>
      ))}
      <div className="assistant-validation" data-warning={warnings.length > 0}>
        {warnings.length ? (
          <CircleAlert size={14} aria-hidden="true" />
        ) : (
          <Check size={14} aria-hidden="true" />
        )}
        <div>
          <strong>
            {warnings.length
              ? `${warnings.length} validation ${warnings.length === 1 ? "issue" : "issues"}`
              : "No worksheet or input issues reported"}
          </strong>
          <span>
            {nonCurrent
              ? `${nonCurrent} ${nonCurrent === 1 ? "result is" : "results are"} not current · `
              : ""}
            No computation run. Physical validity not assessed.
          </span>
        </div>
      </div>
      <details className="assistant-review-details">
        <summary>Review changes and diagnostics</summary>
        {proposal.diff.regions.map((change) => (
          <div key={change.id} className="assistant-source-diff">
            <div className="assistant-change-heading">
              <strong>
                {change.before
                  ? change.after
                    ? "Revise source"
                    : "Remove source"
                  : "Add source"}
              </strong>
              <button type="button" onClick={() => show(change.id)}>
                Show source on canvas
              </button>
            </div>
            <details>
              <summary>View source diff</summary>
              <del aria-label="Before">
                {change.before?.text || "(new region)"}
              </del>
              <ins aria-label="After">{change.after?.text || "(removed)"}</ins>
            </details>
          </div>
        ))}
        {canvasChanges.length > 0 && (
          <div className="assistant-canvas-changes">
            {canvasChanges.map((change) => (
              <div
                key={`${change.kind}-${change.id}`}
                className="assistant-change-heading"
              >
                <span>
                  {change.kind} ·{" "}
                  {change.before
                    ? change.after
                      ? "changed"
                      : "removed"
                    : "added"}
                </span>
                <button
                  type="button"
                  onClick={() => show(change.id)}
                  aria-label={`Show ${change.kind.toLowerCase()} ${change.id} on canvas`}
                >
                  Show on canvas
                </button>
              </div>
            ))}
          </div>
        )}
        {(canvasChanges.length > 0 || proposal.diff.canvas.scene) && (
          <details>
            <summary>Review drawing, plot and layout changes</summary>
            <pre>{JSON.stringify(proposal.diff.canvas, null, 2)}</pre>
          </details>
        )}
        {proposal.validation.issues.length > 0 && (
          <ul
            className="assistant-diagnostic-list"
            aria-label="Validation findings"
          >
            {proposal.validation.issues.map((issue, index) => (
              <li key={`${issue.kind}:${issue.target}:${index}`}>
                {issue.message}
                {proposal.diff.regions.some(
                  (change) => change.id === issue.target,
                ) && (
                  <button type="button" onClick={() => show(issue.target)}>
                    Show on canvas
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <details>
          <summary>Raw changes and diagnostics</summary>
          <pre>
            {JSON.stringify(
              { changes: proposal.diff, validation: proposal.validation },
              null,
              2,
            )}
          </pre>
        </details>
      </details>
      {feedback && (
        <p role="status" className="assistant-privacy">
          {feedback}
        </p>
      )}
      <div className="assistant-proposal-actions">
        <button
          type="button"
          disabled={
            proposal.status !== "pending" || busy || connection !== "ready"
          }
          onClick={() => resolve(proposal, true)}
        >
          Apply edit
        </button>
        <button
          type="button"
          disabled={!["pending", "stale"].includes(proposal.status)}
          onClick={() => resolve(proposal, false)}
        >
          Dismiss
        </button>
      </div>
      {proposal.status === "stale" && (
        <p>Canvas changed. Ask the assistant for a refreshed proposal.</p>
      )}
    </article>
  );
}

function TurnActivity({
  turn,
  reveal,
}: {
  turn: AssistantTurn;
  reveal: (id: string, input?: string) => Promise<boolean>;
}) {
  const running = turn.endedAt === undefined;
  const [now, setNow] = useState(() => performance.now());
  const [referenceStatus, setReferenceStatus] = useState("");
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(performance.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  const failures = turn.tools.filter(
    ({ status }) => !["running", "complete", "stopped"].includes(status),
  ).length;
  const toolCount = turn.tools.length;
  const label = running
    ? assistantLiveLabel(turn.phase, turn.tools)
    : turn.phase === "stopped"
      ? "Stopped"
      : turn.phase === "failed"
        ? "Request failed"
        : turn.phase === "disconnected"
          ? "Disconnected"
          : toolCount
            ? `${toolCount} canvas ${toolCount === 1 ? "action" : "actions"}`
            : "Response complete";
  const Icon = running
    ? LoaderCircle
    : failures || turn.phase === "failed" || turn.phase === "disconnected"
      ? CircleAlert
      : turn.phase === "stopped"
        ? Square
        : Clock3;
  const summary = (
    <>
      <Icon
        size={15}
        className={running ? "assistant-live-icon" : undefined}
        aria-hidden="true"
      />
      <span role="status">
        {label}
        {failures
          ? ` · ${failures} ${failures === 1 ? "issue" : "issues"}`
          : ""}
      </span>
      <time aria-label="Elapsed time">
        {assistantElapsed(turn.startedAt, turn.endedAt ?? now)}
      </time>
      {toolCount > 0 && (
        <ChevronRight
          size={13}
          aria-hidden="true"
          className="assistant-activity-caret"
        />
      )}
    </>
  );
  if (!toolCount)
    return (
      <div className="assistant-turn-activity" data-phase={turn.phase}>
        {summary}
      </div>
    );
  return (
    <details className="assistant-turn-work" data-phase={turn.phase}>
      <summary
        className="assistant-turn-activity"
        aria-label={`Activity: ${label}${failures ? `, ${failures} issues` : ""}`}
      >
        {summary}
      </summary>
      <ol className="assistant-tool-list">
        {turn.tools.map((tool) => (
          <li key={tool.id} data-status={tool.status}>
            <div className="assistant-tool-row">
              <span>{assistantToolLabel(tool.name)}</span>
              <span>{assistantToolOutcome(tool.status)}</span>
            </div>
            {tool.note && <p>{tool.note}</p>}
            {tool.references?.length ? (
              <div className="assistant-tool-references">
                {tool.references.map((ref, index) => (
                  <button
                    type="button"
                    key={`${ref.href}:${index}`}
                    onClick={async () => {
                      setReferenceStatus(
                        (await reveal(ref.id, ref.input))
                          ? `Highlighted ${ref.label} on canvas.`
                          : "This object is no longer visible on the canvas.",
                      );
                    }}
                  >
                    <Focus size={12} aria-hidden="true" />
                    {ref.label.slice(0, 100)}
                  </button>
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ol>
      {referenceStatus && (
        <p role="status" className="assistant-reference-status">
          {referenceStatus}
        </p>
      )}
    </details>
  );
}

export function AssistantConversation({
  turns,
  proposals,
  busy,
  connection,
  resolve,
  reveal,
  editPrompt,
  hasDraft,
}: {
  turns: AssistantTurn[];
  proposals: AssistantProposal[];
  busy: boolean;
  connection: AssistantConnectionState;
  resolve: (proposal: AssistantProposal, apply: boolean) => void;
  reveal: (id: string, input?: string) => Promise<boolean>;
  editPrompt: (value: string) => void;
  hasDraft: boolean;
}) {
  if (!turns.length) return null;
  return (
    <div className="assistant-transcript" aria-label="Assistant conversation">
      {turns.map((turn) => {
        const reviews = proposals.filter(
          (proposal) => proposal.requestId === turn.id,
        );
        const interrupted = ["failed", "stopped", "disconnected"].includes(
          turn.phase,
        );
        return (
          <section
            key={turn.id}
            className="assistant-turn"
            aria-label="Chat turn"
          >
            <div className="assistant-user-message">
              <div className="assistant-user-meta">
                <strong>You</strong>
                <span>
                  {turn.selection.length
                    ? `${turn.selection.length} ${turn.selection.length === 1 ? "object" : "objects"} in focus`
                    : "Worksheet"}
                </span>
              </div>
              <p>{turn.prompt}</p>
            </div>
            <TurnActivity turn={turn} reveal={reveal} />
            {turn.answer ? (
              <Suspense
                fallback={<p className="assistant-answer">{turn.answer}</p>}
              >
                <AssistantMessage
                  text={turn.answer}
                  references={turn.references}
                  reveal={reveal}
                />
              </Suspense>
            ) : turn.phase === "complete" && !reviews.length ? (
              <p className="assistant-empty-response">
                The model finished without returning a written answer.
              </p>
            ) : null}
            {interrupted && (
              <div className="assistant-turn-notice" data-phase={turn.phase}>
                <p>
                  {turn.error ||
                    (turn.phase === "stopped"
                      ? "Request stopped. No edit was applied automatically."
                      : "The request didn’t finish.")}
                </p>
                <button
                  type="button"
                  disabled={hasDraft}
                  title={
                    hasDraft
                      ? "Your current draft is preserved"
                      : "Load the prompt into the composer without sending"
                  }
                  onClick={() => editPrompt(turn.prompt)}
                >
                  Edit and resend
                </button>
              </div>
            )}
            {reviews.map((proposal) => (
              <ProposalReview
                key={proposal.id}
                proposal={proposal}
                busy={busy}
                connection={connection}
                resolve={resolve}
                reveal={reveal}
              />
            ))}
            {turn.settings && (
              <small
                className="assistant-turn-settings"
                aria-label="Effective request settings"
              >
                {turn.settings.model} · Thinking {turn.settings.thinking} ·{" "}
                {turn.settings.permissions === "read-only"
                  ? "Read-only"
                  : "Review edits"}
              </small>
            )}
          </section>
        );
      })}
    </div>
  );
}
