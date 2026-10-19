import { useEffect, useRef, useState, type PointerEvent } from "react";
import {
  Code2,
  GripVertical,
  Link2,
  Maximize2,
  MoreHorizontal,
  X,
  ChevronDown,
  ArrowDown,
  ArrowRight,
  Ungroup,
} from "lucide-react";
import { AreaEditor, type EditorProps } from "./AreaEditors";
import type { CanvasGroup, CanvasTool } from "./canvasScene";
import type { CanvasRect } from "./selection";
import type { Point } from "./document";
import "./canvasObjects.css";
export function CanvasToolView({
  tool,
  cancelVersion,
  zoom,
  hidden,
  editorProps,
  change,
  close,
  focus,
  detach,
  grouped,
}: {
  tool: CanvasTool;
  cancelVersion: number;
  zoom: number;
  hidden: boolean;
  editorProps: Omit<EditorProps, "area">;
  change: (tool: CanvasTool) => void;
  close: () => void;
  focus: () => void;
  detach: () => void;
  grouped: boolean;
}) {
  const move = useRef<
      { x: number; y: number; start: CanvasTool; resize: boolean } | undefined
    >(undefined),
    [menu, setMenu] = useState(false);
  useEffect(() => {
    move.current = undefined;
  }, [cancelVersion]);
  const start = (e: PointerEvent, resize = false) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    move.current = { x: e.clientX, y: e.clientY, start: tool, resize };
  };
  const collapsed = tool.editor === "python" && tool.collapsed !== false;
  const label =
    tool.editor === "python"
      ? "Implementation"
      : tool.editor === "dependencies"
        ? "Relationships"
        : tool.editor === "response"
          ? "Response"
          : "Table";
  return (
    <section
      className="cs-tool"
      data-tool-id={tool.id}
      data-model-object={tool.object}
      data-artifact-id={tool.artifact}
      aria-label={`Canvas ${label.toLowerCase()}`}
      style={{
        left: tool.at.x,
        top: tool.at.y,
        width: tool.width,
        height: collapsed ? 40 : tool.height,
        display: hidden ? "none" : undefined,
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if ((e.target as Element).closest("input,textarea,[role=slider]"))
          e.stopPropagation();
      }}
      onPointerMove={(e) => {
        const g = move.current;
        if (!g) return;
        const dx = (e.clientX - g.x) / zoom,
          dy = (e.clientY - g.y) / zoom;
        change(
          g.resize
            ? {
                ...tool,
                width: Math.max(320, Math.min(1100, g.start.width + dx)),
                height: Math.max(180, Math.min(750, g.start.height + dy)),
              }
            : {
                ...tool,
                at: {
                  x: Math.max(0, g.start.at.x + dx),
                  y: Math.max(0, g.start.at.y + dy),
                },
              },
        );
      }}
      onPointerUp={() => {
        move.current = undefined;
      }}
      onPointerCancel={() => {
        move.current = undefined;
      }}
    >
      <header
        className="cs-tool-head"
        onDoubleClick={(e) => {
          if (!(e.target as Element).closest("button,select")) focus();
        }}
      >
        <button
          aria-label="Move canvas tool"
          className="cs-object-grip"
          onPointerDown={(e) => start(e)}
        >
          <GripVertical size={15} />
        </button>
        {tool.editor === "python" ? (
          <Code2 size={14} />
        ) : tool.editor === "dependencies" ? (
          <Link2 size={14} />
        ) : null}
        <select
          aria-label="Artifact representation"
          value={tool.editor}
          onChange={(e) =>
            change({
              ...tool,
              collapsed: false,
              editor: e.target.value as CanvasTool["editor"],
            })
          }
        >
          <option value="python">Implementation</option>
          <option value="response" disabled={!tool.artifact}>
            Response
          </option>
          <option value="table" disabled={!tool.artifact}>
            Table
          </option>
          <option value="dependencies">Relationships</option>
        </select>
        {tool.editor === "python" && (
          <button
            aria-label={
              collapsed ? "Expand implementation" : "Collapse implementation"
            }
            onClick={() => change({ ...tool, collapsed: !collapsed })}
          >
            <ChevronDown size={14} />
          </button>
        )}
        <span className="cs-space" />
        <select
          className={tool.context ? "cs-pinned" : "cs-following"}
          aria-label="Canvas tool scenario"
          value={tool.context || "follow"}
          onChange={(e) =>
            change({
              ...tool,
              context: e.target.value === "follow" ? undefined : e.target.value,
            })
          }
        >
          <option value="follow">
            Following ·{" "}
            {
              editorProps.page.contexts.find(
                (c) => c.id === editorProps.page.active,
              )?.label
            }
          </option>
          {editorProps.page.contexts.map((c) => (
            <option value={c.id} key={c.id}>
              Pinned · {c.label}
            </option>
          ))}
        </select>
        <div className="cs-secondary">
          <button aria-label="Focus canvas tool" onClick={focus}>
            <Maximize2 size={14} />
          </button>
          <button
            aria-label="Canvas tool actions"
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            <MoreHorizontal size={16} />
          </button>
          <button aria-label="Close canvas tool" onClick={close}>
            <X size={14} />
          </button>
        </div>
        {menu && (
          <div className="cs-tool-menu" role="menu">
            {grouped && (
              <button
                role="menuitem"
                onClick={() => {
                  detach();
                  setMenu(false);
                }}
              >
                Detach from group
              </button>
            )}
            <button
              role="menuitem"
              onClick={() => {
                focus();
                setMenu(false);
              }}
            >
              Focus
            </button>
            <button role="menuitem" onClick={close}>
              Close view
            </button>
          </div>
        )}
      </header>
      <div className="cs-tool-body" hidden={collapsed}>
        <AreaEditor
          {...editorProps}
          area={{
            id: tool.id,
            editor: tool.editor,
            weight: 1,
            object: tool.object,
            artifact: tool.artifact,
            context: tool.context,
          }}
        />
      </div>
      {!collapsed && (
        <button
          className="cs-tool-resize"
          aria-label="Resize canvas tool"
          onPointerDown={(e) => start(e, true)}
        >
          ◢
        </button>
      )}
    </section>
  );
}
export function CanvasGroupView({
  promote,
  group,
  bounds,
  compact,
  zoom,
  focus,
  collapse,
  ungroup,
  arrange,
  start,
  move,
  end,
}: {
  promote?: () => void;
  group: CanvasGroup;
  bounds: CanvasRect;
  compact: boolean;
  zoom: number;
  focus: () => void;
  collapse: () => void;
  ungroup: () => void;
  arrange: (layout: CanvasGroup["layout"]) => void;
  start: (e: PointerEvent) => void;
  move: (e: PointerEvent) => void;
  end: () => void;
}) {
  const [menu, setMenu] = useState(false);
  return (
    <div
      className={`cs-group ${compact ? "is-compact" : ""}`}
      data-group-id={group.id}
      aria-label="Canvas analysis group"
      style={{
        left: bounds.x - 12,
        top: Math.max(4, bounds.y - 40),
        width: compact ? 270 : bounds.width + 24,
        height: compact ? 74 : bounds.height + 52,
      }}
      onDoubleClick={(e) => {
        if (!(e.target as Element).closest("button")) focus();
      }}
    >
      <header
        className="cs-group-head"
        style={{ fontSize: 12 / Math.min(1, zoom) }}
      >
        <button
          aria-label="Move canvas group"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        >
          <GripVertical size={14} />
        </button>
        <b>{group.name}</b>
        <small>{group.members.length} objects</small>
        <span className="cs-space" />
        <button
          aria-label={compact ? "Expand canvas group" : "Collapse canvas group"}
          onClick={collapse}
        >
          <ChevronDown size={14} />
        </button>
        <div className="cs-secondary">
          <button aria-label="Focus canvas group" onClick={focus}>
            <Maximize2 size={14} />
          </button>
          <button aria-label="Group actions" onClick={() => setMenu(!menu)}>
            <MoreHorizontal size={15} />
          </button>
        </div>
        {menu && (
          <div className="cs-tool-menu" role="menu">
            <button
              role="menuitem"
              onClick={() => {
                arrange("row");
                setMenu(false);
              }}
            >
              <ArrowRight size={13} />
              Arrange in a row
            </button>
            <button
              role="menuitem"
              onClick={() => {
                arrange("stack");
                setMenu(false);
              }}
            >
              <ArrowDown size={13} />
              Arrange in a stack
            </button>
            <button role="menuitem" onClick={ungroup}>
              <Ungroup size={13} />
              Ungroup
            </button>
            {promote && (
              <button
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  promote();
                }}
              >
                Make model…
              </button>
            )}
          </div>
        )}
      </header>
    </div>
  );
}
export type SpatialDrag = {
  id: string;
  start: Point;
  members: Record<string, Point>;
  client: Point;
  group?: boolean;
  multiple?: boolean;
  moved: boolean;
};
