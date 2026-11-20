import { useEffect, useState } from "react";
import { display } from "../../notebook/math";
import { worksheetInputUnit } from "../worksheetInputUnit";
import { ancestors, type Projection } from "../document";
import {
  boundedValue,
  type Exploration,
  type VariationRange,
} from "../exploration";
import { useAnchor } from "./Interactions";

const number = (value: number) => Number(value.toPrecision(7)).toString();

/** Temporary exploration controls; the accepted document remains untouched. */
export function ExplorationControls({
  proposal,
  accepted,
  current,
  range,
  anchor,
  change,
  changeRange,
  accept,
  keep,
  cancel,
}: {
  proposal: Exploration;
  accepted: Projection;
  current: Projection;
  range: VariationRange;
  anchor?: Element;
  change: (value: number) => void;
  changeRange: (range: VariationRange) => void;
  accept: () => void;
  keep: () => void;
  cancel: () => void;
}) {
  const name = accepted.statements.get(proposal.input)!.name;
  const original = accepted.solved.values.get(name)!;
  const unit = worksheetInputUnit(
    accepted.statements.get(proposal.input),
    original,
  );
  const shown = number(unit.fromBase(proposal.value));
  const [value, setValue] = useState(shown);
  const [limits, setLimits] = useState({
    low: number(unit.fromBase(range.low)),
    high: number(unit.fromBase(range.high)),
    step: number(range.step / unit.scale),
  });
  const [error, setError] = useState("");
  const [rangeError, setRangeError] = useState("");
  const at = useAnchor(anchor, proposal.input, 350, 410);
  useEffect(() => setValue(shown), [shown]);
  const affected = [...current.statements].filter(
    ([id]) =>
      id !== proposal.input && ancestors(current, id).includes(proposal.input),
  );
  const invalid =
    affected.some(([id]) => current.errors.has(id)) ||
    current.errors.has(proposal.input);
  const updateLimits = (key: keyof VariationRange, text: string) => {
    const next = { ...limits, [key]: text };
    setLimits(next);
    try {
      if (Object.values(next).some((v) => !v.trim()))
        throw Error("Complete the exploration range and step.");
      const range = {
        low: unit.toBase(Number(next.low)),
        high: unit.toBase(Number(next.high)),
        step: Number(next.step) * unit.scale,
      };
      const value = boundedValue(proposal.value, range);
      changeRange(range);
      if (value !== proposal.value) change(value);
      setRangeError("");
    } catch (e) {
      setRangeError((e as Error).message);
    }
  };
  const commitValue = () => {
    try {
      if (value === shown) {
        setError("");
        return;
      }
      if (!value.trim()) throw Error("Enter a finite value.");
      const next = boundedValue(unit.toBase(Number(value)), range);
      change(next);
      setValue(number(unit.fromBase(next)));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <aside
      className="er-exploration-controls"
      style={at}
      aria-label={`Explore ${name}`}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          e.preventDefault();
          cancel();
        }
      }}
    >
      <header>
        <strong>Explore {name}</strong>
        <span>Preview · baseline unchanged</span>
      </header>
      <div className="er-explore-value">
        <label>
          Value{" "}
          <input
            aria-label={`Exploration value ${name}`}
            type="number"
            step="any"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={commitValue}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitValue();
              }
            }}
          />
        </label>
        <span>{unit.label}</span>
        <small>was {unit.format(original.value)}</small>
      </div>
      <input
        aria-label={`Vary ${name}`}
        type="range"
        min={unit.fromBase(range.low)}
        max={unit.fromBase(range.high)}
        step="any"
        value={unit.fromBase(proposal.value)}
        aria-valuetext={unit.format(proposal.value)}
        onChange={(e) => change(unit.toBase(Number(e.target.value)))}
        onKeyDown={(e) => {
          if (
            ["ArrowLeft", "ArrowDown", "ArrowRight", "ArrowUp"].includes(e.key)
          ) {
            e.preventDefault();
            const direction = ["ArrowLeft", "ArrowDown"].includes(e.key)
              ? -1
              : 1;
            change(
              boundedValue(
                proposal.value +
                  direction * range.step * (e.shiftKey ? 0.1 : 1),
                range,
              ),
            );
          }
        }}
      />
      <div className="er-explore-range">
        {(
          [
            ["low", "Minimum"],
            ["high", "Maximum"],
            ["step", "Step"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              aria-label={`Exploration ${label.toLowerCase()}`}
              type="number"
              step="any"
              value={limits[key]}
              onChange={(e) => updateLimits(key, e.target.value)}
            />
          </label>
        ))}
      </div>
      <small>
        Exploration range in {unit.label || "dimensionless units"} · Shift for
        finer steps
      </small>
      <div className="er-explore-effects" aria-label="Exploration effects">
        {affected.length ? (
          affected.map(([id, statement]) => {
            const before = accepted.solved.values.get(statement.name);
            const after = current.solved.values.get(statement.name);
            const condition = current.solved.constraints.get(id);
            const previousCondition = accepted.solved.constraints.get(id);
            const bound =
              condition && after
                ? {
                    ...after,
                    value: Math.abs(condition.bound.value - after.value),
                    absolute: false,
                  }
                : undefined;
            return (
              <div key={id} data-effect-id={id}>
                <strong>
                  {statement.relation === "="
                    ? statement.name
                    : current.texts[id]}
                </strong>
                <span>
                  {current.errors.get(id) ||
                    (condition
                      ? `${previousCondition ? (previousCondition.pass ? "Pass" : "Fail") + " → " : ""}${condition.pass ? "Pass" : "Fail"}${bound ? ` · ${display(bound)} ${condition.pass ? "to limit" : "beyond limit"}` : ""}`
                      : `${before ? display(before) : "Unresolved"} → ${after ? display(after) : "Unresolved"}`)}
                </span>
              </div>
            );
          })
        ) : (
          <p>No downstream equations yet. This varies the assigned quantity.</p>
        )}
      </div>
      {(rangeError || error || invalid) && (
        <p role="status">
          {rangeError ||
            error ||
            "An affected calculation is undefined. Change the value or cancel."}
        </p>
      )}
      <footer>
        <button onClick={cancel}>Cancel</button>
        <button disabled={!!rangeError || !!error || invalid} onClick={keep}>
          Keep as alternative
        </button>
        <button
          className="er-accept"
          disabled={!!rangeError || !!error || invalid}
          onClick={accept}
        >
          Accept value
        </button>
      </footer>
    </aside>
  );
}
