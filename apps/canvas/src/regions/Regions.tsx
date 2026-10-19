import {
  canvasScroll as viewportScroll,
  scrollCanvasTo,
  recenterCanvas,
  SCROLL_SURFACE,
  revealCanvasElement,
} from "./canvasViewport";
import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent,
} from "react";
import {
  ArrowUpRight,
  Bookmark,
  ArrowLeft,
  Check,
  GripVertical,
  FilePlus2,
  Hand,
  HelpCircle,
  Layers,
  LayoutGrid,
  Link2,
  MoreHorizontal,
  Plus,
  Search,
  Undo2,
  X,
} from "lucide-react";
import {
  display,
  same,
  relationGlyph,
  references,
  quantityLiteral,
  unitLabel,
  type Expression,
  type Statement,
  type Quantity,
} from "../notebook/math";
import {
  RegionSession,
  ancestors,
  curve,
  positions,
  project,
  semanticKey,
  type Plot,
  type Point,
  type ConnectionEdit,
} from "./document";
import {
  proposeValue,
  previewPage,
  responseFor,
  type Exploration,
} from "./exploration";
import {
  ScrubNumber,
  RelationshipExpansion,
  InlineExploration,
  InlineRecovery,
  SpatialComparison,
  type Scrub,
} from "./Interactions";
import "./regions.css";
import { workspaceStorage } from "./workspaceStorage";
import { DataRegion } from "./DataRegion";
import {
  DatasetReview,
  DatasetResult,
  RecordFeedback,
  type DataSelection,
} from "./DatasetViews";
import { evaluateDataset } from "./datasetModel";
import { measurementText } from "./dataSources";
import { placeDataResult } from "./dataFeedback";
import { DataRelationshipOverlay } from "./DataRelationshipOverlay";
import { useRelationshipNavigation } from "./useRelationshipNavigation";
import { RelationshipTrail } from "./RelationshipTrail";
import { MEMORY_STORAGE, restoreMemory } from "./workspaceMemory";
import { useWorkspaceMemory } from "./useWorkspaceMemory";
import { useModels } from "./useModels";
import {
  SystemInvestigation,
  type InvestigationView,
  type InvestigationPath,
} from "./SystemInvestigation";
import { placeInvestigation } from "./systemPresentation";
import { SystemOverview } from "./SystemOverview";
import {
  ExternalReferenceView,
  ExternalReferenceEditor,
} from "./ExternalReferenceView";
import { quantityTitle, findBalance, balanceInputs } from "./systemExploration";

import { useCanvasNavigation } from "./useCanvasNavigation";
import { assessConstraint } from "./systemAssessment";
import { modelPath, type NestedModel } from "./models";
import {
  ModelObject,
  ModelReview,
  ModelBreadcrumb,
  ModelConnection,
  ModelTrace,
} from "./ModelViews";
import "./investigation.css";
import { ArtifactView } from "./ArtifactView";
import WorkspaceAreas from "./WorkspaceAreas";
import { useCanvasScene } from "./useCanvasScene";
import { CanvasToolView, CanvasGroupView } from "./CanvasObjects";
import { dockObjects, restoreScene, SCENE_STORAGE } from "./canvasScene";
import type { EditorProps } from "./AreaEditors";
import { mathSource, caretInSpan, type SourceSpan } from "./editing";
import {
  planConnection,
  connectionChoices,
  plotChoices,
  quantityDescription,
} from "./linking";
import {
  frameBounds,
  organizeFrames,
  selectionRect,
  touches,
  type CanvasFrame,
  type CanvasRect,
} from "./selection";
import {
  archive,
  makeArtifact,
  restore,
  STORAGE,
  type Artifact,
  type ArtifactFocus,
} from "./artifacts";

const m = (
  tag: string,
  children: ReactNode,
  props: Record<string, unknown> = {},
) => React.createElement(tag, props, children);
const format = (n: number, digits = 5) =>
  Number(n.toPrecision(digits)).toString();
const label = (name: string) => (name === "T_inf" ? "T∞" : name);
function notation(name: string): ReactNode {
  const parts = name.split("_");
  return parts.length > 1
    ? m("msub", [
        m("mi", parts[0], { key: "a" }),
        m("mi", parts.slice(1).join(""), { key: "b" }),
      ])
    : m("mi", name === "degC" ? "°C" : name);
}
function sourceSpans(text: string): { start: number; end: number }[] {
  const offset = /^\s*[A-Za-z_][A-Za-z_0-9]*\s*(?::=|<=|>=|<|>|=|≤|≥)/.test(
    text,
  )
    ? text.search(/(?::=|<=|>=|<|>|=|≤|≥)/)
    : -1;
  return [
    ...text.matchAll(
      /(?<![A-Za-z_0-9.])(?:\d*\.\d+|\d+(?:\.\d*)?)(?:[eE][+-]?\d+)?/g,
    ),
  ]
    .filter((match) => match.index > offset)
    .map((match) => ({
      start: match.index,
      end: match.index + match[0].length,
    }));
}
function MathLine({
  statement,
  text,
  choose,
  edit,
  scrub,
  resolved,
  scrubSource,
  highlight,
  highlightExpression,
  highlights,
  directEdit = false,
  inspectSymbols = false,
  linkSources,
  onSymbol,
}: {
  statement: Statement;
  text: string;
  choose: (name: string) => void;
  edit: (span?: { start: number; end: number }) => void;
  scrub?: Scrub;
  resolved?: ReturnType<typeof project>;
  scrubSource?: (id: string) => Scrub | undefined;
  highlight?: string;
  highlights?: Set<string>;
  highlightExpression?: boolean;
  directEdit?: boolean;
  inspectSymbols?: boolean;
  linkSources?: Record<string, string[]>;
  onSymbol?: (name: string) => void | boolean;
}) {
  const spans = sourceSpans(text);
  let number = 0;
  const source = mathSource(statement, text);
  const sourceProps = (span?: SourceSpan) =>
    span
      ? { "data-source-start": span.start, "data-source-end": span.end }
      : {};
  const editAt = (span: SourceSpan, element?: Element, x?: number) => {
    if (x !== undefined && element) {
      const rect = element.getBoundingClientRect();
      edit(caretInSpan(span, (x - rect.left) / (rect.width || 1)));
    } else edit({ start: span.start, end: span.start });
  };
  const symbol = (
    name: string,
    substitute = true,
    span?: SourceSpan,
  ): ReactNode => {
    const id =
      resolved?.sources[name]?.length === 1
        ? resolved.sources[name][0]
        : undefined;
    const q = resolved?.solved.values.get(name);
    if (substitute && id && q && !resolved?.errors.has(id))
      return m("munder", [
        m(
          "munder",
          [
            m(
              "mrow",
              <ScrubNumber
                math
                name={`Explore ${name}`}
                scrub={scrubSource?.(id)}
                title="Drag to vary · click for definition"
                edit={() => choose(name)}
              >
                {display(q)}
              </ScrubNumber>,
              { key: "v", "data-source-id": id },
            ),
            m("mo", "⏟", { key: "b", stretchy: "true" }),
          ],
          { key: "q" },
        ),
        m("mtext", name === "T_inf" ? "T∞" : name, {
          key: "n",
          className: "er-term-caption",
        }),
      ]);
    return !references({ kind: "name", name }).length
      ? m("mi", name === "degC" ? "°C" : name, {
          mathvariant: "normal",
          ...sourceProps(span),
        })
      : m("mrow", notation(name), {
          className: `er-term ${highlight === name || highlights?.has(name) ? "is-linked" : ""}`,
          "data-symbol": name,
          "data-link-source":
            linkSources?.[name]?.length === 1
              ? linkSources[name][0]
              : undefined,
          role: "button",
          tabIndex: 0,
          ...sourceProps(span),
          "aria-label": `${directEdit && !inspectSymbols ? "Edit" : "Inspect"} ${name}`,
          onClick: (e: React.MouseEvent) => {
            e.stopPropagation();
            if (onSymbol?.(name)) return;
            if (directEdit && span) editAt(span, e.currentTarget, e.clientX);
            else choose(name);
          },
          onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key === "Enter") {
              e.stopPropagation();
              if (inspectSymbols && onSymbol?.(name)) return;
              if (directEdit && span) editAt(span);
              else choose(name);
            }
          },
        });
  };
  const expression = (e: Expression): ReactNode => {
    const mapped = source.expressions.get(e)!;
    if (e.kind === "number") {
      const span = spans[number++];
      return (
        <ScrubNumber
          math
          name={`Edit value ${e.value}`}
          scrub={number === 1 ? scrub : undefined}
          edit={(element, point) =>
            directEdit ? editAt(mapped.span, element, point?.x) : edit(span)
          }
        >
          {e.value}
        </ScrubNumber>
      );
    }
    if (e.kind === "name") return symbol(e.name, true, mapped.span);
    if (e.kind === "unary")
      return m("mrow", [
        m("mo", "−", { key: "o", ...sourceProps(mapped.operator) }),
        m("mrow", expression(e.expression), { key: "e" }),
      ]);
    if (e.op === "/" || e.op === "^")
      return m(
        e.op === "/" ? "mfrac" : "msup",
        [
          m("mrow", expression(e.left), { key: "l" }),
          m("mrow", expression(e.right), { key: "r" }),
        ],
        sourceProps(mapped.operator),
      );
    const child = (value: Expression) =>
      value.kind === "binary" && ["+", "-"].includes(value.op) && e.op === "*"
        ? m("mrow", [
            m("mo", "(", { key: "a" }),
            m("mrow", expression(value), { key: "v" }),
            m("mo", ")", { key: "b" }),
          ])
        : expression(value);
    return m("mrow", [
      m("mrow", child(e.left), { key: "l" }),
      m("mo", e.op === "*" ? "·" : e.op === "-" ? "−" : e.op, {
        key: "o",
        ...sourceProps(mapped.operator),
      }),
      m("mrow", child(e.right), { key: "r" }),
    ]);
  };
  return m(
    "math",
    m("mrow", [
      ...(!statement.anonymous
        ? [
            m("mrow", symbol(statement.name, false, source.name), { key: "n" }),
            m("mo", relationGlyph(statement.relation), {
              key: "r",
              ...sourceProps(source.relation),
            }),
          ]
        : []),
      m("mrow", expression(statement.expression), {
        key: "e",
        className: highlightExpression ? "er-linked-expression" : "",
        "data-expression-for": statement.name,
      }),
    ]),
    {
      display: "inline",
      className: directEdit ? "er-editable-math" : undefined,
      onClick: (event: React.MouseEvent) => {
        if (!directEdit) return;
        event.stopPropagation();
        let target = (event.target as Element).closest("[data-source-start]");
        if (!target) {
          let nearest = Infinity;
          for (const node of event.currentTarget.querySelectorAll(
            "[data-source-start]",
          )) {
            const rect = node.getBoundingClientRect();
            const distance = Math.hypot(
              Math.max(
                rect.left - event.clientX,
                0,
                event.clientX - rect.right,
              ),
              Math.max(
                rect.top - event.clientY,
                0,
                event.clientY - rect.bottom,
              ),
            );
            if (distance < nearest) {
              target = node;
              nearest = distance;
            }
          }
        }
        if (target)
          editAt(
            {
              start: Number(target.getAttribute("data-source-start")),
              end: Number(target.getAttribute("data-source-end")),
            },
            target,
            event.clientX,
          );
        else edit();
      },
    },
  );
}

function ReferencedNote({
  text,
  links,
  labels,
  open,
}: {
  text: string;
  links: Record<string, string>;
  labels: Record<string, string>;
  open: (id: string) => void;
}) {
  const aliases = Object.keys(links);
  if (!aliases.length) return <>{text}</>;
  const parts = text.split(
    new RegExp(
      `(?<![A-Za-z_0-9])(${aliases.sort((a, b) => b.length - a.length).join("|")})(?![A-Za-z_0-9])`,
      "g",
    ),
  );
  return (
    <>
      {parts.map((part, i) =>
        links[part] ? (
          <button
            className="er-note-reference"
            key={i}
            aria-label={`Open reference ${labels[links[part]] || part}`}
            onClick={(e) => {
              e.stopPropagation();
              open(links[part]);
            }}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {labels[links[part]] || part}
            <ArrowUpRight size={11} />
          </button>
        ) : (
          part
        ),
      )}
    </>
  );
}

const concepts = [
  [
    "Equation",
    "Write executable mathematics",
    "An equation begins as editable text. Recognized symbols bind within this page; missing definitions remain unresolved. Direct typing already tests this behavior.",
  ],
  [
    "Quantity",
    "Assign a value and units",
    "A named value has one identity in the page. Editing its notation changes its assignment; positioning it does not. Write a name, :=, a number, and supported units.",
  ],
  [
    "Constraint",
    "State a requirement or limit",
    "A typed inequality can compare a computed quantity to a compatible bound. Passing it addresses only that authored mathematical condition, not physical validation.",
  ],
  [
    "Plot",
    "Explore a resolved relationship",
    "Select a quantity or expression on the page and choose Plot response. The curve refers to the same definitions and assumption context. It is not a second calculation model.",
  ],
  [
    "Model",
    "Discuss grouping and external bindings",
    "Design discussion: should this grouping only organize regions, or select an executable model? Those operations must stay distinct. No external model is inserted by this concept menu.",
  ],
  [
    "Data",
    "Import CSV measurements",
    "Design discussion: which source revision, columns, units, and applicability would this relation require? This experiment does not import CSVs or turn evidence into an executable binding.",
  ],
  [
    "Sketch",
    "Discuss informal spatial reasoning",
    "Design discussion: a drawing may express intent without computational meaning. Its geometry must not automatically become analysis geometry. This experiment does not insert a sketch tool.",
  ],
  [
    "Note",
    "Capture an unfinished thought",
    "Ordinary writing is an informal note. It gains mathematical meaning only when its contents form a supported definition or requirement. You can edit that same region in place.",
  ],
];

