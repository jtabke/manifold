import { lazy, Suspense, useState } from "react";
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

function bindingLabel(binding: unknown): string {
  if (binding == null) return "default";
  if (
    typeof binding === "object" &&
    "value" in binding &&
    (typeof binding.value === "number" || typeof binding.value === "string")
  )
    return String(binding.value);
  return JSON.stringify(binding);
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
  reveal: (id: string) => Promise<boolean>;
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
        Proposed edit{" "}
        <span className={`assistant-proposal-status is-${proposal.status}`}>
          {proposal.status}
        </span>
      </h4>
      <p>{proposal.explanation}</p>
      <p className="assistant-privacy">
        {proposal.diff.regions.length} worksheet changes ·{" "}
        {proposal.diff.models.length} affected models · {canvasChanges.length}{" "}
        canvas changes
      </p>
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
          <del aria-label="Before">{change.before?.text || "(new region)"}</del>
          <ins aria-label="After">{change.after?.text || "(removed)"}</ins>
        </div>
      ))}
      {proposal.diff.models.map((change) => (
        <div key={change.id} className="assistant-model-diff">
          <div className="assistant-change-heading">
            <strong>{change.after?.label || change.before?.label}</strong>
            <button type="button" onClick={() => show(change.id)}>
              Show model on canvas
            </button>
          </div>
          {change.after?.inputs.map((input) => {
            const before = change.before?.inputs.find(
              (prior) => prior.id === input.id,
            );
            if (
              JSON.stringify(before?.binding) === JSON.stringify(input.binding)
            )
              return null;
            return (
              <p key={input.id}>
                {input.label} [{input.unit}]:{" "}
                <del>{bindingLabel(before?.binding)}</del> →{" "}
                <ins>{bindingLabel(input.binding)}</ins>
              </p>
            );
          })}
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
      {feedback && (
        <p role="status" className="assistant-privacy">
          {feedback}
        </p>
      )}
      {(canvasChanges.length > 0 || proposal.diff.canvas.scene) && (
        <details>
          <summary>Review drawing, plot and layout changes</summary>
          <pre>{JSON.stringify(proposal.diff.canvas, null, 2)}</pre>
        </details>
      )}
      <p className="assistant-validation">
        Validation:{" "}
        {proposal.validation.clean
          ? "clean"
          : `${proposal.validation.issues.length} issue(s)`}
        . Derived values are not checked computation evidence.
      </p>
      <details>
        <summary>Full changes and diagnostics</summary>
        <pre>
          {JSON.stringify(
            { changes: proposal.diff, validation: proposal.validation },
            null,
            2,
          )}
        </pre>
      </details>
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

export function AssistantConversation({
  turns,
  proposals,
  busy,
  connection,
  resolve,
  reveal,
}: {
  turns: AssistantTurn[];
  proposals: AssistantProposal[];
  busy: boolean;
  connection: AssistantConnectionState;
  resolve: (proposal: AssistantProposal, apply: boolean) => void;
  reveal: (id: string) => Promise<boolean>;
}) {
  if (!turns.length) return null;
  return (
    <div className="assistant-transcript" aria-label="Assistant conversation">
      {turns.map((turn, index) => (
        <section key={turn.id} className="assistant-turn">
          <div className="assistant-user-message">
            <h3>
              You{" "}
              <small>
                {turn.selection.length
                  ? `${turn.selection.length} selected object(s) attached`
                  : "Whole worksheet"}
              </small>
            </h3>
            <p>{turn.prompt}</p>
          </div>
          <h3>Assistant</h3>
          {turn.answer ? (
            <Suspense
              fallback={<p className="assistant-answer">{turn.answer}</p>}
            >
              <AssistantMessage text={turn.answer} />
            </Suspense>
          ) : (
            <p className="assistant-answer">
              {busy && index === turns.length - 1
                ? "Working on your request…"
                : proposals.some((proposal) => proposal.requestId === turn.id)
                  ? "See the proposed changes below."
                  : "No text response was returned."}
            </p>
          )}
          {proposals
            .filter((proposal) => proposal.requestId === turn.id)
            .map((proposal) => (
              <ProposalReview
                key={proposal.id}
                proposal={proposal}
                busy={busy}
                connection={connection}
                resolve={resolve}
                reveal={reveal}
              />
            ))}
        </section>
      ))}
    </div>
  );
}
