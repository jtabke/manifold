import type { DesignRange } from "../worksheetOptimization";

type Status = boolean | null;
const labels = { pass: "Passes", fail: "Fails", unknown: "Undefined" };
const kind = (s: Status) =>
  s === true ? "pass" : s === false ? "fail" : "unknown";

/** Discrete measurements: the marks must not imply continuity between samples. */
export function WorksheetFeasibility({ range }: { range: DesignRange }) {
  const { input, unit, points } = range;
  const value = (x: number) =>
    `${Number(x.toPrecision(7))}${unit ? ` ${unit}` : ""}`;
  function strip(
    label: string,
    read: (p: DesignRange["points"][number]) => Status,
    key: string,
  ) {
    const statuses = points.map(read),
      passed = statuses.filter((s) => s === true).length,
      unknown = statuses.filter((s) => s === null).length;
    const crossing = statuses.findIndex(
      (s, i) =>
        i > 0 &&
        s !== null &&
        statuses[i - 1] !== null &&
        s !== statuses[i - 1],
    );
    return (
      <li key={key}>
        <strong>{label}</strong>
        <svg
          aria-hidden="true"
          viewBox={`0 0 ${points.length * 4} 12`}
          preserveAspectRatio="none"
        >
          {statuses.map((s, i) => (
            <rect
              key={i}
              className={`sample-${kind(s)}`}
              x={i * 4}
              y={s === true ? 1 : s === false ? 6 : 4}
              width="3"
              height={s === true ? 10 : s === false ? 4 : 2}
            />
          ))}
        </svg>
        <small>
          {passed} of {points.length} samples pass
          {unknown ? ` · ${unknown} undefined` : ""}
          {crossing > 0
            ? ` · First pass/fail change between ${value(points[crossing - 1].x)} and ${value(points[crossing].x)}`
            : ""}
        </small>
      </li>
    );
  }
  return (
    <section className="design-feasibility" aria-label="Sampled feasibility">
      <h3 tabIndex={-1}>Sampled feasibility</h3>
      <p>
        {input}: {value(points[0].x)} to {value(points[points.length - 1].x)}.
        The scan checks {points.length} individual points, not the intervals
        between them.
      </p>
      <div className="design-sample-key">
        {Object.entries(labels).map(([id, label]) => (
          <span key={id}>
            <i className={`sample-${id}`} />
            {label}
          </span>
        ))}
      </div>
      <ul>
        {strip(
          range.labels.length ? "Feasible samples" : "Goal is defined",
          (p) => p.pass,
          "all",
        )}
        {range.labels.map((label, i) =>
          strip(label, (p) => p.checks[i], String(i)),
        )}
      </ul>
      <small>
        {range.labels.length
          ? "Undefined samples are not counted as passing. Unselected requirements are not checked."
          : "No requirements selected. The scan only checks where the goal is defined."}
      </small>
    </section>
  );
}