function CurveRegion({
  session,
  workingPage,
  comparisonContext,
  previewOnMove,
  finishInput,
  commands,
  quiet,
  revert,
  plot,
  selected,
  compare,
  select,
  move,
  resize,
  inspect,
  branch,
  reveal,
  setInput,
}: {
  session: RegionSession;
  workingPage: import("./document").Page;
  comparisonContext?: string;
  previewOnMove: boolean;
  finishInput: () => void;
  commands: () => void;
  quiet: boolean;
  revert: () => void;
  plot: Plot;
  selected: boolean;
  compare: boolean;
  select: () => void;
  move: (at: Point) => void;
  resize: (w: number, h: number) => void;
  inspect: () => void;
  branch: () => void;
  reveal: () => void;
  setInput: (id: string, x: number, anchor?: Element) => void;
}) {
  const page = workingPage,
    p = project(page),
    at = plot.at || positions(page)[plot.id];
  const [frame, setFrame] = useState<{
    at?: Point;
    width?: number;
    height?: number;
  }>();
  const ids =
    compare && comparisonContext
      ? ["original", comparisonContext]
      : [page.active];
  const series = useMemo(
    () => ids.map((context) => ({ context, ...curve(page, plot, context) })),
    [page, plot, compare, comparisonContext],
  );
  const output = p.statements.get(plot.output),
    input = p.statements.get(plot.input),
    q = input && p.solved.values.get(input.name);
  const acceptedInput =
    input && project(session.state).solved.values.get(input.name);
  const values = series.flatMap((s) =>
    s.points.flatMap((pt) =>
      [pt.y, pt.limit].filter((v): v is number => v !== undefined),
    ),
  );
  const min = values.length ? Math.min(...values) : 0,
    max = values.length ? Math.max(...values) : 1,
    pad = Math.max(1, (max - min) * 0.12);
  const width = frame?.width ?? plot.width,
    height = frame?.height ?? plot.height,
    left = 54,
    right = width - 24,
    top = 78,
    bottom = height - 62;
  const x = (n: number) =>
      left + ((n - plot.low) / (plot.high - plot.low)) * (right - left),
    y = (n: number) =>
      bottom - ((n - min + pad) / (max - min + 2 * pad)) * (bottom - top);
  const svg = useRef<SVGSVGElement>(null),
    drag = useRef<
      | { x: number; y: number; scale: number; width?: number; height?: number }
      | undefined
    >(undefined);
  const [preview, setPreview] = useState<number>();
  const scrub = useRef<
    { x: number; y: number; moved: boolean; id: number } | undefined
  >(undefined);
  useEffect(() => {
    const cancel = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !scrub.current) return;
      const id = scrub.current.id;
      if (svg.current?.hasPointerCapture(id))
        svg.current.releasePointerCapture(id);
      scrub.current = undefined;
      setPreview(undefined);
      revert();
    };
    window.addEventListener("keydown", cancel, true);
    return () => window.removeEventListener("keydown", cancel, true);
  }, [revert]);
  const point = (e: PointerEvent<SVGSVGElement>) => {
    const rect = svg.current!.getBoundingClientRect();
    return Math.max(
      plot.low,
      Math.min(
        plot.high,
        plot.low +
          ((((e.clientX - rect.left) / rect.width) * width - left) /
            (right - left)) *
            (plot.high - plot.low),
      ),
    );
  };
  const guide = preview ?? q?.value;
  const path = (
    points: { x: number; y?: number; limit?: number }[],
    field: "y" | "limit",
  ) => {
    let open = false;
    return points
      .map((pt) => {
        if (pt[field] === undefined) {
          open = false;
          return "";
        }
        const segment = `${open ? "L" : "M"}${x(pt.x)},${y(pt[field]!)}`;
        open = true;
        return segment;
      })
      .join(" ");
  };
  return (
    <section
      className={`er-plot ${selected ? "is-selected" : ""}`}
      data-plot-id={plot.id}
      tabIndex={0}
      aria-label={`Response of ${output?.name || "output"} to ${input?.name || "input"}`}
      onFocus={select}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.stopPropagation();
          inspect();
        }
      }}
      style={{
        left: frame?.at?.x ?? at.x,
        top: frame?.at?.y ?? at.y,
        width,
        height,
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={select}
    >
      <button
        className="er-grip"
        aria-label="Move response plot"
        onPointerDown={(e) => {
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = {
            x: e.clientX,
            y: e.clientY,
            scale:
              e.currentTarget.closest("section")!.getBoundingClientRect()
                .width / width,
          };
        }}
        onPointerMove={(e) => {
          if (drag.current)
            setFrame({
              at: {
                x: at.x + (e.clientX - drag.current.x) / drag.current.scale,
                y: at.y + (e.clientY - drag.current.y) / drag.current.scale,
              },
            });
        }}
        onPointerUp={(e) => {
          if (drag.current) {
            const scale = drag.current.scale;
            move({
              x: at.x + (e.clientX - drag.current.x) / scale,
              y: at.y + (e.clientY - drag.current.y) / scale,
            });
            drag.current = undefined;
            setFrame(undefined);
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
        }}
        onPointerCancel={() => {
          drag.current = undefined;
          setFrame(undefined);
        }}
      >
        <GripVertical size={15} />
      </button>
      {selected && quiet && (
        <button
          className="er-object-menu"
          aria-label="Plot commands"
          onClick={commands}
        >
          <MoreHorizontal size={16} />
        </button>
      )}
      {selected && !quiet && (
        <div className="er-region-actions">
          <button onClick={inspect}>Edit definition</button>
          <button onClick={branch}>Try alternative</button>
          <button onClick={reveal}>Reveal dependencies</button>
        </div>
      )}
      <header>
        <span>
          {output?.name || "?"} <span className="er-vs">against</span>{" "}
          {input?.name || "?"}
        </span>
        <small>
          Same definitions ·{" "}
          {page.contexts.find((c) => c.id === page.active)?.label}
        </small>
      </header>
      {values.length ? (
        <svg
          ref={svg}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="Live response curve"
          onPointerDown={(e) => {
            e.stopPropagation();
            select();
            e.currentTarget.setPointerCapture(e.pointerId);
            scrub.current = {
              x: e.clientX,
              y: e.clientY,
              moved: false,
              id: e.pointerId,
            };
            setPreview(point(e));
          }}
          onPointerMove={(e) => {
            if (
              scrub.current &&
              Math.hypot(
                e.clientX - scrub.current.x,
                e.clientY - scrub.current.y,
              ) > 4
            ) {
              scrub.current.moved = true;
              setPreview(point(e));
              if (previewOnMove)
                setInput(plot.input, point(e), e.currentTarget);
            }
          }}
          onPointerUp={(e) => {
            if (preview !== undefined) {
              const value = point(e);
              setPreview(undefined);
              e.currentTarget.releasePointerCapture(e.pointerId);
              if (scrub.current?.moved) {
                setInput(plot.input, value, e.currentTarget);
                if (previewOnMove) finishInput();
              }
              scrub.current = undefined;
            }
          }}
          onPointerCancel={() => {
            setPreview(undefined);
            scrub.current = undefined;
            revert();
          }}
        >
          {[0, 1, 2, 3].map((i) => {
            const value = min - pad + ((max - min + 2 * pad) * i) / 3;
            return (
              <g key={i}>
                <line
                  className="er-gridline"
                  x1={left}
                  x2={right}
                  y1={y(value)}
                  y2={y(value)}
                />
                <text x={left - 9} y={y(value) + 4} textAnchor="end">
                  {format(value, 3)}
                </text>
              </g>
            );
          })}
          {[plot.low, (plot.low + plot.high) / 2, plot.high].map((value) => (
            <text key={value} x={x(value)} y={bottom + 22} textAnchor="middle">
              {format(q?.absolute ? value - 273.15 : value, 3)}
            </text>
          ))}
          {series.map((s) => (
            <g
              key={s.context}
              className={
                s.context === "original"
                  ? "er-original-series"
                  : "er-alternative-series"
              }
            >
              <path className="er-response-line" d={path(s.points, "y")} />
              <path
                className="er-requirement-line"
                d={path(s.points, "limit")}
              />
            </g>
          ))}
          {series[0]?.points.at(-1)?.limit !== undefined && (
            <text
              x={right}
              y={y(series[0].points.at(-1)!.limit!) - 7}
              textAnchor="end"
            >
              Limit {format(series[0].points.at(-1)!.limit!, 4)}
            </text>
          )}
          {guide !== undefined && (
            <line
              className="er-guide"
              x1={x(guide)}
              x2={x(guide)}
              y1={top}
              y2={bottom}
            />
          )}
          {guide !== undefined &&
            output &&
            p.solved.values.get(output.name) &&
            (() => {
              const result = p.solved.values.get(output.name)!;
              const value = result.absolute
                ? result.value - 273.15
                : result.value;
              return (
                <circle
                  className="er-design-point"
                  cx={x(guide)}
                  cy={y(value)}
                  r={7}
                >
                  <title>
                    {input?.name} = {format(guide)} · {output.name} ={" "}
                    {display(result)} · drag horizontally
                  </title>
                </circle>
              );
            })()}
          {acceptedInput && guide !== acceptedInput.value && (
            <line
              className="er-accepted-guide"
              x1={x(acceptedInput.value)}
              x2={x(acceptedInput.value)}
              y1={top}
              y2={bottom}
            />
          )}
          <text x={left} y={top - 12}>
            {output?.name}
            {series[0]?.unit && unitLabel(series[0].unit)
              ? ` (${unitLabel(series[0].unit)})`
              : ""}
          </text>
          <text x={(left + right) / 2} y={height - 13} textAnchor="middle">
            {input?.name} {q ? `(${unitLabel(q) || "1"})` : ""}
          </text>
        </svg>
      ) : (
        <p className="er-plot-blocked">
          Resolve the plotted quantities before calculating this response.
        </p>
      )}
      <div className="er-plot-readout">
        {preview !== undefined ? "Varying " : "Drag to vary "}
        {input?.name}{" "}
        {!quiet &&
          guide !== undefined &&
          `= ${format(q?.absolute ? guide - 273.15 : guide, 4)}`}{" "}
        {compare && comparisonContext && (
          <span>
            Original <i />{" "}
            <b>
              Alternative <i />
            </b>
          </span>
        )}
      </div>
      <button
        className="er-resize"
        aria-label="Resize response plot"
        onPointerDown={(e) => {
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = {
            x: e.clientX,
            y: e.clientY,
            width,
            height,
            scale:
              e.currentTarget.closest("section")!.getBoundingClientRect()
                .width / width,
          };
        }}
        onPointerMove={(e) => {
          if (drag.current)
            setFrame({
              width: Math.max(
                380,
                drag.current.width! +
                  (e.clientX - drag.current.x) / drag.current.scale,
              ),
              height: Math.max(
                260,
                drag.current.height! +
                  (e.clientY - drag.current.y) / drag.current.scale,
              ),
            });
        }}
        onPointerUp={(e) => {
          if (drag.current) {
            const scale = drag.current.scale;
            resize(
              drag.current.width! + (e.clientX - drag.current.x) / scale,
              drag.current.height! + (e.clientY - drag.current.y) / scale,
            );
            drag.current = undefined;
            setFrame(undefined);
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
        }}
        onPointerCancel={() => {
          drag.current = undefined;
          setFrame(undefined);
        }}
      />
    </section>
  );
}

export default function Regions() {
  // Product authoring includes persistence; explicit research trials stay isolated.
  const params = new URLSearchParams(window.location.search);
  const artifactMode = params.has("artifacts") || !params.has("trial");
  const [saved] = useState(() => {
    if (!artifactMode) return;
    try {
      const raw = localStorage.getItem(STORAGE);
      if (raw) {
        const data = restore(raw);
        return { data };
      }
      return undefined;
    } catch {
      return {
        error:
          "Saved workspace could not be opened. Local save is paused; the previous data is preserved. Export new work to keep it.",
      };
    }
  });
  const [storageError, setStorageError] = useState(saved?.error || "");
  const [referenceEditor, setReferenceEditor] = useState<string>();
  const [artifacts, setArtifacts] = useState<Artifact[]>(
    saved?.data?.artifacts || [],
  );
  const [artifactFocus, setArtifactFocus] = useState<ArtifactFocus>();
  const [areaSelection, setAreaSelection] = useState<string>();
  const [areaCanvasVisible, setAreaCanvasVisible] = useState(true);
  const revealAreaCanvas = useRef<(() => void) | undefined>(undefined);
  const [artifactHeights, setArtifactHeights] = useState<
    Record<string, number>
  >({});
  const artifactFrames = artifacts
    .flatMap((a) => [a, ...(a.views || [])])
    .map((v) => ({ ...v, height: artifactHeights[v.id] || v.height }));
  const artifactReferences = useRef<string[]>([]);
  artifactReferences.current = artifacts.flatMap((a) => [a.input, a.output]);
  const [session] = useState(
      () =>
        new RegionSession(saved?.data?.page, () => artifactReferences.current),
    ),
    [, refresh] = useReducer((n) => n + 1, 0);
  useEffect(() => session.subscribe(refresh), [session]);
  const page = session.state;
  const [resume] = useState(() => {
    if (!artifactMode || saved?.error) return;
    try {
      let toolIds: string[] = [];
      try {
        const rawScene = localStorage.getItem(SCENE_STORAGE);
        if (rawScene) toolIds = restoreScene(rawScene).tools.map((t) => t.id);
      } catch {
        /* An invalid optional arrangement does not discard a valid camera. */
      }
      return restoreMemory(localStorage.getItem(MEMORY_STORAGE), page, [
        ...toolIds,
        ...artifacts.flatMap((a) => [
          a.id,
          ...(a.views || []).map((v) => v.id),
        ]),
      ]);
    } catch {
      return;
    }
  });
  const csvFile = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (artifactMode && !saved?.error) {
      try {
        const serialized = archive(page, artifacts);
        restore(serialized);
        localStorage.setItem(STORAGE, serialized);
        setStorageError("");
      } catch {
        setStorageError(
          "Local save is unavailable or this workspace exceeds the experiment's limits. Export workspace to keep your work.",
        );
      }
    }
  }, [artifactMode, page, artifacts, saved]);
  const accepted = useMemo(() => project(page), [page]);
  const datasetStates = useMemo<
    Record<
      string,
      { result?: ReturnType<typeof evaluateDataset>; error?: string }
    >
  >(
    () =>
      Object.fromEntries(
        (page.dataRelations || []).map((r) => {
          try {
            return [r.id, { result: evaluateDataset(page, r) }];
          } catch (e) {
            return [r.id, { error: (e as Error).message }];
          }
        }),
      ),
    [page],
  );
  const [exploration, setExploration] = useState<Exploration>();
  const proposalRef = useRef<Exploration | undefined>(undefined);
  const previewAnchor = useRef<Element | undefined>(undefined);
  const [gestureActive, setGestureActive] = useState(false);
  const [lastEdit, setLastEdit] = useState<{
    page: typeof page;
    before: typeof page;
    previous: Quantity;
    input: string;
    anchor?: Element;
  }>();
  useEffect(() => {
    proposalRef.current = exploration;
  }, [exploration]);
  const working = useMemo(
    () => previewPage(page, exploration),
    [page, exploration],
  );
  const p = useMemo(() => project(working), [working]);
  const basePlaces = positions(page);
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  const trial = new URLSearchParams(window.location.search).get("trial");
  const quiet = trial !== "baseline";
  const explicit =
    new URLSearchParams(window.location.search).get("interaction") === "A";
  const immediate = !explicit;
  const trials = {
    scrub: !trial || trial === "scrub",
    expand: !trial || trial === "expand",
    spatial: !trial || trial === "compare",
  };
  useEffect(() => {
    const resize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    if (
      exploration &&
      (exploration.context !== page.active ||
        exploration.key !== semanticKey(page))
    )
      setExploration(undefined);
  }, [page, exploration]);
  const [selected, setSelected] = useState<string | undefined>(
      resume?.selected,
    ),
    [editing, setEditing] = useState<string>(),
    [draft, setDraft] = useState(""),
    [selectionSpan, setSelectionSpan] = useState<{
      start: number;
      end: number;
    }>();
  const [canvasSelection, setCanvasSelection] = useState<string[]>(
    resume?.selection || [],
  );
  const [draftLinks, setDraftLinks] = useState<Record<string, string>>({});
  const [caret, setCaret] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState(false);
  type LinkTarget = {
    region?: string;
    artifact?: string;
    view?: string;
    symbol?: string;
    unsupported?: string;
  };
  const [dataSelection, setDataSelection] = useState<DataSelection>();
  const [collapsedData, setCollapsedData] = useState<string[]>([]);
  const [dataReview, setDataReview] = useState<{
    dataset: string;
    columns: number[];
    rows: number[];
    output?: string;
    at: Point;
    kind?: DataSelection["kind"];
  }>();
  const dataGesture = useRef<
    | {
        dataset: string;
        columns: number[];
        start: Point;
        client: Point;
        moved: boolean;
      }
    | undefined
  >(undefined);
  const [dataDrag, setDataDrag] = useState<{
    start: Point;
    end: Point;
    target?: string;
  }>();
  const openDataReview = (
    dataset: string,
    columns: number[],
    rows: number[],
    output?: string,
    at?: Point,
  ) => {
    setDataReview({
      dataset,
      columns,
      rows,
      output,
      kind: dataSelection?.kind,
      at: at || {
        x: viewportScroll(canvas.current).x / zoom + 80,
        y: viewportScroll(canvas.current).y / zoom + 45,
      },
    });
  };
  const chooseData = (selection: DataSelection) => {
    setDataSelection(selection);
    setSelected(selection.view || selection.dataset);
    setArtifactFocus(undefined);
    setTerm(undefined);
    const bound = page.regions.find(
      (r) =>
        r.source?.dataset === selection.dataset &&
        selection.rows.includes(r.source.row) &&
        selection.columns.includes(r.source.column),
    );
    setAreaSelection(bound?.id);
  };
  const linkGesture = useRef<
    { source: string; start: Point; client: Point; moved: boolean } | undefined
  >(undefined);
  const [linkDrag, setLinkDrag] = useState<{
    source: string;
    start: Point;
    end: Point;
    target?: LinkTarget;
  }>();
  const [linkMenu, setLinkMenu] = useState<{
    source: string;
    at: Point;
    mode: "actions" | "inspect" | "review" | "choose";
    target?: LinkTarget;
  }>();
  const [selectedFrames, setSelectedFrames] = useState<CanvasFrame[]>([]);
  const [marquee, setMarquee] = useState<CanvasRect>();
  const [canvasScroll, setCanvasScroll] = useState({ x: 0, y: 0 });
  const marqueeGesture = useRef<
    | {
        start: Point;
        client: Point;
        pointerId: number;
        moved: boolean;
        previous: string[];
        additive: boolean;
      }
    | undefined
  >(undefined);
  const suppressCanvasClick = useRef(false);
  const [term, setTerm] = useState<string>(),
    [overlay, setOverlay] = useState<"none" | "dependencies" | "requirements">(
      "none",
    ),
    [compare, setCompare] = useState(false),
    [palette, setPalette] = useState<"slash" | "search">(),
    [query, setQuery] = useState(""),
    [concept, setConcept] = useState<string>(),
    [history, setHistory] = useState(false),
    [message, setMessage] = useState("");
  const initialSystem =
    (resume?.system?.open ?? false) &&
    !resume?.scope &&
    (page.models?.length || 0) > 1;
  const fitSystemZoom = () =>
    Math.max(
      0.35,
      Math.min(
        1,
        (window.innerWidth - 80) / 1680,
        (window.innerHeight - 130) / 900,
      ),
    );
  const [zoom, setZoom] = useState(
      initialSystem && !resume?.system
        ? fitSystemZoom()
        : resume?.camera.zoom || 1,
    ),
    [title, setTitle] = useState(() => {
      try {
        const savedTitle = localStorage.getItem(
          workspaceStorage("manifold.canvas-title.v1"),
        );
        if (savedTitle !== null) return savedTitle;
      } catch {
        /* The engineering archive reports unavailable local storage. */
      }
      return "Untitled page";
    }),
    [dragPreview, setDragPreview] = useState<Record<string, Point>>({});
  useEffect(() => {
    document.title = `${title || "Untitled page"} — Manifold`;
    if (!artifactMode) return;
    try {
      localStorage.setItem(workspaceStorage("manifold.canvas-title.v1"), title);
    } catch {
      /* The engineering archive reports unavailable local storage. */
    }
  }, [title, artifactMode]);
  let places = { ...basePlaces, ...dragPreview };
  if (dataSelection && !!dataSelection.detail && dataSelection.rows.length) {
    const expanded = (page.dataRelations || []).filter(
      (r) =>
        r.dataset === dataSelection.dataset &&
        (!dataSelection.relation || r.id === dataSelection.relation) &&
        !(dataSelection.detail === "calculation"
          ? page.layout[r.output]
          : page.layout[dataSelection.view || ""]) &&
        editing !== r.output,
    );
    for (const r of page.regions)
      if (!page.layout[r.id])
        for (const relation of expanded)
          if (
            basePlaces[r.id].y >
            basePlaces[
              dataSelection.detail === "requirement"
                ? dataSelection.view!
                : relation.output
            ].y
          )
            places[r.id] = {
              ...places[r.id],
              y:
                places[r.id].y +
                (dataSelection.detail === "requirement"
                  ? 115
                  : dataSelection.rows.length > 1
                    ? 170
                    : 145),
            };
  }

  const editor = useRef<HTMLTextAreaElement>(null),
    canvas = useRef<HTMLDivElement>(null),
    continuationLayout = useRef<
      | { id: string; moves: Map<string, { before: Point; after: Point }> }
      | undefined
    >(undefined),
    skipBlur = useRef(false),
    drag = useRef<
      { id: string; x: number; y: number; start: Point } | undefined
    >(undefined);
  const navigation = useCanvasNavigation(
    canvas,
    zoom,
    setZoom,
    !artifactMode || areaCanvasVisible,
    () => fit(),
  );
  const selectedPlot = page.plots.find((plot) => plot.id === selected),
    selectedId =
      selectedPlot?.output ||
      (selected && p.statements.has(selected) ? selected : undefined);
  const [comparison, setComparison] = useState<{
    context: string;
    output: string;
    input?: string;
  }>();
  const comparisonContext =
    comparison?.context &&
    page.contexts.some((c) => c.id === comparison.context)
      ? comparison.context
      : page.active !== "original"
        ? page.active
        : page.contexts.at(-1)?.id !== "original"
          ? page.contexts.at(-1)?.id
          : undefined;
  const expansionId =
    trials.expand && !editing
      ? term
        ? selectedId
        : overlay === "dependencies"
          ? selectedId ||
            page.regions.find((r) => p.kinds[r.id] === "equation")?.id
          : undefined
      : undefined;
  const showComparison =
    trials.spatial &&
    !(artifactMode && artifacts.length) &&
    compare &&
    comparison &&
    comparisonContext &&
    p.statements.has(comparison.output) &&
    !expansionId;
  const focusedInput =
    term &&
    p.sources[term]?.length === 1 &&
    p.kinds[p.sources[term][0]] === "quantity"
      ? p.sources[term][0]
      : undefined;
  const attachmentAnchor =
    (expansionId && focusedInput ? expansionId : undefined) ||
    (showComparison ? comparison!.output : undefined);
  const attachmentId = expansionId
    ? "relationship-expansion"
    : `comparison-${comparisonContext}`;
  const anchor = attachmentAnchor && basePlaces[attachmentAnchor];
  const [attachmentSizes, setAttachmentSizes] = useState({
    expansion: 420,
    comparison: 280,
  });
  const attachmentHeight = expansionId
    ? attachmentSizes.expansion
    : attachmentSizes.comparison;
  useEffect(() => {
    const node = document.querySelector(
      expansionId
        ? ".er-investigation"
        : showComparison
          ? ".er-spatial-compare"
          : ".er-no-attachment",
    );
    if (!node) return;
    const key = expansionId ? "expansion" : "comparison";
    const measure = () => {
      const height = node.getBoundingClientRect().height / zoom;
      setAttachmentSizes((s) =>
        Math.abs(s[key] - height) > 1 ? { ...s, [key]: height } : s,
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return () => observer.disconnect();
  }, [expansionId, focusedInput, !!showComparison, zoom]);
  const attachmentManual = !expansionId && page.layout[attachmentId];
  const inlineAttachment =
    !!anchor &&
    !attachmentManual &&
    (Boolean(expansionId) || viewportWidth / zoom < 1330);
  const attachmentAt = anchor
    ? attachmentManual || {
        x: expansionId
          ? anchor.x + 130
          : inlineAttachment
            ? anchor.x
            : anchor.x + 630,
        y: inlineAttachment
          ? anchor.y + (expansionId ? 165 : 90)
          : Math.max(
              anchor.y,
              ...page.plots
                .filter(
                  (plot) =>
                    Math.abs(basePlaces[plot.id].x - (anchor.x + 630)) < 500,
                )
                .map((plot) => basePlaces[plot.id].y + plot.height + 65),
            ),
      }
    : { x: 110, y: 110 };
  if (inlineAttachment) {
    places = { ...places };
    for (const region of page.regions)
      if (
        region.id !== attachmentAnchor &&
        !page.layout[region.id] &&
        basePlaces[region.id].y > anchor!.y
      )
        places[region.id] = {
          ...places[region.id],
          y: places[region.id].y + attachmentHeight + (expansionId ? 100 : 25),
        };
    for (const plot of page.plots)
      if (!plot.at)
        places[plot.id] = { ...places[plot.id], y: places[plot.output].y };
  }
  if (expansionId && !focusedInput)
    for (const region of page.regions)
      if (
        region.id !== expansionId &&
        !page.layout[region.id] &&
        basePlaces[region.id].y > basePlaces[expansionId].y
      )
        places[region.id] = {
          ...places[region.id],
          y: places[region.id].y + 85,
        };
  // Default flow yields to a spatial artifact; detached regions keep their positions.
  if (artifactMode) {
    let nextY = page.origin.y;
    for (const r of page.regions) {
      if (page.layout[r.id] || dragPreview[r.id]) continue;
      let y = Math.max(places[r.id].y, nextY);
      for (const frame of [...artifactFrames].sort((a, b) => a.at.y - b.at.y)) {
        if (
          places[r.id].x < frame.at.x + frame.width &&
          places[r.id].x + 500 > frame.at.x &&
          y + 70 > frame.at.y &&
          y < frame.at.y + frame.height + 24
        )
          y = frame.at.y + frame.height + 36;
      }
      places[r.id] = { ...places[r.id], y };
      nextY = y + 92;
    }
  }
  const canvasPoint = (clientX: number, clientY: number): Point => {
    const node = canvas.current!,
      rect = node.getBoundingClientRect();
    return {
      x: (clientX - rect.left + viewportScroll(node).x) / zoom,
      y: (clientY - rect.top + viewportScroll(node).y) / zoom,
    };
  };
  const readCanvasFrames = (): CanvasFrame[] => {
    const node = canvas.current;
    if (!node) return [];
    const origin = node.getBoundingClientRect();
    return [
      ...node.querySelectorAll<HTMLElement>(
        "[data-region-id],[data-plot-id],[data-view-id],[data-tool-id],[data-data-relation-id],[data-model-id]",
      ),
    ]
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => {
        const rect = el.getBoundingClientRect(),
          region = el.dataset.regionId;
        let right = rect.right,
          bottom = rect.bottom;
        if (region) {
          const parts = [
            ...el.querySelectorAll(
              "math,.er-result,.er-condition,.er-region-error,textarea,.er-data,.er-external-reference,.er-source-caption,.er-record-feedback",
            ),
          ].map((part) => part.getBoundingClientRect());
          const note = el.querySelector(".er-note");
          if (note) {
            const range = document.createRange();
            range.selectNodeContents(note);
            parts.push(range.getBoundingClientRect());
          }
          if (parts.length) {
            right = Math.max(...parts.map((r) => r.right));
            bottom = Math.max(
              rect.top + 50 * zoom,
              ...parts.map((r) => r.bottom),
            );
          }
        }
        return {
          id:
            region ||
            el.dataset.viewId ||
            el.dataset.toolId ||
            el.dataset.modelId ||
            el.dataset.dataRelationId ||
            el.dataset.plotId!,
          kind: region ? "region" : "plot",
          x: (rect.left - origin.left + viewportScroll(node).x) / zoom,
          y: (rect.top - origin.top + viewportScroll(node).y) / zoom,
          width: Math.max(30, (right - rect.left) / zoom),
          height: Math.max(30, (bottom - rect.top) / zoom),
        };
      });
  };
  const spatial = useCanvasScene({
    page,
    session,
    artifacts,
    setArtifacts,
    canvas,
    zoom,
    setZoom,
    places,
    readFrames: readCanvasFrames,
  });
  useEffect(() => {
    drag.current = undefined;
    setDragPreview({});
  }, [spatial.cancelVersion]);
  places = { ...places, ...spatial.preview };
  const [viewName, setViewName] = useState("");
  const [modelReview, setModelReview] = useState<{
    members: string[];
    existing?: NestedModel;
  }>();
  const [modelTrace, setModelTrace] = useState<string>();
  const [modelConnection, setModelConnection] = useState<string>();
  const [modelConnectionTarget, setModelConnectionTarget] = useState<string>();
  const hierarchy = useModels({
    initial: resume,
    page,
    artifacts,
    tools: spatial.scene.tools,
    canvas,
    zoom,
    setZoom,
    frames: readCanvasFrames,
    clear: () => {
      setDataSelection(undefined);
      setCanvasSelection([]);
      setArtifactFocus(undefined);
      setTerm(undefined);
      setOverlay("none");
      setLinkMenu(undefined);
      setModelTrace(undefined);
    },
    select: setSelected,
    view: () => (systemActive ? "system" : "canvas"),
    restoreView: (view) => setSystemOpen(view === "system"),
  });
  const [systemOpen, setSystemOpen] = useState(resume?.system?.open ?? false);
  const [systemInvestigating, setSystemInvestigating] = useState(
    resume?.system?.investigating ?? false,
  );
  const [systemFailure, setSystemFailure] = useState<string | undefined>(
    resume?.system?.failure,
  );
  const [systemPath, setSystemPath] = useState<InvestigationPath>();
  const [systemReference, setSystemReference] = useState<string>();
  const [systemResponse, setSystemResponse] = useState<InvestigationView>(
    resume?.system?.inspectionVersion === 2
      ? resume.system.response || "contextual"
      : resume?.system?.response === "detached"
        ? "detached"
        : "contextual",
  );
  const [systemAnchor, setSystemAnchor] = useState<string | undefined>(
    resume?.system?.anchor,
  );
  const [systemPositions, setSystemPositions] = useState<Record<string, Point>>(
    resume?.system?.positions || {},
  );
  const [systemInput, setSystemInput] = useState<string | undefined>(
    resume?.system?.input ||
      page.models?.find((m) => m.presentation?.exploreInput)?.presentation
        ?.exploreInput,
  );
  const [systemOutput, setSystemOutput] = useState<string | undefined>(
    resume?.system?.output || findBalance(page)?.output,
  );
  const systemCanvasCamera = useRef(
    resume?.system?.canvas ||
      (initialSystem ? resume?.camera || { x: 0, y: 0, zoom: 1 } : undefined),
  );
  const systemActive =
    systemOpen && !hierarchy.scope && (page.models?.length || 0) > 1;
  const openSystem = () => {
    if (editing && !commit()) return;
    setEditing(undefined);
    if (!systemOpen)
      systemCanvasCamera.current = {
        x: viewportScroll(canvas.current).x,
        y: viewportScroll(canvas.current).y,
        zoom,
      };
    if (hierarchy.scope) hierarchy.go(undefined);
    setSystemOpen(true);
    if (!systemOutput) setSystemOutput(findBalance(page)?.output);
    if (!systemInput)
      setSystemInput(
        page.models?.find((m) => m.presentation?.exploreInput)?.presentation
          ?.exploreInput ||
          (findBalance(page)
            ? balanceInputs(page, findBalance(page)!)[0]
            : undefined) ||
          page.regions.find((r) => p.kinds[r.id] === "quantity")?.id,
      );
    if (!hierarchy.scope) {
      setZoom(fitSystemZoom());
      requestAnimationFrame(() =>
        scrollCanvasTo(canvas.current, { left: 0, top: 0 }),
      );
    }
  };
  const closeSystem = () => {
    setOverlay("none");
    setSystemOpen(false);
    const prior = systemCanvasCamera.current;
    if (prior) {
      setZoom(prior.zoom);
      hierarchy.cameras.set("root", prior);
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          scrollCanvasTo(canvas.current, { left: prior.x, top: prior.y }),
        ),
      );
    }
  };
  const enterSystemModel = (id: string) => {
    if (editing && !commit()) return;
    setEditing(undefined);
    hierarchy.go(id);
  };
  const followSystemQuantity = (id: string) => {
    if (editing && !commit()) return;
    setEditing(undefined);
    if (p.kinds[id] === "quantity" && !systemInvestigating) setSystemInput(id);
    hierarchy.reveal(id);
    if (!hierarchy.owner(id)) setSystemOpen(false);
  };
  const investigateFailure = (id: string) => {
    if (editing && !commit()) return;
    const check = assessConstraint(working, id);
    if (!check) {
      followSystemQuantity(id);
      return;
    }
    setEditing(undefined);
    setSystemFailure(id);
    setSystemOutput(check.definition);
    setSystemAnchor(hierarchy.owner(id));
    setSelected(hierarchy.owner(id) || id);
    setSystemPath(undefined);
    setSystemResponse("contextual");
    setSystemInvestigating(true);
    setOverlay("none");
    // Follow the engineering question with the camera; never move its models.
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        revealCanvasElement(canvas.current?.querySelector(".sx-failure"), {
          block: "nearest",
          inline: "nearest",
        }),
      ),
    );
  };
  const hierarchyRepresentations = artifacts.map((a) => ({
    id: a.id,
    input: a.input,
    output: a.output,
  }));
  const prepareModel = (ids: string[]) => {
    if (editing && !commit()) return;
    const members = [...new Set(ids.map(hierarchy.canonical))];
    if (!members.length) return;
    setModelReview({ members });
  };
  for (const f of spatial.frames)
    if (!hierarchy.visible(f.id)) spatial.hidden.add(f.id);

  useLayoutEffect(() => {
    const frames = canvasSelection.length
      ? readCanvasFrames().filter((f) => canvasSelection.includes(f.id))
      : [];
    setSelectedFrames((previous) =>
      JSON.stringify(previous) === JSON.stringify(frames) ? previous : frames,
    );
  }, [
    canvasSelection,
    page,
    artifacts,
    artifactHeights,
    zoom,
    editing,
    term,
    overlay,
    dragPreview,
    spatial.preview,
  ]);
  const selectionBounds = frameBounds(selectedFrames);
  const organizeSelection = () => {
    const frames = readCanvasFrames().filter((f) =>
        canvasSelection.includes(f.id),
      ),
      bounds = frameBounds(frames);
    if (!bounds || frames.length < 2) return;
    const available =
      (canvas.current!.clientWidth + viewportScroll(canvas.current!).x - 32) /
        zoom -
      bounds.x;
    const placements = organizeFrames(frames, available);
    if (
      !frames.some(
        (f) =>
          Math.abs(f.x - placements[f.id].x) > 0.5 ||
          Math.abs(f.y - placements[f.id].y) > 0.5,
      )
    )
      return;
    spatial.patchPositions(placements);
  };
  const selectedEvidence = page.regions.find(
    (r) => r.id === (areaSelection || selected),
  )?.source;
  const activeData =
    dataSelection ||
    (selectedEvidence
      ? {
          dataset: selectedEvidence.dataset,
          rows: [selectedEvidence.row],
          columns: [selectedEvidence.column],
        }
      : undefined);
  const scalarData = activeData
    ? page.regions.filter(
        (r) =>
          r.source?.dataset === activeData?.dataset &&
          (!activeData?.columns.length ||
            activeData.columns.includes(r.source!.column)),
      )
    : [];
  const scalarDataIds = new Set(scalarData.map((r) => r.id));
  for (const r of page.regions)
    if (ancestors(accepted, r.id).some((id) => scalarDataIds.has(id)))
      scalarDataIds.add(r.id);
  const relatedData = (page.dataRelations || []).filter(
    (r) =>
      r.dataset === activeData?.dataset &&
      (!activeData?.relation || activeData.relation === r.id),
  );
  const dataSymbols = new Set([
    ...scalarData.map((r) => accepted.statements.get(r.id)?.name || ""),
    ...relatedData.flatMap((r) =>
      r.bindings
        .filter(
          (b) =>
            !activeData?.columns.length ||
            activeData.columns.includes(b.column),
        )
        .map((b) =>
          b.quantity
            ? accepted.statements.get(b.quantity)?.name || b.symbol
            : b.symbol,
        ),
    ),
  ]);
  const dataRelatedIds = new Set([
    ...scalarDataIds,
    ...(activeData ? [activeData.dataset] : []),
    ...relatedData.flatMap((r) => [
      r.dataset,
      r.output,
      ...r.bindings.map((b) => b.quantity).filter((id): id is string => !!id),
      ...[...accepted.statements]
        .filter(
          ([, s]) =>
            s.relation !== "=" &&
            s.name === accepted.statements.get(r.output)?.name,
        )
        .map(([id]) => id),
    ]),
  ]);
  const relationshipNav = useRelationshipNavigation({
    page,
    selection: activeData,
    canvas,
    zoom,
    setZoom,
    frames: readCanvasFrames,
    collapsed: collapsedData,
    setCollapsed: setCollapsedData,
    persist: (positions) => spatial.patchPositions(positions),
    choose: (selection) => {
      if (selection) {
        const target = selection.view || selection.dataset;
        if (!hierarchy.visible(target)) hierarchy.reveal(target);
        chooseData(selection);
      } else {
        setDataSelection(undefined);
        setAreaSelection(undefined);
        setSelected(undefined);
      }
    },
  });
  const activeRelation =
    relatedData.find(
      (r) => r.id === (activeData?.relation || relationshipNav.focus?.relation),
    ) || relatedData[0];
  if (relationshipNav.focus)
    places = { ...places, ...relationshipNav.focus.positions };
  const linkedArtifact = artifacts.find((a) => a.id === artifactFocus?.id);
  const linkedName =
    linkedArtifact &&
    accepted.statements.get(
      artifactFocus?.target === "input" ||
        artifactFocus?.target === "point" ||
        artifactFocus?.target === "range"
        ? artifactFocus?.quantity || linkedArtifact.input
        : linkedArtifact.output,
    )?.name;
  const linkedRequirement =
    linkedArtifact &&
    (linkedArtifact.requirement ||
      [...accepted.statements].find(
        ([, s]) =>
          s.relation !== "=" &&
          s.name === accepted.statements.get(linkedArtifact.output)?.name,
      )?.[0]);
  const pointControls = artifactFocus?.target === "point" && linkedArtifact;
  const revertExploration = () => {
    proposalRef.current = undefined;
    setExploration(undefined);
    setGestureActive(false);
  };
  const exploreValue = (id: string, value: number, anchor?: Element) => {
    try {
      const proposal = proposeValue(page, id, value);
      proposalRef.current = proposal;
      if (anchor) previewAnchor.current = anchor;
      setGestureActive(true);
      setLastEdit(undefined);
      if (!expansionId) setSelected(id);
      setExploration(proposal);
      setMessage("");
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  const scrubFor = (id: string): Scrub | undefined => {
    const s = p.statements.get(id),
      q = s && p.solved.values.get(s.name);
    if (!trials.scrub || !q || p.kinds[id] !== "quantity" || p.errors.has(id))
      return;
    return {
      quantity: q,
      explore: (value, anchor) => exploreValue(id, value, anchor),
      finish: finishValue,
      revert: revertExploration,
    };
  };
  const chooseTerm = (id: string, name: string) => {
    revealAreaCanvas.current?.();
    const source = accepted.sources[name]?.[0];
    if (source && !hierarchy.visible(source)) {
      setModelTrace(source);
      return;
    }
    setSelected(id);
    const a =
      artifactMode && artifacts.find((a) => a.output === id || a.input === id);
    if (a) {
      const quantity = accepted.sources[name]?.[0];
      setArtifactFocus({
        id: a.id,
        target:
          quantity && accepted.kinds[quantity] === "quantity"
            ? "input"
            : "expression",
        quantity,
      });
      setTerm(undefined);
      return;
    }
    setTerm(name);
  };
  const applyProposal = (proposal?: Exploration) => {
    if (
      !proposal ||
      proposal.context !== page.active ||
      proposal.key !== semanticKey(page)
    ) {
      revertExploration();
      return;
    }
    const projection = project(previewPage(page, proposal));
    const invalid = [...projection.errors].some(
      ([id]) =>
        id === proposal.input ||
        ancestors(projection, id).includes(proposal.input),
    );
    if (invalid) {
      if (immediate) {
        revertExploration();
        setMessage("Undefined result. The value was restored.");
      }
      return;
    }
    const name = accepted.statements.get(proposal.input)?.name;
    const previous = name && accepted.solved.values.get(name);
    const result = session.write(proposal.input, proposal.text);
    if (result.ok) {
      if (previous)
        setLastEdit({
          page: session.state,
          before: page,
          previous,
          input: proposal.input,
          anchor: previewAnchor.current,
        });
      revertExploration();
    } else {
      revertExploration();
      setMessage(result.error || "Could not change this value.");
    }
  };
  function finishValue() {
    setGestureActive(false);
    if (immediate) applyProposal(proposalRef.current);
  }
  const acceptExploration = () => applyProposal(exploration);
  const related = useMemo(() => {
    const ids = new Set<string>();
    if (!selectedId) return ids;
    ids.add(selectedId);
    ancestors(p, selectedId).forEach((id) => ids.add(id));
    for (const r of page.regions)
      if (ancestors(p, r.id).includes(selectedId)) ids.add(r.id);
    return ids;
  }, [page, selectedId, p]);
  const begin = (id: string, span?: { start: number; end: number }) => {
    if (page.regions.find((r) => r.id === id)?.external) {
      setReferenceEditor(id);
      return;
    }
    revealAreaCanvas.current?.();
    setCanvasSelection([]);
    setExploration(undefined);
    setSelected(id);
    setEditing(id);
    setDraft(accepted.texts[id] ?? "");
    setDraftLinks(page.links?.[id] || {});
    setCaret(span?.start ?? (accepted.texts[id] || "").length);
    setMentionDismissed(false);
    setLinkMenu(undefined);
    setSelectionSpan(
      exploration?.input === id
        ? sourceSpans(accepted.texts[id] || "")[0]
        : span,
    );
    setTerm(undefined);
    setMessage("");
    skipBlur.current = false;
  };
  useEffect(() => {
    if (editing) {
      editor.current?.focus();
      const end = editor.current?.value.length || 0;
      editor.current?.setSelectionRange(
        selectionSpan?.start ?? end,
        selectionSpan?.end ?? end,
      );
      revealCanvasElement(editor.current, {
        block: "nearest",
        inline: "nearest",
      });
    }
  }, [editing, selectionSpan]);
  const writingPoint = () => {
    const at = {
      x: viewportScroll(canvas.current).x / zoom + 110,
      y: viewportScroll(canvas.current).y / zoom + 110,
    };
    // Find room below existing work. Explicit pointer placement stays freeform.
    for (const frame of readCanvasFrames().sort((a, b) => a.y - b.y)) {
      if (
        at.x < frame.x + frame.width &&
        at.x + 460 > frame.x &&
        at.y < frame.y + frame.height &&
        at.y + 70 > frame.y
      )
        at.y = frame.y + frame.height + 28;
    }
    return at;
  };
  const fresh = (at?: Point, text = "") => {
    if (systemActive) closeSystem();
    setDataSelection(undefined);
    setAreaSelection(undefined);
    setDataReview(undefined);
    revealAreaCanvas.current?.();
    if (editing && !commit()) return;
    setCanvasSelection([]);
    setExploration(undefined);
    const id = session.create(at, hierarchy.scope);
    setSelected(id);
    setEditing(id);
    setDraft(text);
    setSelectionSpan(undefined);
    setDraftLinks({});
    setCaret(0);
    setMentionDismissed(false);
    setLinkMenu(undefined);
    setTerm(undefined);
    skipBlur.current = false;
  };
  const commit = (continuation = false) => {
    if (!editing) return true;
    const result = session.write(
      editing,
      draft,
      continuation,
      Object.keys(draftLinks).length ? draftLinks : undefined,
    );
    if (!result.ok) {
      setMessage(result.error || "Could not use this edit.");
      return false;
    }
    const temporary = continuationLayout.current;
    if (temporary?.id === editing) {
      if (!draft.trim()) {
        const restoreAt = <T extends { id: string; at: Point }>(view: T): T => {
          const move = temporary.moves.get(view.id);
          return move &&
            view.at.x === move.after.x &&
            view.at.y === move.after.y
            ? { ...view, at: move.before }
            : view;
        };
        setArtifacts((current) =>
          current.map((a) => ({
            ...restoreAt(a),
            ...(a.views ? { views: a.views.map(restoreAt) } : {}),
          })),
        );
      }
      continuationLayout.current = undefined;
    }
    if (continuation && result.next) {
      // Make space immediately below the authored line before the existing
      // flow layout yields to a plot. This changes presentation only.
      const at = places[editing];
      if (at && artifactMode) {
        const moves = new Map<string, { before: Point; after: Point }>();
        const below =
          at.y + Math.max(92, 65 + (draft.split("\n").length - 1) * 25);
        const clearLine = <
          T extends { id: string; at: Point; width: number; height: number },
        >(
          view: T,
        ): T => {
          if (
            at.x < view.at.x + view.width &&
            at.x + 500 > view.at.x &&
            below + 70 > view.at.y &&
            below < view.at.y + (artifactHeights[view.id] || view.height) + 24
          ) {
            const after = { ...view.at, y: below + 92 };
            moves.set(view.id, { before: view.at, after });
            return { ...view, at: after };
          }
          return view;
        };
        const arranged = artifacts.map((a) => ({
          ...clearLine(a),
          ...(a.views ? { views: a.views.map(clearLine) } : {}),
        }));
        if (moves.size) {
          setArtifacts(arranged);
          continuationLayout.current = { id: result.next, moves };
        }
      }
      setSelected(result.next);
      setEditing(result.next);
      setDraft("");
      setDraftLinks({});
      setCaret(0);
      setMentionDismissed(false);
      setSelectionSpan(undefined);
    } else {
      setEditing(undefined);
      if (!session.state.regions.some((r) => r.id === editing))
        setSelected(undefined);
    }
    return true;
  };
  const plotSelection = (candidate?: string) => {
    if (artifactMode) {
      createArtifact(undefined, candidate);
      return;
    }
    const id = candidate || (term && p.sources[term]?.[0]) || selectedId;
    if (!id) return;
    let output = id,
      input: string | undefined;
    if (p.kinds[id] === "quantity") {
      input = id;
      output =
        page.regions.find(
          (r) =>
            p.kinds[r.id] === "equation" && ancestors(p, r.id).includes(id),
        )?.id || "";
    } else
      input = ancestors(p, id)
        .filter((ref) => p.kinds[ref] === "quantity")
        .sort((a, b) =>
          (p.statements.get(a)?.name || "").localeCompare(
            p.statements.get(b)?.name || "",
          ),
        )[0];
    if (!input || !output) {
      setMessage(
        "Select a resolved equation or an assigned quantity with a downstream equation.",
      );
      return;
    }
    try {
      const id = session.addPlot(output, input);
      setSelected(id);
      setTerm(undefined);
      setPalette(undefined);
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  const branch = () => {
    if (exploration) {
      setMessage(
        "Accept or revert the preview before creating an alternative.",
      );
      return;
    }
    if (
      !page.regions.some(
        (r) =>
          accepted.kinds[r.id] === "quantity" && !accepted.errors.has(r.id),
      )
    ) {
      setMessage("Define an assigned quantity before trying an alternative.");
      return;
    }
    const output =
      selectedId && accepted.kinds[selectedId] === "equation"
        ? selectedId
        : responseFor(page, selectedId || "", term)?.output ||
          page.regions.find((r) => accepted.kinds[r.id] === "equation")?.id;
    const context = session.branch();
    const input =
      selectedId && accepted.kinds[selectedId] === "quantity"
        ? selectedId
        : (term && accepted.sources[term]?.[0]) ||
          (output && responseFor(page, output, term)?.input);
    if (output) setComparison({ context, output, input: input || undefined });
    setCompare(!quiet);
    setOverlay("none");
    setPalette(undefined);
    setTerm(undefined);
    setMessage("");
  };
  const setInput = (id: string, value: number, anchor?: Element) => {
    if (trials.scrub) exploreValue(id, value, anchor);
    else {
      try {
        const proposal = proposeValue(page, id, value);
        const result = session.write(id, proposal.text);
        if (!result.ok)
          setMessage(result.error || "Could not change this input.");
      } catch (e) {
        setMessage((e as Error).message);
      }
    }
  };
  const fit = () => {
    revealAreaCanvas.current?.();
    requestAnimationFrame(() => {
      const bounds = systemActive
          ? frameBounds([
              ...readCanvasFrames().filter((f) =>
                page.models?.some((m) => m.id === f.id),
              ),
              {
                id: "$system",
                kind: "plot",
                x: 40,
                y: 90,
                width:
                  canvas.current?.querySelector<HTMLElement>(
                    "[data-system-overview]",
                  )?.offsetWidth || 1600,
                height:
                  canvas.current?.querySelector<HTMLElement>(
                    "[data-system-overview]",
                  )?.offsetHeight || 850,
              },
            ])
          : frameBounds([
              ...spatial.frames
                .filter(
                  (f) => hierarchy.visible(f.id) && !spatial.closed.has(f.id),
                )
                .map((f) => ({ ...f, ...places[f.id] })),
              ...(attachmentAnchor
                ? [
                    {
                      id: attachmentId,
                      kind: "plot" as const,
                      ...attachmentAt,
                      width: 600,
                      height: attachmentHeight,
                    },
                  ]
                : []),
            ]),
        viewport = canvas.current;
      if (!bounds || !viewport) return;
      const z = Math.max(
        0.1,
        Math.min(
          1,
          (viewport.clientWidth - 120) / bounds.width,
          (viewport.clientHeight - 160) / bounds.height,
        ),
      );
      setZoom(z);
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          scrollCanvasTo(viewport, {
            left: bounds.x * z - 60,
            top: bounds.y * z - 110,
          }),
        ),
      );
    });
  };
  const paletteOpen = (kind: "slash" | "search") => {
    setPalette(kind);
    setQuery("");
    setConcept(undefined);
  };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const active = (event.target as HTMLElement).closest(
        "input,textarea,select,[role=separator],[contenteditable=true]",
      );
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        paletteOpen("search");
        return;
      }
      if (active) return;
      if (
        (event.target as HTMLElement).closest(
          "button,a,[role=button],summary",
        ) &&
        [
          "Enter",
          " ",
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
        ].includes(event.key)
      )
        return;
      // Begin writing in the viewport without choosing an object type.
      // Preserve control activation, composition input, shortcuts and Space-pan.
      if (
        event.key.length === 1 &&
        event.key !== " " &&
        event.key !== "/" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.isComposing &&
        !event.defaultPrevented &&
        !(event.target as HTMLElement).closest(
          "button,a,summary,[role=button]",
        ) &&
        !editing &&
        !selected &&
        !canvasSelection.length &&
        !palette &&
        !concept &&
        !referenceEditor &&
        !history &&
        !systemActive &&
        !exploration &&
        !dataReview &&
        !linkMenu &&
        !navigation.className
      ) {
        event.preventDefault();
        fresh(writingPoint(), event.key);
        return;
      }
      if (event.key === "/") {
        event.preventDefault();
        paletteOpen("slash");
      }
      if (event.key === "Escape") {
        if (relationshipNav.focus) {
          event.preventDefault();
          relationshipNav.restore();
          return;
        }
        if (relationshipNav.trace) {
          relationshipNav.setTrace(false);
          return;
        }
        if (dataReview || dataDrag || dataSelection) {
          dataGesture.current = undefined;
          setDataDrag(undefined);
          setDataReview(undefined);
          setDataSelection(undefined);
          suppressCanvasClick.current = true;
          return;
        }
        if (linkGesture.current || linkDrag || linkMenu) {
          linkGesture.current = undefined;
          setLinkDrag(undefined);
          setLinkMenu(undefined);
          suppressCanvasClick.current = true;
          return;
        }
        if (spatial.focus && !exploration && !palette && !term) {
          spatial.restoreFocus();
          return;
        }
        if (marqueeGesture.current) {
          const gesture = marqueeGesture.current;
          setCanvasSelection(gesture.previous);
          marqueeGesture.current = undefined;
          setMarquee(undefined);
          suppressCanvasClick.current = true;
          if (canvas.current?.hasPointerCapture(gesture.pointerId))
            canvas.current.releasePointerCapture(gesture.pointerId);
          return;
        }
        if (canvasSelection.length) {
          setCanvasSelection([]);
          setSelected(undefined);
          return;
        }
        if (exploration) {
          setExploration(undefined);
          return;
        }
        if (artifactFocus) {
          setArtifactFocus(undefined);
          return;
        }
        if (palette) setPalette(undefined);
        else if (term) setTerm(undefined);
        else if (trials.expand && overlay !== "none") setOverlay("none");
        else if (concept) setConcept(undefined);
        else if (history) setHistory(false);
        else setSelected(undefined);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (exploration) {
          setExploration(undefined);
          return;
        }
        setExploration(undefined);
        session.undo();
        setEditing(undefined);
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (selectedId || selected) begin(selectedId || selected!);
        else fresh();
      }
      if (
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
          event.key,
        ) &&
        !systemActive &&
        selected &&
        places[selected]
      ) {
        event.preventDefault();
        const point = places[selected],
          step = event.shiftKey ? 20 : 5;
        session.move(selected, {
          x:
            point.x +
            (event.key === "ArrowRight"
              ? step
              : event.key === "ArrowLeft"
                ? -step
                : 0),
          y:
            point.y +
            (event.key === "ArrowDown"
              ? step
              : event.key === "ArrowUp"
                ? -step
                : 0),
        });
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  });
  useWorkspaceMemory({
    enabled: artifactMode && !saved?.error,
    canvas,
    page,
    zoom,
    scope: hierarchy.scope,
    selected,
    selection: canvasSelection,
    cameras: hierarchy.cameras,
    history: hierarchy.history,
    initial:
      resume && initialSystem && !resume.system
        ? { ...resume, camera: { x: 0, y: 0, zoom } }
        : resume,
    system: {
      open: systemOpen,
      input: systemInput,
      investigating: systemInvestigating,
      anchor: systemAnchor,
      response: systemResponse,
      inspectionVersion: 2,
      positions: systemPositions,
      output: systemOutput,
      failure: systemFailure,
      canvas: systemCanvasCamera.current,
    },
    stable:
      !relationshipNav.focus &&
      !hierarchy.transitioning &&
      !spatial.focus &&
      !editing &&
      !marquee &&
      !spatial.moving(),
  });
  const dependencyEdges = page.regions.flatMap((r) =>
    Object.entries(p.bindings[r.id] || {}).map(([name, id]) => ({
      name,
      from: id,
      to: r.id,
    })),
  );
  const writeSystemInput: (id: string, value: string) => string | undefined = (
    id,
    value,
  ) => {
    const before = project(page),
      statement = before.statements.get(id);
    if (!statement || before.kinds[id] !== "quantity")
      return "Enter the model to edit this relationship.";
    const text = `${statement.name} := ${value}`;
    const trial = new RegionSession(page);
    const result = trial.write(id, text);
    if (!result.ok) return result.error;
    const after = project(trial.state),
      a = before.solved.values.get(statement.name),
      b = after.solved.values.get(statement.name);
    if (
      !a ||
      !b ||
      !Number.isFinite(b.value) ||
      after.errors.has(id) ||
      after.kinds[id] !== "quantity" ||
      !same(a.dimension, b.dimension) ||
      !!a.absolute !== !!b.absolute
    )
      return "Use a value with the same units as this input.";
    if (
      [...after.errors].some(
        ([key]) =>
          !before.errors.has(key) && ancestors(after, key).includes(id),
      )
    )
      return "This value leaves an affected calculation undefined.";
    const accepted = session.write(id, text);
    return accepted.ok
      ? undefined
      : accepted.error || "Could not change this input.";
  };
  const internalInvestigation =
    systemInvestigating &&
    systemResponse === "internal" &&
    hierarchy.scope === systemAnchor;
  useLayoutEffect(() => {
    if (!internalInvestigation) return;
    let cancelled = false;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!cancelled)
          revealCanvasElement(
            canvas.current?.querySelector(".sx-internal-investigation"),
            { block: "nearest", inline: "nearest" },
          );
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [internalInvestigation, hierarchy.scope]);
  const internalRegions = (
    page.models?.find((m) => m.id === hierarchy.scope)?.members || []
  ).flatMap((id) => {
    const region = page.regions.find((r) => r.id === id);
    if (!region) return [];
    const measured = spatial.frames.find((f) => f.id === id);
    return [
      {
        id,
        ...(places[id] || { x: 100, y: 130 }),
        width: Math.max(550, measured?.width || 0),
        height: Math.max(
          100,
          measured?.height || 0,
          p.kinds[id] === "note"
            ? Math.ceil(region.text.length / 48) * 29 + 45
            : 100,
        ),
      },
    ];
  });
  const internalOrigin = internalRegions.find(
    (r) => p.kinds[r.id] === "quantity",
  ) ||
    internalRegions[0] || {
      id: "origin",
      x: 100,
      y: 170,
      width: 550,
      height: 100,
    };
  const internalAt = placeInvestigation(internalOrigin, internalRegions, {
    width: 520,
    height: 520,
  });
  const width =
    Math.max(
      1100,
      ...(page.models || []).map((m) => hierarchy.at(m.id).x + 420),
      ...page.regions.map((r) => places[r.id].x + 550),
      ...page.plots.map((plot) => places[plot.id].x + plot.width + 70),
      ...(page.dataRelations || []).map((r) => places[r.id].x + 650),
      ...artifactFrames.map((a) => a.at.x + a.width + 70),
      ...spatial.scene.tools.map((t) => t.at.x + t.width + 70),
      ...(attachmentAnchor ? [attachmentAt.x + 650] : []),
      ...(internalInvestigation ? [internalAt.x + 560] : []),
    ) +
    (canvas.current?.clientWidth || 850) / zoom;
  const height =
    Math.max(
      850,
      ...(page.models || []).map((m) => hierarchy.at(m.id).y + 650),
      ...page.regions.map((r) => places[r.id].y + 200),
      ...page.plots.map((plot) => places[plot.id].y + plot.height + 100),
      ...(page.dataRelations || []).map((r) => places[r.id].y + 600),
      ...artifactFrames.map((a) => a.at.y + a.height + 100),
      ...spatial.scene.tools.map((t) => t.at.y + t.height + 100),
      ...(attachmentAnchor ? [attachmentAt.y + attachmentHeight + 80] : []),
      ...(internalInvestigation ? [internalAt.y + 600] : []),
    ) +
    (canvas.current?.clientHeight || 800) / zoom;
  const original =
    compare && !(artifactMode && artifacts.length)
      ? project(page, "original")
      : undefined;
  const refs = term ? p.sources[term] || [] : [];
  const contexts = page.contexts;
  const switchScenario = (id: string) => {
    if (editing && !commit()) return;
    session.switchContext(id);
    if (id !== "original" && comparison)
      setComparison({ ...comparison, context: id });
    setEditing(undefined);
    setExploration(undefined);
  };
  const createArtifact = (
    request?: string,
    candidate?: string,
    atOverride?: Point,
    inputOverride?: string,
  ) => {
    try {
      if (artifacts.length >= 16)
        throw Error("This experiment supports up to 16 artifacts.");
      const source = candidate || selectedId;
      if (!source) throw Error("Select the equation to compute from first.");
      const response = responseFor(
        page,
        source,
        inputOverride ? accepted.statements.get(inputOverride)?.name : term,
      );
      if (!response)
        throw Error("Select an equation with resolved assigned inputs.");
      const input = accepted.statements.get(response.input)!;
      const output = accepted.statements.get(response.output)!;
      const q = accepted.solved.values.get(input.name)!;
      const value = q.absolute ? q.value - 273.15 : q.value;
      const delta = Math.abs(value) || 1;
      const generatedRequest = `Plot ${output.name} versus ${input.name} from ${value - delta * 0.75} to ${value + delta * 1.5}`;
      const a = makeArtifact(
        page,
        response.output,
        request || generatedRequest,
      );
      const at = positions(page)[response.output];
      const spot =
        atOverride ||
        (viewportWidth < 1100
          ? { x: at.x, y: at.y + 125 + artifacts.length * 480 }
          : { x: at.x + 555, y: at.y + artifacts.length * 480 });
      if (!atOverride)
        for (const frame of readCanvasFrames().filter(
          (f) =>
            !page.regions.some(
              (r) => r.id === f.id && !r.data && !page.layout[r.id],
            ),
        ))
          if (
            frame.id !== response.output &&
            spot.x < frame.x + frame.width &&
            spot.x + 600 > frame.x &&
            spot.y < frame.y + frame.height &&
            spot.y + 460 > frame.y
          )
            if (
              frame.x + frame.width + 655 <
              (canvas.current?.clientWidth || viewportWidth) / zoom +
                viewportScroll(canvas.current).x / zoom
            )
              spot.x = frame.x + frame.width + 55;
            else spot.y = frame.y + frame.height + 45;
      setArtifacts([
        ...artifacts,
        {
          ...a,
          at: spot,
        },
      ]);
      session.addModelMember(hierarchy.scope, a.id);
      setPalette(undefined);
      setTerm(undefined);
      setOverlay("none");
      setArtifactFocus({ id: a.id, target: "point", view: a.id });
      setLinkMenu(undefined);
      return a.id;
    } catch (e) {
      setMessage((e as Error).message);
      setPalette(undefined);
    }
  };
  const exportArtifacts = () => {
    const blob = new Blob([archive(page, artifacts)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = "manifold-workspace.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const mention =
    editing && !mentionDismissed
      ? /@([A-Za-z_0-9 ]*)$/.exec(draft.slice(0, caret))
      : null;
  const mentionCandidates = mention
    ? page.regions
        .filter((r) => {
          const s = accepted.statements.get(r.id);
          if (
            r.data &&
            !/^\s*[A-Za-z_][A-Za-z_0-9]*\s*(?::=|=|<=|>=|<|>|≤|≥)/.test(draft)
          )
            return r.data.name
              .toLowerCase()
              .includes(mention[1].toLowerCase().trim());
          return (
            r.id !== editing &&
            s?.relation === "=" &&
            accepted.sources[s.name]?.length === 1 &&
            !accepted.errors.has(r.id) &&
            accepted.solved.values.has(s.name) &&
            `${s.name} ${quantityDescription(s.name)}`
              .toLowerCase()
              .includes(mention[1].toLowerCase().trim())
          );
        })
        .slice(0, 8)
    : [];
  useEffect(() => setMentionIndex(0), [mention?.[1]]);
  const insertReference = (source: string) => {
    if (!mention) return;
    const evidence = page.regions.find((r) => r.id === source)?.data;
    let name =
      accepted.statements.get(source)?.name ||
      `data_${(evidence?.name || "source").replace(/\.csv$/i, "").replace(/[^A-Za-z_0-9]/g, "_")}`;
    if (evidence) {
      const base = name;
      let n = 2;
      while (draftLinks[name] && draftLinks[name] !== source)
        name = `${base}_${n++}`;
    }
    const start = caret - mention[0].length,
      end = start + name.length;
    setDraft(draft.slice(0, start) + name + draft.slice(caret));
    setDraftLinks((bindings) => ({ ...bindings, [name]: source }));
    setCaret(end);
    setSelectionSpan({ start: end, end });
    setMentionDismissed(false);
  };
  const targetAt = (x: number, y: number): LinkTarget | undefined => {
    const hit = document.elementFromPoint(x, y),
      object = hit?.closest<HTMLElement>(
        "[data-region-id],[data-view-id],[data-plot-id],[data-tool-id]",
      );
    if (!object) return;
    if (object.dataset.toolId)
      return object.dataset.artifactId
        ? {
            artifact: object.dataset.artifactId,
            view: object.dataset.artifactId,
          }
        : object.dataset.modelObject
          ? { region: object.dataset.modelObject }
          : undefined;
    if (object.dataset.viewId)
      return {
        artifact: object.dataset.artifactId!,
        view: object.dataset.viewId,
      };
    if (object.dataset.regionId)
      return {
        region: object.dataset.regionId,
        symbol:
          hit?.closest("[data-symbol]")?.getAttribute("data-symbol") ||
          undefined,
      };
    return {
      unsupported:
        "This plot does not declare this linking interaction. Connect to its equation instead.",
    };
  };
  useEffect(() => {
    const move = (event: globalThis.PointerEvent) => {
      const dg = dataGesture.current;
      if (dg) {
        if (
          !dg.moved &&
          Math.hypot(event.clientX - dg.client.x, event.clientY - dg.client.y) <
            5
        )
          return;
        event.preventDefault();
        dg.moved = true;
        suppressCanvasClick.current = true;
        setDataDrag({
          start: dg.start,
          end: canvasPoint(event.clientX, event.clientY),
          target: targetAt(event.clientX, event.clientY)?.region,
        });
        return;
      }
      const g = linkGesture.current;
      if (
        !g ||
        (!g.moved &&
          Math.hypot(event.clientX - g.client.x, event.clientY - g.client.y) <
            5)
      )
        return;
      event.preventDefault();
      g.moved = true;
      suppressCanvasClick.current = true;
      setCanvasSelection([]);
      setSelected(g.source);
      setTerm(undefined);
      setOverlay("none");
      setLinkDrag({
        source: g.source,
        start: g.start,
        end: canvasPoint(event.clientX, event.clientY),
        target: targetAt(event.clientX, event.clientY),
      });
    };
    const up = (event: globalThis.PointerEvent) => {
      const dg = dataGesture.current;
      dataGesture.current = undefined;
      if (dg?.moved) {
        setDataDrag(undefined);
        suppressCanvasClick.current = true;
        const target = targetAt(event.clientX, event.clientY)?.region;
        if (target && accepted.kinds[target] === "equation")
          openDataReview(
            dg.dataset,
            dg.columns,
            dataSelection?.dataset === dg.dataset ? dataSelection.rows : [],
            target,
          );
        else
          setMessage("Drop selected columns onto a mathematical relationship.");
        return;
      }
      const g = linkGesture.current;
      linkGesture.current = undefined;
      if (!g?.moved) return;
      suppressCanvasClick.current = true;
      const target = targetAt(event.clientX, event.clientY);
      setLinkDrag(undefined);
      if (target?.region === g.source) return;
      setLinkMenu({
        source: g.source,
        at: canvasPoint(event.clientX, event.clientY),
        mode: target ? "review" : "actions",
        target,
      });
    };
    const cancel = () => {
      dataGesture.current = undefined;
      setDataDrag(undefined);
      linkGesture.current = undefined;
      setLinkDrag(undefined);
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
    };
  });
  const linkingSource = linkDrag?.source || linkMenu?.source;
  const linkingTarget = linkDrag?.target || linkMenu?.target;
  const linkReview = useMemo(():
    | {
        label: string;
        edit?: ConnectionEdit;
        artifact?: Artifact;
        error?: string;
      }
    | undefined => {
    if (!linkingSource || !linkingTarget) return;
    try {
      if (linkingTarget.unsupported) throw Error(linkingTarget.unsupported);
      if (linkingTarget.region) {
        const edit = planConnection(
          page,
          linkingSource,
          linkingTarget.region,
          linkingTarget.symbol,
        );
        return { label: edit.label, edit };
      }
      const a = artifacts.find((v) => v.id === linkingTarget.artifact),
        s = accepted.statements.get(linkingSource);
      if (!a || !s) throw Error("This object is no longer available.");
      if (s.relation !== "=") {
        const edit = planConnection(page, linkingSource, a.output);
        return {
          label: edit.label,
          edit,
          artifact: { ...a, requirement: linkingSource },
        };
      }
      const input =
        accepted.kinds[linkingSource] === "quantity" ? linkingSource : a.input;
      const output =
        accepted.kinds[linkingSource] === "equation" ? linkingSource : a.output;
      if (!ancestors(accepted, output).includes(input))
        throw Error("Choose a plot whose result depends on this quantity.");
      const x = accepted.statements.get(input)!,
        y = accepted.statements.get(output)!,
        q = accepted.solved.values.get(x.name)!;
      const value = q.absolute ? q.value - 273.15 : q.value,
        delta = Math.abs(value) || 1;
      const changed = makeArtifact(
        page,
        output,
        `Plot ${y.name} versus ${x.name} from ${value - delta * 0.75} to ${value + delta * 1.5}`,
      );
      return {
        label: `Plot ${y.name} against ${x.name}`,
        artifact: {
          ...a,
          input,
          output,
          low: changed.low,
          high: changed.high,
          request: changed.request,
          code: undefined,
          requirement: output === a.output ? a.requirement : undefined,
        },
      };
    } catch (e) {
      return {
        label: "Cannot connect these objects",
        error: (e as Error).message,
      };
    }
  }, [
    page,
    artifacts,
    linkingSource,
    linkingTarget?.region,
    linkingTarget?.artifact,
    linkingTarget?.symbol,
    linkingTarget?.unsupported,
    accepted,
  ]);
  const connectionPreview = useMemo(() => {
    if (!linkReview?.edit) return;
    const draftSession = new RegionSession(page);
    if (!draftSession.connect(linkReview.edit).ok) return;
    const projection = project(draftSession.state),
      statement = projection.statements.get(linkReview.edit.target);
    return {
      error: projection.errors.get(linkReview.edit.target),
      value: statement && projection.solved.values.get(statement.name),
      kind: projection.kinds[linkReview.edit.target],
    };
  }, [page, linkReview]);
  const acceptConnection = () => {
    if (!linkReview || linkReview.error) return;
    const nextArtifact = linkReview.artifact,
      previous =
        nextArtifact && artifacts.find((a) => a.id === nextArtifact.id);
    const undo = previous
      ? () =>
          setArtifacts((items) =>
            items.map((a) =>
              a.id === previous.id
                ? {
                    ...a,
                    input: previous.input,
                    output: previous.output,
                    low: previous.low,
                    high: previous.high,
                    code: previous.code,
                    request: previous.request,
                    requirement: previous.requirement,
                    receipt: undefined,
                  }
                : a,
            ),
          )
      : undefined;
    if (linkReview.edit) {
      const result = session.connect(linkReview.edit, undo);
      if (!result.ok) {
        setMessage(result.error || "The connection could not be made.");
        return;
      }
    } else session.arrange({}, true, undo);
    if (nextArtifact)
      setArtifacts((items) =>
        items.map((a) =>
          a.id === nextArtifact.id
            ? { ...nextArtifact, receipt: undefined }
            : a,
        ),
      );
    setLinkMenu(undefined);
    setArtifactFocus(
      nextArtifact
        ? {
            id: nextArtifact.id,
            target: nextArtifact.requirement ? "requirement" : "input",
            view: linkingTarget?.view,
          }
        : undefined,
    );
  };
  const inspectConnections = (source: string, at?: Point) => {
    revealAreaCanvas.current?.();
    setSelected(source);
    setTerm(undefined);
    setArtifactFocus(undefined);
    setOverlay("none");
    setLinkMenu({
      source,
      at: at || {
        x: (places[source]?.x || 110) + 140,
        y: (places[source]?.y || 110) + 80,
      },
      mode: "inspect",
    });
  };
  const navigateLink = (source: string) => {
    revealCanvasElement(
      document.querySelector(`[data-region-id="${source}"]`),
      { block: "nearest", inline: "nearest" },
    );
    inspectConnections(source);
  };
  const connectionNodes =
    linkMenu?.mode === "inspect"
      ? [
          ...Object.values(accepted.bindings[linkMenu.source] || {}).map(
            (id) => ({ id, relation: "Input" }),
          ),
          ...page.regions
            .filter(
              (r) =>
                Object.values(accepted.bindings[r.id] || {}).includes(
                  linkMenu.source,
                ) ||
                (!accepted.statements.has(r.id) &&
                  Object.entries(page.links?.[r.id] || {}).some(
                    ([name, id]) =>
                      id === linkMenu.source &&
                      accepted.texts[r.id].includes(name),
                  )),
            )
            .map((r) => ({
              id: r.id,
              relation:
                accepted.kinds[r.id] === "constraint"
                  ? "Requirement"
                  : "Used by",
            })),
        ].filter((v, i, all) => all.findIndex((w) => w.id === v.id) === i)
      : [];
  const linkFrame =
    linkingTarget &&
    readCanvasFrames().find(
      (f) => f.id === (linkingTarget.region || linkingTarget.view),
    );
  const menuSource = linkMenu && accepted.statements.get(linkMenu.source);
  const menuChoices = linkMenu ? plotChoices(page, linkMenu.source) : [];
  const pickConnection = (source?: string, target?: string) => {
    const id =
      source ||
      canvasSelection.find(
        (id) =>
          accepted.statements.get(id)?.relation === "=" &&
          !accepted.errors.has(id),
      ) ||
      selectedId;
    if (!id) {
      setMessage("Select a quantity to connect.");
      return;
    }
    setPalette(undefined);
    setLinkMenu({
      source: id,
      at: {
        x: (canvasScroll.x + 180) / zoom,
        y: (canvasScroll.y + 120) / zoom,
      },
      mode: "choose",
      target: target ? { region: target } : undefined,
    });
  };
  const connectChoices =
    linkMenu?.mode === "choose"
      ? connectionChoices(page, linkMenu.source, linkMenu.target?.region)
      : [];
  const requestedLink = useMemo(() => {
    const match =
      /^(?:use|connect)\s+([A-Za-z_][A-Za-z_0-9]*)\s+(?:for|to)\s+([A-Za-z_][A-Za-z_0-9]*)(?:\s+(?:in|of)\s+([A-Za-z_][A-Za-z_0-9]*))?\s*$/i.exec(
        query,
      );
    if (!match) return;
    const source =
      accepted.sources[match[1]]?.length === 1
        ? accepted.sources[match[1]][0]
        : undefined;
    if (!source) return;
    const choices = connectionChoices(page, source).filter((c) =>
      match[3]
        ? accepted.statements.get(c.edit.target)?.name === match[3] &&
          c.symbol === match[2]
        : c.symbol === match[2] ||
          accepted.statements.get(c.edit.target)?.name === match[2],
    );
    return choices.length === 1 ? choices[0] : undefined;
  }, [query, page, accepted]);
  const newCanvas = () => {
    if (storageError) {
      setMessage(
        "Export this workspace before starting a new canvas; local save is unavailable.",
      );
      return;
    }
    if (editing && !commit()) return;
    setEditing(undefined);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        window.location.href = `?canvas=${crypto.randomUUID()}`;
      }),
    );
  };
  const actions = [
    ["New canvas", newCanvas],
    ["Import CSV measurements", () => csvFile.current?.click()],
    [
      "Add external reference",
      () => {
        setPalette(undefined);
        setReferenceEditor("new");
      },
    ],
    [
      "Connect selected objects",
      () =>
        pickConnection(
          undefined,
          canvasSelection
            .filter((id) => accepted.statements.has(id))
            .find(
              (id) =>
                id !==
                canvasSelection.find(
                  (id) =>
                    accepted.statements.get(id)?.relation === "=" &&
                    !accepted.errors.has(id),
                ),
            ),
        ),
    ],
    ["Write another region", () => fresh()],
    ["Plot response", () => plotSelection()],
    ["Compare another assumption", branch],
    [
      "Investigate relationship",
      () => {
        const id =
          selectedId ||
          page.regions.find((r) => p.kinds[r.id] === "equation")?.id;
        if (id) chooseTerm(id, p.statements.get(id)!.name);
      },
    ],
    ["Reveal dependencies", () => setOverlay("dependencies")],
    ["Reveal requirements", () => setOverlay("requirements")],
    ["Stack regions", () => session.stack()],
    ...((page.models?.length || 0) > 1
      ? [["Explore system relationships", openSystem] as const]
      : []),
    ["Fit page", fit],
    ["Recalculate", () => session.evaluate()],
    ["Calculation history", () => setHistory(true)],
    [
      "Trace connections",
      () => {
        if (selectedId) inspectConnections(selectedId);
      },
    ],
    ...(artifactMode ? [["Export workspace", exportArtifacts] as const] : []),
  ] as const;
  const canvasEditors: Omit<EditorProps, "area"> = {
    page,
    current: working,
    artifacts,
    selection: areaSelection || selectedId,
    session,
    select: (id) => {
      setAreaSelection(id);
      setSelected(id);
      setTerm(undefined);
      setOverlay("none");
      const a = artifacts.find(
        (a) =>
          a.input === id ||
          a.output === id ||
          ancestors(accepted, a.output).includes(id),
      );
      if (a)
        setArtifactFocus({
          id: a.id,
          target:
            a.input === id ? "input" : id === a.output ? "expression" : "input",
          quantity: id,
        });
    },
    math: (statement, text, choose, edit, highlight) => (
      <MathLine
        statement={statement}
        text={text}
        directEdit
        choose={choose}
        edit={edit}
        highlight={highlight}
      />
    ),
    changeArtifact: (a) =>
      setArtifacts((items) =>
        items.map((item) => (item.id === a.id ? a : item)),
      ),
    createPlot: (output) => createArtifact(undefined, output),
    explore: exploreValue,
    finish: finishValue,
    revert: revertExploration,
  };
  const importCsv = async (file: File, point?: Point) => {
    if (editing && !commit()) return;
    try {
      if (!/\.csv$/i.test(file.name)) throw Error("Choose a CSV file.");
      if (file.size > 1_000_000) throw Error("Use a CSV under 1 MB.");
      const at = point || {
        x: viewportScroll(canvas.current).x / zoom + 110,
        y: viewportScroll(canvas.current).y / zoom + 110,
      };
      for (const f of readCanvasFrames())
        if (
          at.x < f.x + f.width &&
          at.x + 480 > f.x &&
          at.y < f.y + f.height &&
          at.y + 250 > f.y
        )
          at.y = f.y + f.height + 50;
      const id = session.importData(
        file.name,
        await file.text(),
        at,
        hierarchy.scope,
      );
      setEditing(undefined);
      setSelected(id);
      setPalette(undefined);
      requestAnimationFrame(() =>
        revealCanvasElement(
          canvas.current?.querySelector(`[data-region-id="${id}"]`),
          { block: "nearest", inline: "nearest" },
        ),
      );
    } catch (error) {
      setMessage((error as Error).message);
    }
  };
  return (
    <main
      className={`er-app ${exploration ? "is-exploring" : ""} ${linkDrag ? "is-linking" : ""}`}
      data-trial={trial || "combined"}
      data-interaction={explicit ? "A" : "B"}
    >
      {referenceEditor && (
        <ExternalReferenceEditor
          key={referenceEditor}
          initial={(() => {
            const region = page.regions.find((r) => r.id === referenceEditor);
            return region?.external
              ? {
                  id: region.id,
                  name: region.label || region.text,
                  reference: region.external,
                }
              : undefined;
          })()}
          close={() => setReferenceEditor(undefined)}
          save={(name, reference) => {
            const id = session.reference(
              name,
              reference,
              {
                x: viewportScroll(canvas.current).x / zoom + 120,
                y: viewportScroll(canvas.current).y / zoom + 100,
              },
              hierarchy.scope,
              referenceEditor === "new" ? undefined : referenceEditor,
            );
            setReferenceEditor(undefined);
            setSelected(id);
          }}
        />
      )}
      <input
        ref={csvFile}
        type="file"
        accept=".csv,text/csv"
        aria-label="Import CSV file"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void importCsv(file);
        }}
      />
      <header className="er-header">
        <a
          href="?think=1&artifacts=1"
          className="er-brand"
          aria-label="Manifold home"
        >
          <img className="manifold-logo" src="/manifold-logo.png" alt="" />
        </a>
        <input
          aria-label="Page title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        {contexts.length > 1 && (
          <div className="er-contexts">
            {contexts.length > 3 ? (
              <select
                aria-label="Design scenario"
                value={page.active}
                onChange={(e) => switchScenario(e.target.value)}
              >
                {contexts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            ) : (
              contexts.map((c) => (
                <button
                  key={c.id}
                  aria-pressed={page.active === c.id}
                  className={c.id !== "original" ? "er-alternative" : ""}
                  onClick={() => switchScenario(c.id)}
                >
                  {c.label}
                </button>
              ))
            )}
            {(!artifactMode || !artifacts.length || page.plots.length > 0) && (
              <button
                aria-pressed={compare}
                onClick={() => {
                  setCompare(!compare);
                  setTerm(undefined);
                  if (!comparison && selectedId && comparisonContext)
                    setComparison({
                      context: comparisonContext,
                      output:
                        responseFor(page, selectedId)?.output || selectedId,
                    });
                }}
              >
                Compare
              </button>
            )}
          </div>
        )}
        <button
          aria-label="New canvas"
          title="New canvas · keep current work"
          onClick={newCanvas}
        >
          <FilePlus2 size={16} />
        </button>

        <button
          aria-label="Write equation or note"
          onClick={() => fresh(writingPoint())}
        >
          <Plus size={16} />
          <span>Write</span>
        </button>
        <button
          aria-label="Import CSV measurements"
          onClick={() => csvFile.current?.click()}
        >
          <span>Import CSV</span>
          <ArrowUpRight size={15} />
        </button>
        {!!page.regions.length && (
          <button
            aria-label="Reveal layer"
            className={overlay !== "none" ? "is-active" : ""}
            onClick={() => {
              revealAreaCanvas.current?.();
              setOverlay(
                overlay === "none"
                  ? "dependencies"
                  : overlay === "dependencies"
                    ? "requirements"
                    : "none",
              );
            }}
          >
            <Layers size={16} />
            <span>
              {overlay === "none"
                ? "Reveal"
                : overlay === "dependencies"
                  ? "Dependencies"
                  : "Requirements"}
            </span>
          </button>
        )}
        <button
          aria-label="Undo"
          disabled={!session.canUndo && !exploration}
          onClick={() => {
            if (exploration) {
              setExploration(undefined);
              return;
            }
            setExploration(undefined);
            session.undo();
            setEditing(undefined);
          }}
        >
          <Undo2 size={16} />
        </button>
        <button
          aria-label="Search objects and commands"
          onClick={() => paletteOpen("search")}
        >
          <Search size={15} />
          <kbd>⌘K</kbd>
        </button>
        {(page.models?.length || 0) > 1 && (
          <button
            aria-label="System overview"
            aria-pressed={systemActive}
            onClick={() => (systemActive ? closeSystem() : openSystem())}
          >
            <Link2 size={15} />
            <span>System</span>
          </button>
        )}
        {!!page.regions.length && (
          <button
            aria-label="Canvas viewpoints"
            aria-expanded={spatial.viewMenu}
            onClick={() => spatial.setViewMenu(!spatial.viewMenu)}
          >
            <Bookmark size={15} />
            <span>Views</span>
          </button>
        )}
      </header>
      {spatial.focus && (
        <button className="cs-focus-return" onClick={spatial.restoreFocus}>
          <ArrowLeft size={14} />
          Return to canvas
        </button>
      )}
      {spatial.viewMenu && (
        <aside className="cs-viewpoints" aria-label="Saved canvas viewpoints">
          <header>
            <b>Canvas views</b>
            <button
              aria-label="Close canvas views"
              onClick={() => spatial.setViewMenu(false)}
            >
              <X size={14} />
            </button>
          </header>
          {spatial.scene.viewpoints.map((v) => (
            <button
              className="cs-viewpoint-row"
              key={v.id}
              onClick={() => spatial.restoreViewpoint(v)}
            >
              {v.name}
            </button>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              spatial.saveViewpoint(viewName);
              setViewName("");
            }}
          >
            <input
              aria-label="Viewpoint name"
              placeholder="Name this view"
              value={viewName}
              onChange={(e) => setViewName(e.target.value)}
            />
            <button disabled={!viewName.trim()} type="submit">
              Save
            </button>
          </form>
          {spatial.scene.closed?.map((id) => (
            <button
              className="cs-viewpoint-row"
              key={id}
              onClick={() =>
                spatial.setScene((s) => ({
                  ...s,
                  closed: s.closed?.filter((v) => v !== id),
                }))
              }
            >
              Reopen {"artifact"}
            </button>
          ))}
        </aside>
      )}
      <WorkspaceAreas
        revealCanvas={revealAreaCanvas}
        enabled={
          artifactMode && new URLSearchParams(location.search).has("editors")
        }
        {...canvasEditors}
        presentationContexts={[
          ...spatial.scene.tools.flatMap((t) => (t.context ? [t.context] : [])),
          ...Object.values(spatial.scene.pins || {}),
        ]}
        onCanvasVisible={setAreaCanvasVisible}
      >
        <div
          ref={canvas}
          className={`er-canvas ${relationshipNav.focus?.mode === "arrange" ? "is-relationship-focused" : ""} ${marquee ? "is-box-selecting" : ""} ${navigation.className}`}
          aria-label="Empty engineering page"
          onScroll={(e) => setCanvasScroll(recenterCanvas(e.currentTarget))}
          onPointerMoveCapture={(e) => {
            if (navigation.move(e)) return;
            spatial.move(e);
            if (spatial.moving()) suppressCanvasClick.current = true;
            if (spatial.movingSelection()) e.stopPropagation();
          }}
          onPointerUpCapture={(e) => {
            if (!navigation.up(e)) requestAnimationFrame(spatial.end);
          }}
          onPointerCancelCapture={(e) => {
            if (!navigation.up(e)) spatial.cancel();
          }}
          onLostPointerCapture={navigation.end}
          onAuxClickCapture={navigation.click}
          onPointerDownCapture={(e) => {
            if (navigation.down(e)) return;
            if (
              relationshipNav.focus?.mode === "arrange" &&
              (e.target as Element).closest('button[aria-label^="Move "]')
            ) {
              e.preventDefault();
              e.stopPropagation();
              return;
            }
            const dataHandle = (e.target as Element).closest<HTMLElement>(
              "[data-dataset-link]",
            );
            if (dataHandle && e.button === 0) {
              e.preventDefault();
              if (editing) {
                skipBlur.current = true;
                if (!commit()) return;
              }
              dataGesture.current = {
                dataset: dataHandle.dataset.datasetLink!,
                columns: dataHandle.dataset.columns!.split(",").map(Number),
                start: canvasPoint(e.clientX, e.clientY),
                client: { x: e.clientX, y: e.clientY },
                moved: false,
              };
              return;
            }
            const hitRegion = (e.target as Element).closest<HTMLElement>(
              "[data-region-id]",
            )?.dataset.regionId;
            if (dataSelection && hitRegion && !dataRelatedIds.has(hitRegion))
              setDataSelection(undefined);
            if (spatial.captureStart(e, canvasSelection)) return;
            if ((e.target as Element).closest('button[aria-label^="Move "]')) {
              setSelected(undefined);
              setTerm(undefined);
              setLinkMenu(undefined);
            }
            if (e.button !== 0) return;
            if (!marqueeGesture.current) suppressCanvasClick.current = false;
            const target = e.target as Element;
            const source = target
              .closest("[data-link-source]")
              ?.getAttribute("data-link-source");
            if (source && !e.shiftKey) {
              e.preventDefault();
              if (editing) {
                skipBlur.current = true;
                if (!commit()) return;
              }
              linkGesture.current = {
                source,
                start: canvasPoint(e.clientX, e.clientY),
                client: { x: e.clientX, y: e.clientY },
                moved: false,
              };
              return;
            }
            if (
              target.closest(
                "[data-source-row],[data-measurement-row],[data-calculated-row]",
              )
            )
              return;
            if (!target.closest(".er-link-popover")) setLinkMenu(undefined);
            if (target.closest("input,textarea,[contenteditable]")) return;
            if (
              target.closest(
                "[data-region-id],[data-plot-id],[data-view-id],[data-tool-id],[data-data-relation-id],[data-model-id]",
              )
            ) {
              if (e.shiftKey) {
                e.preventDefault();
                if (editing) {
                  skipBlur.current = true;
                  commit();
                }
              } else setCanvasSelection([]);
            }
          }}
          onClickCapture={(e) => {
            if (navigation.click(e)) return;
            if (suppressCanvasClick.current) {
              suppressCanvasClick.current = false;
              e.preventDefault();
              e.stopPropagation();
              return;
            }
            if (
              !e.shiftKey ||
              (e.target as Element).closest(
                "input,textarea,[contenteditable],[data-source-row],[data-measurement-row],[data-calculated-row]",
              )
            )
              return;
            const object = (e.target as Element).closest<HTMLElement>(
              "[data-region-id],[data-plot-id],[data-view-id],[data-tool-id],[data-data-relation-id],[data-model-id]",
            );
            if (!object) return;
            e.preventDefault();
            e.stopPropagation();
            const id =
              object.dataset.regionId ||
              object.dataset.viewId ||
              object.dataset.toolId ||
              object.dataset.modelId ||
              object.dataset.dataRelationId ||
              object.dataset.plotId!;
            setCanvasSelection((current) =>
              current.includes(id)
                ? current.filter((item) => item !== id)
                : [...current, id],
            );
            setSelected(undefined);
            setArtifactFocus(undefined);
            setTerm(undefined);
          }}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("Files")) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }
          }}
          onDrop={(e) => {
            if (!e.dataTransfer.files.length) return;
            e.preventDefault();
            if (e.dataTransfer.files.length !== 1) {
              setMessage("Drop one CSV at a time.");
              return;
            }
            const rect = e.currentTarget.getBoundingClientRect();
            void importCsv(e.dataTransfer.files[0], {
              x:
                (e.clientX - rect.left + viewportScroll(e.currentTarget).x) /
                zoom,
              y:
                (e.clientY - rect.top + viewportScroll(e.currentTarget).y) /
                zoom,
            });
          }}
          onPointerDown={(e) => {
            if (
              e.button !== 0 ||
              (e.target as Element).closest(
                "button,input,textarea,.er-region,.er-plot,.er-popover,.er-investigation,.er-expansion-position,.er-spatial-compare,.er-selection-tools,.er-link-popover,.cs-tool,.cs-group,.cs-viewpoints,.er-data-result",
              )
            )
              return;
            if (editing) {
              skipBlur.current = true;
              if (!commit()) {
                skipBlur.current = false;
                return;
              }
            }
            e.preventDefault();
            suppressCanvasClick.current = false;
            marqueeGesture.current = {
              start: canvasPoint(e.clientX, e.clientY),
              client: { x: e.clientX, y: e.clientY },
              pointerId: e.pointerId,
              moved: false,
              previous: canvasSelection,
              additive: e.shiftKey,
            };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const gesture = marqueeGesture.current;
            if (
              !gesture ||
              (!gesture.moved &&
                Math.hypot(
                  e.clientX - gesture.client.x,
                  e.clientY - gesture.client.y,
                ) < 5)
            )
              return;
            e.preventDefault();
            gesture.moved = true;
            suppressCanvasClick.current = true;
            const rect = selectionRect(
              gesture.start,
              canvasPoint(e.clientX, e.clientY),
            );
            setMarquee(rect);
            const hits = readCanvasFrames()
              .filter((f) => touches(rect, f))
              .map((f) => f.id);
            const ids = [
              ...new Set([
                ...(gesture.additive ? gesture.previous : []),
                ...hits,
              ]),
            ];
            setCanvasSelection((previous) =>
              previous.join() === ids.join() ? previous : ids,
            );
            setSelected(undefined);
            setArtifactFocus(undefined);
            setTerm(undefined);
            setOverlay("none");
          }}
          onPointerUp={(e) => {
            if (!marqueeGesture.current) return;
            marqueeGesture.current = undefined;
            setMarquee(undefined);
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onPointerCancel={() => {
            const gesture = marqueeGesture.current;
            if (gesture) setCanvasSelection(gesture.previous);
            marqueeGesture.current = undefined;
            suppressCanvasClick.current = true;
            setMarquee(undefined);
          }}
          onClick={(e) => {
            if (suppressCanvasClick.current) {
              suppressCanvasClick.current = false;
              return;
            }
            if (
              (e.target as Element).closest(
                "button,input,textarea,.er-region,.er-plot,.er-popover,.er-investigation,.er-expansion-position,.er-spatial-compare,.er-selection-tools,.er-link-popover,.cs-tool,.cs-group,.cs-viewpoints,.er-data-result",
              )
            )
              return;
            if (relationshipNav.focus?.mode === "arrange") {
              relationshipNav.restore();
              return;
            }
            if (canvasSelection.length) {
              setCanvasSelection([]);
              setSelected(undefined);
              return;
            }
            if (systemActive) return;
            const rect = e.currentTarget.getBoundingClientRect();
            fresh({
              x:
                (e.clientX - rect.left + viewportScroll(e.currentTarget).x) /
                zoom,
              y:
                (e.clientY - rect.top + viewportScroll(e.currentTarget).y) /
                zoom,
            });
          }}
        >
          {!!page.models?.length && (
            <div
              style={{
                position: "absolute",
                left: canvas.current?.scrollLeft || 0,
                top: canvas.current?.scrollTop || 0,
                width: "100%",
                zIndex: 28,
              }}
            >
              <ModelBreadcrumb
                name="Canvas"
                path={hierarchy.path}
                canBack={hierarchy.canBack}
                back={hierarchy.back}
                go={hierarchy.go}
              />
              {systemOpen && hierarchy.scope && systemInput && (
                <div className="sx-focus-context">
                  <span>
                    Exploring{" "}
                    {quantityTitle(
                      p.statements.get(systemInput)?.name || systemInput,
                      page,
                    )}
                  </span>
                  <button onClick={openSystem}>Return to system</button>
                </div>
              )}
              {modelTrace && (
                <ModelTrace
                  page={page}
                  object={modelTrace}
                  follow={hierarchy.reveal}
                  close={() => setModelTrace(undefined)}
                />
              )}
            </div>
          )}
          {activeData && activeRelation && (
            <RelationshipTrail
              page={page}
              selection={activeData}
              relation={activeRelation}
              at={{
                x: (canvas.current?.scrollLeft || 0) + 20,
                y:
                  (canvas.current?.scrollTop || 0) +
                  (page.models?.length ? 62 : 14),
              }}
              follow={relationshipNav.follow}
              back={relationshipNav.back}
              canBack={relationshipNav.canBack}
              trace={relationshipNav.trace}
              toggleTrace={() =>
                relationshipNav.setTrace(!relationshipNav.trace)
              }
              focus={() => relationshipNav.focusRelationship(activeRelation)}
              arrange={() =>
                relationshipNav.focusRelationship(activeRelation, "arrange")
              }
              mode={relationshipNav.focus?.mode}
              restore={relationshipNav.restore}
              keep={relationshipNav.keepArrangement}
              clear={() => {
                relationshipNav.restore();
                setDataSelection(undefined);
                setAreaSelection(undefined);
                setSelected(undefined);
                relationshipNav.setTrace(false);
              }}
            />
          )}
          <div
            className="er-scroll-surface"
            style={{ width: SCROLL_SURFACE, height: SCROLL_SURFACE }}
          >
            <div className="er-world">
              <div
                className={`er-paper ${systemActive ? "is-system-overview" : ""}`}
                style={{ width, height, transform: `scale(${zoom})` }}
              >
                {!page.regions.length && (
                  <div className="er-empty">
                    <h1>A page to think on.</h1>
                    <p>Start typing, or click anywhere to write.</p>
                    <small>Equations, notes, or a CSV dropped here.</small>
                  </div>
                )}
                {systemActive && (
                  <SystemOverview
                    failure={systemFailure}
                    investigate={investigateFailure}
                    preview={working !== page}
                    changeAppearance={(id, patch) =>
                      session.styleModel(id, patch)
                    }
                    page={working}
                    response={systemResponse}
                    setResponse={setSystemResponse}
                    pathFocus={systemPath}
                    selectPath={setSystemPath}
                    toggleCompare={() => setCompare(!compare)}
                    branch={() => {
                      setSystemReference(page.active);
                      session.branch();
                      setCompare(true);
                    }}
                    write={writeSystemInput}
                    positions={systemPositions}
                    arrange={(
                      next,
                      checkpoint = true,
                      prior = systemPositions,
                    ) => {
                      if (checkpoint)
                        session.arrange({}, true, () =>
                          setSystemPositions(prior),
                        );
                      setSystemPositions(next);
                    }}
                    output={systemOutput}
                    input={
                      systemInput && p.kinds[systemInput] === "quantity"
                        ? systemInput
                        : undefined
                    }
                    selected={selected}
                    anchorModel={systemAnchor}
                    choose={(id, model) => {
                      setSystemFailure(undefined);
                      setSystemInput(id);
                      setSystemPath(undefined);
                      if (systemResponse === "internal")
                        setSystemResponse("contextual");
                      setSystemAnchor(model || hierarchy.owner(id));
                      setSelected(model || hierarchy.owner(id) || id);
                      setSystemInvestigating(true);
                    }}
                    investigating={systemInvestigating}
                    dismissInvestigation={() => {
                      setSystemInvestigating(false);
                      setSystemFailure(undefined);
                    }}
                    selectModel={(id) => setSelected(id)}
                    connect={(source, target) => {
                      setModelConnectionTarget(target);
                      setModelConnection(source);
                    }}
                    zoom={zoom}
                    compare={compare}
                    comparisonContext={
                      systemReference && systemReference !== page.active
                        ? systemReference
                        : page.active === "original"
                          ? comparisonContext
                          : "original"
                    }
                    tracePaths={overlay === "dependencies"}
                    toggleTrace={() =>
                      setOverlay(
                        overlay === "dependencies" ? "none" : "dependencies",
                      )
                    }
                    requirements={overlay === "requirements"}
                    enter={enterSystemModel}
                    follow={followSystemQuantity}
                    close={closeSystem}
                    canvas={closeSystem}
                    scrub={scrubFor}
                  />
                )}
                {internalInvestigation && (
                  <div
                    className="sx-internal-investigation"
                    style={{
                      position: "absolute",
                      left: internalAt.x,
                      top: internalAt.y,
                      width: 520,
                    }}
                  >
                    <SystemInvestigation
                      failure={systemFailure}
                      preview={working !== page}
                      page={working}
                      response="internal"
                      setResponse={(mode) => {
                        setSystemResponse(mode);
                        if (mode !== "internal") openSystem();
                      }}
                      input={systemInput}
                      output={systemOutput}
                      sourceOwner={systemAnchor}
                      pathFocus={systemPath}
                      selectPath={setSystemPath}
                      choose={setSystemInput}
                      follow={followSystemQuantity}
                      write={writeSystemInput}
                      branch={() => {
                        setSystemReference(page.active);
                        session.branch();
                        setCompare(true);
                      }}
                      compare={compare}
                      toggleCompare={() => setCompare(!compare)}
                      comparisonContext={
                        systemReference && systemReference !== page.active
                          ? systemReference
                          : page.active !== "original"
                            ? "original"
                            : comparisonContext
                      }
                      enterSource={() => {
                        if (systemAnchor) enterSystemModel(systemAnchor);
                      }}
                      scrub={scrubFor}
                      tracePaths={overlay === "dependencies"}
                      toggleTrace={() =>
                        setOverlay(
                          overlay === "dependencies" ? "none" : "dependencies",
                        )
                      }
                      dismissInvestigation={() => setSystemInvestigating(false)}
                    />
                  </div>
                )}
                {(page.models || [])
                  .filter(
                    (m) =>
                      !systemActive &&
                      hierarchy.visible(m.id) &&
                      !spatial.hidden.has(m.id),
                  )
                  .map((model) => (
                    <ModelObject
                      changeAppearance={(id, patch) =>
                        session.styleModel(id, patch)
                      }
                      key={model.id}
                      page={page}
                      model={model}
                      at={places[model.id] || hierarchy.at(model.id)}
                      level={hierarchy.level(model.id) || "interface"}
                      override={hierarchy.detail[model.id] || "auto"}
                      selected={selected === model.id}
                      highlight={modelTrace}
                      select={() => setSelected(model.id)}
                      enter={() => hierarchy.go(model.id)}
                      inspect={setModelTrace}
                      openSource={hierarchy.reveal}
                      connect={setModelConnection}
                      followModel={hierarchy.go}
                      review={() =>
                        setModelReview({
                          members: model.members,
                          existing: model,
                        })
                      }
                      setLevel={(level) =>
                        hierarchy.setDetail((d) => ({
                          ...d,
                          [model.id]: level,
                        }))
                      }
                      move={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        e.currentTarget.setPointerCapture(e.pointerId);
                        spatial.start(model.id, e, true);
                      }}
                      math={(id) => {
                        const st = p.statements.get(id);
                        return st ? (
                          <MathLine
                            statement={st}
                            text={p.texts[id]}
                            choose={() => {}}
                            edit={() => {}}
                          />
                        ) : null;
                      }}
                    />
                  ))}
                {spatial.scene.groups.map((g) => {
                  if (!g.members.every(hierarchy.visible)) return null;
                  const bounds = frameBounds(
                    spatial.frames.filter((f) => g.members.includes(f.id)),
                  );
                  return (
                    bounds && (
                      <CanvasGroupView
                        key={g.id}
                        group={g}
                        bounds={bounds}
                        compact={spatial.compact(g)}
                        zoom={zoom}
                        focus={() => spatial.focusObject(g.id)}
                        collapse={() => {
                          if (zoom < 0.65 && spatial.compact(g)) {
                            spatial.focusObject(g.id);
                            return;
                          }
                          spatial.setScene((s) => ({
                            ...s,
                            groups: s.groups.map((v) =>
                              v.id === g.id
                                ? { ...v, collapsed: !spatial.compact(g) }
                                : v,
                            ),
                          }));
                        }}
                        promote={() => prepareModel(g.members)}
                        ungroup={() =>
                          spatial.setScene((s) => ({
                            ...s,
                            groups: s.groups.filter((v) => v.id !== g.id),
                          }))
                        }
                        arrange={(layout) => spatial.arrangeGroup(g.id, layout)}
                        start={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          e.currentTarget.setPointerCapture(e.pointerId);
                          spatial.start(g.id, e, true);
                        }}
                        move={() => {}}
                        end={() => {}}
                      />
                    )
                  );
                })}
                {spatial.dock &&
                  (() => {
                    const target = spatial.frames.find(
                      (f) => f.id === spatial.dock!.id,
                    );
                    if (!target) return null;
                    const stack = spatial.dock.layout === "stack";
                    return (
                      <div
                        className="cs-dock-preview"
                        style={{
                          left: target.x + (stack ? 0 : target.width + 12),
                          top: target.y + (stack ? target.height + 12 : 0),
                          width: stack ? target.width : 120,
                          height: stack ? 45 : target.height,
                        }}
                      >
                        Group {stack ? "below" : "beside"}
                      </div>
                    );
                  })()}
                {linkDrag && (
                  <svg
                    className="er-link-drag"
                    width={width}
                    height={height}
                    aria-hidden="true"
                  >
                    <path
                      d={`M ${linkDrag.start.x} ${linkDrag.start.y} C ${linkDrag.start.x + 70} ${linkDrag.start.y}, ${linkDrag.end.x - 70} ${linkDrag.end.y}, ${linkDrag.end.x} ${linkDrag.end.y}`}
                    />
                    <circle
                      cx={linkDrag.start.x}
                      cy={linkDrag.start.y}
                      r={4 / zoom}
                    />
                    <circle
                      cx={linkDrag.end.x}
                      cy={linkDrag.end.y}
                      r={4 / zoom}
                    />
                  </svg>
                )}
                {linkDrag && linkFrame && (
                  <div
                    className={`er-link-target ${linkReview?.error ? "is-invalid" : ""}`}
                    style={{
                      left: linkFrame.x - 5,
                      top: linkFrame.y - 5,
                      width: linkFrame.width + 10,
                      height: linkFrame.height + 10,
                    }}
                  />
                )}
                {linkDrag && (
                  <div
                    className="er-link-hint"
                    style={{
                      left: linkDrag.end.x + 16 / zoom,
                      top: linkDrag.end.y + 18 / zoom,
                      transform: `scale(${1 / zoom})`,
                    }}
                  >
                    {linkReview?.error ||
                      linkReview?.label ||
                      "Release for actions"}
                  </div>
                )}
                {linkMenu && (
                  <div
                    className="er-link-popover"
                    role="dialog"
                    aria-label={
                      linkMenu.mode === "review"
                        ? "Review connection"
                        : linkMenu.mode === "inspect"
                          ? "Connections"
                          : "Link actions"
                    }
                    style={{
                      left: Math.max(
                        (canvasScroll.x + 12) / zoom,
                        Math.min(
                          linkMenu.at.x,
                          (canvasScroll.x +
                            (canvas.current?.clientWidth || viewportWidth) -
                            348) /
                            zoom,
                        ),
                      ),
                      top: Math.max(
                        (canvasScroll.y + 12) / zoom,
                        Math.min(
                          linkMenu.at.y,
                          (canvasScroll.y +
                            (canvas.current?.clientHeight || 800) -
                            350) /
                            zoom,
                        ),
                      ),
                      transform: `scale(${1 / zoom})`,
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <header>
                      <Link2 size={16} />
                      <strong>
                        {linkMenu.mode === "review"
                          ? "Connect"
                          : menuSource?.name || "Connections"}
                      </strong>
                      <button
                        aria-label="Close connections"
                        onClick={() => setLinkMenu(undefined)}
                      >
                        <X size={15} />
                      </button>
                    </header>
                    {linkMenu.mode === "choose" ? (
                      <div className="er-connect-pick">
                        <p>Use {menuSource?.name}…</p>
                        {connectChoices.map(({ edit, symbol }) => (
                          <button
                            className="er-link-row"
                            key={`${edit.target}-${symbol || "binding"}`}
                            onClick={() =>
                              setLinkMenu({
                                ...linkMenu,
                                source:
                                  edit.kind === "constrain"
                                    ? edit.target
                                    : edit.source,
                                mode: "review",
                                target: {
                                  region:
                                    edit.kind === "constrain"
                                      ? edit.source
                                      : edit.target,
                                  symbol,
                                },
                              })
                            }
                          >
                            <span>{edit.label}</span>
                            <ArrowUpRight size={13} />
                          </button>
                        ))}
                        {!connectChoices.length && (
                          <small>
                            No compatible destinations on this page. Add an
                            equation with a missing input, or select another
                            source.
                          </small>
                        )}
                      </div>
                    ) : linkMenu.mode === "review" ? (
                      <>
                        <p>{linkReview?.label}</p>
                        <span className="er-link-kind">
                          {linkReview?.edit?.kind === "reference"
                            ? "Reference · definition identity"
                            : linkReview?.edit?.kind === "compute"
                              ? "Binding · replace an assumption"
                              : linkReview?.edit?.kind === "constrain"
                                ? "Requirement binding"
                                : "Visualization binding"}
                        </span>
                        {linkReview?.error ? (
                          <p className="er-link-error" role="status">
                            {linkReview.error}
                          </p>
                        ) : (
                          <>
                            {linkReview?.edit && (
                              <div className="er-link-change">
                                <s>{accepted.texts[linkReview.edit.target]}</s>
                                <code>{linkReview.edit.text}</code>
                              </div>
                            )}
                            {connectionPreview?.error && (
                              <small className="er-link-unresolved">
                                {connectionPreview.error} Units will be checked
                                when the remaining inputs are defined.
                              </small>
                            )}
                            {connectionPreview?.value && (
                              <p className="er-link-value">
                                Result · {display(connectionPreview.value)}
                              </p>
                            )}
                            <small>
                              {
                                contexts.find((c) => c.id === page.active)
                                  ?.label
                              }
                              {linkReview?.artifact && !linkReview.edit
                                ? " · Plot binding"
                                : " · Calculation change"}
                            </small>
                            <footer>
                              <button onClick={() => setLinkMenu(undefined)}>
                                Cancel
                              </button>
                              <button
                                className="er-link-apply"
                                onClick={acceptConnection}
                              >
                                Apply connection
                              </button>
                            </footer>
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        {linkMenu.mode === "inspect" && (
                          <>
                            <p className="er-link-definition">
                              {accepted.texts[linkMenu.source]}
                            </p>
                            {connectionNodes.map((node) => (
                              <button
                                className="er-link-row"
                                key={node.id}
                                onClick={() => navigateLink(node.id)}
                              >
                                <small>{node.relation}</small>
                                <span>{accepted.texts[node.id]}</span>
                                <ArrowUpRight size={14} />
                              </button>
                            ))}
                            {artifacts
                              .filter(
                                (a) =>
                                  a.input === linkMenu.source ||
                                  a.output === linkMenu.source ||
                                  a.requirement === linkMenu.source,
                              )
                              .map((a) => (
                                <button
                                  className="er-link-row"
                                  key={a.id}
                                  onClick={() => {
                                    revealCanvasElement(
                                      document.querySelector(
                                        `[data-view-id="${a.id}"]`,
                                      ),
                                      {
                                        block: "nearest",
                                        inline: "nearest",
                                      },
                                    );
                                    setArtifactFocus({
                                      id: a.id,
                                      view: a.id,
                                      target:
                                        a.requirement === linkMenu.source
                                          ? "requirement"
                                          : a.input === linkMenu.source
                                            ? "input"
                                            : "expression",
                                    });
                                    setLinkMenu(undefined);
                                  }}
                                >
                                  <small>Visualized by</small>
                                  <span>
                                    {accepted.statements.get(a.output)?.name} vs{" "}
                                    {accepted.statements.get(a.input)?.name}
                                  </span>
                                  <ArrowUpRight size={14} />
                                </button>
                              ))}
                            {!connectionNodes.length &&
                              !artifacts.some(
                                (a) =>
                                  a.input === linkMenu.source ||
                                  a.output === linkMenu.source ||
                                  a.requirement === linkMenu.source,
                              ) && <small>No connected objects yet.</small>}
                          </>
                        )}
                        {linkMenu.mode === "actions" &&
                          menuChoices.map((choice) => (
                            <button
                              className="er-link-row"
                              key={`${choice.output}-${choice.input}`}
                              onClick={() => {
                                if (artifactMode)
                                  createArtifact(
                                    undefined,
                                    choice.output,
                                    linkMenu.at,
                                    choice.input,
                                  );
                                else {
                                  const plot = session.addPlot(
                                    choice.output,
                                    choice.input,
                                  );
                                  if (plot) session.move(plot, linkMenu.at);
                                  setLinkMenu(undefined);
                                }
                              }}
                            >
                              <span>
                                Plot{" "}
                                {accepted.statements.get(choice.output)?.name}{" "}
                                vs {accepted.statements.get(choice.input)?.name}
                              </span>
                              <ArrowUpRight size={14} />
                            </button>
                          ))}
                        {linkMenu.mode === "actions" &&
                          menuSource?.relation === "=" && (
                            <button
                              className="er-link-row"
                              onClick={() => {
                                const source = linkMenu.source,
                                  name = menuSource.name;
                                let result = `R_${name}`,
                                  serial = 2;
                                while (accepted.sources[result])
                                  result = `R_${name}_${serial++}`;
                                const at = linkMenu.at;
                                fresh(at);
                                setDraft(`${result} = ${name}`);
                                setDraftLinks({ [name]: source });
                                setCaret(result.length);
                                setSelectionSpan({
                                  start: 0,
                                  end: result.length,
                                });
                              }}
                            >
                              <span>Use in an equation</span>
                              <ArrowUpRight size={14} />
                            </button>
                          )}
                        {linkMenu.mode === "actions" && (
                          <button
                            className="er-link-row"
                            onClick={() =>
                              inspectConnections(linkMenu.source, linkMenu.at)
                            }
                          >
                            <span>Inspect connections</span>
                            <ArrowUpRight size={14} />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
                {spatial.guides.map((guide) => (
                  <div
                    key={guide.axis}
                    className="er-alignment-guide"
                    data-alignment-axis={guide.axis}
                    aria-hidden="true"
                    style={
                      guide.axis === "x"
                        ? {
                            left: guide.at,
                            top: guide.from,
                            height: guide.to - guide.from,
                            borderLeftWidth: 1 / zoom,
                          }
                        : {
                            top: guide.at,
                            left: guide.from,
                            width: guide.to - guide.from,
                            borderTopWidth: 1 / zoom,
                          }
                    }
                  />
                ))}
                {selectedFrames.map((frame) => (
                  <div
                    key={frame.id}
                    data-selection-object={frame.id}
                    className="er-selection-outline"
                    aria-hidden="true"
                    style={{
                      left: frame.x - 6 / zoom,
                      top: frame.y - 6 / zoom,
                      width: frame.width + 12 / zoom,
                      height: frame.height + 12 / zoom,
                      borderWidth: 1.5 / zoom,
                    }}
                  />
                ))}
                {marquee && (
                  <div
                    className="er-selection-marquee"
                    aria-hidden="true"
                    style={{
                      left: marquee.x,
                      top: marquee.y,
                      width: marquee.width,
                      height: marquee.height,
                      borderWidth: 1 / zoom,
                    }}
                  />
                )}
                {selectionBounds && !marquee && !spatial.moving() && (
                  <div
                    className="er-selection-tools"
                    role="toolbar"
                    aria-label="Canvas selection"
                    style={{
                      left: Math.max(
                        canvasScroll.x / zoom + 12 / zoom,
                        Math.min(
                          selectionBounds.x,
                          (canvasScroll.x +
                            (canvas.current?.clientWidth || viewportWidth) -
                            240) /
                            zoom,
                        ),
                      ),
                      top: Math.max(
                        (canvasScroll.y + 12) / zoom,
                        selectionBounds.y - 46 / zoom,
                      ),
                      transform: `scale(${1 / zoom})`,
                    }}
                  >
                    {canvasSelection.length > 1 && (
                      <button
                        aria-label="Move selected objects"
                        title="Drag selection · Alt bypasses alignment"
                        onPointerDown={(e) => {
                          if (e.button !== 0 || !canvasSelection.length) return;
                          e.preventDefault();
                          e.stopPropagation();
                          e.currentTarget.setPointerCapture(e.pointerId);
                          spatial.start(
                            canvasSelection[0],
                            e,
                            false,
                            canvasSelection,
                          );
                        }}
                      >
                        <GripVertical size={15} />
                      </button>
                    )}
                    <span aria-live="polite">
                      {selectedFrames.length} selected
                    </span>
                    <button
                      disabled={selectedFrames.length < 2}
                      onClick={organizeSelection}
                    >
                      <LayoutGrid size={14} /> Organize
                    </button>
                    <button
                      disabled={
                        !canvasSelection.some((id) =>
                          accepted.statements.has(id),
                        )
                      }
                      onClick={() =>
                        pickConnection(
                          undefined,
                          canvasSelection.length === 2
                            ? canvasSelection.find(
                                (id) =>
                                  id !==
                                  canvasSelection.find(
                                    (id) =>
                                      accepted.statements.get(id)?.relation ===
                                        "=" && !accepted.errors.has(id),
                                  ),
                              )
                            : undefined,
                        )
                      }
                    >
                      <Link2 size={13} />
                      Connect
                    </button>
                    <button
                      disabled={selectedFrames.length < 2}
                      onClick={() => {
                        let groups = spatial.scene.groups;
                        const ids = selectedFrames.map((f) => f.id);
                        for (const id of ids.slice(1))
                          groups = dockObjects(groups, id, ids[0], "stack");
                        spatial.setScene((s) => ({
                          ...s,
                          groups: groups.map((g) =>
                            g.members.includes(ids[0])
                              ? { ...g, auto: false }
                              : g,
                          ),
                        }));
                        setCanvasSelection([]);
                      }}
                    >
                      Group
                    </button>
                    <button
                      onClick={() =>
                        prepareModel(selectedFrames.map((f) => f.id))
                      }
                    >
                      Make model
                    </button>
                    <button
                      aria-label="Clear canvas selection"
                      onClick={() => setCanvasSelection([])}
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}
                {overlay === "dependencies" && !trials.expand && (
                  <svg
                    className="er-dependencies"
                    width={width}
                    height={height}
                    aria-label="Dependency overlay"
                  >
                    <defs>
                      <marker
                        id="er-arrow"
                        markerWidth="5"
                        markerHeight="5"
                        refX="4"
                        refY="2.5"
                        orient="auto"
                      >
                        <path d="M0,0 L5,2.5 L0,5" />
                      </marker>
                    </defs>
                    {dependencyEdges
                      .filter(
                        (edge) =>
                          !selectedId ||
                          (related.has(edge.from) && related.has(edge.to)),
                      )
                      .map((edge) => {
                        const a = places[edge.from],
                          b = places[edge.to],
                          x = Math.min(a.x, b.x) - 28;
                        return (
                          <g
                            key={`${edge.from}-${edge.to}`}
                            onClick={() => {
                              setSelected(edge.to);
                              setTerm(edge.name);
                            }}
                          >
                            <path
                              d={`M${a.x - 8},${a.y + 20} C${x - 45},${a.y + 20} ${x - 45},${b.y + 20} ${b.x - 8},${b.y + 20}`}
                              markerEnd="url(#er-arrow)"
                            />
                            <title>
                              {edge.name} supplies{" "}
                              {p.kinds[edge.to] === "constraint"
                                ? "requirement on "
                                : ""}
                              {p.statements.get(edge.to)?.name}
                            </title>
                          </g>
                        );
                      })}
                  </svg>
                )}
                {dataDrag && (
                  <svg
                    className="er-data-drag"
                    style={{
                      position: "absolute",
                      inset: 0,
                      width: "100%",
                      height: "100%",
                      pointerEvents: "none",
                      zIndex: 35,
                    }}
                  >
                    <path
                      d={`M${dataDrag.start.x},${dataDrag.start.y} L${dataDrag.end.x},${dataDrag.end.y}`}
                      stroke="#7b62a3"
                      strokeWidth="2"
                      strokeDasharray="5 4"
                    />
                    <text x={dataDrag.end.x + 12} y={dataDrag.end.y - 12}>
                      Connect paired columns
                    </text>
                  </svg>
                )}
                {dataReview && (
                  <DatasetReview
                    key={`${dataReview.dataset}-${dataReview.output || "pick"}`}
                    page={page}
                    {...dataReview}
                    close={() => setDataReview(undefined)}
                    accept={(relation, placement) => {
                      try {
                        const frames = readCanvasFrames(),
                          anchor = frames.find(
                            (f) =>
                              f.id ===
                              (placement === "source"
                                ? relation.dataset
                                : relation.output),
                          )!;
                        const spot = placeDataResult(
                          placement === "model"
                            ? {
                                ...anchor,
                                height: Math.max(anchor.height, 280),
                              }
                            : anchor,
                          frames,
                          (viewportScroll(canvas.current).x +
                            (canvas.current?.clientWidth || 1200)) /
                            zoom,
                        );
                        const id = session.bindDataset(relation, spot);
                        // The review may scroll while focusing its controls. Bring
                        // the new view back into the same visible working context.
                        requestAnimationFrame(() => {
                          const node = canvas.current;
                          const result = node?.querySelector<HTMLElement>(
                            `[data-data-relation-id="${id}"]`,
                          );
                          revealCanvasElement(result, {
                            block: "nearest",
                            inline: "nearest",
                          });
                          if (!node || !result) return;
                          // Leave space for the contextual relationship trail so
                          // the equation beside this plot remains readable too.
                          const rect = result.getBoundingClientRect();
                          const margin = Math.min(
                            100,
                            Math.max(0, node.clientHeight - rect.height - 20),
                          );
                          const top =
                            rect.top - node.getBoundingClientRect().top;
                          if (top < margin)
                            scrollCanvasTo(node, {
                              top: viewportScroll(node).y - (margin - top),
                            });
                        });
                        setDataReview(undefined);
                        setSelected(id);
                        setDataSelection({
                          dataset: relation.dataset,
                          rows:
                            relation.scope.kind === "records"
                              ? relation.scope.rows
                              : [],
                          columns: relation.bindings.map((b) => b.column),
                          kind:
                            relation.scope.kind === "records"
                              ? "record"
                              : "series",
                        });
                      } catch (e) {
                        setMessage((e as Error).message);
                      }
                    }}
                  />
                )}
                <DataRelationshipOverlay
                  page={page}
                  selection={activeData}
                  canvas={canvas}
                  zoom={zoom}
                  trace={relationshipNav.trace}
                  preferred={
                    activeData?.detail === "requirement"
                      ? "requirement"
                      : activeData?.kind === "series" ||
                          activeData?.view === activeData?.dataset
                        ? "evidence"
                        : "calculation"
                  }
                />
                {(page.dataRelations || []).map((relation) => (
                  <DatasetResult
                    key={relation.id}
                    relation={relation}
                    hidden={
                      spatial.hidden.has(relation.id) ||
                      !!(
                        relationshipNav.focus?.mode === "arrange" &&
                        !relationshipNav.focus.ids.includes(relation.id)
                      )
                    }
                    page={page}
                    at={places[relation.id]}
                    selected={
                      selected === relation.id || relatedData.includes(relation)
                    }
                    selection={activeData}
                    focus={() => spatial.focusObject(relation.id)}
                    inspect={(row, column, additive) =>
                      chooseData({
                        dataset: relation.dataset,
                        rows:
                          additive && activeData?.dataset === relation.dataset
                            ? [...new Set([...activeData.rows, row])]
                            : [row],
                        columns: column === undefined ? [] : [column],
                        kind: column === undefined ? "record" : "cell",
                        relation: relation.id,
                        view: relation.id,
                      })
                    }
                    move={(e) => {
                      e.currentTarget.setPointerCapture(e.pointerId);
                      drag.current = {
                        id: relation.id,
                        x: e.clientX,
                        y: e.clientY,
                        start: places[relation.id],
                      };
                      const node = e.currentTarget as HTMLElement;
                      const move = (event: globalThis.PointerEvent) => {
                        if (drag.current?.id === relation.id)
                          setDragPreview({
                            [relation.id]: {
                              x:
                                drag.current.start.x +
                                (event.clientX - drag.current.x) / zoom,
                              y:
                                drag.current.start.y +
                                (event.clientY - drag.current.y) / zoom,
                            },
                          });
                      };
                      const end = (event: globalThis.PointerEvent) => {
                        node.removeEventListener("pointermove", move);
                        node.removeEventListener("pointerup", end);
                        node.removeEventListener("pointercancel", cancel);
                        if (drag.current?.id === relation.id) {
                          session.move(relation.id, {
                            x:
                              drag.current.start.x +
                              (event.clientX - drag.current.x) / zoom,
                            y:
                              drag.current.start.y +
                              (event.clientY - drag.current.y) / zoom,
                          });
                          drag.current = undefined;
                          setDragPreview({});
                        }
                      };
                      const cancel = () => {
                        node.removeEventListener("pointermove", move);
                        node.removeEventListener("pointerup", end);
                        node.removeEventListener("pointercancel", cancel);
                        drag.current = undefined;
                        setDragPreview({});
                      };
                      node.addEventListener("pointermove", move);
                      node.addEventListener("pointerup", end);
                      node.addEventListener("pointercancel", cancel);
                    }}
                    remove={() => session.removeDataset(relation.id)}
                  />
                ))}
                {page.regions.map((region) => {
                  const id = region.id,
                    at = places[id],
                    s = p.statements.get(id),
                    dataRelation = (page.dataRelations || []).find(
                      (r) =>
                        r.output === id ||
                        (s?.relation !== "=" &&
                          p.statements.get(r.output)?.name === s?.name),
                    ),
                    dataState = dataRelation
                      ? datasetStates[dataRelation.id]
                      : undefined,
                    error =
                      dataState?.result &&
                      p.errors.get(id)?.startsWith("Define ")
                        ? undefined
                        : p.errors.get(id),
                    q = s && p.solved.values.get(s.name),
                    condition = p.solved.constraints.get(id),
                    other = s && original?.solved.values.get(s.name),
                    kind = p.kinds[id],
                    effectiveText = p.texts[id];
                  return (
                    <section
                      key={id}
                      data-region-id={id}
                      data-kind={kind}
                      data-interaction={
                        editing === id
                          ? "editing"
                          : selected === id
                            ? "selected"
                            : "idle"
                      }
                      className={`er-region ${editing === id ? "is-editing" : ""} ${activeData?.view === id ? "is-navigation-target" : ""} ${dataRelatedIds.has(id) || dataDrag?.target === id ? "is-data-connected" : ""} ${linkMenu?.mode === "inspect" && (linkMenu.source === id || connectionNodes.some((node) => node.id === id)) ? "is-connected" : ""} ${expansionId === id ? "is-investigating" : ""} ${exploration && (id === exploration.input || ancestors(p, id).includes(exploration.input)) ? "er-preview-region" : ""} ${selected === id ? "is-selected" : ""} ${overlay === "dependencies" && selectedId && !related.has(id) ? "is-dimmed" : ""} ${overlay === "requirements" && kind === "constraint" ? "er-condition-focus" : ""} ${page.active !== "original" && contexts.find((c) => c.id === page.active)?.overrides[id] ? "er-overridden" : ""}`}
                      style={{
                        left: at.x,
                        top: at.y,
                        display:
                          spatial.hidden.has(id) ||
                          (relationshipNav.focus?.mode === "arrange" &&
                            !relationshipNav.focus.ids.includes(id))
                            ? "none"
                            : undefined,
                      }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        setSelected(id);
                        setAreaSelection(id);
                        if (
                          !(e.target as Element).closest(
                            "button,[role=button],math",
                          )
                        )
                          setTerm(undefined);
                      }}
                    >
                      <button
                        className="er-grip"
                        aria-label={`Move ${s?.name || "region"}`}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          e.currentTarget.setPointerCapture(e.pointerId);
                          drag.current = {
                            id,
                            x: e.clientX,
                            y: e.clientY,
                            start: at,
                          };
                        }}
                        onPointerMove={(e) => {
                          if (drag.current?.id === id)
                            setDragPreview({
                              [id]: {
                                x:
                                  drag.current.start.x +
                                  (e.clientX - drag.current.x) / zoom,
                                y:
                                  drag.current.start.y +
                                  (e.clientY - drag.current.y) / zoom,
                              },
                            });
                        }}
                        onPointerUp={(e) => {
                          if (drag.current) {
                            session.move(id, {
                              x:
                                drag.current.start.x +
                                (e.clientX - drag.current.x) / zoom,
                              y:
                                drag.current.start.y +
                                (e.clientY - drag.current.y) / zoom,
                            });
                            drag.current = undefined;
                            setDragPreview({});
                            e.currentTarget.releasePointerCapture(e.pointerId);
                          }
                        }}
                        onPointerCancel={() => {
                          drag.current = undefined;
                          setDragPreview({});
                        }}
                      >
                        <GripVertical size={16} />
                      </button>
                      {s && editing !== id && (
                        <button
                          className="er-link-handle"
                          data-link-source={id}
                          aria-label={`Link ${s.relation === "=" ? s.name : `requirement ${s.name}`}`}
                          title="Drag to connect · click for connections"
                          onClick={(e) => {
                            e.stopPropagation();
                            inspectConnections(id);
                          }}
                        >
                          <Link2 size={15} />
                        </button>
                      )}
                      {selected === id &&
                        editing !== id &&
                        effectiveText &&
                        !palette &&
                        quiet && (
                          <div className="er-object-actions">
                            {s && (
                              <button onClick={() => begin(id)}>
                                {kind === "equation" ? "Edit equation" : "Edit"}
                              </button>
                            )}
                            {artifactMode &&
                              s &&
                              s.relation === "=" &&
                              kind === "equation" &&
                              !error && (
                                <button onClick={() => plotSelection(id)}>
                                  Plot response
                                </button>
                              )}
                            {s && (
                              <>
                                <button onClick={() => pickConnection(id)}>
                                  Connect
                                </button>
                                {kind === "equation" && !error && (
                                  <button
                                    onClick={() => {
                                      const existing = artifacts.find(
                                        (a) => a.output === id,
                                      );
                                      const artifact =
                                        existing?.id ||
                                        createArtifact(undefined, id);
                                      if (artifact)
                                        spatial.openTool(
                                          "python",
                                          id,
                                          artifact,
                                        );
                                    }}
                                  >
                                    Compute
                                  </button>
                                )}
                                <button onClick={() => inspectConnections(id)}>
                                  Trace
                                </button>
                              </>
                            )}
                            <button
                              aria-label="Region commands"
                              onClick={() => paletteOpen("search")}
                            >
                              <MoreHorizontal size={17} />
                            </button>
                          </div>
                        )}
                      {selected === id &&
                        editing !== id &&
                        effectiveText &&
                        !quiet && (
                          <div className="er-region-actions">
                            <button onClick={() => begin(id)}>Edit</button>
                            {trials.expand && s && (
                              <button onClick={() => chooseTerm(id, s.name)}>
                                Expand relationship
                              </button>
                            )}
                            {s && s.relation === "=" && !error && (
                              <>
                                <button onClick={() => plotSelection(id)}>
                                  Plot response
                                </button>
                                <button onClick={branch}>
                                  Try alternative
                                </button>
                              </>
                            )}
                            <button
                              aria-label="Region commands"
                              onClick={() => paletteOpen("search")}
                            >
                              <MoreHorizontal size={15} />
                            </button>
                          </div>
                        )}
                      {expansionId === id && !focusedInput && (
                        <button
                          className="er-investigation-close"
                          aria-label="Close relationship"
                          onClick={() => {
                            setTerm(undefined);
                            setOverlay("none");
                          }}
                        >
                          <X size={14} />
                        </button>
                      )}
                      {editing === id ? (
                        <>
                          <textarea
                            ref={editor}
                            aria-label="Write an engineering region"
                            value={draft}
                            spellCheck={false}
                            rows={Math.max(1, draft.split("\n").length)}
                            placeholder="Write a thought or an equation…"
                            onChange={(e) => {
                              setDraft(e.target.value);
                              setCaret(e.target.selectionStart);
                              setMentionDismissed(false);
                            }}
                            onSelect={(e) =>
                              setCaret(e.currentTarget.selectionStart)
                            }
                            aria-autocomplete="list"
                            aria-controls={
                              mention ? "er-reference-options" : undefined
                            }
                            aria-activedescendant={
                              mentionCandidates[mentionIndex]
                                ? `er-reference-${mentionCandidates[mentionIndex].id}`
                                : undefined
                            }
                            onBlur={() => {
                              if (skipBlur.current) {
                                skipBlur.current = false;
                                return;
                              }
                              commit();
                            }}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (
                                mention &&
                                [
                                  "ArrowDown",
                                  "ArrowUp",
                                  "Enter",
                                  "Tab",
                                  "Escape",
                                ].includes(e.key)
                              ) {
                                e.preventDefault();
                                if (e.key === "Escape")
                                  setMentionDismissed(true);
                                else if (
                                  e.key === "ArrowDown" ||
                                  e.key === "ArrowUp"
                                )
                                  setMentionIndex(
                                    (i) =>
                                      (i +
                                        (e.key === "ArrowDown" ? 1 : -1) +
                                        Math.max(1, mentionCandidates.length)) %
                                      Math.max(1, mentionCandidates.length),
                                  );
                                else if (mentionCandidates[mentionIndex])
                                  insertReference(
                                    mentionCandidates[mentionIndex].id,
                                  );
                                return;
                              }
                              if (
                                (e.metaKey || e.ctrlKey) &&
                                e.key.toLowerCase() === "k"
                              ) {
                                e.preventDefault();
                                paletteOpen("search");
                                return;
                              }
                              if (e.key === "/" && !draft.trim()) {
                                e.preventDefault();
                                paletteOpen("slash");
                                return;
                              }
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                skipBlur.current = true;
                                commit(true);
                                return;
                              }
                              if (e.key === "Escape") {
                                e.preventDefault();
                                skipBlur.current = true;
                                commit();
                                return;
                              }
                              if (e.key === "Tab") {
                                const spans = sourceSpans(draft),
                                  cursor = e.currentTarget.selectionEnd;
                                const next = e.shiftKey
                                  ? [...spans]
                                      .reverse()
                                      .find(
                                        (span) =>
                                          span.end <
                                          e.currentTarget.selectionStart,
                                      )
                                  : spans.find(
                                      (span) =>
                                        span.start >= cursor &&
                                        span.end !== cursor,
                                    );
                                if (next) {
                                  e.preventDefault();
                                  e.currentTarget.setSelectionRange(
                                    next.start,
                                    next.end,
                                  );
                                } else if (!e.shiftKey) {
                                  e.preventDefault();
                                  skipBlur.current = true;
                                  commit(true);
                                }
                              }
                            }}
                          />
                          {mention && (
                            <div
                              id="er-reference-options"
                              className="er-reference-menu"
                              role="listbox"
                              aria-label="Reference an object"
                              onPointerDown={(e) => e.preventDefault()}
                            >
                              {mentionCandidates.map((candidate, index) => {
                                const definition = accepted.statements.get(
                                    candidate.id,
                                  ),
                                  value =
                                    definition &&
                                    accepted.solved.values.get(definition.name);
                                return (
                                  <button
                                    id={`er-reference-${candidate.id}`}
                                    key={candidate.id}
                                    role="option"
                                    aria-selected={index === mentionIndex}
                                    onClick={() =>
                                      insertReference(candidate.id)
                                    }
                                  >
                                    <strong>
                                      {definition?.name || candidate.data?.name}
                                    </strong>
                                    <span>
                                      {definition
                                        ? quantityDescription(definition.name)
                                        : "Evidence reference"}
                                    </span>
                                    <small>
                                      {value
                                        ? display(value)
                                        : candidate.data
                                          ? "Not a calculation input"
                                          : ""}
                                    </small>
                                  </button>
                                );
                              })}
                              {!mentionCandidates.length && (
                                <small>No matching resolved quantities</small>
                              )}
                            </div>
                          )}
                        </>
                      ) : region.data ? (
                        <DataRegion
                          data={region.data}
                          navigating={!!activeData?.relation}
                          dataset={region.id}
                          trace={
                            (page.dataRelations || []).some(
                              (r) => r.dataset === region.id,
                            )
                              ? () => {
                                  const relation = page.dataRelations!.find(
                                    (r) => r.dataset === region.id,
                                  )!;
                                  setSelected(relation.output);
                                  revealCanvasElement(
                                    canvas.current?.querySelector(
                                      `[data-region-id="${relation.output}"]`,
                                    ),
                                    {
                                      block: "nearest",
                                      inline: "nearest",
                                    },
                                  );
                                }
                              : undefined
                          }
                          collapsed={collapsedData.includes(region.id)}
                          toggleCollapsed={() =>
                            setCollapsedData((ids) =>
                              ids.includes(region.id)
                                ? ids.filter((id) => id !== region.id)
                                : [...ids, region.id],
                            )
                          }
                          selection={activeData}
                          choose={(rows, columns, kind) =>
                            chooseData({
                              dataset: region.id,
                              rows,
                              columns,
                              kind,
                            })
                          }
                          connect={(columns, rows) =>
                            openDataReview(region.id, columns, rows)
                          }
                          selected={areaSelection || selectedId}
                          bound={page.regions
                            .filter((r) => r.source?.dataset === id)
                            .map((r) => ({
                              row: r.source!.row,
                              column: r.source!.column,
                              id: r.id,
                              name: p.statements.get(r.id)?.name || r.id,
                            }))}
                          select={(id) => {
                            setDataSelection(undefined);
                            setSelected(id);
                            setAreaSelection(id);
                            revealCanvasElement(
                              canvas.current?.querySelector(
                                `[data-region-id="${id}"]`,
                              ),
                              {
                                block: "nearest",
                                inline: "nearest",
                              },
                            );
                          }}
                          define={(row, column, name, unit) => {
                            const spot = {
                              x: at.x,
                              y:
                                (readCanvasFrames().find(
                                  (f) => f.id === region.id,
                                )?.height || 250) +
                                at.y +
                                45,
                            };
                            for (const f of readCanvasFrames())
                              if (
                                f.id !== region.id &&
                                spot.x < f.x + f.width &&
                                spot.x + 500 > f.x &&
                                spot.y < f.y + f.height &&
                                spot.y + 80 > f.y
                              )
                                spot.y = f.y + f.height + 25;
                            const id = session.quantityFromCell(
                              region.id,
                              row,
                              column,
                              name,
                              unit,
                              spot,
                            );
                            setSelected(id);
                            setAreaSelection(id);
                          }}
                        />
                      ) : region.external ? (
                        <ExternalReferenceView
                          name={region.label || effectiveText}
                          reference={region.external}
                          edit={() => setReferenceEditor(id)}
                        />
                      ) : s ? (
                        <div
                          className="er-math-line"
                          onDoubleClick={() => begin(id)}
                        >
                          <MathLine
                            statement={s}
                            text={effectiveText}
                            directEdit={quiet}
                            inspectSymbols={(page.dataRelations || []).some(
                              (r) => r.output === id,
                            )}
                            linkSources={accepted.sources}
                            onSymbol={(name) => {
                              const r = (page.dataRelations || []).find(
                                (r) => r.output === id,
                              );
                              if (r) {
                                const binding = r.bindings.find(
                                  (b) =>
                                    (b.quantity
                                      ? p.statements.get(b.quantity)?.name
                                      : b.symbol) === name,
                                );
                                if (binding) {
                                  chooseData({
                                    dataset: r.dataset,
                                    view: id,
                                    rows: [],
                                    columns: [binding.column],
                                    kind: "series",
                                  });
                                  return true;
                                }
                                if (name === s.name) {
                                  chooseData({
                                    dataset: r.dataset,
                                    view: id,
                                    rows: activeData?.rows || [],
                                    columns: [],
                                    kind: activeData?.rows.length
                                      ? "record"
                                      : "series",
                                  });
                                  return true;
                                }
                              }
                              const source = accepted.sources[name]?.[0];
                              if (source) {
                                if (!hierarchy.visible(source)) {
                                  setModelTrace(source);
                                  return true;
                                }
                                setDataSelection(undefined);
                                setAreaSelection(source);
                              }
                            }}
                            choose={(name) => chooseTerm(id, name)}
                            scrub={scrubFor(id)}
                            resolved={
                              expansionId === id && kind === "equation"
                                ? p
                                : undefined
                            }
                            scrubSource={scrubFor}
                            edit={(span) => begin(id, span)}
                            highlight={
                              linkedName ||
                              (systemOpen && systemInput
                                ? p.statements.get(systemInput)?.name
                                : undefined)
                            }
                            highlights={dataSymbols}
                            highlightExpression={
                              artifactFocus?.target === "expression" &&
                              linkedArtifact?.output === id
                            }
                          />
                          {dataState && kind === "equation" && (
                            <button
                              className="er-data-model-result"
                              onClick={() => {
                                setSelected(dataRelation!.id);
                                revealCanvasElement(
                                  canvas.current?.querySelector(
                                    `[data-data-relation-id="${dataRelation!.id}"]`,
                                  ),
                                  {
                                    block: "nearest",
                                    inline: "nearest",
                                  },
                                );
                              }}
                            >
                              {dataState.error
                                ? `Dataset blocked · ${dataState.error}`
                                : `${dataState.result!.records.length} records · calculated`}
                            </button>
                          )}
                          {(kind === "equation" ||
                            (kind === "quantity" &&
                              s &&
                              !quantityLiteral(s.expression))) &&
                            q &&
                            !error && (
                              <button
                                className={`er-result ${artifactFocus?.target === "context" && linkedArtifact?.output === id ? "is-linked" : ""}`}
                                data-result-for={s.name}
                                aria-label={`Inspect result ${s.anonymous ? "expression" : s.name}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const a = artifacts.find(
                                    (a) => a.output === id,
                                  );
                                  if (a) {
                                    setArtifactFocus({
                                      id: a.id,
                                      target: "context",
                                    });
                                    setSelected(id);
                                    setTerm(undefined);
                                  } else chooseTerm(id, s.name);
                                }}
                              >
                                {exploration &&
                                  ancestors(p, id).includes(
                                    exploration.input,
                                  ) && (
                                    <small className="er-result-preview">
                                      Preview
                                    </small>
                                  )}
                                = {display(q)}
                              </button>
                            )}
                          {kind === "constraint" &&
                            dataState?.result &&
                            !condition && (
                              <span className="er-data-requirement-status">
                                {
                                  dataState.result.records.filter(
                                    (r) => r.conditions[id],
                                  ).length
                                }
                                /{dataState.result.records.length} records
                                within limit
                              </span>
                            )}
                          {condition && !error && (
                            <span
                              className={`er-condition ${condition.pass ? "is-pass" : "is-fail"} ${artifactFocus?.target === "requirement" && linkedRequirement === id ? "is-linked" : ""}`}
                              role="status"
                              title="This authored mathematical condition only; not physical validation"
                            >
                              {condition.pass ? (
                                <Check size={14} />
                              ) : (
                                <X size={14} />
                              )}{" "}
                              {exploration &&
                              ancestors(p, id).includes(exploration.input)
                                ? "Preview · "
                                : ""}
                              {condition.pass ? "Satisfied" : "Not satisfied"}
                            </span>
                          )}
                        </div>
                      ) : (
                        <div
                          className={`er-note ${kind === "draft" ? "er-draft" : ""}`}
                          role="button"
                          tabIndex={0}
                          aria-label={
                            effectiveText
                              ? `Edit thought: ${effectiveText}`
                              : "Write here"
                          }
                          onClick={() => begin(id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") begin(id);
                          }}
                        >
                          {effectiveText ? (
                            <ReferencedNote
                              text={effectiveText}
                              links={page.links?.[id] || {}}
                              labels={Object.fromEntries(
                                page.regions.map((r) => [
                                  r.id,
                                  r.data?.name ||
                                    p.statements.get(r.id)?.name ||
                                    "Unavailable reference",
                                ]),
                              )}
                              open={navigateLink}
                            />
                          ) : (
                            <span>Continue writing…</span>
                          )}
                        </div>
                      )}
                      {trials.scrub &&
                        kind === "quantity" &&
                        !editing &&
                        !quiet && (
                          <small className="er-value-hint">
                            ↔ Drag value to explore · click to type
                          </small>
                        )}
                      {kind === "equation" &&
                        dataRelation &&
                        dataState?.result &&
                        activeData?.dataset === dataRelation.dataset &&
                        activeData.detail === "calculation" &&
                        activeData.view === id &&
                        editing !== id && (
                          <RecordFeedback
                            page={page}
                            relation={dataRelation}
                            records={dataState.result.records}
                            selection={activeData}
                            clear={() => {
                              setDataSelection(undefined);
                              setAreaSelection(undefined);
                              setSelected(undefined);
                            }}
                            follow={(row) => {
                              relationshipNav.follow(dataRelation, {
                                kind: "source",
                                row,
                              });
                            }}
                          />
                        )}
                      {kind === "constraint" &&
                        dataRelation &&
                        dataState?.result &&
                        activeData?.detail === "requirement" &&
                        activeData.view === id && (
                          <RecordFeedback
                            page={page}
                            relation={dataRelation}
                            records={dataState.result.records}
                            selection={activeData}
                            requirement={id}
                            clear={() => {
                              setDataSelection(undefined);
                              setAreaSelection(undefined);
                              setSelected(undefined);
                            }}
                            follow={(row) =>
                              relationshipNav.follow(dataRelation, {
                                kind: "source",
                                row,
                              })
                            }
                          />
                        )}
                      {error && editing !== id && (
                        <div className="er-region-error">
                          {error}
                          {s &&
                            references(s.expression)
                              .filter((name) => !p.sources[name])
                              .slice(0, 1)
                              .map((name) => (
                                <button
                                  key={name}
                                  onClick={() => {
                                    const next = session.create(
                                      undefined,
                                      hierarchy.scope,
                                    );
                                    session.write(next, `${name} := `);
                                    begin(next);
                                  }}
                                >
                                  Define {name} here <Plus size={11} />
                                </button>
                              ))}
                        </div>
                      )}
                      {kind === "note" &&
                        !region.data &&
                        effectiveText &&
                        editing !== id &&
                        selected === id && (
                          <small className="er-informal">
                            Informal thought · not executable
                          </small>
                        )}
                      {!quiet &&
                        compare &&
                        page.active !== "original" &&
                        other &&
                        s &&
                        kind === "equation" &&
                        !error && (
                          <small className="er-comparison">
                            Original {display(other)}{" "}
                            <span>
                              →{" "}
                              {
                                contexts.find((c) => c.id === page.active)
                                  ?.label
                              }{" "}
                              {display(q)}
                            </span>
                          </small>
                        )}
                      {!quiet &&
                        compare &&
                        page.active !== "original" &&
                        condition && (
                          <small className="er-comparison">
                            Original{" "}
                            {original?.solved.constraints.get(id)?.pass
                              ? "satisfied"
                              : "not satisfied"}{" "}
                            <span>
                              ·{" "}
                              {
                                contexts.find((c) => c.id === page.active)
                                  ?.label
                              }{" "}
                              {condition.pass ? "satisfied" : "not satisfied"}
                            </span>
                          </small>
                        )}
                      {region.source && selected === id && (
                        <button
                          className="er-source-caption"
                          onClick={(e) => {
                            e.stopPropagation();
                            revealCanvasElement(
                              canvas.current?.querySelector(
                                `[data-region-id="${region.source!.dataset}"]`,
                              ),
                              {
                                block: "nearest",
                                inline: "nearest",
                              },
                            );
                          }}
                        >
                          {page.regions.find(
                            (r) => r.id === region.source!.dataset,
                          )?.data?.name || "Source unavailable"}{" "}
                          · row {region.source.row + 1} ·{" "}
                          {effectiveText.trim() ===
                          measurementText(
                            s?.name || "q",
                            region.source.raw,
                            region.source.unit,
                          )
                            ? "Imported measurement"
                            : "Edited assumption"}
                        </button>
                      )}
                    </section>
                  );
                })}
                {page.plots
                  .filter((plot) => hierarchy.visible(plot.id))
                  .map((plot) => (
                    <CurveRegion
                      key={plot.id}
                      session={session}
                      workingPage={working}
                      comparisonContext={comparisonContext}
                      previewOnMove={trials.scrub}
                      finishInput={finishValue}
                      commands={() => paletteOpen("search")}
                      quiet={quiet}
                      revert={revertExploration}
                      plot={{ ...plot, at: places[plot.id] }}
                      compare={compare}
                      selected={selected === plot.id}
                      select={() => {
                        setSelected(plot.id);
                        setTerm(undefined);
                      }}
                      move={(at) => session.move(plot.id, at)}
                      resize={(w, h) => session.resize(plot.id, w, h)}
                      inspect={() => begin(plot.output)}
                      branch={branch}
                      reveal={() => {
                        setSelected(plot.id);
                        setOverlay("dependencies");
                      }}
                      setInput={setInput}
                    />
                  ))}
                {artifactMode &&
                  artifacts.map((a) => (
                    <ArtifactView
                      dataSelection={activeData}
                      inspectMeasurement={(dataset, row, column) =>
                        chooseData({ dataset, rows: [row], columns: [column] })
                      }
                      key={a.id}
                      artifact={{
                        ...a,
                        at: spatial.preview[a.id] || a.at,
                        views: a.views?.map((v) => ({
                          ...v,
                          at: spatial.preview[v.id] || v.at,
                        })),
                      }}
                      layoutCancelVersion={spatial.cancelVersion}
                      closedViews={spatial.closed}
                      hiddenViews={spatial.hidden}
                      groupedViews={
                        new Set(spatial.scene.groups.flatMap((g) => g.members))
                      }
                      viewContexts={spatial.scene.pins}
                      pinView={spatial.pin}
                      focusCanvas={spatial.focusObject}
                      detach={spatial.detach}
                      openTool={(editor, view, context) => {
                        const frame = spatial.frames.find((f) => f.id === view);
                        spatial.openTool(
                          editor,
                          a.output,
                          a.id,
                          context,
                          frame
                            ? { x: frame.x, y: frame.y + frame.height + 36 }
                            : undefined,
                        );
                      }}
                      trace={() =>
                        inspectConnections(a.output, {
                          x: a.at.x + 24,
                          y: a.at.y + 55,
                        })
                      }
                      page={page}
                      current={working}
                      zoom={zoom}
                      change={(next) =>
                        setArtifacts((items) =>
                          items.map((item) =>
                            item.id === next.id ? next : item,
                          ),
                        )
                      }
                      remove={() => spatial.closeView(a.id)}
                      explore={exploreValue}
                      finish={finishValue}
                      revert={revertExploration}
                      accept={acceptExploration}
                      undo={() => {
                        session.undo();
                        setLastEdit(undefined);
                        revertExploration();
                      }}
                      focus={artifactFocus}
                      select={(target, range, quantity, view) => {
                        setAreaSelection(
                          target === "input" || target === "point"
                            ? quantity || a.input
                            : a.output,
                        );
                        setArtifactFocus({
                          id: a.id,
                          target,
                          range,
                          quantity,
                          view,
                        });
                        setSelected(
                          target === "input" || target === "point"
                            ? quantity || a.input
                            : a.output,
                        );
                        setTerm(undefined);
                        setOverlay("none");
                      }}
                      pending={
                        !!exploration &&
                        exploration.input === a.input &&
                        !gestureActive
                      }
                      canKeep={
                        lastEdit?.page === page && lastEdit.input === a.input
                      }
                      branch={(keep) => {
                        if (exploration) {
                          setMessage("Accept or revert the value first.");
                          return;
                        }
                        try {
                          const context =
                            keep && lastEdit
                              ? lastEdit.before.active
                              : page.active;
                          if (
                            keep &&
                            lastEdit?.page === page &&
                            lastEdit.input === a.input
                          )
                            session.branchEdit(a.input, lastEdit.before);
                          else session.branch();
                          setArtifacts((items) =>
                            items.map((item) =>
                              item.id === a.id
                                ? {
                                    ...item,
                                    compareContext: context,
                                    comparing: keep,
                                  }
                                : item,
                            ),
                          );
                          setLastEdit(undefined);
                          setArtifactFocus((focus) => ({
                            id: a.id,
                            target: "point",
                            view: focus?.view,
                          }));
                          setTerm(undefined);
                        } catch (e) {
                          setMessage((e as Error).message);
                        }
                      }}
                      measure={(id, height) =>
                        setArtifactHeights((previous) =>
                          Math.abs((previous[id] || 0) - height) < 1
                            ? previous
                            : { ...previous, [id]: height },
                        )
                      }
                    />
                  ))}
                {spatial.scene.tools.map((t) => (
                  <CanvasToolView
                    key={t.id}
                    cancelVersion={spatial.cancelVersion}
                    tool={{ ...t, at: spatial.preview[t.id] || t.at }}
                    zoom={zoom}
                    hidden={spatial.hidden.has(t.id)}
                    editorProps={canvasEditors}
                    change={(next) =>
                      spatial.setScene((s) => ({
                        ...s,
                        tools: s.tools.map((t) =>
                          t.id === next.id ? next : t,
                        ),
                      }))
                    }
                    close={() => spatial.closeTool(t.id)}
                    focus={() => spatial.focusObject(t.id)}
                    detach={() => spatial.detach(t.id)}
                    grouped={spatial.scene.groups.some((g) =>
                      g.members.includes(t.id),
                    )}
                  />
                ))}
                {expansionId && focusedInput && (
                  <div
                    className="er-expansion-position"
                    aria-label={
                      overlay === "dependencies"
                        ? "Dependency overlay"
                        : undefined
                    }
                    style={{ left: attachmentAt.x, top: attachmentAt.y }}
                  >
                    <RelationshipExpansion
                      accepted={page}
                      current={working}
                      p={p}
                      focus={expansionId}
                      symbol={term}
                      edit={(id) =>
                        begin(id, sourceSpans(accepted.texts[id] || "")[0])
                      }
                      close={() => {
                        setTerm(undefined);
                        setOverlay("none");
                      }}
                    />
                  </div>
                )}
                {showComparison && (
                  <SpatialComparison
                    page={page}
                    current={working}
                    context={comparisonContext!}
                    output={comparison!.output}
                    input={comparison!.input}
                    at={attachmentAt}
                    move={(at) => session.move(attachmentId, at)}
                    scrub={scrubFor}
                    edit={(id) =>
                      begin(id, sourceSpans(accepted.texts[id] || "")[0])
                    }
                    switchContext={(id) => {
                      setExploration(undefined);
                      session.switchContext(id);
                    }}
                    close={() => setCompare(false)}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </WorkspaceAreas>
      {spatial.error && (
        <div role="status" className="er-message">
          {spatial.error}
        </div>
      )}
      {explicit &&
        exploration &&
        working !== page &&
        !(pointControls && pointControls.input === exploration.input) && (
          <InlineExploration
            proposal={exploration}
            accepted={accepted}
            current={p}
            anchor={previewAnchor.current}
            busy={gestureActive}
            accept={acceptExploration}
            revert={revertExploration}
          />
        )}
      {!exploration &&
        lastEdit?.page === page &&
        !(pointControls && pointControls.input === lastEdit.input) && (
          <InlineRecovery
            anchor={lastEdit.anchor}
            input={lastEdit.input}
            previous={lastEdit.previous}
            undo={() => {
              session.undo();
              setLastEdit(undefined);
            }}
          />
        )}
      {term && selectedId && !trials.expand && (
        <aside
          className="er-popover er-term-popover"
          aria-label="Quantity actions"
        >
          <header>
            <b>{label(term)}</b>
            <button
              aria-label="Close quantity actions"
              onClick={() => setTerm(undefined)}
            >
              <X size={14} />
            </button>
          </header>
          {refs.length === 1 ? (
            <>
              <p>
                {p.kinds[refs[0]] === "quantity"
                  ? "Assigned quantity"
                  : "Computed quantity"}{" "}
                · this page
                <br />
                {display(p.solved.values.get(term))}
              </p>
              <button onClick={() => begin(refs[0])}>
                Edit definition <ArrowUpRight size={13} />
              </button>
              <button onClick={() => plotSelection(refs[0])}>
                Plot response
              </button>
              <button onClick={branch}>Try another assumption</button>
              <button onClick={() => setOverlay("dependencies")}>
                Reveal dependencies
              </button>
            </>
          ) : (
            <p>
              {refs.length > 1
                ? "This name is ambiguous: more than one definition uses it."
                : "Unresolved on this page. Define it without leaving your calculation."}
            </p>
          )}
          <small>
            Selection, definition, and calculation remain the same object.
          </small>
        </aside>
      )}
      {palette && (
        <div className="er-scrim" onMouseDown={() => setPalette(undefined)}>
          <section
            className="er-palette"
            aria-label={
              palette === "slash" ? "Add to canvas" : "Objects and commands"
            }
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header>
              <Search size={16} />
              <input
                aria-label="Search commands"
                autoFocus
                placeholder={
                  palette === "slash"
                    ? "Write, import, or plot…"
                    : "Find a quantity or action…"
                }
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setPalette(undefined);
                  }
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const first = e.currentTarget
                      .closest("section")
                      ?.querySelector<HTMLButtonElement>(".er-command-item");
                    first?.click();
                  }
                }}
              />
              <button
                aria-label="Close commands"
                onClick={() => setPalette(undefined)}
              >
                <X size={15} />
              </button>
            </header>
            {palette === "slash" ? (
              <>
                <small className="er-palette-caption">Add to canvas</small>
                {concepts
                  .filter(([name]) =>
                    ["Equation", "Note", "Data", "Plot"].includes(name),
                  )
                  .filter(([name, description]) =>
                    (name + description)
                      .toLowerCase()
                      .includes(query.toLowerCase()),
                  )
                  .map(([name, description]) => (
                    <button
                      className="er-command-item"
                      key={name}
                      onClick={() => {
                        setPalette(undefined);
                        if (name === "Data") {
                          csvFile.current?.click();
                          return;
                        }
                        if (name === "Plot") {
                          plotSelection();
                          return;
                        }
                        if (
                          [
                            "Equation",
                            "Quantity",
                            "Constraint",
                            "Note",
                          ].includes(name)
                        ) {
                          if (editing)
                            requestAnimationFrame(() =>
                              editor.current?.focus(),
                            );
                          else fresh();
                          return;
                        }
                        setConcept(name);
                      }}
                    >
                      <b>{name}</b>
                      <span>{description}</span>
                    </button>
                  ))}
              </>
            ) : (
              <>
                {requestedLink && (
                  <button
                    className="er-command-item"
                    onClick={() => {
                      const { edit, symbol } = requestedLink;
                      setPalette(undefined);
                      setLinkMenu({
                        source:
                          edit.kind === "constrain" ? edit.target : edit.source,
                        mode: "review",
                        at: {
                          x: (canvasScroll.x + 160) / zoom,
                          y: (canvasScroll.y + 120) / zoom,
                        },
                        target: {
                          region:
                            edit.kind === "constrain"
                              ? edit.source
                              : edit.target,
                          symbol,
                        },
                      });
                    }}
                  >
                    <b>Review connection</b>
                    <span>{requestedLink.edit.label}</span>
                  </button>
                )}
                {artifactMode &&
                  /^plot\s+.+\s+(?:versus|vs\.?)\s+.+\s+from\s+/i.test(
                    query,
                  ) && (
                    <button
                      className="er-command-item"
                      onClick={() => createArtifact(query)}
                    >
                      <b>Plot response</b>
                      <span>{query}</span>
                    </button>
                  )}
                {actions
                  .filter(([name]) =>
                    name.toLowerCase().includes(query.toLowerCase()),
                  )
                  .map(([name, action]) => (
                    <button
                      className="er-command-item"
                      key={name}
                      onClick={() => {
                        setPalette(undefined);
                        action();
                      }}
                    >
                      {name}
                    </button>
                  ))}
                {(page.models || [])
                  .filter((m) =>
                    m.name.toLowerCase().includes(query.toLowerCase()),
                  )
                  .map((m) => (
                    <button
                      className="er-command-item"
                      key={m.id}
                      onClick={() => {
                        setPalette(undefined);
                        hierarchy.go(m.id);
                      }}
                    >
                      <b>{m.name}</b>
                      <span>Model · {m.members.length} objects</span>
                    </button>
                  ))}
                {page.regions
                  .filter(
                    (r) =>
                      (p.statements.get(r.id)?.name || r.text)
                        .toLowerCase()
                        .includes(query.toLowerCase()) && r.text,
                  )
                  .map((r) => (
                    <button
                      className="er-command-item"
                      key={r.id}
                      onClick={() => {
                        setPalette(undefined);
                        hierarchy.reveal(r.id);
                      }}
                    >
                      <b>{p.statements.get(r.id)?.name || "Thought"}</b>
                      <span>
                        {p.texts[r.id]}
                        {hierarchy.owner(r.id) &&
                          ` · ${modelPath(page, hierarchy.owner(r.id))
                            .map((m) => m.name)
                            .join(" / ")}`}
                      </span>
                    </button>
                  ))}
              </>
            )}
          </section>
        </div>
      )}
      {modelReview && (
        <ModelReview
          key={modelReview.existing?.id || "new-model"}
          page={page}
          members={modelReview.members}
          existing={modelReview.existing}
          representations={hierarchyRepresentations}
          close={() => setModelReview(undefined)}
          save={(model) => {
            if (modelReview.existing)
              session.exposeModel(
                model.id,
                model.inputs,
                model.outputs,
                model.name,
              );
            else {
              const bounds = frameBounds(
                readCanvasFrames().filter((f) =>
                  modelReview.members.includes(hierarchy.canonical(f.id)),
                ),
              );
              const anchor = { x: bounds?.x || 120, y: bounds?.y || 140 },
                obstacles = readCanvasFrames().filter(
                  (f) => !model.members.includes(hierarchy.canonical(f.id)),
                );
              const candidates = Array.from({ length: 24 }, (_, i) => ({
                x: anchor.x + (i % 4) * 430,
                y: anchor.y + Math.floor(i / 4) * 520,
              }));
              const at =
                candidates.find(
                  (at) =>
                    !obstacles.some(
                      (f) =>
                        at.x < f.x + f.width + 24 &&
                        at.x + 390 > f.x &&
                        at.y < f.y + f.height + 24 &&
                        at.y + 480 > f.y,
                    ),
                ) || candidates.at(-1)!;
              session.makeModel(
                model,
                at,
                artifacts.flatMap((a) => [
                  a.id,
                  ...(a.views || []).map((v) => v.id),
                ]),
              );
            }
            setModelReview(undefined);
            setCanvasSelection([]);
            setSelected(model.id);
          }}
        />
      )}
      {modelConnection && (
        <ModelConnection
          page={page}
          source={modelConnection}
          initialTarget={modelConnectionTarget}
          close={() => {
            setModelConnection(undefined);
            setModelConnectionTarget(undefined);
          }}
          accept={(edit) => session.connect(edit)}
        />
      )}
      {concept && (
        <aside
          className="er-popover er-concept"
          aria-label="Region design discussion"
        >
          <header>
            <span>Interaction design · {concept}</span>
            <button
              aria-label="Close concept"
              onClick={() => setConcept(undefined)}
            >
              <X size={14} />
            </button>
          </header>
          <p>{concepts.find(([name]) => name === concept)?.[2]}</p>
          <small>
            What must remain consistent when this object appears as notation, a
            curve, or a physical representation?
          </small>
          <button
            onClick={() => {
              setConcept(undefined);
              if (editing) editor.current?.focus();
              else if (selectedId) begin(selectedId);
              else fresh();
            }}
          >
            Continue writing
          </button>
        </aside>
      )}
      {message && (
        <div className="er-message" role="status">
          {message}
          <button aria-label="Dismiss message" onClick={() => setMessage("")}>
            <X size={13} />
          </button>
        </div>
      )}
      {storageError && (
        <aside className="er-storage-error" role="status">
          {storageError}
        </aside>
      )}
      {history && (
        <aside
          className="er-popover er-history"
          aria-label="Calculation history"
        >
          <header>
            <b>Retained calculations</b>
            <button
              aria-label="Close history"
              onClick={() => setHistory(false)}
            >
              <X size={14} />
            </button>
          </header>
          <p>
            Typed mathematics only. Satisfied conditions are not physical
            validation.
          </p>
          {[...session.receipts].reverse().map((r) => (
            <details key={r.id}>
              <summary>
                {page.contexts.find((c) => c.id === r.context)?.label ||
                  r.context}{" "}
                ·{" "}
                {Object.keys(r.errors).length
                  ? "partially blocked"
                  : "calculated"}
                <small>
                  {r.context === page.active && r.key === semanticKey(page)
                    ? "Matches this page"
                    : "Earlier state"}
                </small>
              </summary>
              <pre>
                {JSON.stringify(
                  {
                    definitions: r.definitions,
                    values: r.values,
                    conditions: r.conditions,
                    errors: r.errors,
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
          ))}
        </aside>
      )}
      <div
        className="er-zoom"
        onPointerDown={(e) => {
          if ((e.target as Element).closest("button")) e.preventDefault();
        }}
        style={{
          display: !artifactMode || areaCanvasVisible ? undefined : "none",
        }}
      >
        <button
          aria-label="Pan canvas"
          aria-pressed={navigation.hand}
          title="Pan canvas · Space-drag or middle-button drag"
          onClick={() => navigation.setHand(!navigation.hand)}
        >
          <Hand size={15} />
        </button>
        <button
          aria-label="Zoom out"
          onClick={() => navigation.zoomBy(-0.1)}
          title="Zoom out (−)"
          disabled={zoom <= 0.1}
        >
          −
        </button>
        <button
          aria-label="Fit page"
          title="Fit page (double middle-click or Shift+1)"
          onClick={fit}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          aria-label="Zoom in"
          onClick={() => navigation.zoomBy(0.1)}
          title="Zoom in (+)"
          disabled={zoom >= 2}
        >
          +
        </button>
        <details className="er-navigation-help">
          <summary aria-label="Canvas navigation" title="Canvas navigation">
            <HelpCircle size={14} />
          </summary>
          <div role="group" aria-label="Canvas gestures">
            <strong>Move around</strong>
            <span>
              Scroll wheel <kbd>Zoom</kbd>
            </span>
            <span>
              ⌘ / Ctrl + scroll · pinch <kbd>Zoom</kbd>
            </span>
            <span>
              Space + drag · middle drag <kbd>Pan</kbd>
            </span>
            <span>
              Shift + scroll <kbd>Pan sideways</kbd>
            </span>
            <span>
              + / − <kbd>Zoom</kbd>
            </span>
            <span>
              Double middle-click · Shift + 1 <kbd>Fit page</kbd>
            </span>
            <span>
              ⌘ / Ctrl + 0 <kbd>100%</kbd>
            </span>
          </div>
        </details>
      </div>
    </main>
  );
}
