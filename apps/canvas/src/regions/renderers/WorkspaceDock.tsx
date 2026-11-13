import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronLeft, GripVertical, X } from "lucide-react";
import type { WorkspaceChromeState } from "../app/useWorkspaceChrome";
import {
  dockSides,
  panelNames,
  type DockSide,
  type PanelId,
} from "../workspaceChrome";
import "../styles/workspaceDock.css";

export function WorkspaceControls({
  workspace,
}: {
  workspace: WorkspaceChromeState;
}) {
  const { layout, presets } = workspace.preferences;
  const [name, setName] = useState("");
  return (
    <>
      <span className="er-command-heading">Panels</span>
      {(Object.keys(panelNames) as PanelId[]).map((id) => (
        <label className="wc-menu-row" key={id}>
          <input
            type="checkbox"
            checked={dockSides.some((side) =>
              layout.groups[side].tabs.includes(id),
            )}
            onChange={(e) => workspace.show(id, e.target.checked)}
          />
          {panelNames[id]}
        </label>
      ))}
      <span className="er-command-heading">Toolbars</span>
      <label className="wc-menu-row">
        Canvas tools
        <select
          aria-label="Canvas toolbar position"
          value={layout.toolbar}
          onChange={(e) =>
            workspace.update((l) => ({
              ...l,
              toolbar: e.target.value as typeof l.toolbar,
            }))
          }
        >
          {["top", "bottom", "left", "right", "hidden"].map((side) => (
            <option key={side} value={side}>
              {side}
            </option>
          ))}
        </select>
      </label>
      <span className="er-command-heading">
        Workspace presets · this device
      </span>
      <div className="wc-menu-row">
        <input
          aria-label="Workspace preset name"
          placeholder="Name this layout"
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button disabled={!name.trim()} onClick={() => workspace.save(name)}>
          Save preset
        </button>
      </div>
      {presets.map((preset) => (
        <div className="wc-menu-row" key={preset.name}>
          <button
            onClick={() => workspace.load(preset.name)}
            aria-label={`Load workspace ${preset.name}`}
          >
            {preset.name}
          </button>
          <button
            onClick={() => workspace.remove(preset.name)}
            aria-label={`Delete workspace ${preset.name}`}
          >
            <X size={14} />
          </button>
        </div>
      ))}
      <button onClick={workspace.reset}>Reset workspace</button>
    </>
  );
}

