import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  Columns2,
  GripVertical,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Pin,
  Plus,
  X,
} from "lucide-react";
import {
  AREA_STORAGE,
  arrangeAreas,
  duplicateWorkspace,
  editorNames,
  initialLayouts,
  restoreLayouts,
  type Area,
  type AreaAction,
  type Arrangement,
  type EditorKind,
} from "./areaLayout";
import { AreaEditor, artifactFor, type EditorProps } from "./AreaEditors";
import { ArtifactResultsProvider } from "./artifactRuntime";
import "./workspaceAreas.css";
type Props = Omit<EditorProps, "area"> & {
  children: ReactNode;
  onCanvasVisible: (visible: boolean) => void;
  revealCanvas: RefObject<(() => void) | undefined>;
  presentationContexts?: string[];
};
export default function WorkspaceAreas({
  enabled,
  ...props
}: Props & { enabled: boolean }) {
  return enabled ? (
    <WorkspaceAreasInner {...props} />
  ) : (
    <ArtifactResultsProvider
      page={props.page}
      artifacts={props.artifacts}
      contexts={props.presentationContexts || []}
      change={props.changeArtifact}
    >
      {props.children}
    </ArtifactResultsProvider>
  );
}
function WorkspaceAreasInner({
  children,
  onCanvasVisible,
  revealCanvas,
  ...props
}: Props) {
  const [saved] = useState(() => {
    try {
      const raw = localStorage.getItem(AREA_STORAGE);
      return {
        layouts: raw ? restoreLayouts(raw) : initialLayouts(),
        error: "",
      };
    } catch {
      return {
        layouts: initialLayouts(),
        error:
          "Saved arrangements could not be opened. The saved layout is preserved.",
      };
    }
  });
  const [layouts, setLayouts] = useState(saved.layouts),
    [error, setError] = useState(saved.error),
    [paused, setPaused] = useState(!!saved.error);
  const [menu, setMenu] = useState(false),
    [areaMenu, setAreaMenu] = useState<string>(),
    [maximized, setMaximized] = useState<string>(),
    [name, setName] = useState("");
  const [canvasHost] = useState(() => {
    const el = document.createElement("div");
    el.className = "mw-canvas-host";
    return el;
  });
  const slots = useRef(new Map<string, HTMLDivElement>()),
    parking = useRef<HTMLDivElement>(null),
    strip = useRef<HTMLDivElement>(null),
    dragArea = useRef<string | undefined>(undefined);
  const resize = useRef<
    | {
        type: "column" | "row";
        column: string;
        area?: string;
        start: number;
        width: number;
        weights?: [number, number];
        height?: number;
      }
    | undefined
  >(undefined);
  const workspace = layouts.workspaces.find((w) => w.id === layouts.active)!;
  const canvasArea = workspace.columns
    .flatMap((c) => c.areas)
    .find((a) => a.editor === "canvas");
  const canvasVisible =
    !!canvasArea && (!maximized || maximized === canvasArea.id);
  const update = (fn: (w: Arrangement) => Arrangement) =>
    setLayouts((l) => ({
      ...l,
      workspaces: l.workspaces.map((w) => (w.id === l.active ? fn(w) : w)),
    }));
  const patch = (id: string, values: Partial<Area>) =>
    update((w) => ({
      ...w,
      columns: w.columns.map((c) => ({
        ...c,
        areas: c.areas.map((a) => (a.id === id ? { ...a, ...values } : a)),
      })),
    }));
  const act = (action: AreaAction) => {
    const next = arrangeAreas(workspace, action);
    const ids = new Set(
      workspace.columns.flatMap((c) => c.areas.map((a) => a.id)),
    );
    const added = next.columns
      .flatMap((c) => c.areas)
      .find((a) => !ids.has(a.id));
    update(() => next);
    if (added)
      requestAnimationFrame(() =>
        slots.current.get(added.id)?.parentElement?.scrollIntoView({
          block: "nearest",
          inline: "nearest",
        }),
      );
    setAreaMenu(undefined);
    if (action.type === "close" && maximized === action.id)
      setMaximized(undefined);
  };
  useEffect(() => {
    if (paused) return;
    try {
      const text = JSON.stringify(layouts);
      restoreLayouts(text);
      localStorage.setItem(AREA_STORAGE, text);
      setError("");
    } catch {
      setError("Arrangements could not be saved on this device.");
    }
  }, [layouts, paused]);
  useLayoutEffect(() => {
    const target = canvasVisible
      ? slots.current.get(canvasArea!.id)
      : parking.current;
    if (target && canvasHost.parentElement !== target)
      target.append(canvasHost);
    onCanvasVisible(canvasVisible);
  }, [canvasHost, canvasArea?.id, canvasVisible, onCanvasVisible, layouts]);
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const g = resize.current;
      if (!g) return;
      e.preventDefault();
      if (g.type === "column") {
        const width = Math.max(
          320,
          Math.min(1800, g.width + e.clientX - g.start),
        );
        update((w) => ({
          ...w,
          columns: w.columns.map((c) =>
            c.id === g.column ? { ...c, width } : c,
          ),
        }));
      } else {
        const total = g.weights![0] + g.weights![1],
          ratio = Math.max(
            0.12,
            Math.min(
              0.88,
              g.weights![0] / total + (e.clientY - g.start) / g.height!,
            ),
          );
        update((w) => ({
          ...w,
          columns: w.columns.map((c) =>
            c.id === g.column
              ? {
                  ...c,
                  areas: c.areas.map((a, i) =>
                    a.id === g.area
                      ? { ...a, weight: total * ratio }
                      : c.areas[i - 1]?.id === g.area
                        ? { ...a, weight: total * (1 - ratio) }
                        : a,
                  ),
                }
              : c,
          ),
        }));
      }
    };
    const up = () => {
      resize.current = undefined;
      document.body.classList.remove("mw-resizing");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("blur", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("blur", up);
      document.body.classList.remove("mw-resizing");
    };
  });
  const selectWorkspace = (id: string) => {
    setLayouts((l) => ({ ...l, active: id }));
    setMaximized(undefined);
    setMenu(false);
    setAreaMenu(undefined);
    requestAnimationFrame(() => strip.current?.scrollTo({ left: 0 }));
  };
  const newWorkspace = (copy = false) => {
    if (layouts.workspaces.length >= 12) return;
    const base = name.trim() || `${workspace.name} copy`,
      w = copy
        ? duplicateWorkspace(workspace, base)
        : { ...duplicateWorkspace(workspace, base), columns: [] };
    setLayouts((l) => ({
      ...l,
      active: w.id,
      workspaces: [...l.workspaces, w],
    }));
    setMenu(false);
    setMaximized(undefined);
  };
  const drop = (target: string) => {
    const id = dragArea.current;
    dragArea.current = undefined;
    if (!id || id === target) return;
    update((w) => {
      const next = structuredClone(w),
        source = next.columns.find((c) => c.areas.some((a) => a.id === id)),
        dest = next.columns.find((c) => c.areas.some((a) => a.id === target));
      if (!source || !dest) return w;
      const index = source.areas.findIndex((a) => a.id === id),
        [item] = source.areas.splice(index, 1);
      dest.areas.splice(
        dest.areas.findIndex((a) => a.id === target),
        0,
        item,
      );
      next.columns = next.columns.filter((c) => c.areas.length);
      return next;
    });
  };
  useLayoutEffect(() => {
    revealCanvas.current = () => {
      if (maximized && maximized !== canvasArea?.id) setMaximized(undefined);
      if (canvasArea) {
        requestAnimationFrame(() =>
          slots.current
            .get(canvasArea.id)
            ?.scrollIntoView({ block: "nearest", inline: "nearest" }),
        );
        return;
      }
      const existing = layouts.workspaces.find((w) =>
        w.columns.some((c) => c.areas.some((a) => a.editor === "canvas")),
      );
      if (existing) selectWorkspace(existing.id);
      else
        update((w) =>
          w.columns.length < 12
            ? {
                ...w,
                columns: [
                  ...w.columns,
                  {
                    id: crypto.randomUUID(),
                    width: 900,
                    areas: [
                      { id: crypto.randomUUID(), editor: "canvas", weight: 1 },
                    ],
                  },
                ],
              }
            : arrangeAreas(w, {
                type: "editor",
                id: w.columns[0].areas[0].id,
                editor: "canvas",
              }),
        );
    };
    return () => {
      revealCanvas.current = undefined;
    };
  });
  const pinnedContexts = layouts.workspaces
    .filter((w) => w.id === layouts.active)
    .flatMap((w) =>
      w.columns.flatMap((c) =>
        c.areas.flatMap((a) => (a.context ? [a.context] : [])),
      ),
    );
  return (
    <ArtifactResultsProvider
      page={props.page}
      artifacts={props.artifacts}
      contexts={pinnedContexts}
      change={props.changeArtifact}
    >
      <div
        className={`mw-shell ${workspace.columns.length > 1 ? "mw-tiled" : ""} ${maximized ? "mw-maximized" : ""}`}
        aria-label="Engineering workspace"
      >
        <nav className="mw-workspaces" aria-label="Saved workspaces">
          <Columns2 size={15} />
          {layouts.workspaces.map((w) => (
            <button
              key={w.id}
              aria-pressed={w.id === workspace.id}
              onClick={() => selectWorkspace(w.id)}
            >
              {w.name}
            </button>
          ))}
          <button
            aria-label="Workspace actions"
            aria-expanded={menu}
            onClick={() => {
              setName(workspace.name);
              setMenu(!menu);
            }}
          >
            <MoreHorizontal size={17} />
          </button>
          <span className="mw-space" />
          <button
            onClick={() => {
              update((w) => ({
                ...w,
                columns: [
                  ...w.columns,
                  {
                    id: crypto.randomUUID(),
                    width: 600,
                    areas: [
                      {
                        id: crypto.randomUUID(),
                        editor: "response",
                        weight: 1,
                      },
                    ],
                  },
                ],
              }));
              requestAnimationFrame(() =>
                strip.current?.scrollTo({
                  left: strip.current.scrollWidth,
                  behavior: "smooth",
                }),
              );
            }}
            disabled={workspace.columns.length >= 12}
            aria-label="Add workspace view"
          >
            <Plus size={14} /> View
          </button>
        </nav>
        {menu && (
          <form
            className="mw-workspace-menu"
            aria-label="Manage workspace"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) {
                update((w) => ({ ...w, name: name.trim().slice(0, 60) }));
                setMenu(false);
              }
            }}
          >
            <label>
              Workspace name
              <input
                aria-label="Workspace name"
                value={name}
                maxLength={60}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <button type="submit">Rename</button>
            <button
              type="button"
              disabled={layouts.workspaces.length >= 12}
              onClick={() => newWorkspace(true)}
            >
              Duplicate workspace
            </button>
            <button
              type="button"
              disabled={layouts.workspaces.length >= 12}
              onClick={() => newWorkspace(false)}
            >
              New empty workspace
            </button>
            <small>Arrangements save on this device.</small>
            <button type="button" onClick={() => setMenu(false)}>
              Close
            </button>
          </form>
        )}
        {error && (
          <div className="mw-layout-error" role="status">
            {error}
            {paused && (
              <button
                onClick={() => {
                  setPaused(false);
                  setError("");
                }}
              >
                Save new arrangements
              </button>
            )}
          </div>
        )}
        <div className="mw-columns" ref={strip}>
          {!workspace.columns.length && (
            <div className="mw-empty-workspace">
              <Columns2 size={28} />
              <h2>Room to think.</h2>
              <p>Add a view. Your model is still here.</p>
            </div>
          )}
          {workspace.columns.map((column, ci) => (
            <div
              key={column.id}
              className="mw-column"
              data-column-id={column.id}
              style={{
                width: workspace.columns.length === 1 ? "100%" : column.width,
                display:
                  maximized && !column.areas.some((a) => a.id === maximized)
                    ? "none"
                    : undefined,
              }}
            >
              <div className="mw-column-areas">
                {column.areas.map((area, ai) => {
                  const resolvedArtifact = artifactFor({ ...props, area }),
                    object = area.object || props.selection;
                  return (
                    <div
                      key={area.id}
                      className="mw-area-wrap"
                      style={{
                        flex: area.weight,
                        display:
                          maximized && area.id !== maximized
                            ? "none"
                            : undefined,
                      }}
                    >
                      <section
                        className="mw-area"
                        data-area-id={area.id}
                        data-editor={area.editor}
                        aria-label={`${editorNames[area.editor]} area`}
                        onKeyDown={(e) => {
                          if (
                            area.editor !== "canvas" &&
                            !(
                              (e.metaKey || e.ctrlKey) &&
                              ["z", "k"].includes(e.key.toLowerCase())
                            )
                          )
                            e.stopPropagation();
                        }}
                      >
                        <header
                          className="mw-area-header"
                          onDragOver={(e) => {
                            if (dragArea.current) e.preventDefault();
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            drop(area.id);
                          }}
                        >
                          <button
                            draggable
                            aria-label="Move workspace area"
                            title="Drag onto another view header"
                            onDragStart={(e) => {
                              dragArea.current = area.id;
                              e.dataTransfer.setData("text/plain", area.id);
                              e.dataTransfer.effectAllowed = "move";
                            }}
                            onDragEnd={() => {
                              dragArea.current = undefined;
                            }}
                            className="mw-area-grip"
                          >
                            <GripVertical size={14} />
                          </button>
                          <select
                            aria-label="Editor type"
                            value={area.editor}
                            onChange={(e) =>
                              act({
                                type: "editor",
                                id: area.id,
                                editor: e.target.value as EditorKind,
                              })
                            }
                          >
                            {Object.entries(editorNames).map(
                              ([kind, label]) => (
                                <option key={kind} value={kind}>
                                  {label}
                                  {kind === "canvas" &&
                                  canvasArea &&
                                  canvasArea.id !== area.id
                                    ? " (move here)"
                                    : ""}
                                </option>
                              ),
                            )}
                          </select>
                          <span className="mw-space" />
                          {area.editor !== "canvas" && (
                            <>
                              <button
                                aria-label={
                                  area.object || area.artifact
                                    ? "Unpin selection"
                                    : "Pin selection"
                                }
                                aria-pressed={!!(area.object || area.artifact)}
                                disabled={!object && !resolvedArtifact}
                                title={
                                  area.object
                                    ? `Pinned to ${props.page.regions.find((r) => r.id === area.object)?.text || "object"}`
                                    : "Follow active selection"
                                }
                                onClick={() =>
                                  patch(
                                    area.id,
                                    area.object || area.artifact
                                      ? {
                                          object: undefined,
                                          artifact: undefined,
                                        }
                                      : {
                                          object,
                                          artifact: resolvedArtifact?.id,
                                        },
                                  )
                                }
                              >
                                <Pin size={13} />
                              </button>
                              <select
                                aria-label="View scenario"
                                value={area.context || "follow"}
                                onChange={(e) =>
                                  patch(area.id, {
                                    context:
                                      e.target.value === "follow"
                                        ? undefined
                                        : e.target.value,
                                  })
                                }
                              >
                                <option value="follow">Follow scenario</option>
                                {props.page.contexts.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.label}
                                  </option>
                                ))}
                              </select>
                            </>
                          )}
                          <button
                            aria-label={
                              maximized === area.id
                                ? "Restore area"
                                : "Maximize area"
                            }
                            onClick={() =>
                              setMaximized(
                                maximized === area.id ? undefined : area.id,
                              )
                            }
                          >
                            {maximized === area.id ? (
                              <Minimize2 size={13} />
                            ) : (
                              <Maximize2 size={13} />
                            )}
                          </button>
                          <button
                            aria-label="Area actions"
                            aria-expanded={areaMenu === area.id}
                            onClick={() =>
                              setAreaMenu(
                                areaMenu === area.id ? undefined : area.id,
                              )
                            }
                          >
                            <MoreHorizontal size={16} />
                          </button>
                          {areaMenu === area.id && (
                            <div className="mw-area-menu" role="menu">
                              <button
                                role="menuitem"
                                onClick={() =>
                                  act({
                                    type: "split",
                                    id: area.id,
                                    direction: "right",
                                  })
                                }
                              >
                                Split right
                              </button>
                              <button
                                role="menuitem"
                                onClick={() =>
                                  act({
                                    type: "split",
                                    id: area.id,
                                    direction: "down",
                                  })
                                }
                              >
                                Split below
                              </button>
                              <button
                                role="menuitem"
                                onClick={() =>
                                  act({ type: "duplicate", id: area.id })
                                }
                              >
                                {area.editor === "canvas"
                                  ? "Duplicate as equation view"
                                  : "Duplicate view"}
                              </button>
                              <button
                                role="menuitem"
                                disabled={!ci}
                                onClick={() =>
                                  act({ type: "left", id: area.id })
                                }
                              >
                                Move column left
                              </button>
                              <button
                                role="menuitem"
                                disabled={ci === workspace.columns.length - 1}
                                onClick={() =>
                                  act({ type: "right", id: area.id })
                                }
                              >
                                Move column right
                              </button>
                              <button
                                role="menuitem"
                                onClick={() =>
                                  act({ type: "close", id: area.id })
                                }
                              >
                                <X size={13} /> Close view
                              </button>
                            </div>
                          )}
                        </header>
                        <div
                          className="mw-area-content"
                          ref={(el) => {
                            if (el) slots.current.set(area.id, el);
                            else slots.current.delete(area.id);
                          }}
                        >
                          {area.editor !== "canvas" && (
                            <AreaEditor {...props} area={area} />
                          )}
                        </div>
                      </section>
                      {ai < column.areas.length - 1 && !maximized && (
                        <div
                          className="mw-row-divider"
                          role="separator"
                          aria-label="Resize stacked areas"
                          aria-orientation="horizontal"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key !== "ArrowUp" && e.key !== "ArrowDown")
                              return;
                            e.preventDefault();
                            const neighbor = column.areas[ai + 1],
                              total = area.weight + neighbor.weight,
                              first = Math.max(
                                total * 0.12,
                                Math.min(
                                  total * 0.88,
                                  area.weight +
                                    (e.key === "ArrowDown" ? 1 : -1) *
                                      total *
                                      0.05,
                                ),
                              );
                            update((w) => ({
                              ...w,
                              columns: w.columns.map((c) =>
                                c.id === column.id
                                  ? {
                                      ...c,
                                      areas: c.areas.map((a) =>
                                        a.id === area.id
                                          ? { ...a, weight: first }
                                          : a.id === neighbor.id
                                            ? { ...a, weight: total - first }
                                            : a,
                                      ),
                                    }
                                  : c,
                              ),
                            }));
                          }}
                          onPointerDown={(e) => {
                            e.preventDefault();
                            resize.current = {
                              type: "row",
                              column: column.id,
                              area: area.id,
                              start: e.clientY,
                              width: column.width,
                              weights: [
                                area.weight,
                                column.areas[ai + 1].weight,
                              ],
                              height:
                                e.currentTarget.parentElement!.parentElement!.getBoundingClientRect()
                                  .height,
                            };
                            document.body.classList.add("mw-resizing");
                          }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
              {ci < workspace.columns.length - 1 && !maximized && (
                <div
                  className="mw-column-divider"
                  role="separator"
                  aria-label="Resize workspace column"
                  aria-orientation="vertical"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                    e.preventDefault();
                    update((w) => ({
                      ...w,
                      columns: w.columns.map((c) =>
                        c.id === column.id
                          ? {
                              ...c,
                              width: Math.max(
                                320,
                                Math.min(
                                  1800,
                                  c.width + (e.key === "ArrowRight" ? 40 : -40),
                                ),
                              ),
                            }
                          : c,
                      ),
                    }));
                  }}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    resize.current = {
                      type: "column",
                      column: column.id,
                      start: e.clientX,
                      width: column.width,
                    };
                    document.body.classList.add("mw-resizing");
                  }}
                />
              )}
            </div>
          ))}
        </div>
        <div ref={parking} hidden />
      </div>
      {createPortal(children, canvasHost)}
    </ArtifactResultsProvider>
  );
}
