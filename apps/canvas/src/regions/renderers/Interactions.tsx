import { isDialogEvent } from "../interaction/modalInput";
import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ArrowRight, GripVertical, X } from "lucide-react";
import { display, unitLabel, type Quantity } from "../../notebook/math";
import {
  ancestors,
  curve,
  project,
  type Page,
  type Point,
  type Projection,
} from "../document";
import {
  boundedValue,
  responseFor,
  type Exploration,
  type VariationRange,
} from "../exploration";
const shown = (q?: Quantity) => (q ? display(q) : "Unresolved");
const short = (n: number) => Number(n.toPrecision(4)).toString();
export type Scrub = {
  quantity: Quantity;
  range?: VariationRange;
  explore: (value: number, anchor?: Element) => void;
  finish: () => void;
  revert: () => void;
};
export function ScrubNumber({
  children,
  scrub,
  edit,
  name,
  math = false,
  title,
}: {
  children: ReactNode;
  scrub?: Scrub;
  edit?: (anchor?: Element, point?: { x: number; y: number }) => void;
  title?: string;
  name: string;
  math?: boolean;
}) {
  const pointer = useRef<
    | { x: number; start: number; moved: boolean; target: Element; id: number }
    | undefined
  >(undefined);
  const suppress = useRef(false);
  const keyboard = useRef(false);
  const cancel = () => {
    const p = pointer.current;
    if (p?.target.hasPointerCapture(p.id)) p.target.releasePointerCapture(p.id);
    pointer.current = undefined;
    keyboard.current = false;
    scrub?.revert();
  };
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (isDialogEvent(e)) return;
      if (e.key === "Escape" && pointer.current) cancel();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  });
  const props = {
    role: "button",
    tabIndex: 0,
    "aria-label": name,
    className: `er-number ${scrub ? "er-scrubbable" : ""}`,
    title: title || (scrub ? "Drag to vary · click to edit" : "Click to edit"),
    onPointerDown: (e: React.PointerEvent<Element>) => {
      if (!scrub || e.button !== 0) return;
      e.stopPropagation();
      suppress.current = false;
      e.currentTarget.setPointerCapture(e.pointerId);
      pointer.current = {
        x: e.clientX,
        start: scrub.quantity.value,
        moved: false,
        target: e.currentTarget,
        id: e.pointerId,
      };
    },
    onPointerMove: (e: React.PointerEvent<Element>) => {
      const p = pointer.current;
      if (!p || !scrub || (!p.moved && Math.abs(e.clientX - p.x) < 4)) return;
      p.moved = true;
      suppress.current = true;
      const base = scrub.quantity.absolute ? p.start - 273.15 : p.start;
      const step =
        (scrub.range?.step || Math.abs(base) / 180 || 0.01) *
        (e.shiftKey ? 0.1 : 1);
      const value = p.start + (e.clientX - p.x) * step;
      scrub.explore(
        scrub.range ? boundedValue(value, scrub.range) : value,
        e.currentTarget,
      );
    },
    onPointerUp: (e: React.PointerEvent<Element>) => {
      if (!pointer.current) return;
      const moved = pointer.current.moved;
      e.currentTarget.releasePointerCapture(e.pointerId);
      pointer.current = undefined;
      if (moved) scrub?.finish();
    },
    onPointerCancel: cancel,
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      if (suppress.current) {
        suppress.current = false;
        return;
      }
      edit?.(e.currentTarget, { x: e.clientX, y: e.clientY });
    },
    onKeyUp: (e: React.KeyboardEvent) => {
      if (keyboard.current && ["ArrowLeft", "ArrowRight"].includes(e.key)) {
        keyboard.current = false;
        scrub?.finish();
      }
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (scrub && ["ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.stopPropagation();
        e.preventDefault();
        const value = scrub.quantity.value,
          base = scrub.quantity.absolute ? value - 273.15 : value;
        keyboard.current = true;
        scrub.explore(
          value +
            (e.key === "ArrowRight" ? 1 : -1) *
              (scrub.range?.step || Math.abs(base) / 100 || 0.01) *
              (e.shiftKey ? 0.1 : 1),
          e.currentTarget,
        );
      } else if (e.key === "Enter") {
        e.stopPropagation();
        e.preventDefault();
        edit?.(e.currentTarget);
      } else if (e.key === "Escape") {
        cancel();
      }
    },
  };
  return React.createElement(math ? "mn" : "button", props, children);
}

