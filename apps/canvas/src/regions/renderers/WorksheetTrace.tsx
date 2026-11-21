import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { ArrowUpRight, GitBranch, Pin, X } from "lucide-react";
import { display } from "../../notebook/math";
import { createFrameTask } from "../interaction/frameTask";
import { useNumberScrub, type Scrub } from "../interaction/useNumberScrub";
import type { TracePort, WorksheetTrace } from "../worksheetTrace";
import { traceGeometry, type TraceGeometry } from "./worksheetTraceGeometry";
import "../styles/worksheetTrace.css";

function SourceValue({
  port,
  scrub,
  version,
}: {
  port: TracePort;
  scrub?: Scrub;
  version: unknown;
}) {
  const { events, cancel } = useNumberScrub({ read: () => ({ scrub }) });
  useLayoutEffect(() => {
    cancel();
  }, [version]);
  const value = (
    <>
      <i>{port.name}</i>
      <span> = </span>
      <b>{display(port.value)}</b>
    </>
  );
  return scrub ? (
    <button
      className="er-trace-value"
      aria-label={`Vary ${port.name}: ${display(port.value)}`}
      title="Drag or use arrow keys to vary · Shift for fine steps"
      {...events}
    >
      {value}
      <span aria-hidden="true"> ↔</span>
    </button>
  ) : (
    <span className="er-trace-value">{value}</span>
  );
}

