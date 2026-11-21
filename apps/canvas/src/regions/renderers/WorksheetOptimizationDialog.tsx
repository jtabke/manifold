import { useEffect, useId, useRef, useState } from "react";
import { project, type RegionSession } from "../document";
import {
  designChoices,
  defaultAxis,
  type DesignSpec,
  type DesignReview,
  type DesignRange,
  type DesignResponseMap,
} from "../worksheetOptimization";
import type { EditBuffers } from "../app/workspaceFiles";
import { useEditBuffer } from "../app/useEditBuffer";
import { WorksheetFeasibility } from "./WorksheetFeasibility";
import {
  WorksheetResponseMaps,
  type MapInspection,
} from "./WorksheetResponseMaps";
import "../styles/worksheetOptimization.css";

function focusMaps(id: string) {
  const heading = document.getElementById(id);
  heading?.focus({ preventScroll: true });
  heading?.scrollIntoView({ block: "start" });
}

export function WorksheetOptimizationDialog({
  session,
  goal,
  buffers,
  close,
  notify,
}: {
  session: RegionSession;
  goal: string;
  buffers: EditBuffers;
  close: () => void;
  notify: (message: string) => void;
}) {
  const [opened] = useState(() => ({
    document: session.document,
    choices: designChoices(session.state, goal),
    name: project(session.state).statements.get(goal)!.name,
  }));
  const { inputs, requirements, reports } = opened.choices;
  const [spec, setSpec] = useState<DesignSpec>(() => ({
    goal,
    mode: "minimize",
    axes: inputs[0] ? [defaultAxis(inputs[0])] : [],
    requirements: requirements.filter((r) => !r.error).map((r) => r.id),
    reports: [],
  }));
  const [range, setRange] = useState<DesignRange>();
  const [map, setMap] = useState<DesignResponseMap>();
  const [inspection, setInspection] = useState<MapInspection>();
  const [review, setReview] = useState<DesignReview>(),
    [error, setError] = useState(""),
    [running, setRunning] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null),
    job = useRef<ReturnType<RegionSession["optimizeWorksheet"]> | undefined>(
      undefined,
    ),
    outcome = useRef<HTMLHeadingElement>(null),
    id = useId();
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null,
      node = dialog.current!;
    node.showModal();
    node.querySelector("select")?.focus();
    return () => {
      job.current?.cancel();
      job.current = undefined;
      node.close();
      if (prior?.isConnected) prior.focus();
    };
  }, []);
  useEffect(() => {
    if (review) {
      outcome.current?.focus({ preventScroll: true });
      if (dialog.current) dialog.current.scrollTop = 0;
    }
  }, [review]);
  useEffect(() => {
    if (range)
      dialog.current
        ?.querySelector<HTMLElement>(".design-feasibility h3")
        ?.focus();
  }, [range]);
  useEffect(() => {
    if (map) focusMaps(`${id}-maps`);
  }, [map, id]);
  useEditBuffer(buffers, id, {
    read: () => JSON.stringify(spec),
    finish: () => {
      setError("Close the design review before changing files.");
      return false;
    },
  });
  const stale = session.document !== opened.document;
  const change = (next: Partial<DesignSpec>) => {
    setRange(undefined);
    setMap(undefined);
    setInspection(undefined);
    setReview(undefined);
    setError("");
    setSpec({ ...spec, ...next });
  };
  const axisChange = (i: number, m: Partial<DesignSpec["axes"][number]>) =>
    change({ axes: spec.axes.map((a, j) => (j === i ? { ...a, ...m } : a)) });
  async function run() {
    setReview(undefined);
    setError("");
    try {
      if (stale) throw Error("Worksheet changed. Close and reopen Optimize.");
      const task = session.optimizeWorksheet(spec);
      job.current = task;
      setRunning(true);
      const result = await task.completion;
      if (job.current !== task) return;
      job.current = undefined;
      setRunning(false);
      if (result.status !== "success")
        throw Error(result.reason.replace(/^Error: /, ""));
      setReview(result.value);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function scan() {
    setError("");
    try {
      if (stale) throw Error("Worksheet changed. Close and reopen Optimize.");
      setRange(session.scanWorksheetDesign(spec));
    } catch (e) {
      setRange(undefined);
      setError((e as Error).message);
    }
  }
  function mapResponses(showCandidate = false) {
    setError("");
    try {
      if (stale) throw Error("Worksheet changed. Close and reopen Optimize.");
      if (showCandidate) setInspection("candidate");
      if (map) focusMaps(`${id}-maps`);
      else setMap(session.mapWorksheetDesign(spec));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function adopt(alternative: boolean) {
    if (!review) return;
    try {
      session.adoptWorksheetDesign(review, alternative);
      close();
      notify(
        alternative
          ? "Kept the design as an alternative."
          : "Applied the reviewed design. Undo restores the previous inputs.",
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const unusedInput = inputs.find((a) => spec.axes.every((x) => x.id !== a.id));
  const automatic = new Set([
    goal,
    ...spec.axes.map((a) => a.id),
    ...requirements
      .filter((r) => spec.requirements.includes(r.id))
      .map((r) => r.source),
  ]);
  return (
    <dialog
      ref={dialog}
      className={`worksheet-optimization${map && !stale ? " with-response-maps" : ""}`}
      aria-labelledby={id}
      onKeyDown={(e) => e.stopPropagation()}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <header>
        <h2 id={id}>Optimize {opened.name}</h2>
        <button type="button" onClick={close}>
          Close
        </button>
      </header>
      {review && !stale && (
        <section className="design-result">
          <h3 ref={outcome} tabIndex={-1}>
            Candidate preview
          </h3>
          <p>
            Bounded local search, not a global optimum. The worksheet is
            unchanged.
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
                Positive means room to spare; negative means the limit is
                exceeded.
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
            <button className="design-primary" onClick={() => adopt(false)}>
              Apply
            </button>
            <button onClick={() => adopt(true)}>Keep as alternative</button>
            {spec.axes.length === 2 && (
              <button type="button" onClick={() => mapResponses(true)}>
                Show on maps
              </button>
            )}
          </div>
        </section>
      )}
      {range && !stale && <WorksheetFeasibility range={range} />}
      {map && !stale && (
        <WorksheetResponseMaps
          map={map}
          review={review}
          heading={`${id}-maps`}
          selected={inspection}
          select={setInspection}
        />
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <fieldset disabled={running || stale}>
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
            <strong>{opened.name}</strong>
          </label>
        </fieldset>
        <fieldset disabled={running || stale}>
          <legend>Vary</legend>
          {spec.axes.map((a, i) => {
            const input = inputs.find((x) => x.id === a.id)!;
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
                        defaultAxis(
                          inputs.find((x) => x.id === e.target.value)!,
                        ),
                      )
                    }
                  >
                    {inputs
                      .filter(
                        (x) =>
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
                      {input.unit && ` (${input.unit})`}
                      <input
                        aria-label={`${k === "low" ? "Minimum" : "Maximum"} for ${input.name}`}
                        required
                        value={a[k]}
                        onChange={(e) => axisChange(i, { [k]: e.target.value })}
                      />
                    </label>
                  ))}
                </div>
                {i > 0 && (
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
          {unusedInput && spec.axes.length < 2 && (
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
        <fieldset disabled={running || stale}>
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
                disabled={!!r.error}
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
        <fieldset disabled={running || stale}>
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
        <button
          className="design-primary"
          type="submit"
          disabled={running || stale || !spec.axes.length}
        >
          Run
        </button>
        {spec.axes.length === 1 && (
          <button type="button" onClick={scan} disabled={running || stale}>
            Scan range
          </button>
        )}
        {spec.axes.length === 2 && (
          <button
            type="button"
            onClick={() => mapResponses()}
            disabled={running || stale}
          >
            Map responses
          </button>
        )}
        {running && (
          <>
            <span role="status">Searching…</span>
            <button type="button" onClick={() => job.current?.cancel()}>
              Cancel run
            </button>
          </>
        )}
      </form>
      {stale && (
        <p role="alert">Worksheet changed. Close and reopen Optimize.</p>
      )}
      {error && <p role="alert">{error}</p>}
    </dialog>
  );
}