function MiniResponse({
  accepted,
  current,
  focus,
  symbol,
}: {
  accepted: Page;
  current: Page;
  focus: string;
  symbol?: string;
}) {
  const spec = useMemo(
    () => responseFor(accepted, focus, symbol),
    // Keep the inspected window stable when a value is accepted.
    [accepted.active, focus, symbol],
  );
  const data = useMemo(
    () => (spec ? curve(current, spec, current.active) : undefined),
    [current, spec],
  );
  if (!spec || !data?.points.length)
    return (
      <p className="er-lens-empty">
        Resolve an input and its dependent equation to explore a response.
      </p>
    );
  const p = project(current),
    input = p.statements.get(spec.input)!,
    output = p.statements.get(spec.output)!,
    q = p.solved.values.get(input.name),
    value = p.solved.values.get(output.name);
  const finite = data.points.flatMap((pt) =>
    [pt.y, pt.limit].filter((v): v is number => v !== undefined),
  );
  const low = Math.min(...finite),
    high = Math.max(...finite),
    pad = Math.max(1, (high - low) * 0.12);
  const x = (n: number) => 10 + ((n - spec.low) / (spec.high - spec.low)) * 310,
    y = (n: number) => 91 - ((n - low + pad) / (high - low + 2 * pad)) * 78;
  let open = false;
  const path = data.points
    .map((pt) => {
      if (pt.y === undefined) {
        open = false;
        return "";
      }
      const d = `${open ? "L" : "M"}${x(pt.x)},${y(pt.y)}`;
      open = true;
      return d;
    })
    .join(" ");
  const bound = data.points.find((pt) => pt.limit !== undefined)?.limit;
  return (
    <div className="er-mini-response" aria-label="Contextual response preview">
      <div>
        <span>
          {input.name} <ArrowRight size={13} /> {output.name}
        </span>
      </div>
      <svg
        viewBox="0 0 330 108"
        role="img"
        aria-label={`${output.name} response to ${input.name}`}
      >
        {bound !== undefined && (
          <line
            className="er-requirement-line"
            x1={10}
            x2={320}
            y1={y(bound)}
            y2={y(bound)}
          >
            <title>Authored limit</title>
          </line>
        )}
        <path className="er-mini-line" d={path} />
        {q && value && (
          <>
            <line
              className="er-guide"
              x1={x(q.value)}
              x2={x(q.value)}
              y1={6}
              y2={94}
            />
            <circle
              className="er-mini-point"
              cx={x(q.value)}
              cy={y(value.absolute ? value.value - 273.15 : value.value)}
              r={5}
            />
          </>
        )}
        <text x={10} y={106}>
          {short(q?.absolute ? spec.low - 273.15 : spec.low)}
        </text>
        <text x={320} y={106} textAnchor="end">
          {short(q?.absolute ? spec.high - 273.15 : spec.high)}{" "}
          {q && unitLabel(q)}
        </text>
      </svg>
    </div>
  );
}
export function RelationshipExpansion({
  accepted,
  current,
  p,
  focus,
  symbol,
  edit,
  close,
}: {
  accepted: Page;
  current: Page;
  p: Projection;
  focus: string;
  symbol?: string;
  edit: (id: string) => void;
  close: () => void;
}) {
  const id =
    symbol && p.sources[symbol]?.length === 1
      ? p.sources[symbol][0]
      : undefined;
  if (!id || p.kinds[id] !== "quantity") return null;
  return (
    <section className="er-investigation" aria-label="Relationship expansion">
      <header>
        <button
          className="er-source-link"
          onClick={() => edit(id)}
          title={project(accepted).texts[id]}
          aria-label={`Definition of ${symbol}`}
        >
          {symbol} <ArrowRight size={12} /> definition on this page
        </button>
        <button aria-label="Close relationship" onClick={close}>
          <X size={14} />
        </button>
      </header>
      <MiniResponse
        accepted={accepted}
        current={current}
        focus={focus}
        symbol={symbol}
      />
    </section>
  );
}
export function useAnchor(
  anchor?: Element,
  input?: string,
  width = 280,
  height = 60,
) {
  const [at, setAt] = useState({ left: 20, top: 80 });
  const place = () => {
    const target = anchor?.isConnected
      ? anchor
      : input
        ? document.querySelector(`[data-region-id="${input}"] .er-number`)
        : undefined;
    if (!target) return;
    const annotated =
      target.closest("[data-source-id]")?.parentElement?.parentElement;
    const r = (annotated || target).getBoundingClientRect();
    const next = {
      left: Math.max(12, Math.min(window.innerWidth - width - 12, r.left)),
      top: Math.max(
        70,
        Math.min(window.innerHeight - height - 12, r.bottom + 10),
      ),
    };
    setAt((previous) =>
      previous.left === next.left && previous.top === next.top
        ? previous
        : next,
    );
  };
  useLayoutEffect(() => {
    place();
  });
  useEffect(() => {
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor, input]);
  return at;
}
export function InlineExploration({
  proposal,
  accepted,
  current,
  anchor,
  busy,
  accept,
  revert,
}: {
  proposal: Exploration;
  accepted: Projection;
  current: Projection;
  anchor?: Element;
  busy: boolean;
  accept: () => void;
  revert: () => void;
}) {
  const at = useAnchor(anchor, proposal.input);
  const name = accepted.statements.get(proposal.input)?.name || "?";
  const invalid = [...current.errors].some(
    ([id]) =>
      id === proposal.input || ancestors(current, id).includes(proposal.input),
  );
  if (busy) return null;
  return (
    <aside className="er-inline-change" style={at} aria-label="Pending value">
      <span title="Accepted value">
        was {shown(accepted.solved.values.get(name))}
      </span>
      <button onClick={revert}>Revert</button>
      <button
        className="er-accept"
        disabled={invalid}
        title={invalid ? "Resolve the calculation before accepting" : undefined}
        onClick={accept}
      >
        Accept
      </button>
    </aside>
  );
}
export function InlineRecovery({
  anchor,
  input,
  previous,
  undo,
}: {
  anchor?: Element;
  input: string;
  previous: Quantity;
  undo: () => void;
}) {
  const at = useAnchor(anchor, input);
  return (
    <aside
      className="er-inline-change er-inline-recovery"
      style={at}
      aria-label="Previous value"
    >
      <span>was {shown(previous)}</span>
      <button onClick={undo}>Undo</button>
    </aside>
  );
}
export function SpatialComparison({
  page,
  current,
  context,
  output,
  input,
  at,
  move,
  scrub,
  edit,
  switchContext,
  close,
}: {
  page: Page;
  current: Page;
  context: string;
  output: string;
  input?: string;
  at: Point;
  move: (at: Point) => void;
  scrub: (id: string) => Scrub | undefined;
  edit: (id: string) => void;
  switchContext: (id: string) => void;
  close: () => void;
}) {
  const original = project(page, "original"),
    alternative = project(current, context),
    s = original.statements.get(output),
    name = s?.name || "?";
  const c = page.contexts.find((c) => c.id === context)!;
  const changes = Object.keys(c.overrides).filter((id) =>
    ancestors(alternative, output).includes(id),
  );
  const assigned = ancestors(alternative, output).filter(
    (id) => alternative.kinds[id] === "quantity",
  );
  const inputs = [
    ...new Set([
      ...(input ? [input] : []),
      ...(changes.length ? changes : input ? [] : assigned.slice(0, 1)),
    ]),
  ].filter((id) => alternative.statements.has(id));
  const drag = useRef<{ x: number; y: number; scale: number } | undefined>(
    undefined,
  );
  const [offset, setOffset] = React.useState<Point>();
  return (
    <section
      className="er-spatial-compare"
      aria-label="Spatial comparison"
      style={{ left: offset?.x ?? at.x, top: offset?.y ?? at.y }}
    >
      <header>
        <button
          aria-label="Move comparison"
          className="er-comparison-grip"
          onPointerDown={(e) => {
            e.stopPropagation();
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = {
              x: e.clientX,
              y: e.clientY,
              scale:
                e.currentTarget.closest("section")!.getBoundingClientRect()
                  .width / 600,
            };
          }}
          onPointerMove={(e) => {
            if (drag.current)
              setOffset({
                x: at.x + (e.clientX - drag.current.x) / drag.current.scale,
                y: at.y + (e.clientY - drag.current.y) / drag.current.scale,
              });
          }}
          onPointerUp={(e) => {
            if (drag.current) {
              move({
                x: at.x + (e.clientX - drag.current.x) / drag.current.scale,
                y: at.y + (e.clientY - drag.current.y) / drag.current.scale,
              });
              drag.current = undefined;
              setOffset(undefined);
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
          }}
          onPointerCancel={() => {
            drag.current = undefined;
            setOffset(undefined);
          }}
        >
          <GripVertical size={17} />
          <span>Move comparison</span>
        </button>
        <small>One relationship · two assumptions</small>
        <button aria-label="Close comparison" onClick={close}>
          <X size={16} />
        </button>
      </header>
      <div className="er-comparison-pair">
        {[
          ["original", "Original", original],
          [context, c.label, alternative],
        ].map(([id, label, p]) => {
          const projection = p as Projection;
          return (
            <div
              key={id as string}
              className={
                id === "original"
                  ? "er-original-result"
                  : "er-alternative-result"
              }
            >
              <button
                onClick={() => switchContext(id as string)}
                aria-pressed={page.active === id}
              >
                {label as string}
                {id === page.active && current !== page ? " · preview" : ""}
              </button>
              <div className="er-comparison-result">
                <span>{name} = </span>
                <b>{shown(projection.solved.values.get(name))}</b>
              </div>
              <div className="er-comp-assumptions">
                {inputs.map((input) => {
                  const s = projection.statements.get(input)!,
                    q = projection.solved.values.get(s.name);
                  return (
                    <div key={input}>
                      <span>{s.name} = </span>
                      {id === page.active ? (
                        <ScrubNumber
                          name={`Explore compared ${s.name}`}
                          scrub={scrub(input)}
                          edit={() => edit(input)}
                        >
                          {shown(q)}
                        </ScrubNumber>
                      ) : (
                        <span>{shown(q)}</span>
                      )}
                    </div>
                  );
                })}
              </div>
              {[...projection.solved.constraints]
                .filter(([id]) => ancestors(projection, id).includes(output))
                .map(([id, c]) => (
                  <span
                    key={id}
                    className={`er-comp-condition ${c.pass ? "is-pass" : "is-fail"}`}
                  >
                    {c.pass
                      ? "Within authored limit"
                      : "Outside authored limit"}
                  </span>
                ))}
            </div>
          );
        })}
      </div>
      <footer>
        <small>
          Definitions stay linked. Changes belong to the selected assumption
          context.
        </small>
      </footer>
    </section>
  );
}
