import { useEffect, useId, useRef, useState } from "react";
import * as f from "@manifold/foundation";
import type { RegionSession, Point } from "../document";
import type { EditBuffers } from "../app/workspaceFiles";
import { useEditBuffer } from "../app/useEditBuffer";
import { inspectModel, modelReference } from "../modelCommands";
import { canvasSchemas } from "../app/canvasDocument";
import { optimizationSpec, type OptimizationSpec } from "../modelOptimization";
import {
  optimizationQuantity,
  optimizationConvert,
} from "../optimizationQuantities";
import {
  createModelOptimization,
  reviseModelOptimization,
} from "../modelOptimizationCommands";
const fmt = (n: number) => String(n);
type Field = "low" | "high" | "target" | "xTolerance" | "residualTolerance";
export function ModelOptimizationEditor({
  session,
  buffers,
  instance,
  item,
  initial,
  at,
  close,
}: {
  session: RegionSession;
  buffers: EditBuffers;
  instance: string;
  item?: string;
  initial?: OptimizationSpec;
  at: Point;
  close: () => void;
}) {
  const { definition } = inspectModel(session, instance);
  const missingInput = !!initial && !definition.inputs[initial.input];
  const missingOutput = !!initial && !definition.outputs[initial.output];
  const [spec, setSpec] = useState<OptimizationSpec>(() =>
    initial
      ? {
          ...initial,
          ...(missingInput
            ? {
                input: Object.keys(definition.inputs)[0]!,
                low: 0,
                high: 10,
                xTolerance: 1e-8,
              }
            : {}),
          ...(missingOutput
            ? {
                output: Object.keys(definition.outputs)[0]!,
                target: initial.mode === "target" ? 0 : null,
                residualTolerance: initial.mode === "target" ? 1e-8 : null,
              }
            : {}),
        }
      : {
          input: Object.keys(definition.inputs)[0]!,
          output: Object.keys(definition.outputs)[0]!,
          low: 0,
          high: 10,
          mode: "target",
          target: 0,
          xTolerance: 1e-8,
          residualTolerance: 1e-8,
        },
  );
  const projected = (selector: f.Json) =>
    f.project(
      session.document,
      modelReference(session.document, instance, selector),
      canvasSchemas,
      session.foundation.resources(),
    );
  const inp = definition.inputs[spec.input],
    inputNode = inp && definition.nodes[inp.node];
  const inputUnit = inputNode?.kind === "input" ? inputNode.unit : "1";
  const out = projected(f.modelPort(spec.output));
  const outputUnit =
    out.status === "resolved" && f.object(out.projection.value)
      ? String(out.projection.value.unit)
      : "1";
  const current = inp ? projected(f.modelNode([], inp.node)) : undefined;
  const initialDisplay = {
    ...(initial?.displayUnits || { input: inputUnit, output: outputUnit }),
  };
  if (missingInput) initialDisplay.input = inputUnit;
  if (missingOutput) initialDisplay.output = outputUnit;
  let resetDisplay: boolean = missingInput || missingOutput;
  for (const axis of ["input", "output"] as const) {
    const unit = axis === "input" ? inputUnit : outputUnit;
    try {
      optimizationConvert(1, unit, initialDisplay[axis]);
    } catch {
      initialDisplay[axis] = unit;
      resetDisplay = true;
    }
  }
  const [display, setDisplay] = useState(initialDisplay);
  const [unitText, setUnitText] = useState(display);
  const unitErrors: Partial<Record<"input" | "output", string>> = {};
  for (const axis of ["input", "output"] as const) {
    try {
      optimizationConvert(
        1,
        axis === "input" ? inputUnit : outputUnit,
        unitText[axis],
      );
    } catch {
      unitErrors[axis] =
        `Use a display unit compatible with ${axis === "input" ? inputUnit : outputUnit}.`;
    }
  }
  const values = (s: OptimizationSpec, d = display) =>
    Object.fromEntries(
      (
        ["low", "high", "target", "xTolerance", "residualTolerance"] as Field[]
      ).map((k) => [
        k,
        s[k] === null
          ? ""
          : fmt(
              optimizationConvert(
                s[k]!,
                k === "target" || k === "residualTolerance"
                  ? outputUnit
                  : inputUnit,
                k === "target" || k === "residualTolerance"
                  ? d.output
                  : d.input,
              ),
            ),
      ]),
    ) as Record<Field, string>;
  const [text, setText] = useState(() => values(spec));
  const [reviewed, setReviewed] = useState(!!initial && !resetDisplay),
    [error, setError] = useState(
      resetDisplay
        ? "Model ports or units changed. Affected settings were reset; review the selected ports, target and permitted range before saving."
        : "",
    );
  const [expected] = useState(session.document);
  const dialog = useRef<HTMLDialogElement>(null),
    id = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = dialog.current!;
    node.showModal();
    node.querySelector<HTMLSelectElement>("select")?.focus();
    return () => {
      node.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  useEditBuffer(buffers, id, {
    read: () => JSON.stringify({ spec, text, display, unitText, reviewed }),
    finish: () => {
      setError("Save or cancel optimization settings before changing files.");
      return false;
    },
  });
  const errors: Partial<Record<Field, string>> = {},
    converted = { ...spec, displayUnits: unitText };
  for (const key of [
    "low",
    "high",
    "xTolerance",
    ...(spec.mode === "target" ? ["target", "residualTolerance"] : []),
  ] as Field[]) {
    try {
      const output = key === "target" || key === "residualTolerance";
      converted[key] =
        text[key] === values(spec)[key]
          ? spec[key]!
          : optimizationConvert(
              optimizationQuantity(
                text[key],
                output ? display.output : display.input,
              ),
              output ? display.output : display.input,
              output ? outputUnit : inputUnit,
            );
    } catch (e) {
      errors[key] = (e as Error).message;
    }
  }
  if (converted.low >= converted.high)
    errors.high = "Upper bound must be greater than lower bound.";
  if (
    converted.xTolerance < 1e-12 ||
    converted.xTolerance > converted.high - converted.low
  )
    errors.xTolerance =
      "Use a positive numerical tolerance ≥1e-12 in model units and no larger than the range.";
  if (converted.residualTolerance !== null && converted.residualTolerance < 0)
    errors.residualTolerance = "Target tolerance cannot be negative.";
  const field = (key: Field, label: string) => (
    <label key={key}>
      {label}
      <input
        type="text"
        required
        aria-label={label}
        aria-invalid={!!errors[key]}
        aria-describedby={`${id}-${key}`}
        value={text[key]}
        onChange={(e) => {
          setText((t) => ({ ...t, [key]: e.target.value }));
          if (key === "low" || key === "high") setReviewed(true);
        }}
      />
      <small id={`${id}-${key}`}>
        {errors[key] ||
          `Will use ${fmt(converted[key] ?? 0)} ${key === "target" || key === "residualTolerance" ? outputUnit : inputUnit} in the model.`}
      </small>
    </label>
  );
  const switchUnit = (axis: "input" | "output", unit: string) => {
    try {
      optimizationConvert(1, axis === "input" ? inputUnit : outputUnit, unit);
      if (Object.keys(errors).length)
        throw Error("Correct quantity entries before changing display units.");
      const next = { ...display, [axis]: unit };
      setSpec(converted);
      setText(values(converted, next));
      setDisplay(next);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="im-editor optimization-editor"
      aria-labelledby={id}
      onKeyDown={(e) => e.stopPropagation()}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <header>
        <h2 id={id}>{item ? "Edit optimization" : "Optimize model"}</h2>
        <button onClick={close}>Cancel optimization editing</button>
      </header>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            f.assert(
              session.document === expected,
              "Model changed; cancel and reopen settings.",
            );
            f.assert(
              definition.inputs[converted.input] &&
                definition.outputs[converted.output],
              "Model public ports unavailable; cancel and expose an input and output before editing optimization settings.",
            );
            f.assert(reviewed, "Review the suggested range before saving.");
            f.assert(
              !Object.keys(errors).length && !Object.keys(unitErrors).length,
              "Correct the highlighted quantities or display units.",
            );
            optimizationSpec(converted);
            if (item)
              reviseModelOptimization(session, item, converted, expected);
            else createModelOptimization(session, instance, converted, at);
            close();
          } catch (e) {
            setError((e as Error).message);
            const invalid = dialog.current?.querySelector<HTMLInputElement>(
              '[aria-invalid="true"]',
            );
            const details = invalid?.closest("details");
            if (details) details.open = true;
            invalid?.focus();
          }
        }}
      >
        <label>
          I want to
          <select
            aria-label="Optimization goal"
            value={spec.mode}
            onChange={(e) => {
              const mode = e.target.value as OptimizationSpec["mode"];
              setSpec((s) => ({
                ...s,
                mode,
                target: mode === "target" ? 0 : null,
                residualTolerance: mode === "target" ? 1e-8 : null,
              }));
              if (mode === "target")
                setText((t) => ({
                  ...t,
                  target: "0",
                  residualTolerance: fmt(
                    optimizationConvert(1e-8, outputUnit, display.output),
                  ),
                }));
            }}
          >
            <option value="target">Reach a target value</option>
            <option value="minimize">Make an output smaller</option>
            <option value="maximize">Make an output larger</option>
          </select>
        </label>
        <label>
          Output
          <select
            aria-label="Optimization output"
            value={spec.output}
            onChange={(e) => {
              const projection = projected(f.modelPort(e.target.value));
              const unit =
                projection.status === "resolved" &&
                f.object(projection.projection.value)
                  ? String(projection.projection.value.unit)
                  : "1";
              setSpec((s) => ({
                ...s,
                output: e.target.value,
                target: s.mode === "target" ? 0 : null,
                residualTolerance: s.mode === "target" ? 1e-8 : null,
              }));
              setText((t) => ({
                ...t,
                target: "0",
                residualTolerance: "1e-8",
              }));
              setDisplay((d) => ({ ...d, output: unit }));
              setUnitText((d) => ({ ...d, output: unit }));
              setReviewed(false);
            }}
          >
            {Object.entries(definition.outputs).map(([port, p]) => (
              <option key={port} value={port}>
                {p.label} (
                {(() => {
                  const p = projected(f.modelPort(port));
                  return p.status === "resolved" && f.object(p.projection.value)
                    ? String(p.projection.value.unit)
                    : "units unavailable";
                })()}
                )
              </option>
            ))}
          </select>
        </label>
        <p>
          Output model units: {outputUnit}. Quantity literals such as 10 mm or 5
          cm are converted visibly below. Bare numbers use the displayed units.
        </p>
        {spec.mode === "target" && field("target", "Target output")}
        <label>
          One input to change
          <select
            aria-label="Optimization input"
            value={spec.input}
            onChange={(e) => {
              const node =
                definition.nodes[definition.inputs[e.target.value]!.node];
              const unit = node?.kind === "input" ? node.unit : "1";
              setSpec((s) => ({
                ...s,
                input: e.target.value,
                low: 0,
                high: 10,
                xTolerance: 1e-8,
              }));
              setText((t) => ({
                ...t,
                low: "0",
                high: "10",
                xTolerance: "1e-8",
              }));
              setDisplay((d) => ({ ...d, input: unit }));
              setUnitText((d) => ({ ...d, input: unit }));
              setReviewed(false);
            }}
          >
            {Object.entries(definition.inputs).map(([port, p]) => (
              <option key={port} value={port}>
                {p.label} (
                {definition.nodes[p.node]?.kind === "input"
                  ? (definition.nodes[p.node] as { unit: string }).unit
                  : "units unavailable"}
                )
              </option>
            ))}
          </select>
        </label>
        <p>
          Current {inp?.label || "input unavailable"}:{" "}
          {current?.status === "resolved" && f.object(current.projection.value)
            ? `${current.projection.value.value} ${current.projection.value.unit}`
            : "unavailable"}
          . All other effective inputs stay fixed.
        </p>
        <fieldset>
          <legend>Permitted range ({display.input})</legend>
          {field("low", "Lower bound")}
          {field("high", "Upper bound")}
          <label>
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            {reviewed
              ? "Range reviewed"
              : "Suggested—review before running; not an engineering safe range"}
          </label>
        </fieldset>
        <details>
          <summary>
            Advanced: units, numerical tolerances and work limits
          </summary>
          <label>
            Input display unit
            <input
              aria-label="Input display unit"
              value={unitText.input}
              onChange={(e) =>
                setUnitText((t) => ({ ...t, input: e.target.value }))
              }
              aria-invalid={!!unitErrors.input}
              aria-describedby={id + "-input-unit"}
              onBlur={(e) => switchUnit("input", e.target.value)}
            />
            <small id={id + "-input-unit"}>
              {unitErrors.input ||
                "Display only; physical settings stay fixed."}
            </small>
          </label>
          <label>
            Output display unit
            <input
              aria-label="Output display unit"
              value={unitText.output}
              onChange={(e) =>
                setUnitText((t) => ({ ...t, output: e.target.value }))
              }
              aria-invalid={!!unitErrors.output}
              aria-describedby={id + "-output-unit"}
              onBlur={(e) => switchUnit("output", e.target.value)}
            />
            <small id={id + "-output-unit"}>
              {unitErrors.output ||
                "Display only; checked receipts are not rewritten."}
            </small>
          </label>
          {field("xTolerance", "Input tolerance")}
          {spec.mode === "target" &&
            field("residualTolerance", "Residual tolerance")}
          <p>
            Numerical tolerances control search termination, not engineering
            acceptance or physical validity. Fixed work limits: 500 evaluations,
            200 iterations, 5 seconds. Reaching a limit does not confirm a
            candidate; a larger range or another run is not guaranteed to
            succeed.
          </p>
        </details>
        <p>
          One variable only:{" "}
          {spec.mode === "target"
            ? `reach ${text.target} ${display.output} on`
            : spec.mode === "minimize"
              ? "make smaller"
              : "make larger"}{" "}
          {definition.outputs[spec.output]?.label || "output unavailable"},
          changing only {inp?.label || "input unavailable"} between {text.low}{" "}
          and {text.high} {display.input}. No additional constraints.
        </p>
        <button type="submit">
          {item ? "Save optimization settings" : "Create optimization"}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
    </dialog>
  );
}
