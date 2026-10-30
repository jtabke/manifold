import { isDialogEvent } from "../interaction/modalInput";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent,
} from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronRight,
  GripVertical,
} from "lucide-react";
import {
  ModelAppearance,
  ModelGlyph,
  type AppearanceChange,
} from "./ModelAppearance";
import { display } from "../../notebook/math";
import { ModelExteriorPreview } from "./ModelExteriorPreview";
import {
  project,
  semanticKey,
  type Page,
  type Point,
  type ConnectionEdit,
} from "../document";
import {
  modelBoundary,
  modelContents,
  modelPath,
  type NestedModel,
  type ModelRepresentation,
} from "../models";
import { evaluateDataset } from "../datasetModel";
import { readCsv } from "../dataSources";
import { planConnection } from "../linking";
import "../styles/models.css";
import {
  engineeringValue,
  exteriorPorts,
  modelExterior,
  quantityTitle,
} from "../systemExploration";
import { ScrubNumber, type Scrub } from "./Interactions";
function useReviewKeyboard(close: () => void) {
  const dismiss = useRef(close);
  dismiss.current = close;
  const [previous] = useState(
    () => document.activeElement as HTMLElement | null,
  );
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (isDialogEvent(e)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        dismiss.current();
      }
      if (e.key === "Tab") {
        const items = [
          ...document.querySelectorAll<HTMLElement>(
            ".nm-review button:not([disabled]),.nm-review input:not([disabled]),.nm-review select,.nm-review summary",
          ),
        ];
        const first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      previous?.focus({ preventScroll: true });
    };
  }, [previous]);
}
export function modelLabel(page: Page, id: string) {
  const p = project(page),
    s = p.statements.get(id),
    r = page.regions.find((r) => r.id === id);
  return (
    (s?.anonymous ? p.texts[id] : s?.name) ||
    r?.data?.name ||
    page.models?.find((m) => m.id === id)?.name ||
    (page.dataRelations?.some((r) => r.id === id)
      ? "Derived dataset"
      : r?.text || id)
  );
}
export function modelValue(page: Page, id: string) {
  const p = project(page),
    s = p.statements.get(id),
    r = page.regions.find((r) => r.id === id);
  if (p.errors.has(id)) return "Unresolved";
  if (r?.data) return `${readCsv(r.data).rows.length} records`;
  const data = page.dataRelations?.find((r) => r.id === id);
  if (data) {
    try {
      return `${evaluateDataset(page, data).records.length} calculated records`;
    } catch {
      return "Blocked";
    }
  }
  const q = s && p.solved.values.get(s.name);
  return q ? display(q) : "Unresolved";
}
export function ModelReview({
  page,
  members,
  representations,
  existing,
  close,
  save,
}: {
  page: Page;
  members: string[];
  representations: ModelRepresentation[];
  existing?: NestedModel;
  close: () => void;
  save: (m: NestedModel) => void;
}) {
  useReviewKeyboard(close);
  const boundary = modelBoundary(page, members, representations),
    [name, setName] = useState(existing?.name || "New model"),
    [inputs, setInputs] = useState(existing?.inputs || boundary.inputs),
    [outputs, setOutputs] = useState(
      existing?.outputs ||
        (boundary.requiredOutputs.length
          ? boundary.requiredOutputs
          : boundary.outputs),
    ),
    [error, setError] = useState("");
  const initial = useState(
    () => semanticKey(page) + JSON.stringify(page.models),
  )[0];
  return (
    <div
      className="er-modal-shade"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <form
        className="nm-review"
        role="dialog"
        aria-modal="true"
        aria-label="Review model interface"
        onSubmit={(e) => {
          e.preventDefault();
          if (initial !== semanticKey(page) + JSON.stringify(page.models)) {
            setError("The work changed. Reopen the interface review.");
            return;
          }
          if (!name.trim()) {
            setError("Name this model.");
            return;
          }
          if (
            boundary.requiredInputs.some((id) => !inputs.includes(id)) ||
            boundary.requiredOutputs.some((id) => !outputs.includes(id))
          ) {
            setError("Keep existing crossing references exposed.");
            return;
          }
          try {
            save({
              id: existing?.id || `model-${crypto.randomUUID()}`,
              name: name.trim().slice(0, 80),
              members,
              inputs,
              outputs,
            });
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <header>
          <div>
            <small>
              {existing ? "MODEL INTERFACE" : "SELECTED WORK → MODEL"}
            </small>
            <h2>
              {existing
                ? "Review exposed quantities"
                : "Give this work a boundary"}
            </h2>
          </div>
          <button type="button" aria-label="Close model review" onClick={close}>
            ×
          </button>
        </header>
        <label className="nm-name">
          Model name
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
          />
        </label>
        <p>
          {members.length} objects · Definitions, references and internal
          positions stay intact.
        </p>
        <div className="nm-interface-review">
          {(["inputs", "outputs"] as const).map((kind) => (
            <fieldset key={kind}>
              <legend>{kind === "inputs" ? "Inputs" : "Outputs"}</legend>
              {boundary[kind].map((id) => {
                const required = (
                    kind === "inputs"
                      ? boundary.requiredInputs
                      : boundary.requiredOutputs
                  ).includes(id),
                  selected = kind === "inputs" ? inputs : outputs,
                  set = kind === "inputs" ? setInputs : setOutputs;
                return (
                  <label key={id}>
                    <input
                      type="checkbox"
                      checked={selected.includes(id) || required}
                      disabled={required}
                      onChange={(e) =>
                        set(
                          e.target.checked
                            ? [...selected, id]
                            : selected.filter((v) => v !== id),
                        )
                      }
                    />
                    <span>
                      {modelLabel(page, id)}
                      <small>
                        {modelValue(page, id)}
                        {required ? " · crosses boundary" : ""}
                      </small>
                    </span>
                  </label>
                );
              })}
              {!boundary[kind].length && <small>No {kind} to expose.</small>}
            </fieldset>
          ))}
        </div>
        {!!boundary.crossing.length && (
          <details className="nm-crossings">
            <summary>
              {boundary.crossing.length} existing references cross this boundary
            </summary>
            {boundary.crossing.map((e, i) => (
              <div key={i}>
                {modelLabel(page, e.source)} → {modelLabel(page, e.target)}
                <small>{e.kind}</small>
              </div>
            ))}
          </details>
        )}
        {error && <p role="alert">{error}</p>}
        <footer>
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button type="submit">
            {existing ? "Save interface" : "Create model"}
          </button>
        </footer>
      </form>
    </div>
  );
}
export function ModelObject({
  changeAppearance,
  page,
  model,
  at,
  level,
  override,
  selected,
  select,
  enter,
  inspect,
  openSource,
  connect,
  review,
  setLevel,
  move,
  math,
  highlight,
  system = false,
  related,
  scrub,
  followModel,
  tone,
}: {
  changeAppearance: AppearanceChange;
  page: Page;
  model: NestedModel;
  at: Point;
  level: string;
  override: string;
  selected: boolean;
  select: () => void;
  enter: () => void;
  inspect: (id: string) => void;
  openSource: (id: string) => void;
  connect: (id: string) => void;
  review: () => void;
  setLevel: (level: "auto" | "compact" | "interface" | "detail") => void;
  move: (e: PointerEvent) => void;
  math: (id: string) => ReactNode;
  highlight?: string;
  system?: boolean;
  related?: boolean;
  scrub?: (id: string) => Scrub | undefined;
  followModel?: (id: string) => void;
  tone?: "available" | "required" | "both" | "condition";
}) {
  const p = project(page),
    inside = modelContents(page, model.members),
    boundary = modelBoundary(page, model.members),
    needsReview =
      boundary.requiredInputs.some((id) => !model.inputs.includes(id)) ||
      boundary.requiredOutputs.some((id) => !model.outputs.includes(id)),
    blocked = modelExterior(page, model).computation === "incomplete",
    checks = [...p.solved.constraints].filter(
      ([id]) =>
        inside.has(id) ||
        Object.values(p.bindings[id] || {}).some((source) =>
          model.outputs.includes(source),
        ),
    ),
    failed = checks.some(([, c]) => !c.pass),
    result = model.presentation?.primaryOutput || model.outputs[0],
    status = needsReview
      ? "Interface changed"
      : blocked
        ? "Blocked"
        : modelExterior(page, model).computation === "current"
          ? "Evaluated"
          : "Defined · not evaluated";
  const exterior = modelExterior(page, model);
  const briefInputs = exteriorPorts(page, model, highlight).slice(
    0,
    system ? 3 : 2,
  );
  const destinations = [...new Set(exterior.feeds.map((f) => f.model))];
  const shortName = (name: string) => name.replace(/^\d+\s*·\s*/, "");
  return (
    <section
      className={`nm-object sx-shape-${model.presentation?.shape || "plain"} is-${level} ${system ? "is-system-exterior" : ""} ${tone ? `tone-${tone}` : ""} ${related === true ? "is-related" : related === false ? "is-unrelated" : ""} ${selected ? "is-selected" : ""}`}
      data-model-id={model.id}
      data-detail={level}
      data-exterior={model.presentation?.exterior?.kind || "interface"}
      data-causal-role={tone}
      aria-label={`Model ${model.name}`}
      style={{ left: at.x, top: at.y }}
      onClick={(e) => {
        e.stopPropagation();
        select();
      }}
      onDoubleClick={(e) => {
        if (!(e.target as Element).closest("button,select")) enter();
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <header>
        <button aria-label={`Move model ${model.name}`} onPointerDown={move}>
          <GripVertical size={15} />
        </button>
        <ModelGlyph model={model} />
        <h2>{system ? shortName(model.name) : model.name}</h2>
        <ModelAppearance page={page} model={model} change={changeAppearance} />
        <button aria-label={`Enter model ${model.name}`} onClick={enter}>
          <ArrowUpRight size={17} />
        </button>
      </header>
      <div className="nm-state">
        <span className={blocked || needsReview ? "is-blocked" : ""}>
          {status}
        </span>
        <small>{page.contexts.find((c) => c.id === page.active)?.label}</small>
      </div>
      {model.presentation?.exterior &&
      model.presentation.exterior.kind !== "interface" ? (
        <>
          <ModelExteriorPreview
            page={page}
            model={model}
            math={math}
            distant={level === "compact"}
            follow={openSource}
          />
          {selected && (
            <div className="nm-ports" aria-label="Exterior interface">
              {model.inputs.map((id) => (
                <button
                  key={id}
                  aria-label={`Inspect model input ${modelLabel(page, id)}`}
                  onClick={() => inspect(id)}
                >
                  <span>IN · {modelLabel(page, id)}</span>
                  <b>{modelValue(page, id)}</b>
                </button>
              ))}
              {model.outputs.map((id) => (
                <div key={id}>
                  <button
                    aria-label={`Inspect model output ${modelLabel(page, id)}`}
                    onClick={() => inspect(id)}
                  >
                    <span>OUT · {modelLabel(page, id)}</span>
                    <b>{modelValue(page, id)}</b>
                  </button>
                  <button
                    aria-label={`Connect model output ${modelLabel(page, id)}`}
                    onClick={() => connect(id)}
                  >
                    ↗
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      ) : level === "compact" ? (
        <div className="nm-behavior">
          {briefInputs.length > 0 && (
            <div className="nm-brief-inputs" aria-label="Model input summary">
              {briefInputs.map((id) => (
                <div
                  key={id}
                  data-quantity-id={id}
                  className={id === highlight ? "is-highlighted" : ""}
                >
                  <button
                    aria-label={`Inspect model input ${modelLabel(page, id)}`}
                    onClick={() => inspect(id)}
                  >
                    {quantityTitle(id, page)}
                  </button>
                  <ScrubNumber
                    name={`${scrub?.(id) ? "Vary" : "Inspect"} ${modelLabel(page, id)}`}
                    title={
                      scrub?.(id)
                        ? "Drag to vary · click for definition"
                        : "Inspect definition"
                    }
                    scrub={scrub?.(id)}
                    edit={() => inspect(id)}
                  >
                    {engineeringValue(page, id)}
                  </ScrubNumber>
                </div>
              ))}
            </div>
          )}
          <small className="nm-result-label">
            {result ? quantityTitle(result, page) : "Model"}
          </small>
          <button
            className="nm-key-result"
            data-quantity-id={result}
            aria-label={
              result
                ? `Inspect model output ${modelLabel(page, result)}`
                : "Enter model"
            }
            aria-pressed={!!result && result === highlight}
            onClick={() => (result ? inspect(result) : enter())}
          >
            {result
              ? engineeringValue(page, result)
              : `${model.members.length} objects`}
          </button>
          {destinations.length > 0 && (
            <div className="nm-feeds">
              <span>Feeds </span>
              {destinations.slice(0, 3).map((id, i) => (
                <span key={id}>
                  {i > 0 ? " · " : ""}
                  <button
                    onClick={() => {
                      if (followModel) followModel(id);
                      else
                        inspect(
                          exterior.feeds.find((f) => f.model === id)!.source,
                        );
                    }}
                  >
                    {shortName(page.models!.find((m) => m.id === id)!.name)}
                  </button>
                </span>
              ))}
            </div>
          )}
          {!!checks.length && (
            <div className={`nm-check ${failed ? "is-fail" : ""}`}>
              {failed ? "Check " : "Modeled checks pass"}
              {failed &&
                checks
                  .filter(([, c]) => !c.pass)
                  .map(([id]) => (
                    <button key={id} onClick={() => inspect(id)}>
                      {quantityTitle(
                        p.statements.get(id)?.name || "unresolved condition",
                        page,
                      )}
                    </button>
                  ))}
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="nm-ports">
            <small>INPUTS</small>
            {model.inputs.map((id) => (
              <button
                key={id}
                data-quantity-id={id}
                aria-pressed={id === highlight}
                aria-label={`Inspect model input ${modelLabel(page, id)}`}
                onClick={() => inspect(id)}
              >
                <span>◦ {modelLabel(page, id)}</span>
                <b>{modelValue(page, id)}</b>
              </button>
            ))}
          </div>
          <div className="nm-ports nm-outputs">
            <small>OUTPUTS</small>
            {model.outputs.map((id) => (
              <div key={id}>
                <button
                  aria-label={`Inspect model output ${modelLabel(page, id)}`}
                  data-quantity-id={id}
                  aria-pressed={id === highlight}
                  onClick={() => inspect(id)}
                >
                  <span>{modelLabel(page, id)}</span>
                  <b>{modelValue(page, id)}</b>
                </button>
                <button
                  aria-label={`Connect model output ${modelLabel(page, id)}`}
                  title="Connect to an exposed input"
                  onClick={() => connect(id)}
                >
                  ↗
                </button>
              </div>
            ))}
          </div>
          {level === "detail" && (
            <div
              className="nm-math-preview"
              aria-label="Model calculation preview"
            >
              {[...inside]
                .filter((id) => p.statements.has(id))
                .slice(0, 5)
                .map((id) => (
                  <div inert key={id}>
                    {math(id)}
                  </div>
                ))}
              <button onClick={enter}>
                Enter to work here <ChevronRight size={12} />
              </button>
            </div>
          )}
          {!!checks.length && (
            <div className={`nm-check ${failed ? "is-fail" : ""}`}>
              {checks.filter(([, c]) => c.pass).length}/{checks.length}{" "}
              conditions satisfied
            </div>
          )}
        </>
      )}
      <footer>
        {!system && (
          <select
            aria-label={`Detail for ${model.name}`}
            value={override}
            onChange={(e) => setLevel(e.target.value as "auto")}
          >
            <option value="auto">Auto detail</option>
            <option value="compact">Compact</option>
            <option value="interface">Interface</option>
            <option value="detail">Calculation detail</option>
          </select>
        )}
        <button onClick={review}>Edit ports</button>
        <button onClick={enter}>Enter model</button>
      </footer>
    </section>
  );
}
export function ModelBreadcrumb({
  name,
  path,
  back,
  canBack,
  go,
}: {
  name: string;
  path: NestedModel[];
  back: () => void;
  canBack: boolean;
  go: (id?: string) => void;
}) {
  return (
    <nav className="nm-breadcrumb" aria-label="Model hierarchy">
      <button
        aria-label="Back through models"
        disabled={!canBack}
        onClick={back}
      >
        <ArrowLeft size={14} />
      </button>
      <button onClick={() => go()}>{name || "Canvas"}</button>
      {path.map((m) => (
        <span key={m.id}>
          <ChevronRight size={13} />
          <button
            aria-current={m.id === path.at(-1)?.id ? "location" : undefined}
            onClick={() => go(m.id)}
          >
            {m.name}
          </button>
        </span>
      ))}
    </nav>
  );
}
export function ModelTrace({
  page,
  object,
  follow,
  close,
}: {
  page: Page;
  object: string;
  follow: (id: string) => void;
  close: () => void;
}) {
  const p = project(page),
    sources = [...new Set(Object.values(p.bindings[object] || {}))],
    uses = Object.entries(p.bindings)
      .filter(([, b]) => Object.values(b).includes(object))
      .map(([id]) => id);
  const item = (id: string) => (
    <button key={id} onClick={() => follow(id)}>
      {modelLabel(page, id)}
      <small>
        {modelPath(page, modelParentFor(page, id))
          .map((m) => m.name)
          .join(" / ") || "Canvas"}
      </small>
      <span>↗</span>
    </button>
  );
  return (
    <aside className="nm-trace" aria-label="Model quantity trace">
      <header>
        <b>
          {modelLabel(page, object)} · {modelValue(page, object)}
        </b>
        <button aria-label="Close model trace" onClick={close}>
          ×
        </button>
      </header>
      <button className="nm-definition" onClick={() => follow(object)}>
        Go to definition ↗
      </button>
      {!!sources.length && (
        <>
          <small>SOURCES</small>
          {sources.map(item)}
        </>
      )}
      {!!uses.length && (
        <>
          <small>USES & CONDITIONS</small>
          {uses.map(item)}
        </>
      )}
    </aside>
  );
}
const modelParentFor = (page: Page, id: string) =>
  page.models?.find((m) => m.members.includes(id))?.id;
export function ModelConnection({
  page,
  source,
  initialTarget,
  close,
  accept,
}: {
  page: Page;
  source: string;
  initialTarget?: string;
  close: () => void;
  accept: (edit: ConnectionEdit) => { ok: boolean; error?: string };
}) {
  useReviewKeyboard(close);
  const [target, setTarget] = useState(initialTarget || ""),
    [error, setError] = useState("");
  const candidates = (page.models || [])
    .filter((m) => m.id !== modelParentFor(page, source))
    .flatMap((m) =>
      m.inputs
        .filter((id) => modelContents(page, m.members).has(id) && id !== source)
        .map((id) => ({ id, model: m.name })),
    );
  let edit: ConnectionEdit | undefined,
    problem = "";
  try {
    if (target) edit = planConnection(page, source, target);
  } catch (e) {
    problem = (e as Error).message;
  }
  return (
    <div className="er-modal-shade">
      <form
        className="nm-review nm-connect"
        role="dialog"
        aria-modal="true"
        aria-label="Review model connection"
        onSubmit={(e) => {
          e.preventDefault();
          if (!edit) return;
          const result = accept(edit);
          if (result.ok) close();
          else setError(result.error || "Review the connection again.");
        }}
      >
        <header>
          <h2>Connect {modelLabel(page, source)}</h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close model connection"
          >
            ×
          </button>
        </header>
        <label>
          Exposed input
          <select
            autoFocus
            aria-label="Destination model input"
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
              setError("");
            }}
          >
            <option value="">Choose an input…</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.model} / {modelLabel(page, c.id)} · {modelValue(page, c.id)}
              </option>
            ))}
          </select>
        </label>
        {edit && (
          <>
            <p>{edit.label}</p>
            <div className="nm-binding-preview">
              {modelValue(page, source)} → {modelLabel(page, target)}
              <small>
                Computational binding · shared identity · unit checked
              </small>
            </div>
          </>
        )}
        {(error || problem) && <p role="alert">{error || problem}</p>}
        {!candidates.length && (
          <p>
            No other model exposes an internal input. Expose an assigned
            quantity through its Interface.
          </p>
        )}
        <footer>
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button type="submit" disabled={!edit}>
            Connect & recalculate
          </button>
        </footer>
      </form>
    </div>
  );
}