export function WorksheetTraceView({
  trace,
  canvas,
  mode,
  focus,
  follow,
  pin,
  close,
  scrubFor,
  version,
  nameFor,
}: {
  trace: WorksheetTrace;
  canvas: RefObject<HTMLDivElement | null>;
  mode: (values: boolean) => void;
  focus: (id?: string, uses?: boolean) => void;
  follow: (id: string) => void;
  pin: () => void;
  close: () => void;
  scrubFor: (id: string) => Scrub | undefined;
  version: unknown;
  nameFor: (id: string) => string;
}) {
  const { values, source } = trace;
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [trace.root]);
  function dismiss() {
    close();
    const row = canvas.current?.querySelector(
      `[data-region-id="${CSS.escape(trace.root)}"]`,
    );
    (
      row?.querySelector<HTMLButtonElement>("[data-result-for]") ??
      row?.querySelector<HTMLButtonElement>(".er-link-handle")
    )?.focus({ preventScroll: true });
  }
  const svg = useRef<SVGSVGElement>(null),
    tray = useRef<HTMLElement>(null),
    marker = useId(),
    [geometry, setGeometry] = useState<TraceGeometry>({
      routes: [],
      other: [],
    });
  const consumers = trace.edges.map((e) => e.to),
    shape = JSON.stringify(consumers);
  useLayoutEffect(() => {
    const root = canvas.current,
      layer = svg.current,
      paper = root?.querySelector(".er-paper");
    if (!root || !layer || !paper) return;
    const measure = () => {
      const next =
        source && consumers.length
          ? traceGeometry(root, layer, source, consumers)
          : { routes: [], other: [] };
      setGeometry((old) =>
        JSON.stringify(old) === JSON.stringify(next) ? old : next,
      );
    };
    const task = createFrameTask(measure),
      schedule = () => task.schedule(undefined),
      resize = new ResizeObserver(schedule),
      changes = new MutationObserver(schedule);
    // Intervening rows are obstacles too. Observe the paper, not just endpoints,
    // and keep the overlay outside it so drawing a route cannot invalidate itself.
    changes.observe(paper, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        "style",
        "class",
        "open",
        "data-trace-origin",
        "data-trace-use",
        "data-radical-painted",
        "data-canvas-offscreen",
      ],
    });
    resize.observe(root);
    if (tray.current) resize.observe(tray.current);
    root.addEventListener("scroll", schedule, { passive: true });
    root.addEventListener("canvaszoom", schedule);
    root.addEventListener("load", schedule, true);
    document.fonts.addEventListener("loadingdone", schedule);
    measure();
    return () => {
      resize.disconnect();
      changes.disconnect();
      task.cancel();
      root.removeEventListener("scroll", schedule);
      root.removeEventListener("canvaszoom", schedule);
      root.removeEventListener("load", schedule, true);
      document.fonts.removeEventListener("loadingdone", schedule);
    };
  }, [canvas, shape, source?.id, source?.name, values]);
  return (
    <div className="er-trace-host">
      <svg
        ref={svg}
        className="er-trace-wires"
        aria-hidden="true"
        width="1"
        height="1"
      >
        <defs>
          <marker
            id={marker}
            viewBox="0 0 8 8"
            refX="8"
            refY="4"
            markerUnits="userSpaceOnUse"
            markerWidth="4"
            markerHeight="4"
            orient="auto"
          >
            <path d="M0 0 L8 4 L0 8Z" fill="var(--canvas-accent)" />
          </marker>
        </defs>
        {geometry.routes.map(({ to, trunk, branches }) => (
          <g key={to} data-trace-to={to}>
            <path data-trace-trunk="" d={trunk} />
            {branches.map(({ occurrence, path, lead }) => (
              <g key={occurrence} data-trace-occurrence={occurrence}>
                {lead && <path data-trace-lead="" d={lead} />}
                <path
                  data-trace-wire=""
                  d={path}
                  markerEnd={`url(#${marker})`}
                />
              </g>
            ))}
          </g>
        ))}
      </svg>
      <aside
        ref={tray}
        className="er-trace-tray"
        aria-label="Trace values"
        data-canvas-controls=""
        onKeyDown={(e) => {
          if (e.key === "Escape" && !e.defaultPrevented) {
            e.preventDefault();
            e.stopPropagation();
            dismiss();
          }
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <GitBranch size={15} />
          <h2 ref={heading} tabIndex={-1}>
            Trace values <span>· {trace.name}</span>
          </h2>
          <button
            aria-label="Pin in Results"
            title="Pin in Results"
            onClick={pin}
          >
            <Pin size={14} />
          </button>
          <button aria-label="Close value trace" onClick={dismiss}>
            <X size={15} />
          </button>
        </header>
        <div
          role="group"
          aria-label="Equation display"
          className="er-trace-modes"
        >
          <button aria-pressed={!values} onClick={() => mode(false)}>
            Symbols
          </button>
          <button aria-pressed={values} onClick={() => mode(true)}>
            Values
          </button>
        </div>
        {!!trace.inputs.length && (
          <div
            role="group"
            aria-label={`Inputs to ${trace.name}`}
            className="er-trace-inputs"
          >
            <span>Input</span>
            {trace.inputs.map((port) => (
              <button
                key={port.id}
                aria-pressed={source?.id === port.id}
                aria-label={`Trace input ${port.name}`}
                onClick={() => focus(port.id, false)}
              >
                {port.name}
              </button>
            ))}
          </div>
        )}
        {source && (
          <div className="er-trace-source">
            <SourceValue
              key={source.id}
              port={source}
              version={version}
              scrub={source.editable ? scrubFor(source.id) : undefined}
            />
            {!source.editable && source.id !== trace.root && (
              <button
                onClick={() => follow(source.id)}
                aria-label={`Follow definition of ${source.name}`}
              >
                Definition <ArrowUpRight size={12} />
              </button>
            )}
          </div>
        )}
        {source?.editable && scrubFor(source.id) && (
          <small>Drag the value or use ← →. Shift for fine steps.</small>
        )}
        {trace.error && <small role="status">{trace.error}</small>}
        {!!trace.missing.length && (
          <small>Unresolved: {trace.missing.join(", ")}</small>
        )}
        {trace.inputs.length > 0 && (
          <div className="er-trace-links">
            {trace.uses ? (
              <button
                onClick={() =>
                  focus(
                    source?.id === trace.root ? undefined : source?.id,
                    false,
                  )
                }
              >
                Show inputs to {trace.name}
              </button>
            ) : (
              <>
                {source && (
                  <button onClick={() => focus(source.id, true)}>
                    Show uses of {source.name}
                  </button>
                )}
                {trace.own && (
                  <button onClick={() => focus(trace.root, true)}>
                    Show uses of {trace.name}
                  </button>
                )}
              </>
            )}
          </div>
        )}
        {trace.edges.length ? (
          <details>
            <summary>
              {trace.uses
                ? `Uses of ${source!.name} · ${trace.edges.length}`
                : `${source!.name} → ${trace.name}`}
              {geometry.other.length
                ? ` · ${geometry.other.length} without a visible route`
                : ""}
            </summary>
            {geometry.other
              .filter(
                (id) =>
                  !trace.edges.some(
                    (e) => (trace.uses ? e.to : e.from.id) === id,
                  ),
              )
              .map((id) => (
                <button key={id} onClick={() => follow(id)}>
                  Reveal {nameFor(id)} <ArrowUpRight size={13} />
                </button>
              ))}
            {trace.edges.map(({ from, to }) => (
              <button
                key={to}
                onClick={() => follow(trace.uses ? to : from.id)}
              >
                {from.name} → {nameFor(to)} <ArrowUpRight size={13} />
              </button>
            ))}
          </details>
        ) : (
          !trace.error && (
            <small>No direct scalar {trace.uses ? "uses" : "inputs"}.</small>
          )
        )}
      </aside>
    </div>
  );
}