type DragItem = PanelId | "toolbar";
const transferType = "application/x-manifold-chrome";
export function WorkspaceDock({
  workspace,
  toolbar,
  panels,
  detachedPanels = [],
  children,
}: {
  detachedPanels?: readonly PanelId[];
  workspace: WorkspaceChromeState;
  toolbar: ReactNode;
  panels: Record<PanelId, ReactNode>;
  children: ReactNode;
}) {
  const savedLayout = workspace.preferences.layout;
  // Detachment is transient presentation, not a second persisted layout owner.
  const layout = useMemo(
    () => ({
      ...savedLayout,
      groups: Object.fromEntries(
        dockSides.map((side) => {
          const group = savedLayout.groups[side];
          const tabs = group.tabs.filter((id) => !detachedPanels.includes(id));
          return [
            side,
            {
              ...group,
              tabs,
              active: tabs.includes(group.active!) ? group.active : tabs[0],
            },
          ];
        }),
      ) as typeof savedLayout.groups,
    }),
    [savedLayout, detachedPanels],
  );
  // Moving DOM hosts rather than React subtrees keeps canvas, drafts and tools alive.
  const [hosts] = useState(() => {
    const make = (className: string) =>
      Object.assign(document.createElement("div"), { className });
    return {
      toolbar: Object.assign(make("wc-toolbar-host"), { tabIndex: -1 }),
      panels: Object.fromEntries(
        Object.keys(panelNames).map((id) => [id, make("wc-panel-host")]),
      ) as Record<PanelId, HTMLDivElement>,
    };
  });
  const toolbarSlots = useRef(new Map<string, HTMLDivElement>());
  const panelSlots = useRef(new Map<string, HTMLDivElement>());
  const parking = useRef<HTMLDivElement>(null);
  const detached = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<DragItem | undefined>(undefined);
  const [dragging, setDragging] = useState<DragItem>();
  const [target, setTarget] = useState<string>();
  const [preview, setPreview] = useState<{ side: DockSide; size: number }>();
  const resize = useRef<
    | {
        pointer: number;
        side: DockSide;
        start: number;
        size: number;
        next: number;
      }
    | undefined
  >(undefined);
  useLayoutEffect(() => {
    const place = (
      host: HTMLDivElement,
      target: HTMLDivElement | null | undefined,
    ) => {
      if (!target || host.parentElement === target) return;
      const focused = document.activeElement;
      const restoreFocus =
        focused instanceof HTMLElement &&
        host.contains(focused) &&
        target !== parking.current;
      target.append(host);
      if (restoreFocus) focused.focus({ preventScroll: true });
    };
    place(
      hosts.toolbar,
      toolbarSlots.current.get(layout.toolbar) || parking.current,
    );
    for (const id of Object.keys(panelNames) as PanelId[]) {
      const side = dockSides.find(
        (s) => layout.groups[s].active === id && !layout.groups[s].collapsed,
      );
      const slot = detachedPanels.includes(id)
        ? detached.current
        : side
          ? panelSlots.current.get(side)
          : parking.current;
      place(hosts.panels[id], slot);
    }
  }, [layout, hosts, detachedPanels]);
  const cancel = () => {
    resize.current = undefined;
    setPreview(undefined);
  };
  useLayoutEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        cancel();
        drag.current = undefined;
        setDragging(undefined);
        setTarget(undefined);
      }
    };
    window.addEventListener("keydown", key);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", cancel);
    };
  }, []);
  const startDrag = (event: React.DragEvent, item: DragItem) => {
    drag.current = item;
    setDragging(item);
    event.dataTransfer.setData(transferType, item);
    event.dataTransfer.effectAllowed = "move";
  };
  const endDrag = () => {
    drag.current = undefined;
    setDragging(undefined);
    setTarget(undefined);
  };
  const move = (id: PanelId, side: DockSide) => {
    workspace.move(id, side);
    requestAnimationFrame(() =>
      document.getElementById(`wc-tab-${id}`)?.focus({ preventScroll: true }),
    );
  };
  const dropProps = (side: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!drag.current || !e.dataTransfer.types.includes(transferType)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setTarget(side);
    },
    onDragLeave: () => setTarget(undefined),
    onDrop: (e: React.DragEvent) => {
      const item = drag.current;
      if (!item || !e.dataTransfer.types.includes(transferType)) return;
      e.preventDefault();
      if (item === "toolbar")
        workspace.update((l) => ({ ...l, toolbar: side as typeof l.toolbar }));
      else if (side !== "top") move(item, side as DockSide);
      endDrag();
    },
  });
  const toolbarSlot = (side: string) => (
    <div
      key={side}
      className={`wc-toolbar-slot wc-toolbar-${side}`}
      ref={(el) => {
        if (el) toolbarSlots.current.set(side, el);
        else toolbarSlots.current.delete(side);
      }}
    />
  );
  const setSize = (side: DockSide, size: number) =>
    workspace.update((l) => ({
      ...l,
      groups: {
        ...l.groups,
        [side]: { ...l.groups[side], size: Math.max(160, Math.min(600, size)) },
      },
    }));
  const groupView = (side: DockSide) => {
    const group = layout.groups[side];
    if (!group.tabs.length) return null;
    return (
      <section
        key={side}
        aria-label={`${side} dock`}
        data-canvas-controls=""
        className={`wc-group wc-group-${side} ${group.collapsed ? "is-collapsed" : ""}`}
        style={
          {
            "--dock-size": `${preview?.side === side ? preview.size : group.size}px`,
          } as CSSProperties
        }
        {...dropProps(side)}
      >
        <div className="wc-tabs" role="tablist" aria-label={`${side} panels`}>
          {group.tabs.map((id) => (
            <button
              key={id}
              id={`wc-tab-${id}`}
              role="tab"
              aria-selected={group.active === id && !group.collapsed}
              aria-controls={`wc-panel-${id}`}
              tabIndex={group.active === id ? 0 : -1}
              draggable
              onDragStart={(e) => startDrag(e, id)}
              onDragEnd={endDrag}
              title={`Drag ${panelNames[id]} to dock, or use the position control`}
              onClick={() =>
                workspace.update((l) => ({
                  ...l,
                  groups: {
                    ...l.groups,
                    [side]: { ...l.groups[side], active: id, collapsed: false },
                  },
                }))
              }
              onKeyDown={(e) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
                  return;
                e.preventDefault();
                const index = group.tabs.indexOf(id);
                const next =
                  group.tabs[
                    e.key === "Home"
                      ? 0
                      : e.key === "End"
                        ? group.tabs.length - 1
                        : (index +
                            (e.key === "ArrowRight" ? 1 : -1) +
                            group.tabs.length) %
                          group.tabs.length
                  ];
                workspace.update((l) => ({
                  ...l,
                  groups: {
                    ...l.groups,
                    [side]: {
                      ...l.groups[side],
                      active: next,
                      collapsed: false,
                    },
                  },
                }));
                document.getElementById(`wc-tab-${next}`)?.focus();
              }}
            >
              {panelNames[id]}
            </button>
          ))}
        </div>
        <div className="wc-group-actions">
          {!group.collapsed && (
            <select
              aria-label={`Move ${panelNames[group.active!]} panel`}
              value={side}
              onChange={(e) => move(group.active!, e.target.value as DockSide)}
            >
              {dockSides.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
          <button
            aria-label={`${group.collapsed ? "Expand" : "Collapse"} ${side} dock`}
            onClick={() =>
              workspace.update((l) => ({
                ...l,
                groups: {
                  ...l.groups,
                  [side]: {
                    ...l.groups[side],
                    collapsed: !l.groups[side].collapsed,
                  },
                },
              }))
            }
          >
            {group.collapsed ? (
              <ChevronDown size={14} />
            ) : (
              <ChevronLeft size={14} />
            )}
          </button>
          {!group.collapsed && (
            <button
              aria-label={`Close ${panelNames[group.active!]} panel`}
              onClick={() => {
                workspace.show(group.active!, false);
                requestAnimationFrame(() =>
                  document
                    .querySelector<HTMLButtonElement>(
                      '.er-header button[aria-label="View"]',
                    )
                    ?.focus(),
                );
              }}
            >
              <X size={14} />
            </button>
          )}
        </div>
        <div
          className="wc-group-content"
          hidden={group.collapsed}
          ref={(el) => {
            if (el) panelSlots.current.set(side, el);
            else panelSlots.current.delete(side);
          }}
        />
        {!group.collapsed && (
          <div
            className={`wc-resizer wc-resizer-${side}`}
            role="separator"
            tabIndex={0}
            aria-label={`Resize ${side} dock`}
            aria-orientation={side === "bottom" ? "horizontal" : "vertical"}
            aria-valuemin={160}
            aria-valuemax={600}
            aria-valuenow={group.size}
            onKeyDown={(e) => {
              if (
                ![
                  "ArrowLeft",
                  "ArrowRight",
                  "ArrowUp",
                  "ArrowDown",
                  "Home",
                  "End",
                ].includes(e.key)
              )
                return;
              e.preventDefault();
              setSize(
                side,
                e.key === "Home"
                  ? 160
                  : e.key === "End"
                    ? 600
                    : group.size +
                      ((e.key === "ArrowRight" && side === "left") ||
                      (e.key === "ArrowLeft" && side === "right") ||
                      (e.key === "ArrowUp" && side === "bottom")
                        ? 20
                        : -20),
              );
            }}
            onPointerDown={(e) => {
              if (e.button !== 0 || resize.current) return;
              e.preventDefault();
              e.currentTarget.focus();
              e.currentTarget.setPointerCapture(e.pointerId);
              resize.current = {
                pointer: e.pointerId,
                side,
                start: side === "bottom" ? e.clientY : e.clientX,
                size: group.size,
                next: group.size,
              };
            }}
            onPointerMove={(e) => {
              const g = resize.current;
              if (!g || g.pointer !== e.pointerId) return;
              const delta =
                (side === "bottom" ? e.clientY : e.clientX) - g.start;
              const bounds = root.current?.getBoundingClientRect();
              const max = Math.max(
                160,
                Math.min(
                  600,
                  side === "bottom"
                    ? (bounds?.height || 600) * 0.6
                    : (bounds?.width || 1200) - 200,
                ),
              );
              g.next = Math.max(
                160,
                Math.min(max, g.size + delta * (side === "left" ? 1 : -1)),
              );
              setPreview({ side, size: g.next });
            }}
            onPointerUp={(e) => {
              const g = resize.current;
              if (!g || g.pointer !== e.pointerId) return;
              cancel();
              setSize(side, g.next);
            }}
            onPointerCancel={(e) => {
              if (resize.current?.pointer === e.pointerId) cancel();
            }}
            onLostPointerCapture={(e) => {
              if (resize.current?.pointer === e.pointerId) cancel();
            }}
          />
        )}
      </section>
    );
  };
  return (
    <div className="wc-shell" ref={root}>
      {workspace.error && (
        <div className="wc-error" role="status">
          {workspace.error}
        </div>
      )}
      {toolbarSlot("top")}
      <div className="wc-body">
        {toolbarSlot("left")}
        <div className="wc-layout">
          {groupView("left")}
          <div className="wc-canvas">{children}</div>
          {groupView("right")}
          {groupView("bottom")}
        </div>
        {toolbarSlot("right")}
      </div>
      {toolbarSlot("bottom")}
      <div hidden ref={parking} />
      <div
        className="wc-detached-panels"
        ref={detached}
        data-canvas-controls=""
      />
      {createPortal(
        <>
          <button
            className="wc-toolbar-grip"
            aria-label="Move canvas toolbar"
            title="Drag toolbar to an edge; position is also available in View"
            draggable
            onDragStart={(e) => startDrag(e, "toolbar")}
            onDragEnd={endDrag}
          >
            <GripVertical size={16} />
          </button>
          {toolbar}
        </>,
        hosts.toolbar,
      )}
      {(Object.keys(panelNames) as PanelId[]).map((id) =>
        createPortal(
          <div
            role={detachedPanels.includes(id) ? undefined : "tabpanel"}
            id={`wc-panel-${id}`}
            aria-labelledby={
              detachedPanels.includes(id) ? undefined : `wc-tab-${id}`
            }
            className="wc-panel"
          >
            {panels[id]}
          </div>,
          hosts.panels[id],
          id,
        ),
      )}
      {dragging && (
        <div className="wc-drop-overlay">
          {(dragging === "toolbar" ? ["top", ...dockSides] : dockSides).map(
            (side) => (
              <div
                key={side}
                className={`wc-drop wc-drop-${side} ${target === side ? "is-target" : ""}`}
                {...dropProps(side)}
              >
                Dock {dragging === "toolbar" ? "toolbar" : panelNames[dragging]}{" "}
                {side}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
