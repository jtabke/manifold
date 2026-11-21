import { useEffect, useRef, useState, type Ref } from "react";
import type { RegionSession } from "../document";
import {
  defaultAxis,
  type designChoices,
  type DesignSpec,
  type DesignReview,
} from "../worksheetOptimization";

export function DesignFields({
  choices,
  spec,
  name,
  disabled,
  fixedAxes = false,
  change,
}: {
  choices: ReturnType<typeof designChoices>;
  spec: DesignSpec;
  name: string;
  disabled: boolean;
  fixedAxes?: boolean;
  change: (next: Partial<DesignSpec>) => void;
}) {
  const { inputs, requirements, reports } = choices;
  const unusedInput = inputs.find((a) => spec.axes.every((x) => x.id !== a.id));
  const automatic = new Set([
    spec.goal,
    ...spec.axes.map((a) => a.id),
    ...requirements
      .filter((r) => spec.requirements.includes(r.id))
      .map((r) => r.source),
  ]);
  const axisChange = (i: number, m: Partial<DesignSpec["axes"][number]>) => {
    const swap = m.id && spec.axes.findIndex((a) => a.id === m.id);
    change({
      axes:
        typeof swap === "number" && swap >= 0 && swap !== i
          ? spec.axes.map((a, j) =>
              j === i ? spec.axes[swap] : j === swap ? spec.axes[i] : a,
            )
          : spec.axes.map((a, j) => (j === i ? { ...a, ...m } : a)),
    });
  };
  return (
    <>
      <fieldset disabled={disabled}>
        <legend>Goal</legend>
        <label>
          <select
            aria-label="Optimization goal"
            value={spec.mode}
            onChange={(e) =>
              change({ mode: e.target.value as DesignSpec["mode"] })
            }
          >
            <option value="minimize">Minimize</option>
            <option value="maximize">Maximize</option>
          </select>{" "}
          <strong>{name}</strong>
        </label>
      </fieldset>
      <fieldset disabled={disabled}>
        <legend>Vary</legend>
        {spec.axes.map((a, i) => {
          const input = inputs.find((x) => x.id === a.id);
          return (
            <div className="design-axis" key={i}>
              <label>
                Input {i + 1}
                <select
                  aria-label={`Input ${i + 1}`}
                  value={a.id}
                  onChange={(e) =>
                    axisChange(
                      i,
                      defaultAxis(inputs.find((x) => x.id === e.target.value)!),
                    )
                  }
                >
                  {!input && <option value={a.id}>{a.id} (unresolved)</option>}
                  {inputs
                    .filter(
                      (x) =>
                        fixedAxes ||
                        x.id === a.id ||
                        !spec.axes.some((b) => b.id === x.id),
                    )
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                        {x.unit && ` (${x.unit})`}
                      </option>
                    ))}
                </select>
              </label>
              <div className="design-bounds">
                {(["low", "high"] as const).map((k) => (
                  <label key={k}>
                    {k === "low" ? "Minimum" : "Maximum"}
                    {input?.unit && ` (${input?.unit})`}
                    <input
                      aria-label={`${k === "low" ? "Minimum" : "Maximum"} for ${input?.name || a.id}`}
                      required
                      maxLength={100}
                      value={a[k]}
                      onChange={(e) => axisChange(i, { [k]: e.target.value })}
                    />
                  </label>
                ))}
              </div>
              {!fixedAxes && i > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    change({ axes: spec.axes.filter((_, j) => i !== j) })
                  }
                >
                  Remove second input
                </button>
              )}
            </div>
          );
        })}
        {!inputs.length && <p>No resolved literal inputs are available.</p>}
        {!fixedAxes && unusedInput && spec.axes.length < 2 && (
          <button
            type="button"
            onClick={() =>
              change({ axes: [...spec.axes, defaultAxis(unusedInput)] })
            }
          >
            Add second input
          </button>
        )}
        <small>
          Check the suggested bounds. Other assigned inputs stay fixed.
        </small>
      </fieldset>
      <fieldset disabled={disabled}>
        <legend>Subject to</legend>
        {requirements.length === 0 && (
          <small>
            No worksheet inequalities. Write one (for example, deflection ≤ 2
            mm) to enforce a limit.
          </small>
        )}
        {requirements.map((r) => (
          <label key={r.id}>
            <input
              type="checkbox"
              checked={spec.requirements.includes(r.id)}
              disabled={!!r.error && !spec.requirements.includes(r.id)}
              onChange={(e) =>
                change({
                  requirements: e.target.checked
                    ? [...spec.requirements, r.id]
                    : spec.requirements.filter((id) => id !== r.id),
                })
              }
            />
            {r.label}
            {r.error && ` — unavailable: ${r.error}`}
          </label>
        ))}
      </fieldset>
      <fieldset disabled={disabled}>
        <legend>Also report</legend>
        <label>
          <select
            aria-label="Add reported quantity"
            value=""
            onChange={(e) =>
              change({ reports: [...spec.reports, e.target.value] })
            }
          >
            <option value="" disabled>
              Add a quantity…
            </option>
            {reports
              .filter(
                (r) => !automatic.has(r.id) && !spec.reports.includes(r.id),
              )
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
          </select>
        </label>
        {spec.reports.map((id) => (
          <button
            type="button"
            key={id}
            aria-label={`Remove ${reports.find((r) => r.id === id)?.name} from report`}
            onClick={() =>
              change({ reports: spec.reports.filter((x) => x !== id) })
            }
          >
            {reports.find((r) => r.id === id)?.name} ×
          </button>
        ))}
        <small>Reported quantities do not change the goal.</small>
      </fieldset>
    </>
  );
}

