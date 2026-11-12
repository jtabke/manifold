import type { AssistantProposal } from "../assistant";
import type {
  AssistantConnectionState,
  AssistantTurn,
} from "../app/useCanvasAssistant";

export function AssistantConversation({
  turns,
  proposals,
  busy,
  connection,
  resolve,
}: {
  turns: AssistantTurn[];
  proposals: AssistantProposal[];
  busy: boolean;
  connection: AssistantConnectionState;
  resolve: (proposal: AssistantProposal, apply: boolean) => void;
}) {
  if (!turns.length) return null;
  return (
    <div className="assistant-transcript" aria-label="Assistant conversation">
      {turns.map((turn) => (
        <section key={turn.id} className="assistant-turn">
          <h3>
            You{" "}
            <small>
              {turn.selection.length
                ? `${turn.selection.length} selected object(s) attached`
                : "Whole worksheet"}
            </small>
          </h3>
          <p>{turn.prompt}</p>
          <h3>Assistant</h3>
          <p>{turn.answer || "…"}</p>
          {proposals
            .filter((proposal) => proposal.requestId === turn.id)
            .map((proposal) => (
              <article
                key={proposal.id}
                className="assistant-proposal"
                aria-label="Proposed canvas edit"
              >
                <h4>Proposed edit · {proposal.status}</h4>
                <p>{proposal.explanation}</p>
                <p>
                  {proposal.diff.regions.length} worksheet changes ·{" "}
                  {proposal.diff.models.length} affected models
                </p>
                {proposal.diff.regions.map((change) => (
                  <div key={change.id} className="assistant-source-diff">
                    <del>{change.before?.text || "(new region)"}</del>
                    <ins>{change.after?.text || "(removed)"}</ins>
                  </div>
                ))}
                {proposal.diff.models.map((change) => (
                  <div key={change.id}>
                    <strong>
                      {change.after?.label || change.before?.label}
                    </strong>
                    {change.after?.inputs.map((input) => {
                      const before = change.before?.inputs.find(
                        (prior) => prior.id === input.id,
                      );
                      return JSON.stringify(before?.binding) ===
                        JSON.stringify(input.binding) ? null : (
                        <p key={input.id}>
                          {input.label} [{input.unit}]:{" "}
                          {JSON.stringify(before?.binding ?? "default")} →{" "}
                          {JSON.stringify(input.binding ?? "default")}
                        </p>
                      );
                    })}
                  </div>
                ))}
                {(proposal.diff.canvas.objects.length > 0 ||
                  proposal.diff.canvas.drawings.length > 0 ||
                  proposal.diff.canvas.plots.length > 0 ||
                  proposal.diff.canvas.analyses.length > 0 ||
                  proposal.diff.canvas.scene) && (
                  <details>
                    <summary>Review drawing, plot and layout changes</summary>
                    <pre>{JSON.stringify(proposal.diff.canvas, null, 2)}</pre>
                  </details>
                )}
                <p>
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
                      {
                        changes: proposal.diff,
                        validation: proposal.validation,
                      },
                      null,
                      2,
                    )}
                  </pre>
                </details>
                <button
                  type="button"
                  disabled={
                    proposal.status !== "pending" ||
                    busy ||
                    connection !== "ready"
                  }
                  onClick={() => resolve(proposal, true)}
                >
                  Apply edit
                </button>{" "}
                <button
                  type="button"
                  disabled={!["pending", "stale"].includes(proposal.status)}
                  onClick={() => resolve(proposal, false)}
                >
                  Dismiss
                </button>
                {proposal.status === "stale" && (
                  <p>
                    Canvas changed. Ask the assistant for a refreshed proposal.
                  </p>
                )}
              </article>
            ))}
        </section>
      ))}
    </div>
  );
}
