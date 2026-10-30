import { useEffect, useRef, useState, type ReactNode } from "react";
import { display, type Statement } from "../../notebook/math";
import { ancestors, project, type Page, type RegionSession } from "../document";
import { names, prepare, type Artifact } from "../artifacts";
import { useComputations } from "../app/artifactRuntime";
import type { ArtifactRuntime } from "../artifactComputations";
import type { Area } from "../areaLayout";
import type { EditBuffers } from "../app/workspaceFiles";
import { useEditBuffer } from "../app/useEditBuffer";
export type MathRenderer = (
  statement: Statement,
  text: string,
  choose: (name: string) => void,
  edit: (span?: { start: number; end: number }) => void,
  highlight?: string,
) => ReactNode;
export type EditorProps = {
  area: Area;
  page: Page;
  current: Page;
  artifacts: Artifact[];
  selection?: string;
  session: RegionSession;
  editBuffers: EditBuffers;
  select: (id: string) => void;
  math: MathRenderer;
  changeArtifact: (a: Artifact) => void;
  createPlot: (output?: string) => void;
  explore: (id: string, value: number, anchor: Element) => void;
  finish: () => void;
  revert: () => void;
};
export function artifactFor(
  props: Pick<EditorProps, "area" | "page" | "artifacts" | "selection">,
) {
  const { area, page, artifacts } = props,
    selection = area.object || props.selection;
  if (area.artifact) return artifacts.find((a) => a.id === area.artifact);
  const p = project(page);
  return artifacts.find(
    (a) =>
      !selection ||
      a.input === selection ||
      a.output === selection ||
      a.requirement === selection ||
      ancestors(p, a.output).includes(selection),
  );
}
export function AreaEditor(props: EditorProps) {
  const bound = {
    ...props.page,
    active: props.area.context || props.page.active,
  };
  if (!props.page.contexts.some((c) => c.id === bound.active))
    return (
      <p className="mw-empty">
        This scenario is unavailable. Choose another scenario in the view
        header.
      </p>
    );
  const selection = props.area.object || props.selection,
    artifact = artifactFor({ ...props, page: bound });
  if (
    props.area.object &&
    !bound.regions.some((r) => r.id === props.area.object)
  )
    return <p className="mw-empty">Pinned object unavailable.</p>;
  if (props.area.editor === "equations" || props.area.editor === "notes")
    return (
      <EquationEditor
        {...props}
        bound={bound}
        notes={props.area.editor === "notes"}
      />
    );
  if (props.area.editor === "dependencies")
    return (
      <Relationships
        page={bound.active === props.page.active ? props.current : bound}
        selected={selection}
        select={props.select}
      />
    );
  if (!artifact)
    return (
      <div className="mw-empty">
        <b>No response selected</b>
        <p>Choose a calculated relationship to use its response here.</p>
        <button onClick={() => props.createPlot(selection)}>
          Plot selected relationship
        </button>
      </div>
    );
  return <ComputedEditor {...props} bound={bound} artifact={artifact} />;
}
function EquationEditor(props: EditorProps & { bound: Page; notes: boolean }) {
  const { bound, page, session, select, math, notes } = props,
    p = project(bound.active === page.active ? props.current : bound),
    readonly = bound.active !== page.active;
  const [editing, setEditing] = useState<string>(),
    [draft, setDraft] = useState(""),
    [error, setError] = useState("");
  const editor = useRef<HTMLTextAreaElement>(null),
    span = useRef<{ start: number; end: number } | undefined>(undefined);
  const source = bound.regions.filter(
    (r) => !!p.texts[r.id].trim() && (!notes || p.kinds[r.id] === "note"),
  );
  const focus = props.area.object || props.selection,
    highlight = focus && p.statements.get(focus)?.name;
  useEffect(() => {
    if (editing) {
      editor.current?.focus();
      if (span.current)
        editor.current?.setSelectionRange(span.current.start, span.current.end);
    }
  }, [editing]);
  useEffect(() => {
    setEditing(undefined);
    setError("");
  }, [bound.active]);
  const start = (id: string, at?: { start: number; end: number }) => {
    if (readonly) return;
    span.current = at;
    setEditing(id);
    setDraft(p.texts[id] || "");
    setError("");
  };
  const commit = (next = false) => {
    if (!editing) return true;
    const result = session.write(editing, draft, next);
    if (!result.ok) {
      setError(result.error || "Could not use this edit.");
      return false;
    }
    setError("");
    if (result.next) {
      span.current = undefined;
      setEditing(result.next);
      setDraft("");
    } else setEditing(undefined);
    return true;
  };
  useEditBuffer(props.editBuffers, "area-text:" + props.area.id, {
    read: () =>
      editing ? JSON.stringify([editing, bound.active, draft]) : undefined,
    finish: () => commit(),
  });
  const all =
    editing && !source.some((r) => r.id === editing)
      ? [...source, { id: editing, text: draft }]
      : source;
  return (
    <div
      className="mw-equations"
      aria-label={notes ? "Notes editor" : "Equation editor"}
    >
      {readonly && (
        <p className="mw-readonly">
          Viewing {page.contexts.find((c) => c.id === bound.active)?.label} ·{" "}
          <button onClick={() => session.switchContext(bound.active)}>
            Activate to edit
          </button>
        </p>
      )}
      {all.map((r) => {
        const s = p.statements.get(r.id),
          q = s && p.solved.values.get(s.name),
          condition = p.solved.constraints.get(r.id);
        return (
          <section
            key={r.id}
            data-object-id={r.id}
            className={focus === r.id ? "is-linked" : ""}
            onClickCapture={(e) => {
              const name = (e.target as Element)
                .closest("[data-symbol]")
                ?.getAttribute("data-symbol");
              if (name && p.sources[name]?.length === 1)
                select(p.sources[name][0]);
              else if (!editing) select(r.id);
            }}
          >
            {editing === r.id ? (
              <textarea
                aria-label="Edit equation in workspace"
                ref={editor}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => commit()}
                rows={Math.max(1, draft.split("\n").length)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    commit(true);
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    commit();
                  }
                }}
              />
            ) : s ? (
              <div className="mw-equation-line">
                {math(
                  s,
                  p.texts[r.id],
                  (name) => {
                    const id = p.sources[name]?.[0];
                    if (id) select(id);
                  },
                  (at) => start(r.id, at),
                  highlight,
                )}
                {p.kinds[r.id] === "equation" && q && !p.errors.has(r.id) && (
                  <button className="mw-result" onClick={() => select(r.id)}>
                    = {display(q)}
                  </button>
                )}
                {condition && (
                  <span className={condition.pass ? "mw-pass" : "mw-fail"}>
                    {condition.pass ? "Satisfied" : "Outside limit"}
                  </span>
                )}
              </div>
            ) : (
              <p className="mw-note" onClick={() => start(r.id)}>
                {p.texts[r.id] || "Write a thought or equation…"}
              </p>
            )}
            {p.errors.has(r.id) && (
              <small className="mw-error">{p.errors.get(r.id)}</small>
            )}
          </section>
        );
      })}
      {error && (
        <p className="mw-error" role="status">
          {error}
        </p>
      )}
      {!readonly && !editing && (
        <button
          className="mw-insert"
          onClick={() => {
            const id = session.create();
            start(id);
          }}
        >
          + {notes ? "Write a note" : "Write an equation"}
        </button>
      )}
    </div>
  );
}
function Relationships({
  page,
  selected,
  select,
}: {
  page: Page;
  selected?: string;
  select: (id: string) => void;
}) {
  const p = project(page),
    id = selected || page.regions.find((r) => p.kinds[r.id] === "equation")?.id;
  if (!id)
    return (
      <p className="mw-empty">
        Select an equation or quantity to follow its relationships.
      </p>
    );
  const inputs = [...new Set(Object.values(p.bindings[id] || {}))],
    consumers = page.regions.filter((r) =>
      Object.values(p.bindings[r.id] || {}).includes(id),
    );
  const item = (source: string) => {
    const s = p.statements.get(source),
      q = s && p.solved.values.get(s.name);
    return (
      <button key={source} onClick={() => select(source)}>
        <b>{s?.name || "Note"}</b>
        <span>{p.texts[source]}</span>
        {q && !p.errors.has(source) && <strong>{display(q)}</strong>}
      </button>
    );
  };
  return (
    <div className="mw-relationships" aria-label="Relationship editor">
      {inputs.length > 0 && (
        <>
          <small>INPUTS</small>
          {inputs.map(item)}
          <div className="mw-flow-arrow">↓</div>
        </>
      )}
      <div className="mw-relationship-focus">{item(id)}</div>
      {consumers.length > 0 && (
        <>
          <div className="mw-flow-arrow">↓</div>
          <small>USED BY</small>
          {consumers.map((r) => item(r.id))}
        </>
      )}
      {!inputs.length && !consumers.length && (
        <p>No resolved connections yet.</p>
      )}
    </div>
  );
}
function ComputedEditor(
  props: EditorProps & { bound: Page; artifact: Artifact },
) {
  const { bound, artifact: a, area, select } = props,
    computations = useComputations(),
    runtime = computations.read(a.id, bound.active);
  const [editing, setEditing] = useState(false),
    [code, setCode] = useState(""),
    [codeError, setCodeError] = useState("");
  let generated: ReturnType<typeof prepare> | undefined,
    resolved: ReturnType<typeof names> | undefined,
    live: ReturnType<typeof names> | undefined;
  try {
    generated = prepare(bound, a, props.session.document);
    resolved = names(bound, a);
    live = names(bound.active === props.page.active ? props.current : bound, a);
  } catch {
    /* Affected view reports its blocked state below. */
  }
  const codeText = a.code || generated?.code || "",
    selected = area.object || props.selection;
  useEditBuffer(props.editBuffers, "area-code:" + area.id, {
    read: () =>
      editing && code !== codeText
        ? JSON.stringify([a.id, bound.active, code])
        : undefined,
    finish: () => {
      if (!editing || code === codeText) return true;
      setCodeError(
        "Run or cancel this Python draft before opening or exporting work.",
      );
      return false;
    },
  });
  const ready = !!runtime?.current && runtime.job?.key === generated?.key;
  const context = props.page.contexts.find((c) => c.id === bound.active)?.label;
  useEffect(() => {
    setEditing(false);
  }, [a.id, bound.active, area.editor]);
  if (area.editor === "python") {
    const bindings = generated
      ? [
          [
            a.input,
            resolved ? `${resolved.x.name} · ${display(resolved.xq)}` : "Input",
          ],
          ...Object.entries(generated.bindings).map(([, id]) => [
            id,
            `${resolved?.p.statements.get(id)?.name} · ${resolved?.p.solved.values.get(resolved.p.statements.get(id)?.name || "") ? display(resolved.p.solved.values.get(resolved.p.statements.get(id)!.name)!) : "unresolved"}`,
          ]),
        ]
      : [];
    const alias =
      selected === a.input
        ? "a"
        : Object.entries(generated?.bindings || {}).find(
            ([, id]) => id === selected,
          )?.[0];
    return (
      <div className="mw-python" aria-label="Python editor">
        <div className="mw-source-label">
          <span>Implementation · {context}</span>
          {!editing && (
            <button
              onClick={() => {
                setCode(codeText);
                setEditing(true);
              }}
            >
              Edit code
            </button>
          )}
        </div>
        <div className="mw-bindings">
          {bindings.map(([id, label]) => (
            <button
              key={id}
              data-link-source={id}
              className={id === selected ? "is-linked" : ""}
              onClick={() => select(id!)}
            >
              {label}
            </button>
          ))}
        </div>
        {editing ? (
          <>
            <textarea
              aria-label="Workspace Python source"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setCodeError("");
              }}
              spellCheck={false}
            />
            <div>
              <button onClick={() => setEditing(false)}>Cancel</button>
              <button
                onClick={() => {
                  try {
                    props.changeArtifact({ ...a, code });
                    setCodeError("");
                    setEditing(false);
                    runtime.run();
                  } catch (error) {
                    setCodeError((error as Error).message);
                  }
                }}
              >
                Run Python
              </button>
            </div>
            {codeError && (
              <p className="mw-error" role="alert">
                {codeError}
              </p>
            )}
          </>
        ) : (
          <pre>
            {codeText
              .split(/(\b[a-zA-Z_][a-zA-Z_0-9]*\b)/)
              .map((text, i) =>
                text === alias ? <mark key={i}>{text}</mark> : text,
              )}
          </pre>
        )}
        <details className="cs-execution">
          <summary>Execution & bindings</summary>
          <p>
            Restricted sampler; mathematical definitions remain authoritative.
          </p>
          <pre>
            {JSON.stringify(
              {
                bindings: generated?.bindings,
                inputs: generated?.inputs,
                runtime: runtime?.receipt?.runtime,
              },
              null,
              2,
            )}
          </pre>
        </details>
        {runtime?.error && <p className="mw-error">{runtime.error}</p>}
      </div>
    );
  }
  if (!ready || !resolved || !live)
    return (
      <div className="mw-empty" role="status">
        {runtime?.error ||
          (!resolved ? "Resolve the source calculation." : "Calculating…")}
      </div>
    );
  if (area.editor === "table")
    return (
      <div className="mw-data-table" aria-label="Table editor">
        <div className="mw-source-label">
          {resolved.y.name} vs {resolved.x.name} · {context} ·{" "}
          {runtime.receipt!.points.length} samples
        </div>
        <table>
          <thead>
            <tr>
              <th>
                <button onClick={() => select(a.input)}>
                  {resolved.x.name} ({resolved.xUnit})
                </button>
              </th>
              <th>
                <button onClick={() => select(a.output)}>
                  {resolved.y.name} ({resolved.yUnit})
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {runtime.receipt!.points.map(([x, y], i) => (
              <tr key={i} onClick={() => select(a.input)}>
                <td>{fmt(x - (resolved.xq.absolute ? 273.15 : 0))}</td>
                <td>{fmt(y)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  return (
    <Response {...props} runtime={runtime} resolved={resolved} live={live} />
  );
}
const fmt = (v: number) => Number(v.toPrecision(5)).toString();
function Response({
  bound,
  artifact: a,
  runtime,
  resolved,
  live,
  ...props
}: EditorProps & {
  bound: Page;
  artifact: Artifact;
  runtime: ArtifactRuntime;
  resolved: ReturnType<typeof names>;
  live: ReturnType<typeof names>;
}) {
  const svg = useRef<SVGSVGElement>(null),
    gesture = useRef<
      { start: number; value: number; moved: boolean } | undefined
    >(undefined);
  const points = runtime.receipt!.points,
    ys = points.map((v) => v[1]);
  const limit = [...resolved.p.solved.constraints].find(
    ([id]) =>
      (!a.requirement || a.requirement === id) &&
      resolved.p.statements.get(id)?.name === resolved.y.name,
  );
  const threshold =
    limit &&
    (resolved.yq.absolute
      ? limit[1].bound.value - 273.15
      : limit[1].bound.value);
  const minimum = Math.min(
      ...ys,
      ...(threshold === undefined ? [] : [threshold]),
    ),
    maximum = Math.max(...ys, ...(threshold === undefined ? [] : [threshold])),
    padding = Math.max((maximum - minimum) * 0.1, 1),
    low = minimum - padding,
    high = maximum + padding;
  const px = (x: number) => 60 + ((x - a.low) / (a.high - a.low)) * 480,
    py = (y: number) => 280 - ((y - low) / (high - low)) * 240;
  const y = live.yq.absolute ? live.yq.value - 273.15 : live.yq.value,
    x = live.xq.value;
  const selected = props.area.object || props.selection,
    editable = bound.active === props.page.active;
  const revertLatest = useRef(props.revert);
  revertLatest.current = props.revert;
  useEffect(
    () => () => {
      if (gesture.current) {
        gesture.current = undefined;
        revertLatest.current();
      }
    },
    [a.id, bound.active],
  );
  const move = (clientX: number) => {
    const g = gesture.current;
    if (!g) return;
    const rect = svg.current!.getBoundingClientRect();
    if (!g.moved && Math.abs(clientX - g.start) < 4) return;
    g.moved = true;
    props.explore(
      a.input,
      Math.max(
        a.low,
        Math.min(
          a.high,
          g.value +
            ((((clientX - g.start) / rect.width) * 600) / 480) *
              (a.high - a.low),
        ),
      ),
      svg.current!,
    );
  };
  return (
    <div
      className="mw-response"
      aria-label="Response editor"
      data-status="current"
    >
      <div className="mw-source-label">
        <b>
          {resolved.y.name} vs {resolved.x.name}
        </b>
        <span>
          {bound.active === props.page.active && props.current !== props.page
            ? "Preview"
            : props.page.contexts.find((c) => c.id === bound.active)?.label}
        </span>
        <strong>{display(live.yq)}</strong>
      </div>
      <svg
        ref={svg}
        viewBox="0 0 600 330"
        role="group"
        aria-label={`${resolved.y.name} response to ${resolved.x.name}`}
      >
        <path d="M60,40V280H540" fill="none" stroke="#d9d9d3" />
        <text x="48" y="47" textAnchor="end">
          {fmt(high)}
        </text>
        <text x="48" y="283" textAnchor="end">
          {fmt(low)}
        </text>
        <path
          className={selected === a.output ? "mw-curve is-linked" : "mw-curve"}
          d={points
            .map(([x, y], i) => `${i ? "L" : "M"}${px(x)},${py(y)}`)
            .join(" ")}
          fill="none"
          stroke={bound.active === "original" ? "#555c64" : "#ad713d"}
          strokeWidth="2.5"
          role="button"
          tabIndex={0}
          aria-label="Select response relationship"
          onClick={() => props.select(a.output)}
          onKeyDown={(e) => {
            if (e.key === "Enter") props.select(a.output);
          }}
        />
        {threshold !== undefined && (
          <g
            role="button"
            tabIndex={0}
            aria-label="Select response requirement"
            onClick={() => props.select(limit![0])}
            onKeyDown={(e) => {
              if (e.key === "Enter") props.select(limit![0]);
            }}
          >
            <path
              d={`M60,${py(threshold)}H540`}
              stroke="#889087"
              strokeDasharray="4 5"
            />
            <text x="540" y={py(threshold) - 8} textAnchor="end">
              {fmt(threshold)} {resolved.yUnit} limit
            </text>
          </g>
        )}
        <text x="60" y="300">
          {fmt(a.low - (resolved.xq.absolute ? 273.15 : 0))}
        </text>
        <text x="540" y="300" textAnchor="end">
          {fmt(a.high - (resolved.xq.absolute ? 273.15 : 0))}
        </text>
        <g
          className={selected === a.input ? "mw-axis is-linked" : "mw-axis"}
          role="button"
          tabIndex={0}
          aria-label="Select response input"
          onClick={() => props.select(a.input)}
          onKeyDown={(e) => {
            if (e.key === "Enter") props.select(a.input);
          }}
        >
          <rect x="180" y="303" width="240" height="27" fill="transparent" />
          <text x="300" y="322" textAnchor="middle">
            {resolved.x.name} ({resolved.xUnit})
          </text>
        </g>
        <text x="63" y="23">
          {resolved.y.name} ({resolved.yUnit})
        </text>
        {x >= a.low && x <= a.high && (
          <g
            role="slider"
            tabIndex={0}
            aria-label="Vary workspace input"
            aria-valuemin={a.low}
            aria-valuemax={a.high}
            aria-valuenow={x}
            aria-disabled={!editable}
            transform={`translate(${px(x)},${py(y)})`}
            className="mw-point"
            onPointerDown={(e) => {
              props.select(a.input);
              if (!editable) return;
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              gesture.current = { start: e.clientX, value: x, moved: false };
            }}
            onPointerMove={(e) => move(e.clientX)}
            onPointerUp={(e) => {
              const g = gesture.current;
              gesture.current = undefined;
              if (g?.moved) props.finish();
              if (e.currentTarget.hasPointerCapture(e.pointerId))
                e.currentTarget.releasePointerCapture(e.pointerId);
            }}
            onPointerCancel={() => {
              gesture.current = undefined;
              props.revert();
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                gesture.current = undefined;
                props.revert();
              } else if (
                editable &&
                (e.key === "ArrowLeft" || e.key === "ArrowRight")
              ) {
                e.preventDefault();
                props.explore(
                  a.input,
                  Math.max(
                    a.low,
                    Math.min(
                      a.high,
                      x +
                        ((e.key === "ArrowRight" ? 1 : -1) * (a.high - a.low)) /
                          100,
                    ),
                  ),
                  svg.current!,
                );
              }
            }}
            onKeyUp={(e) => {
              if (e.key === "ArrowLeft" || e.key === "ArrowRight")
                props.finish();
            }}
          >
            <circle r="17" fill="#8766ac16" />
            <circle
              r="7"
              fill={bound.active === "original" ? "#8062a2" : "#ad713d"}
              stroke="white"
              strokeWidth="2"
            />
          </g>
        )}
      </svg>
      <div className="mw-response-value">
        <button onClick={() => props.select(a.input)}>
          {resolved.x.name} = {display(live.xq)}
        </button>
        {!editable && (
          <button onClick={() => props.session.switchContext(bound.active)}>
            Activate scenario to edit
          </button>
        )}
      </div>
    </div>
  );
}
