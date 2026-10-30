import { isDialogEvent } from "../interaction/modalInput";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, X } from "lucide-react";
import { ancestors, project, type Page, type Point } from "../document";
import { display, relationGlyph, same } from "../../notebook/math";
import { modelContents, modelParent } from "../models";
import { type Scrub } from "./Interactions";
import {
  causalNeighborhood,
  definitionPath,
  definitionPaths,
  engineeringValue,
  findBalance,
  quantityTitle,
  systemComposition,
  systemArchitecture,
  systemPortOutputs,
  exteriorPorts,
} from "../systemExploration";
import "../styles/system-exploration.css";
import { SystemModel } from "./SystemModel";
import {
  SystemInvestigation,
  type InvestigationView,
  type InvestigationPath,
} from "./SystemInvestigation";
import {
  arrangeSystem,
  spaceArrangedModels,
  placeInvestigation,
  routeConnection,
  routeLabel,
  pathData,
  type ModelRect,
} from "../systemPresentation";
import type { AppearanceChange } from "./ModelAppearance";
import { systemAssessment } from "../systemAssessment";
import { planConnection } from "../linking";
export function SystemOverview({
  page,
  response,
  setResponse,
  pathFocus,
  selectPath,
  toggleCompare,
  write,
  branch,
  positions,
  arrange,
  input,
  output,
  selected,
  anchorModel,
  choose,
  enter,
  follow,
  close,
  canvas,
  selectModel,
  connect,
  investigating,
  dismissInvestigation,
  scrub,
  zoom,
  compare,
  comparisonContext,
  tracePaths,
  toggleTrace,
  requirements,
  changeAppearance,
  failure,
  investigate,
  preview = false,
}: {
  failure?: string;
  investigate: (id: string) => void;
  preview?: boolean;
  changeAppearance: AppearanceChange;
  page: Page;
  response: InvestigationView;
  setResponse: (mode: InvestigationView) => void;
  pathFocus?: InvestigationPath;
  selectPath: (path?: InvestigationPath) => void;
  toggleCompare: () => void;
  write: (id: string, value: string) => string | undefined;
  branch: () => void;
  positions: Record<string, Point>;
  arrange: (
    positions: Record<string, Point>,
    checkpoint?: boolean,
    previous?: Record<string, Point>,
  ) => void;
  zoom: number;
  compare: boolean;
  comparisonContext?: string;
  tracePaths: boolean;
  toggleTrace: () => void;
  requirements: boolean;
  input?: string;
  output?: string;
  selected?: string;
  anchorModel?: string;
  choose: (id: string, model?: string) => void;
  enter: (id: string) => void;
  follow: (id: string) => void;
  close: () => void;
  canvas: () => void;
  selectModel: (id: string) => void;
  connect: (source: string, target?: string) => void;
  investigating: boolean;
  dismissInvestigation: () => void;
  scrub: (id: string) => Scrub | undefined;
}) {
  const p = useMemo(() => project(page), [page]);
  const assessment = useMemo(() => systemAssessment(page), [page]);
  const failureAncestors = new Set(failure ? ancestors(p, failure) : []);
  const balance = useMemo(
    () => (output ? findBalance(page, output) : undefined),
    [page, output],
  );
  const trace = useMemo(
    () => (input ? causalNeighborhood(page, input) : undefined),
    [page, input],
  );
  const composition = { ...systemComposition(page), ...positions },
    models = (page.models || []).filter((m) => !modelParent(page, m.id));
  const ownersAlong = (target: string) =>
    new Set(
      input
        ? definitionPaths(page, input, target).flatMap((path) =>
            path
              .slice(1)
              .map((id) => modelParent(page, id))
              .filter((id): id is string => !!id),
          )
        : [],
    );
  const positiveModels = balance
      ? ownersAlong(balance.positive)
      : new Set<string>(),
    negativeModels = balance
      ? ownersAlong(balance.negative)
      : new Set<string>();
  if (balance && input && ancestors(p, balance.output).includes(input)) {
    const owner = modelParent(page, balance.output);
    if (owner) {
      positiveModels.add(owner);
      negativeModels.add(owner);
    }
  }
  const focusedModel = page.models?.find((m) => m.id === selected);
  const activeModel = page.models?.find(
    (m) => m.id === (investigating ? anchorModel || selected : selected),
  );
  const sourceOwner =
    activeModel?.id ||
    (input ? modelParent(page, input) : undefined) ||
    models.find((model) => model.inputs.includes(input || ""))?.id;
  const [sizes, setSizes] = useState<
    Record<string, { width: number; height: number }>
  >({});
  const floating = ["contextual", "detached", "internal"].includes(response);
  const popupSize = sizes.$investigation || { width: 430, height: 365 };
  const modelBoxes = models.map((m) => ({
    id: m.id,
    ...composition[m.id],
    width: sizes[m.id]?.width || 280,
    height: sizes[m.id]?.height || 180,
  }));
  const originBox = modelBoxes.find((m) => m.id === sourceOwner) || {
    id: "origin",
    x: 385,
    y: 490,
    width: 280,
    height: 180,
  };
  const investigationAt =
    (response === "detached" && positions.$investigation) ||
    placeInvestigation(originBox, modelBoxes, popupSize);
  const distant = zoom < 0.6,
    closeScale = zoom >= 0.95;
  const architecture = systemArchitecture(page);
  const arranged = useMemo(() => arrangeSystem(page), [page]);
  const popupBox = { id: "$investigation", ...investigationAt, ...popupSize };
  const horizontal =
    investigationAt.x >= originBox.x + originBox.width ||
    investigationAt.x + popupSize.width <= originBox.x;
  const forward = horizontal
    ? investigationAt.x > originBox.x
    : investigationAt.y > originBox.y;
  const from = horizontal
    ? {
        x: forward ? originBox.x + originBox.width : originBox.x,
        y: originBox.y + 78,
      }
    : {
        x: originBox.x + originBox.width / 2,
        y: forward ? originBox.y + originBox.height : originBox.y,
      };
  const to = horizontal
    ? {
        x: forward ? investigationAt.x : investigationAt.x + popupSize.width,
        y: investigationAt.y + 42,
      }
    : {
        x: investigationAt.x + popupSize.width / 2,
        y: forward ? investigationAt.y : investigationAt.y + popupSize.height,
      };
  const escape = (pt: Point, amount: number) => ({
    x: pt.x + (horizontal ? amount : 0),
    y: pt.y + (horizontal ? 0 : amount),
  });
  const tetherRoute = routeConnection(
    escape(from, forward ? 14 : -14),
    escape(to, forward ? -14 : 14),
    [...modelBoxes, popupBox],
  );
  const extents = {
    width: Math.max(
      1600,
      ...models.map(
        (model) =>
          composition[model.id].x + (sizes[model.id]?.width || 280) + 60,
      ),
      investigating && floating
        ? investigationAt.x + (sizes.$investigation?.width || 625) + 60
        : 0,
    ),
    height: Math.max(
      800,
      ...models.map(
        (model) =>
          composition[model.id].y + (sizes[model.id]?.height || 180) + 80,
      ),
      investigating && floating
        ? investigationAt.y + (sizes["$investigation"]?.height || 550) + 60
        : 0,
    ),
  };
  const [drag, setDrag] = useState<{
    source: string;
    start: Point;
    end: Point;
    target?: string;
    problem?: string;
    valid: boolean;
  }>();
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const root = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const read = () => {
      const next = Object.fromEntries(
        [
          ...root.current!.querySelectorAll<HTMLElement>(
            ".sx-model,.sx-investigation",
          ),
        ].map((node) => [
          node.dataset.modelId || "$investigation",
          { width: node.offsetWidth, height: node.offsetHeight },
        ]),
      );
      setSizes((old) =>
        JSON.stringify(old) === JSON.stringify(next) ? old : next,
      );
    };
    read();
    const observer = new ResizeObserver(read);
    root.current
      ?.querySelectorAll(".sx-model,.sx-investigation")
      .forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [
    page.models,
    selected,
    investigating,
    distant,
    closeScale,
    response,
    sourceOwner,
    failure,
  ]);
  const moving = useRef<
    | {
        id: string;
        start: Point;
        at: Point;
        before: Record<string, Point>;
        next?: Record<string, Point>;
      }
    | undefined
  >(undefined);
  const captured = useRef<{ node: HTMLButtonElement; id: number } | undefined>(
    undefined,
  );
  const cancelDrag = () => {
    if (moving.current) {
      arrange(moving.current.before, false);
      moving.current = undefined;
    }
    const held = captured.current;
    captured.current = undefined;
    dragRef.current = undefined;
    if (held?.node.hasPointerCapture(held.id))
      held.node.releasePointerCapture(held.id);
    setDrag(undefined);
  };
  useEffect(() => {
    const cancel = (e: KeyboardEvent) => {
      if (isDialogEvent(e)) return;
      if (e.key === "Escape" && (dragRef.current || moving.current)) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        cancelDrag();
      }
    };
    const blur = cancelDrag;
    window.addEventListener("keydown", cancel, true);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", cancel, true);
      window.removeEventListener("blur", blur);
    };
  }, []);
  const point = (x: number, y: number) => {
    const r = root.current!.getBoundingClientRect();
    return { x: (x - r.left) / zoom, y: (y - r.top) / zoom };
  };
  const ranked = architecture
    .filter(
      (edge) =>
        tracePaths ||
        edge.source === input ||
        !page.regions.find((r) => r.id === edge.source)?.interfaceHidden,
    )
    .sort((a, b) => {
      const score = (id: string) => {
        const model = models.find((m) => m.outputs.includes(id));
        const rank = model ? systemPortOutputs(page, model).indexOf(id) : -1;
        return rank < 0 ? 999 : rank;
      };
      return score(a.source) - score(b.source);
    });
  const edges = ranked.filter(
    (e, i, all) =>
      all.findIndex((a) => a.from === e.from && a.to === e.to) === i,
  );
  const selectedEdges = edges.map((e) => {
    const bindings = architecture.filter(
      (a) => a.from === e.from && a.to === e.to,
    );
    const affected =
      investigating && bindings.some((a) => trace?.downstream.has(a.source));
    const boundary = selected === e.from || selected === e.to;
    const onBranch = (target?: string) =>
      !!target &&
      bindings.some(
        (a) =>
          (a.source === target &&
            !!balance &&
            (a.target === balance.output ||
              ancestors(p, balance.output).includes(a.target))) ||
          definitionPaths(page, input || "", target).some(
            (path) => path.includes(a.source) && path.includes(a.target),
          ),
      );
    const available = onBranch(balance?.positive),
      required = onBranch(balance?.negative);
    return {
      ...e,
      available,
      condition: affected && !available && !required,
      active:
        failure && investigating
          ? failureAncestors.has(e.source) &&
            (tracePaths
              ? failureAncestors.has(e.target)
              : e.to === modelParent(page, failure))
          : investigating && pathFocus
            ? pathFocus === "available"
              ? available
              : pathFocus === "required"
                ? required
                : available || required
            : focusedModel &&
                (!investigating || focusedModel.id !== anchorModel)
              ? boundary
              : investigating
                ? available ||
                  required ||
                  ((requirements || tracePaths) && affected)
                : boundary,
    };
  });
  const title = (id: string) => quantityTitle(id, page);
  const investigation = investigating ? (
    <SystemInvestigation
      failure={failure}
      preview={preview}
      page={page}
      input={input}
      output={output}
      sourceOwner={sourceOwner}
      response={response === "internal" ? "contextual" : response}
      setResponse={setResponse}
      pathFocus={pathFocus}
      selectPath={selectPath}
      at={investigationAt}
      choose={choose}
      follow={follow}
      write={write}
      branch={branch}
      compare={compare}
      toggleCompare={toggleCompare}
      comparisonContext={comparisonContext}
      enterSource={() => {
        if (sourceOwner) {
          setResponse("internal");
          enter(sourceOwner);
        }
      }}
      scrub={scrub}
      tracePaths={tracePaths}
      toggleTrace={toggleTrace}
      dismissInvestigation={dismissInvestigation}
      move={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        captured.current = { node: e.currentTarget, id: e.pointerId };
        moving.current = {
          id: "$investigation",
          start: point(e.clientX, e.clientY),
          at: investigationAt,
          before: positions,
        };
      }}
    />
  ) : undefined;
  const context = page.contexts.find((c) => c.id === page.active)?.label;
  return (
    <section
      ref={root}
      data-context={page.active}
      data-evaluation={assessment.key}
      data-system-status={
        assessment.blocked
          ? "blocked"
          : assessment.failures.length
            ? "failed"
            : "screening-pass"
      }
      data-evaluation-state={
        preview ? "preview" : assessment.blocked ? "blocked" : "current"
      }
      className={`system-overview ${distant ? "is-distant" : ""} ${requirements ? "show-requirements" : ""}`}
      data-semantic-level={
        distant ? "system" : closeScale ? "interfaces" : "subsystem"
      }
      style={{ width: extents.width, minHeight: extents.height }}
      data-system-overview
      aria-label="System exploration"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => {
        const move = moving.current;
        if (move) {
          const to = point(e.clientX, e.clientY),
            next = {
              ...positions,
              [move.id]: {
                x: move.at.x + to.x - move.start.x,
                y: move.at.y + to.y - move.start.y,
              },
            };
          move.next = next;
          arrange(next, false);
          return;
        }
        const d = dragRef.current;
        if (!d) return;
        const node = document
          .elementFromPoint(e.clientX, e.clientY)
          ?.closest<HTMLElement>("[data-system-input]");
        const target = node?.dataset.systemInput;
        let valid = false,
          problem = "";
        if (target)
          try {
            if (modelParent(page, d.source) === modelParent(page, target))
              throw Error(
                "Enter the model to connect its internal quantities.",
              );
            planConnection(page, d.source, target);
            valid = true;
          } catch (error) {
            problem = (error as Error).message;
          }
        setDrag({
          ...d,
          end: point(e.clientX, e.clientY),
          target,
          valid,
          problem,
        });
      }}
      onPointerUp={(e) => {
        if (moving.current) {
          const move = moving.current;
          if (
            move.next &&
            JSON.stringify(move.next) !== JSON.stringify(move.before)
          )
            arrange(move.next, true, move.before);
          moving.current = undefined;
          const held = captured.current;
          captured.current = undefined;
          if (held?.node.hasPointerCapture(held.id))
            held.node.releasePointerCapture(held.id);
          return;
        }
        const d = dragRef.current;
        if (!d) return;
        setDrag(undefined);
        const moved = Math.hypot(d.end.x - d.start.x, d.end.y - d.start.y) > 5;
        if (!moved) connect(d.source);
        else if (d.valid && d.target) connect(d.source, d.target);
        if ((e.target as Element).hasPointerCapture(e.pointerId))
          (e.target as Element).releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={cancelDrag}
      onClick={(e) => e.stopPropagation()}
    >
      <header
        className={`sx-heading ${assessment.failures.length || assessment.blocked ? "is-failing" : ""}`}
      >
        <div>
          <small>
            {context} · {preview ? "Preview" : "Current"}
          </small>
          <h1>
            {assessment.blocked
              ? "Calculations blocked"
              : assessment.failures.length
                ? `${assessment.failures.length} modeled checks exceeded`
                : "Authored system checks pass"}
          </h1>
          <div className="sx-failure-strip" aria-label="System check results">
            {assessment.failures.map((check) => (
              <button
                key={check.id}
                data-check-id={check.id}
                aria-pressed={failure === check.id}
                onClick={() => investigate(check.id)}
              >
                <span>
                  {quantityTitle(check.id, page)}
                  {check.provisional ? " (provisional)" : ""}
                </span>
                <b>{check.summary}</b>
              </button>
            ))}
            {!assessment.failures.length && (
              <small>
                {assessment.blocked
                  ? "Inspect unresolved definitions before using results"
                  : "Screening only · applicability and evidence remain separate"}
              </small>
            )}
          </div>
          <details className="sx-limits-disclosure">
            <summary>Limits</summary>
            <div className="sx-requirements" aria-label="System requirements">
              {[...p.statements]
                .filter(
                  ([id, s]) =>
                    s.relation !== "=" &&
                    (page.regions.find((r) => r.id === id)?.requirement ||
                      !modelParent(page, id)),
                )
                .map(([id, s]) => {
                  const c = p.solved.constraints.get(id);
                  return c ? (
                    <button
                      key={id}
                      onClick={() => (c.pass ? follow(id) : investigate(id))}
                    >
                      {quantityTitle(s.name, page)}
                      {page.regions.find((r) => r.id === id)?.provisional
                        ? " (provisional)"
                        : ""}{" "}
                      {relationGlyph(s.relation)}{" "}
                      {same(c.bound.dimension, [0, 0, 1, 0])
                        ? `${Number((c.bound.value / 60).toPrecision(4))} min`
                        : display(c.bound)}
                    </button>
                  ) : null;
                })}
            </div>
          </details>
        </div>
        <div className="sx-view-actions">
          <button
            onClick={() =>
              arrange(spaceArrangedModels(arranged.positions, sizes))
            }
          >
            Arrange connections
          </button>
          {!!Object.keys(positions).length && (
            <button onClick={() => arrange({})}>Restore arrangement</button>
          )}
          <button onClick={canvas}>Free canvas</button>
          <button aria-label="Close system overview" onClick={close}>
            <X size={16} />
          </button>
        </div>
      </header>
      {investigating && !failure && balance && input && (
        <div
          className="sx-causal-ribbon"
          aria-label="Selected input model paths"
        >
          {[
            { id: balance.negative, label: "Required", color: "required" },
            { id: balance.positive, label: "Available", color: "available" },
          ]
            .filter(
              (branch) =>
                !pathFocus ||
                pathFocus === "margin" ||
                branch.color === pathFocus,
            )
            .map((branch) => {
              const path = definitionPath(page, input, branch.id);
              const owners = [
                ...new Set(
                  path
                    .slice(1)
                    .map((id) => modelParent(page, id))
                    .filter((id): id is string => !!id),
                ),
              ];
              return (
                <div key={branch.id} className={`sx-ribbon-${branch.color}`}>
                  <strong>{branch.label}</strong>
                  <button onClick={() => follow(input)}>{title(input)}</button>
                  <ArrowRight size={14} />
                  {path.length ? (
                    owners.map((id, i) => (
                      <span key={id}>
                        {i > 0 && <ArrowRight size={14} />}
                        <button onClick={() => enter(id)}>
                          {page
                            .models!.find((m) => m.id === id)!
                            .name.replace(/^\d+\s*·\s*/, "")}
                        </button>
                      </span>
                    ))
                  ) : (
                    <span>Fixed in this sweep</span>
                  )}
                </div>
              );
            })}
        </div>
      )}
      <svg
        className="sx-architecture"
        aria-label="Model architecture"
        viewBox={`0 0 ${extents.width} ${extents.height}`}
        style={{ width: extents.width, height: extents.height }}
      >
        <defs>
          <marker
            id="sx-arrow"
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
          >
            <path d="M0,1 L7,4 L0,7" fill="none" stroke="context-stroke" />
          </marker>
        </defs>
        {selectedEdges.map((e) => {
          const a = composition[e.from],
            b = composition[e.to];
          if (!a || !b) return null;
          const detail = (id: string) =>
            !floating &&
            (selected === id ||
              (investigating && sourceOwner === id && !focusedModel));
          const sourceModel = models.find((m) => m.id === e.from)!,
            targetModel = models.find((m) => m.id === e.to)!;
          const outputs = systemPortOutputs(page, sourceModel).slice(
            0,
            detail(e.from) || closeScale ? 4 : 1,
          );
          const inputs = exteriorPorts(page, targetModel, input).slice(
            0,
            detail(e.to) || closeScale ? 3 : 1,
          );
          const out = outputs.indexOf(e.source),
            into = inputs.findIndex((id) => id === e.source || id === e.target);
          const start = {
              x: a.x + (sizes[e.from]?.width || 280),
              y: a.y + (out >= 0 ? 76 + out * 33 : 155),
            },
            end = { x: b.x, y: b.y + (into >= 0 ? 76 + into * 33 : 155) };
          const rectangles: ModelRect[] = models.map((m) => ({
            id: m.id,
            ...composition[m.id],
            width: sizes[m.id]?.width || 280,
            height: sizes[m.id]?.height || 180,
          }));
          if (investigating && floating)
            rectangles.push({
              id: "$investigation",
              ...investigationAt,
              width: sizes["$investigation"]?.width || 625,
              height: sizes["$investigation"]?.height || 550,
            });
          const route = routeConnection(
            { x: start.x + 22, y: start.y },
            { x: end.x - 22, y: end.y },
            rectangles,
          );
          if (!route) return null;
          const points = [start, ...route, end];
          const quantities = architecture
            .filter((a) => a.from === e.from && a.to === e.to)
            .map((a) => a.source);
          const label = title(e.source);
          const related =
            e.active && selected && (e.from === selected || e.to === selected)
              ? [...new Set(quantities)]
                  .filter((id) => id !== e.source)
                  .map(title)
              : [];
          const captionText =
            label +
            (closeScale ? ` · ${engineeringValue(page, e.source)}` : "");
          const focused = !!selected || investigating;
          const captionLines = captionText
            .split(" ")
            .reduce<string[]>((lines, word) => {
              if (lines.length && lines.at(-1)!.length + word.length + 1 <= 21)
                lines[lines.length - 1] += " " + word;
              else lines.push(word);
              return lines;
            }, []);
          const caption = routeLabel(
            route,
            rectangles,
            Math.max(...captionLines.map((line) => line.length)) * 7 + 8,
            captionLines.length,
          );
          return (
            <g
              key={e.from + e.to}
              className={`sx-connection ${e.active ? "is-relevant" : focused ? "is-muted" : ""}`}
            >
              <path
                data-from-model={e.from}
                data-to-model={e.to}
                data-source-id={e.source}
                data-target-id={e.target}
                className={`sx-system-edge ${e.active ? "is-active" : ""} ${investigating && e.available ? "is-available" : ""} ${e.condition ? "is-condition" : ""}`}
                d={pathData(points)}
                markerEnd="url(#sx-arrow)"
              />
              {(e.active || closeScale) && caption && (
                <g
                  role="button"
                  tabIndex={0}
                  aria-label={`Follow connection ${label}`}
                  className="sx-connection-label"
                  onClick={() => follow(e.source)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      follow(e.source);
                    }
                  }}
                >
                  <title>
                    {[...new Set(quantities)]
                      .map(
                        (id) => `${title(id)} · ${engineeringValue(page, id)}`,
                      )
                      .join(" · ")}
                  </title>
                  {related.length > 0 && <desc>{related.join(" · ")}</desc>}
                  <text x={caption.x} y={caption.y} textAnchor="middle">
                    {captionLines.map((line, i) => (
                      <tspan key={i} x={caption.x} dy={i ? 14 : 0}>
                        {line}
                      </tspan>
                    ))}
                  </text>
                </g>
              )}
            </g>
          );
        })}
        {investigating && floating && tetherRoute && (
          <path
            className="sx-emergence"
            d={pathData([from, ...tetherRoute, to])}
          />
        )}

        {drag && (
          <g className={drag.valid ? "sx-drag-valid" : "sx-drag-pending"}>
            <path
              d={`M${drag.start.x},${drag.start.y} L${drag.end.x},${drag.end.y}`}
            />
            <text x={drag.end.x + 12} y={drag.end.y - 12}>
              {drag.valid
                ? "Review connection"
                : drag.problem || "Drop on an exposed input"}
            </text>
          </g>
        )}
      </svg>
      <div className="sx-system-models" aria-label="Subsystem interfaces">
        {models.map((model) => (
          <SystemModel
            preview={preview}
            investigate={investigate}
            changeAppearance={changeAppearance}
            key={model.id}
            page={page}
            model={model}
            at={composition[model.id]}
            coupled={arranged.coupled.some((group) => group.includes(model.id))}
            inspecting={
              floating &&
              (selected === model.id ||
                (investigating && sourceOwner === model.id))
            }
            response={
              investigating && !floating && sourceOwner === model.id
                ? investigation
                : undefined
            }
            responseExpanded={response === "expanded"}
            write={write}
            selected={
              selected === model.id ||
              (investigating && !focusedModel && activeModel?.id === model.id)
            }
            distant={distant}
            close={closeScale}
            input={input}
            tone={
              failure && investigating
                ? model.members.some((id) => failureAncestors.has(id)) ||
                  model.id === modelParent(page, failure)
                  ? "condition"
                  : undefined
                : investigating &&
                    (pathFocus !== "available" ||
                      positiveModels.has(model.id)) &&
                    (pathFocus !== "required" || negativeModels.has(model.id))
                  ? pathFocus !== "required" &&
                    positiveModels.has(model.id) &&
                    pathFocus !== "available" &&
                    negativeModels.has(model.id)
                    ? "both"
                    : pathFocus !== "required" && positiveModels.has(model.id)
                      ? "available"
                      : pathFocus !== "available" &&
                          negativeModels.has(model.id)
                        ? "required"
                        : trace &&
                            [...modelContents(page, model.members)].some((id) =>
                              trace.downstream.has(id),
                            )
                          ? "condition"
                          : undefined
                  : undefined
            }
            select={() => selectModel(model.id)}
            choose={(id) => choose(id, model.id)}
            enter={() => enter(model.id)}
            follow={follow}
            scrub={scrub}
            connect={connect}
            move={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              e.stopPropagation();
              e.currentTarget.setPointerCapture(e.pointerId);
              captured.current = { node: e.currentTarget, id: e.pointerId };
              moving.current = {
                id: model.id,
                start: point(e.clientX, e.clientY),
                at: composition[model.id],
                before: positions,
              };
            }}
            drag={(e, source) => {
              if (e.button !== 0) return;
              e.stopPropagation();
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              captured.current = { node: e.currentTarget, id: e.pointerId };
              const start = point(e.clientX, e.clientY);
              setDrag({ source, start, end: start, valid: false });
            }}
          />
        ))}
      </div>
      {investigating && floating && investigation}
    </section>
  );
}