export function DesignCandidate({
  review,
  adopt,
  heading,
}: {
  review: DesignReview;
  adopt: (alternative: boolean) => void;
  heading?: Ref<HTMLHeadingElement>;
}) {
  const goal = review.rows.find((row) => row.id === review.goal);
  const atBounds = review.rows.filter((row) => row.atBound);
  const atLimits = review.limits.filter((limit) => limit.active);
  return (
    <section className="design-result">
      <h3 ref={heading} tabIndex={-1}>
        Candidate preview
      </h3>
      <p>
        Bounded local search, not a global optimum. The worksheet is unchanged.
      </p>
      <table aria-label="Design comparison">
        <thead>
          <tr>
            <th>Quantity</th>
            <th>Current</th>
            <th>Proposed</th>
          </tr>
        </thead>
        <tbody>
          {review.rows.map((row) => (
            <tr key={row.id}>
              <th scope="row">{row.name}</th>
              <td>{row.current}</td>
              <td>
                {row.proposed}
                {row.atBound && <small>{row.atBound}</small>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {review.limits.length > 0 && (
        <>
          <h4>Requirement margins</h4>
          <small>
            Positive means room to spare; negative means the limit is exceeded.
          </small>
          <table aria-label="Requirement margins">
            <thead>
              <tr>
                <th>Requirement</th>
                <th>Current</th>
                <th>Proposed</th>
              </tr>
            </thead>
            <tbody>
              {review.limits.map((r) => (
                <tr key={r.id}>
                  <th scope="row">{r.label}</th>
                  <td>{r.current}</td>
                  <td title={r.checkedMargin}>
                    {r.proposed}
                    <small>{r.active ? "At limit" : "Pass"}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <div className="design-adopt">
        <section className="design-tradeoff" aria-label="Candidate trade-off">
          <h4>Candidate trade-off</h4>
          <ul>
            {goal && (
              <li>
                <strong>{goal.name}</strong>: {goal.current} →{" "}
                <strong>{goal.proposed}</strong>
              </li>
            )}
            {atBounds.map((row) => (
              <li key={row.id}>
                <strong>{row.name}</strong> {row.atBound?.toLowerCase()} ·{" "}
                {row.proposed}
              </li>
            ))}
            {atLimits.map((limit) => (
              <li key={limit.id}>
                <strong>
                  {limit.label.replaceAll("<=", "≤").replaceAll(">=", "≥")}
                </strong>{" "}
                · {limit.proposed} margin
              </li>
            ))}
            {review.limits.length > 0 && !atLimits.length && (
              <li>No selected requirement is at its limit.</li>
            )}
          </ul>
        </section>
        <button
          type="button"
          className="design-primary"
          onClick={() => adopt(false)}
        >
          Apply
        </button>
        <button type="button" onClick={() => adopt(true)}>
          Keep as alternative
        </button>
      </div>
    </section>
  );
}

export function useWorksheetDesignRun(
  session: RegionSession,
  notify: (message: string) => void,
) {
  const [capture, setCapture] = useState<{
    review: DesignReview;
    document: RegionSession["document"];
  }>();
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const job = useRef<
    ReturnType<RegionSession["optimizeWorksheet"]> | undefined
  >(undefined);
  useEffect(
    () => () => {
      job.current?.cancel();
      job.current = undefined;
    },
    [],
  );
  const review =
    capture?.document === session.document ? capture?.review : undefined;
  function clear() {
    job.current?.cancel();
    job.current = undefined;
    setRunning(false);
    setCapture(undefined);
    setError("");
  }
  async function run(spec: DesignSpec) {
    clear();
    try {
      const document = session.document;
      const task = session.optimizeWorksheet(spec);
      job.current = task;
      setRunning(true);
      const result = await task.completion;
      if (job.current !== task) return;
      job.current = undefined;
      setRunning(false);
      if (result.status !== "success")
        throw Error(result.reason.replace(/^Error: /, ""));
      setCapture({ review: result.value, document });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function adopt(alternative: boolean) {
    if (!review) return false;
    try {
      session.adoptWorksheetDesign(review, alternative);
      clear();
      notify(
        alternative
          ? "Kept the design as an alternative."
          : "Applied the reviewed design. Undo restores the previous inputs.",
      );
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }
  return {
    review,
    staleReview: !!capture && !review,
    error,
    setError,
    run,
    clear,
    adopt,
    running,
    cancel: () => job.current?.cancel(),
  };
}
