import { isDialogEvent } from "../interaction/modalInput";
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  X,
  GripVertical,
  Maximize2,
  Minimize2,
  Unplug,
} from "lucide-react";
import { ancestors, project, type Page, type Point } from "../document";
import { display, relationGlyph } from "../../notebook/math";
import { type Scrub } from "./Interactions";
import {
  balanceInputs,
  causalNeighborhood,
  definitionPaths,
  engineeringValue,
  findBalance,
  quantityTitle,
  sampleBalance,
} from "../systemExploration";
import { SystemInput } from "./SystemInput";
import { SystemFailure } from "./SystemFailure";
import { evaluationKey } from "../systemAssessment";
export type InvestigationView =
  | "contextual"
  | "compact"
  | "expanded"
  | "detached"
  | "internal";
export type InvestigationPath = "available" | "required" | "margin";
export type InvestigationProps = {
  page: Page;
  failure?: string;
  preview?: boolean;
  input?: string;
  output?: string;
  sourceOwner?: string;
  response: InvestigationView;
  setResponse: (view: InvestigationView) => void;
  at?: Point;
  move?: (e: PointerEvent<HTMLButtonElement>) => void;
  pathFocus?: InvestigationPath;
  selectPath: (path?: InvestigationPath) => void;
  choose: (id: string) => void;
  follow: (id: string) => void;
  enterSource: () => void;
  write: (id: string, value: string) => string | undefined;
  branch: () => void;
  compare: boolean;
  toggleCompare: () => void;
  comparisonContext?: string;
  scrub: (id: string) => Scrub | undefined;
  tracePaths: boolean;
  toggleTrace: () => void;
  dismissInvestigation: () => void;
};
/** A contextual presentation over existing quantities and evaluation. Never a model member. */
export function SystemInvestigation({
  page,
  input,
  output,
  sourceOwner,
  response,
  setResponse,
  at,
  move,
  pathFocus,
  selectPath,
  choose,
  follow,
  enterSource,
  write,
  branch,
  compare,
  toggleCompare,
  comparisonContext,
  scrub,
  tracePaths,
  toggleTrace,
  dismissInvestigation,
  failure,
  preview = false,
}: InvestigationProps) {
  const [varying, setVarying] = useState(true);
  const light = ["contextual", "detached", "internal"].includes(response);
  const p = useMemo(() => project(page), [page]);
  const balance = useMemo(
    () => (output ? findBalance(page, output) : undefined),
    [page, output],
  );
  const candidates = balance
    ? balanceInputs(page, balance)
    : page.regions.filter((r) => p.kinds[r.id] === "quantity").map((r) => r.id);
  const trace = useMemo(
    () => (input ? causalNeighborhood(page, input) : undefined),
    [page, input],
  );
  const current = input && p.statements.get(input),
    quantity = current && p.solved.values.get(current.name);
  const title = (id: string) => quantityTitle(id, page);
  const effects = useMemo(() => {
    if (!balance || !input || !quantity) return [];
    const delta = Math.abs(quantity.value) * 0.01 || 0.01;
    const values = sampleBalance(
      page,
      balance,
      input,
      quantity.value,
      quantity.value + delta,
    );
    const first = values[0],
      last = values.at(-1);
    return (
      [
        ["Available", first?.positive, last?.positive],
        ["Required", first?.negative, last?.negative],
      ] as const
    ).map(([name, a, b]) => ({
      name,
      direction:
        a === undefined || b === undefined
          ? "Unresolved"
          : Math.abs(b - a) < 1e-8
            ? "Unchanged"
            : b > a
              ? "Increases"
              : "Decreases",
      delta: a === undefined || b === undefined ? undefined : b - a,
    }));
  }, [page, input, output]);
  const failedLimits = [...p.solved.constraints].filter(([, c]) => !c.pass);
  if (failure)
    return (
      <SystemFailure
        {...{
          page,
          input,
          output,
          sourceOwner,
          response,
          setResponse,
          at,
          move,
          pathFocus,
          selectPath,
          choose,
          follow,
          enterSource,
          write,
          branch,
          compare,
          toggleCompare,
          comparisonContext,
          scrub,
          tracePaths,
          toggleTrace,
          dismissInvestigation,
          preview,
          failure,
        }}
      />
    );
  return (
    <section
      className={`sx-investigation is-${response} ${light ? "is-context-tool" : ""} ${varying ? "is-varying" : ""}`}
      style={
        response === "detached" || response === "contextual"
          ? { left: at?.x, top: at?.y }
          : undefined
      }
      data-source-model={sourceOwner}
      data-response={response}
      data-context={page.active}
      data-evaluation={evaluationKey(page)}
      data-evaluation-state={
        preview
          ? "preview"
          : (output && p.errors.has(output)) || (input && p.errors.has(input))
            ? "blocked"
            : "current"
      }
      data-input-value={quantity ? quantity.value : undefined}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (
          response === "contextual" &&
          e.key === "Escape" &&
          !(e.target as Element).closest("input,textarea,select,.er-number")
        ) {
          e.preventDefault();
          e.stopPropagation();
          dismissInvestigation();
        }
      }}
      aria-label="Investigate a connected input"
    >
      <small className="sx-evaluation-context">
        {page.contexts.find((c) => c.id === page.active)?.label} ·{" "}
        {preview ? "Preview" : "Current"}
      </small>
      <button
        className="sx-dismiss"
        aria-label="Close investigation"
        title="Close investigation"
        onClick={dismissInvestigation}
      >
        <X size={15} />
      </button>
      <div className="sx-response-actions">
        {response === "detached" && (
          <button aria-label="Move investigation" onPointerDown={move}>
            <GripVertical size={14} />
          </button>
        )}
        {!light && (
          <button
            title={
              response === "compact" ? "Expand response" : "Collapse response"
            }
            aria-label={
              response === "compact" ? "Expand response" : "Collapse response"
            }
            onClick={() =>
              setResponse(response === "compact" ? "expanded" : "compact")
            }
          >
            {response === "compact" ? (
              <Maximize2 size={13} />
            ) : (
              <Minimize2 size={13} />
            )}
          </button>
        )}
        {!light && (
          <button
            title={
              response === "detached"
                ? "Return response to model"
                : "Detach response onto canvas"
            }
            aria-label={
              response === "detached"
                ? "Return response to model"
                : "Detach response"
            }
            onClick={() =>
              setResponse(response === "detached" ? "expanded" : "detached")
            }
          >
            <Unplug size={13} />
          </button>
        )}
      </div>
      {light ? (
        <header className="sx-tool-heading">
          <h2>{input ? title(input) : "Select input"}</h2>
          {input && quantity && (
            <SystemInput
              key={`${input}:${page.active}`}
              page={page}
              id={input}
              scrub={scrub(input)}
              write={write}
              name={`Vary system ${current!.name}`}
            />
          )}
        </header>
      ) : (
        <header>
          <div>
            <small>ONE INPUT · CONNECTED CONSEQUENCES</small>
            <h2>
              {response === "detached" && input
                ? title(input)
                : "Energy response"}
            </h2>
          </div>
          <select
            aria-label="Explore system input"
            value={input || ""}
            onChange={(e) => choose(e.target.value)}
          >
            {!input && <option value="">Choose input</option>}
            {candidates.map((id) => (
              <option key={id} value={id}>
                {title(id)}
              </option>
            ))}
          </select>
        </header>
      )}
      {light && (
        <div className="sx-quantity-palette" aria-label="Quantity actions">
          <button aria-pressed={varying} onClick={() => setVarying(!varying)}>
            Vary
          </button>
          <button aria-pressed={tracePaths} onClick={toggleTrace}>
            Trace
          </button>
          <button
            aria-pressed={compare}
            onClick={() => {
              setVarying(true);
              toggleCompare();
            }}
          >
            Compare
          </button>
          {input && (
            <button onClick={() => follow(input)}>
              Open definition <ArrowUpRight size={12} />
            </button>
          )}
        </div>
      )}
      {!light && response === "detached" && input && quantity && (
        <div className="sx-input-value">
          <SystemInput
            key={`${input}:${page.active}`}
            page={page}
            id={input}
            scrub={scrub(input)}
            write={write}
            name={`Vary system ${current!.name}`}
          />
          <button onClick={() => follow(input)}>
            Definition <ArrowUpRight size={13} />
          </button>
        </div>
      )}
      {output && !balance && (
        <div className="sx-balance-unavailable" role="status">
          Balance unavailable{" "}
          <button onClick={() => follow(output)}>
            Inspect definition <ArrowUpRight size={13} />
          </button>
        </div>
      )}
      {balance && input && ancestors(p, balance.output).includes(input) ? (
        <>
          <div
            className="sx-local-effects sx-response-detail"
            aria-label="Local effects of increasing input"
          >
            <small>
              {quantity && quantity.value > 0 ? "+1%" : "Small increase"}{" "}
              {input && title(input)} · other assumptions fixed
            </small>
            {effects.map((effect) => (
              <span key={effect.name} data-effect={effect.name}>
                <b>{effect.direction}</b> {effect.name.toLowerCase()} energy{" "}
                {effect.delta !== undefined &&
                  `(${effect.delta >= 0 ? "+" : ""}${Number(effect.delta.toPrecision(3))} ${balance.unit})`}
              </span>
            ))}
          </div>
          <div className="sx-competing-paths">
            {[
              { id: balance.positive, label: "Available" },
              { id: balance.negative, label: "Required" },
            ].map((branch) => {
              return (
                <div
                  key={branch.id}
                  className={
                    branch.label === "Available"
                      ? "sx-available"
                      : "sx-required"
                  }
                >
                  <span>{branch.label}</span>
                  <b>{engineeringValue(page, branch.id)}</b>

                  <button
                    className="sx-follow"
                    onClick={() => follow(branch.id)}
                  >
                    Inspect calculation <ArrowUpRight size={13} />
                  </button>
                </div>
              );
            })}
            <div className="sx-margin">
              <span>{title(balance.output)}</span>
              <b>{engineeringValue(page, balance.output)}</b>
              <button onClick={() => follow(balance.output)}>
                Inspect balance <ArrowUpRight size={13} />
              </button>
            </div>
          </div>
          <BalanceCurve
            preview={preview}
            focus={pathFocus}
            select={selectPath}
            page={page}
            input={input}
            balance={balance}
            scrub={scrub(input)}
            compareContext={compare ? comparisonContext : undefined}
          />
          <button
            className="sx-path-toggle sx-response-detail"
            aria-expanded={tracePaths}
            onClick={toggleTrace}
          >
            {tracePaths
              ? "Hide definition paths"
              : "Trace authored definitions"}
          </button>
          {tracePaths && response !== "compact" && (
            <div
              className="sx-definition-paths"
              aria-label="Authored causal paths"
            >
              {[balance.positive, balance.negative]
                .flatMap((target) => definitionPaths(page, input, target))
                .map((path, index) => (
                  <div key={index}>
                    {path.map((id, i) => (
                      <span key={id}>
                        {i > 0 && <ArrowRight size={12} />}
                        <button onClick={() => follow(id)}>{title(id)}</button>
                      </span>
                    ))}
                  </div>
                ))}
            </div>
          )}
        </>
      ) : (
        input && (
          <div className="sx-uses">
            <p>Follow a consequence</p>
            {[...(trace?.downstream || [])]
              .filter((id) => p.kinds[id] === "equation")
              .slice(0, 6)
              .map((id) => (
                <button key={id} onClick={() => follow(id)}>
                  {title(id)} <b>{engineeringValue(page, id)}</b>
                </button>
              ))}
          </div>
        )
      )}
      <div className="sx-system-consequences" aria-label="System consequences">
        {[...new Set((page.models || []).flatMap((m) => m.outputs))]
          .filter(
            (id) =>
              trace?.downstream.has(id) &&
              p.kinds[id] === "equation" &&
              !page.regions.find((r) => r.id === id)?.interfaceHidden,
          )
          .slice(0, 4)
          .map((id) => (
            <button key={id} onClick={() => follow(id)}>
              {title(id)} <b>{engineeringValue(page, id)}</b>
            </button>
          ))}
      </div>
      <div
        className={`sx-system-limits ${failedLimits.length ? "is-fail" : ""}`}
        aria-label="System limit status"
      >
        {failedLimits.length ? (
          <>
            <strong>
              {failedLimits.length} modeled{" "}
              {failedLimits.length === 1 ? "limit" : "limits"} exceeded
            </strong>
            {(light ? [] : failedLimits).map(([id, condition]) => (
              <button key={id} onClick={() => follow(id)}>
                {title(id)} ·{" "}
                {p.solved.values.has(condition.statement.name)
                  ? display(p.solved.values.get(condition.statement.name)!)
                  : "Unresolved"}{" "}
                · limit {relationGlyph(p.statements.get(id)!.relation)}{" "}
                {display(condition.bound)}
              </button>
            ))}
          </>
        ) : (
          <span>
            {p.errors.size
              ? "Calculations unresolved"
              : "Authored limits pass · screening only"}
          </span>
        )}
      </div>
      <div className="sx-view-choice">
        <select
          aria-label="Investigation presentation"
          value={response === "expanded" ? "compact" : response}
          onChange={(e) =>
            e.target.value === "internal"
              ? enterSource()
              : setResponse(e.target.value as InvestigationView)
          }
        >
          <option value="contextual">Contextual</option>
          <option value="compact">Inline</option>
          <option value="internal">Inside model</option>
          {response === "detached" && (
            <option value="detached">On canvas</option>
          )}
        </select>
        {light && response !== "internal" && (
          <button
            onClick={() =>
              setResponse(response === "detached" ? "contextual" : "detached")
            }
          >
            {response === "detached" ? "Return to context" : "Keep on canvas"}
          </button>
        )}
      </div>
      <div className="sx-response-footer">
        <button onClick={branch}>Try alternative</button>
        {input && (
          <button onClick={() => follow(input)}>
            Definition <ArrowUpRight size={12} />
          </button>
        )}
      </div>
      <p className="sx-scope sx-response-detail">
        Curves show this balance only. Other modeled conditions and physical
        validity remain separate.
      </p>
    </section>
  );
}
function BalanceCurve({
  page,
  input,
  balance,
  scrub,
  compareContext,
  focus,
  select,
  preview = false,
}: {
  preview?: boolean;
  page: Page;
  input: string;
  compareContext?: string;
  focus?: InvestigationPath;
  select: (path?: InvestigationPath) => void;
  balance: NonNullable<ReturnType<typeof findBalance>>;
  scrub?: Scrub;
}) {
  const p = project(page),
    s = p.statements.get(input)!,
    q = p.solved.values.get(s.name)!;
  const existing = page.plots.find((plot) => plot.input === input),
    delta = Math.abs(q.value) * 0.65 || 1,
    low = existing?.low ?? q.value - delta,
    high = existing?.high ?? q.value + delta;
  const points = useMemo(
    () => sampleBalance(page, balance, input, low, high),
    [page, balance.output, input, low, high],
  );
  const reference = useMemo(
    () =>
      compareContext && compareContext !== page.active
        ? sampleBalance(
            { ...page, active: compareContext },
            balance,
            input,
            low,
            high,
          )
        : [],
    [page, compareContext, balance.output, input, low, high],
  );
  const margin = focus === "margin";
  const rangePoints = [...points, ...reference];
  const shownValues = (pt: (typeof points)[number]) =>
    margin
      ? pt.positive !== undefined && pt.negative !== undefined
        ? [pt.positive - pt.negative]
        : []
      : [pt.positive, pt.negative].filter((v): v is number => v !== undefined);
  const min = Math.min(0, ...rangePoints.flatMap((pt) => shownValues(pt))),
    max = Math.max(1, ...rangePoints.flatMap(shownValues));
  const left = 65,
    right = 540,
    top = 30,
    bottom = 190,
    x = (n: number) => left + ((n - low) / (high - low || 1)) * (right - left),
    y = (n: number) => bottom - ((n - min) / (max - min || 1)) * (bottom - top);
  const path = (field: "positive" | "negative" | "margin", series = points) => {
    let open = false;
    return series
      .map((pt) => {
        const value =
          field === "margin"
            ? pt.positive !== undefined && pt.negative !== undefined
              ? pt.positive - pt.negative
              : undefined
            : pt[field];
        if (value === undefined) {
          open = false;
          return "";
        }
        const segment = `${open ? "L" : "M"}${x(pt.x)},${y(value)}`;
        open = true;
        return segment;
      })
      .join(" ");
  };
  const svg = useRef<SVGSVGElement>(null),
    drag = useRef<
      | {
          id: number;
          x: number;
          start: number;
          moved: boolean;
          branch?: InvestigationPath;
        }
      | undefined
    >(undefined);
  const latestScrub = useRef(scrub);
  latestScrub.current = scrub;
  useEffect(() => {
    const cancel = () => {
      const current = drag.current;
      if (!current) return;
      drag.current = undefined;
      if (svg.current?.hasPointerCapture(current.id))
        svg.current.releasePointerCapture(current.id);
      latestScrub.current?.revert();
    };
    const key = (e: KeyboardEvent) => {
      if (isDialogEvent(e)) return;
      if (e.key === "Escape" && drag.current) {
        e.stopPropagation();
        e.preventDefault();
        cancel();
      }
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", cancel);
      cancel();
    };
  }, []);
  const change = (event: PointerEvent<SVGSVGElement>) => {
    const r = svg.current!.getBoundingClientRect();
    const n = Math.max(
      low,
      Math.min(
        high,
        low +
          ((((event.clientX - r.left) / r.width) * 560 - left) /
            (right - left)) *
            (high - low),
      ),
    );
    scrub?.explore(n, event.currentTarget);
  };
  return (
    <div
      className={`sx-balance-curve ${margin ? "is-margin" : ""}`}
      data-path-focus={focus}
      data-context={page.active}
      data-evaluation={evaluationKey(page)}
      data-evaluation-state={preview ? "preview" : "current"}
      data-input-id={input}
      data-input-value={q.value}
    >
      <div className="sx-curve-legend">
        <button
          aria-label="Trace available energy"
          aria-pressed={focus === "available"}
          onClick={() =>
            select(focus === "available" ? undefined : "available")
          }
        >
          Available <b>{engineeringValue(page, balance.positive)}</b>
        </button>
        <button
          aria-label="Trace required energy"
          aria-pressed={focus === "required"}
          onClick={() => select(focus === "required" ? undefined : "required")}
        >
          Required <b>{engineeringValue(page, balance.negative)}</b>
        </button>
        <button
          aria-label="Inspect energy margin"
          aria-pressed={margin}
          onClick={() => select(margin ? undefined : "margin")}
        >
          Margin
        </button>
        <small>
          {balance.unit}
          {reference.length
            ? ` · dashed: ${page.contexts.find((c) => c.id === compareContext)?.label}`
            : ""}
        </small>
      </div>
      <svg
        ref={svg}
        viewBox="0 0 560 245"
        aria-label={
          margin
            ? "Energy margin response"
            : "Available and required energy response"
        }
        role="img"
        onPointerDown={(e) => {
          if (!scrub || e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = {
            id: e.pointerId,
            x: e.clientX,
            start: q.value,
            moved: false,
            branch: (e.target as Element).closest<SVGElement>(
              "[data-curve-branch]",
            )?.dataset.curveBranch as InvestigationPath | undefined,
          };
        }}
        onPointerMove={(e) => {
          if (drag.current && Math.abs(e.clientX - drag.current.x) > 3) {
            drag.current.moved = true;
            change(e);
          }
        }}
        onPointerUp={(e) => {
          if (!drag.current) return;
          const { moved, branch } = drag.current;
          drag.current = undefined;
          e.currentTarget.releasePointerCapture(e.pointerId);
          if (moved) scrub?.finish();
          else if (branch) select(branch === focus ? undefined : branch);
        }}
        onPointerCancel={() => {
          drag.current = undefined;
          scrub?.revert();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && drag.current) {
            drag.current = undefined;
            scrub?.revert();
          }
        }}
        tabIndex={0}
      >
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line
              x1={left}
              x2={right}
              y1={y(min + (max - min) * t)}
              y2={y(min + (max - min) * t)}
              className="sx-grid"
            />
            <text
              data-axis="output"
              x={left - 10}
              y={y(min + (max - min) * t) + 4}
              textAnchor="end"
            >
              {Math.round(min + (max - min) * t)}
              {t === 0 && balance.unit ? ` ${balance.unit}` : ""}
            </text>
          </g>
        ))}
        {!margin &&
          points.slice(0, -1).map((a, i) => {
            const b = points[i + 1];
            if (
              a.positive === undefined ||
              a.negative === undefined ||
              b.positive === undefined ||
              b.negative === undefined
            )
              return null;
            return (
              <path
                key={i}
                d={`M${x(a.x)},${y(a.positive)} L${x(b.x)},${y(b.positive)} L${x(b.x)},${y(b.negative)} L${x(a.x)},${y(a.negative)} Z`}
                className={
                  a.positive >= a.negative
                    ? "sx-balance-surplus"
                    : "sx-balance-shortfall"
                }
              />
            );
          })}
        {!!reference.length && !margin && (
          <g aria-label="Reference scenario">
            <path
              d={path("positive", reference)}
              className="sx-reference-positive"
            />
            <path
              d={path("negative", reference)}
              className="sx-reference-negative"
            />
          </g>
        )}
        {margin && (
          <line
            className="sx-margin-zero"
            x1={left}
            x2={right}
            y1={y(0)}
            y2={y(0)}
          />
        )}
        {(margin
          ? (["margin"] as const)
          : (["positive", "negative"] as const)
        ).map((field) => {
          const branch: InvestigationPath =
            field === "positive"
              ? "available"
              : field === "negative"
                ? "required"
                : "margin";
          return (
            <g
              key={field}
              className={focus && focus !== branch ? "sx-curve-muted" : ""}
            >
              <path
                d={path(field)}
                className={`sx-${field === "positive" ? "positive" : field === "negative" ? "negative" : "margin"}-line`}
              />
              <path
                d={path(field)}
                className="sx-curve-hit"
                data-curve-branch={branch}
                role="button"
                aria-label={`Select ${branch} energy curve`}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    select(focus === branch ? undefined : branch);
                  }
                }}
              />
            </g>
          );
        })}
        {margin && !!reference.length && (
          <g aria-label="Reference scenario">
            <path
              d={path("margin", reference)}
              className="sx-reference-positive"
            />
          </g>
        )}
        <line
          x1={x(q.value)}
          x2={x(q.value)}
          y1={top}
          y2={bottom}
          className="sx-current-guide"
        />
        {(margin ? [balance.output] : [balance.positive, balance.negative]).map(
          (id, i) => {
            const name = p.statements.get(id)?.name,
              value = name && p.solved.values.get(name)?.value;
            return typeof value === "number" ? (
              <circle
                key={id}
                data-output-id={id}
                data-result-value={value}
                data-plot-value={margin ? value : value / balance.scale}
                cx={x(q.value)}
                cy={y(margin ? value : value / balance.scale)}
                r={6}
                className={i ? "sx-negative-point" : "sx-positive-point"}
              />
            ) : null;
          },
        )}
        {[low, (low + high) / 2, high].map((n) => (
          <text
            data-axis="input"
            key={n}
            x={x(n)}
            y={bottom + 24}
            textAnchor="middle"
          >
            {Number(n.toPrecision(3))}
          </text>
        ))}
        <text x={(left + right) / 2} y={238} textAnchor="middle">
          {quantityTitle(s.name, page)} · drag horizontally
        </text>
      </svg>
    </div>
  );
}
