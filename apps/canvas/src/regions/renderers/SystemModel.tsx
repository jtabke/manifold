import {
  ArrowUpRight,
  GripVertical,
  CircleCheck,
  TriangleAlert,
} from "lucide-react";
import type { PointerEvent, ReactNode } from "react";
import { project, type Page, type Point } from "../document";
import { modelBoundary, modelContents, type NestedModel } from "../models";
import {
  engineeringValue,
  exteriorPorts,
  modelExterior,
  quantityTitle,
  systemPortOutputs,
} from "../systemExploration";
import { type Scrub } from "./Interactions";
import {
  ModelAppearance,
  ModelGlyph,
  type AppearanceChange,
} from "./ModelAppearance";
import { evaluationKey } from "../systemAssessment";
import { SystemInput } from "./SystemInput";
import { ModelExteriorPreview } from "./ModelExteriorPreview";
export type BoundaryDrag = (
  e: PointerEvent<HTMLButtonElement>,
  source: string,
) => void;
export function SystemModel({
  page,
  model,
  at,
  selected,
  distant,
  close,
  input,
  tone,
  select,
  choose,
  enter,
  follow,
  connect,
  drag,
  scrub,
  move,
  coupled,
  response,
  write,
  responseExpanded,
  inspecting,
  changeAppearance,
  investigate,
  preview = false,
}: {
  investigate: (id: string) => void;
  preview?: boolean;
  changeAppearance: AppearanceChange;
  move: (e: PointerEvent<HTMLButtonElement>) => void;
  coupled?: boolean;
  inspecting?: boolean;
  response?: ReactNode;
  responseExpanded?: boolean;
  write: (id: string, value: string) => string | undefined;
  page: Page;
  model: NestedModel;
  at: Point;
  selected: boolean;
  distant: boolean;
  close: boolean;
  input?: string;
  tone?: string;
  select: () => void;
  choose: (id: string) => void;
  enter: () => void;
  follow: (id: string) => void;
  connect: (source: string) => void;
  drag: BoundaryDrag;
  scrub: (id: string) => Scrub | undefined;
}) {
  const p = project(page),
    exterior = modelExterior(page, model);
  const result = model.presentation?.primaryOutput || model.outputs[0];
  const failed = exterior.checks.filter(([, c]) => !c.pass),
    blocked = exterior.computation === "incomplete";
  const boundary = modelBoundary(page, model.members),
    needsReview =
      boundary.requiredInputs.some((id) => !model.inputs.includes(id)) ||
      boundary.requiredOutputs.some((id) => !model.outputs.includes(id));
  const detail = (selected && !inspecting) || !!response,
    inputs = exteriorPorts(page, model, input);
  const outputPorts = systemPortOutputs(page, model);
  const outputs =
    detail || close ? outputPorts.slice(0, 4) : outputPorts.slice(0, 1);
  const title = (id: string) => quantityTitle(id, page);
  const inspect = (id: string) =>
    p.kinds[id] === "quantity" ? choose(id) : follow(id);
  return (
    <section
      className={`sx-model sx-shape-${model.presentation?.shape || "plain"} ${detail ? "is-open" : ""} ${tone ? `tone-${tone}` : ""} ${selected ? "is-selected" : ""} ${response && responseExpanded ? "has-expanded-response" : ""} ${response ? "has-response" : ""}`}
      data-model-id={model.id}
      data-exterior={model.presentation?.exterior?.kind || "interface"}
      data-causal-role={tone}
      data-context={page.active}
      data-evaluation={evaluationKey(page)}
      data-evaluation-state={
        preview ? "preview" : blocked ? "blocked" : "current"
      }
      data-detail={
        inspecting
          ? "inspect"
          : detail
            ? "selected"
            : distant
              ? "silhouette"
              : close
                ? "interfaces"
                : "overview"
      }
      aria-label={`Model ${model.name}`}
      style={{ left: at.x, top: at.y }}
      onClick={(e) => {
        e.stopPropagation();
        select();
      }}
      onDoubleClick={(e) => {
        if (!(e.target as Element).closest("button,[role=button]")) enter();
      }}
    >
      <header>
        <button
          className="sx-move-model"
          aria-label={`Move system model ${model.name}`}
          onPointerDown={move}
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical size={15} />
        </button>
        <ModelGlyph model={model} />
        <button
          className="sx-model-title"
          onDoubleClick={(e) => {
            e.stopPropagation();
            enter();
          }}
          onClick={(e) => {
            e.stopPropagation();
            select();
          }}
        >
          {model.name.replace(/^\d+\s*·\s*/, "")}
        </button>
        <ModelAppearance page={page} model={model} change={changeAppearance} />
        <button
          className="sx-enter"
          aria-label={`Enter model ${model.name}`}
          onClick={(e) => {
            e.stopPropagation();
            enter();
          }}
        >
          <ArrowUpRight size={18} />
        </button>
      </header>
      <div className="sx-model-role">
        {model.presentation?.description || "Model"}
      </div>
      {model.presentation?.exterior &&
      model.presentation.exterior.kind !== "interface" ? (
        <ModelExteriorPreview
          page={page}
          model={model}
          follow={follow}
          distant={distant}
        />
      ) : (
        result && (
          <button
            className="sx-model-output"
            aria-label={`Inspect model output ${p.statements.get(result)?.name}`}
            data-result-value={
              p.solved.values.get(p.statements.get(result)?.name || "")?.value
            }
            onClick={(e) => {
              e.stopPropagation();
              const check = failed.find(
                ([id]) =>
                  p.statements.get(id)?.name === p.statements.get(result)?.name,
              );
              if (check) investigate(check[0]);
              else follow(result);
            }}
          >
            <span>
              {detail && <small className="sx-direction">OUT </small>}
              {title(result)}
            </span>
            <b>{engineeringValue(page, result)}</b>
          </button>
        )
      )}
      <div
        className="sx-model-state"
        aria-label="Model computation"
        data-computation={exterior.computation}
      >
        <span>
          {preview
            ? "Preview"
            : blocked
              ? "Unresolved inputs or definitions"
              : exterior.computation === "current"
                ? "Evaluated"
                : "Defined · not evaluated"}
        </span>
        {needsReview && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              select();
            }}
          >
            Review interface
          </button>
        )}
      </div>
      {!!exterior.checks.length && (
        <div
          className={`sx-model-state nm-check ${failed.length ? "is-fail" : ""}`}
          aria-label="Local model status"
        >
          {failed.length ? (
            <TriangleAlert size={13} />
          ) : (
            <CircleCheck size={13} />
          )}
          <button
            className="sx-local-status"
            onClick={(e) => {
              e.stopPropagation();
              if (failed[0]) investigate(failed[0][0]);
              else select();
            }}
          >
            {failed.length
              ? `${failed.length} local ${failed.length === 1 ? "check" : "checks"} exceeded`
              : "Local checks pass"}
          </button>
          {detail &&
            failed.map(([id]) => (
              <button
                key={id}
                onClick={(e) => {
                  e.stopPropagation();
                  investigate(id);
                }}
              >
                {title(id)}
              </button>
            ))}
        </div>
      )}
      <div
        className="sx-boundary sx-boundary-in"
        aria-label={`${model.name} input ports`}
      >
        {inputs.slice(0, detail || close ? 3 : 1).map((id) => (
          <button
            key={id}
            data-system-input={
              modelContents(page, model.members).has(id) ? id : undefined
            }
            className={id === input ? "is-active" : ""}
            aria-label={`Select input ${title(id)} in ${model.name}`}
            title={`Input · ${title(id)} · ${engineeringValue(page, id)}`}
            onClick={(e) => {
              e.stopPropagation();
              inspect(id);
            }}
          >
            <i />
            {close && !detail ? <span>{title(id)}</span> : null}
          </button>
        ))}
      </div>
      <div
        className="sx-boundary sx-boundary-out"
        aria-label={`${model.name} output ports`}
      >
        {outputs.slice(0, detail || close ? 4 : 1).map((id) => (
          <button
            key={id}
            aria-label={`Connect output ${title(id)} (${p.statements.get(id)?.name}) from ${model.name}`}
            title={`Output · ${title(id)} · ${engineeringValue(page, id)} · ${p.statements.get(id)?.name}`}
            onPointerDown={(e) => drag(e, id)}
            onClick={(e) => {
              e.stopPropagation();
              if (e.detail === 0) connect(id);
            }}
          >
            <i />
          </button>
        ))}
      </div>
      {distant && !detail && (
        <button
          className="sx-interface-summary"
          onClick={(e) => {
            e.stopPropagation();
            select();
          }}
        >
          {model.inputs.length} in · {outputPorts.length} out
        </button>
      )}
      {detail && (
        <div className="sx-model-details">
          <div className="nm-brief-inputs" aria-label="Model input summary">
            <small className="sx-direction">INPUTS</small>
            {inputs
              .filter((id) => !response || responseExpanded || id === input)
              .map((id) => (
                <div key={id} className={id === input ? "is-highlighted" : ""}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      inspect(id);
                    }}
                  >
                    {title(id)}
                  </button>
                  {p.kinds[id] === "quantity" ? (
                    <SystemInput
                      key={`${id}:${page.active}`}
                      page={page}
                      id={id}
                      scrub={scrub(id)}
                      write={write}
                    />
                  ) : (
                    <button
                      aria-label={`Inspect ${p.statements.get(id)?.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        follow(id);
                      }}
                    >
                      {engineeringValue(page, id)}
                    </button>
                  )}
                </div>
              ))}
          </div>
          {response}
          {outputs
            .filter((id) => title(id) !== title(result || ""))
            .slice(0, 1)
            .map((id) => (
              <button
                key={id}
                className="sx-secondary-output"
                onClick={(e) => {
                  e.stopPropagation();
                  follow(id);
                }}
              >
                <span>
                  <small className="sx-direction">OUT </small>
                  {title(id)}
                </span>
                <b>{engineeringValue(page, id)}</b>
              </button>
            ))}
          {coupled && (
            <small
              className="sx-coupled"
              title="Different quantities participate in reciprocal model dependencies. This does not provide an inverse solve."
            >
              Reciprocal dependencies
            </small>
          )}
          <div className="sx-assumptions" aria-label="Model assumptions">
            {model.members
              .filter(
                (id) => p.kinds[id] === "quantity" && !inputs.includes(id),
              )
              .slice(0, 2)
              .map((id) => (
                <button
                  key={id}
                  onClick={(e) => {
                    e.stopPropagation();
                    follow(id);
                  }}
                >
                  {title(id)} · {engineeringValue(page, id)}
                </button>
              ))}
          </div>
          <button
            className="sx-enter-equations"
            onClick={(e) => {
              e.stopPropagation();
              enter();
            }}
          >
            Enter equations <ArrowUpRight size={13} />
          </button>
        </div>
      )}
      {model.presentation?.exploreInput === input &&
        !detail &&
        !distant &&
        inputs.includes(input || "") && (
          <button
            className="sx-investigate-input"
            onClick={(e) => {
              e.stopPropagation();
              choose(input!);
            }}
          >
            {title(input!)} <ArrowUpRight size={13} />
          </button>
        )}
    </section>
  );
}
