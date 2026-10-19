import { canvasScroll, scrollCanvasTo } from "./canvasViewport";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
  type PointerEvent,
} from "react";
import type { Artifact } from "./artifacts";
import { type Page, type Point, type RegionSession } from "./document";
import { alignSelection, type AlignmentGuide } from "./alignment";
import { frameBounds, type CanvasFrame } from "./selection";
import {
  SCENE_STORAGE,
  emptyScene,
  restoreScene,
  groupMembers,
  detachMember,
  dockObjects,
  groupPlacements,
  dockTarget,
  type CanvasGroup,
  type CanvasTool,
  type Camera,
  type Viewpoint,
} from "./canvasScene";
import type { SpatialDrag } from "./CanvasObjects";
type Options = {
  page: Page;
  session: RegionSession;
  artifacts: Artifact[];
  setArtifacts: Dispatch<SetStateAction<Artifact[]>>;
  canvas: RefObject<HTMLDivElement | null>;
  zoom: number;
  setZoom: Dispatch<SetStateAction<number>>;
  places: Record<string, Point>;
  readFrames: () => CanvasFrame[];
};
export function useCanvasScene(o: Options) {
  const [saved] = useState(() => {
    try {
      const raw = localStorage.getItem(SCENE_STORAGE);
      return { value: raw ? restoreScene(raw) : emptyScene(), error: "" };
    } catch {
      return {
        value: emptyScene(),
        error:
          "Saved canvas arrangements could not be opened. Their saved copy is preserved.",
      };
    }
  });
  const [scene, setScene] = useState(() => ({
      ...saved.value,
      tools: saved.value.tools.map((t) =>
        t.editor === "python" && t.collapsed === undefined
          ? { ...t, collapsed: true }
          : t,
      ),
    })),
    [error, setError] = useState(saved.error),
    [preview, setPreview] = useState<Record<string, Point>>({}),
    [dock, setDock] = useState<
      { id: string; layout: CanvasGroup["layout"] } | undefined
    >(),
    [focus, setFocus] = useState<{ id: string; camera: Camera } | undefined>(),
    [viewMenu, setViewMenu] = useState(false),
    [cancelVersion, setCancelVersion] = useState(0);
  const [guides, setGuides] = useState<AlignmentGuide[]>([]);
  const gesture = useRef<SpatialDrag | undefined>(undefined),
    cache = useRef(new Map<string, CanvasFrame>());
  useEffect(() => {
    if (saved.error) return;
    try {
      const text = JSON.stringify(scene);
      restoreScene(text);
      localStorage.setItem(SCENE_STORAGE, text);
      setError("");
    } catch {
      setError("Canvas arrangements could not be saved.");
    }
  }, [scene, saved]);
  useLayoutEffect(() => {
    for (const f of o.readFrames())
      if (f.width > 0 && f.height > 0) cache.current.set(f.id, f);
  });
  const raw: CanvasFrame[] = [
    ...(o.page.models || []).map((m) => ({
      id: m.id,
      kind: "plot" as const,
      ...(o.places[m.id] || o.page.layout[m.id] || { x: 120, y: 140 }),
      width: cache.current.get(m.id)?.width || 370,
      height: cache.current.get(m.id)?.height || 260,
    })),
    ...o.page.regions.map((r) => ({
      id: r.id,
      kind: "region" as const,
      ...o.places[r.id],
      width: cache.current.get(r.id)?.width || 500,
      height: cache.current.get(r.id)?.height || 70,
    })),
    ...(o.page.dataRelations || []).map((r) => ({
      id: r.id,
      kind: "plot" as const,
      ...o.places[r.id],
      width: 550,
      height: cache.current.get(r.id)?.height || 470,
    })),
    ...o.page.plots.map((p) => ({
      id: p.id,
      kind: "plot" as const,
      ...(p.at || o.places[p.id]),
      width: p.width,
      height: p.height,
    })),
    ...o.artifacts
      .flatMap((a) => [a, ...(a.views || [])])
      .map((a) => ({
        id: a.id,
        kind: "plot" as const,
        ...a.at,
        width: a.width,
        height: cache.current.get(a.id)?.height || a.height,
      })),
    ...scene.tools.map((t) => ({
      id: t.id,
      kind: "plot" as const,
      ...t.at,
      width: t.width,
      height: t.editor === "python" && t.collapsed !== false ? 40 : t.height,
    })),
  ];
  const automatic: Record<string, Point> = {};
  for (const g of scene.groups) {
    if (
      !g.auto ||
      (gesture.current &&
        (gesture.current.id === g.id || g.members.includes(gesture.current.id)))
    )
      continue;
    Object.assign(automatic, groupPlacements(g, raw));
  }
  const displayed = { ...automatic, ...preview };
  const frames = raw.map((f) => ({ ...f, ...displayed[f.id] }));
  const compact = (g: CanvasGroup) =>
    (!!g.collapsed || o.zoom < 0.65) && focus?.id !== g.id;
  const hidden = new Set(
    scene.groups.filter(compact).flatMap((g) => g.members),
  );
  const closed = new Set(scene.closed || []);
  const camera = (): Camera => ({
    x: canvasScroll(o.canvas.current).x,
    y: canvasScroll(o.canvas.current).y,
    zoom: o.zoom,
  });
  const setCamera = (c: Camera) => {
    o.setZoom(c.zoom);
    requestAnimationFrame(() =>
      scrollCanvasTo(o.canvas.current, { left: c.x, top: c.y }),
    );
  };
  const patchPositions = (
    placements: Record<string, Point>,
    checkpoint = true,
    groups?: CanvasGroup[],
  ) => {
    const before = scene,
      prior = new Map(
        o.artifacts
          .flatMap((a) => [a, ...(a.views || [])])
          .map((a) => [a.id, a.at]),
      );
    const place = <T extends { id: string; at: Point }>(a: T): T =>
      placements[a.id] ? { ...a, at: placements[a.id] } : a;
    o.session.arrange(placements, checkpoint, () => {
      o.setArtifacts((items) =>
        items.map((a) => ({
          ...a,
          at: prior.get(a.id) || a.at,
          ...(a.views
            ? {
                views: a.views.map((v) => ({
                  ...v,
                  at: prior.get(v.id) || v.at,
                })),
              }
            : {}),
        })),
      );
      setScene((s) => ({
        ...s,
        groups: before.groups,
        tools: s.tools.map((t) => {
          const old = before.tools.find((v) => v.id === t.id);
          return old ? { ...t, at: old.at } : t;
        }),
      }));
    });
    o.setArtifacts((items) =>
      items.map((a) => ({
        ...place(a),
        ...(a.views ? { views: a.views.map(place) } : {}),
      })),
    );
    setScene((s) => ({
      ...s,
      ...(groups ? { groups } : {}),
      tools: s.tools.map(place),
    }));
  };
  const arrangeGroup = (id: string, layout: CanvasGroup["layout"]) => {
    const group = scene.groups.find((g) => g.id === id);
    if (!group) return;
    const next = { ...group, layout, auto: true };
    patchPositions(
      groupPlacements(next, frames),
      true,
      scene.groups.map((g) => (g.id === id ? next : g)),
    );
  };
  const dockTogether = (
    source: string,
    target: string,
    layout: CanvasGroup["layout"],
  ) => {
    const groups = dockObjects(scene.groups, source, target, layout),
      group = groups.find((g) =>
        g.members.includes(groupMembers(scene.groups, source)[0]),
      );
    if (group) patchPositions(groupPlacements(group, frames), true, groups);
  };
  const restoreFocus = () => {
    if (focus) setCamera(focus.camera);
    setFocus(undefined);
  };
  const focusObject = (id: string) => {
    const members = groupMembers(scene.groups, id),
      bounds = frameBounds(frames.filter((f) => members.includes(f.id)));
    if (!bounds || !o.canvas.current) return;
    setFocus({ id, camera: focus?.camera || camera() });
    const viewport = o.canvas.current,
      z = Math.max(
        0.35,
        Math.min(
          1.5,
          (viewport.clientWidth - 120) / bounds.width,
          (viewport.clientHeight - 140) / bounds.height,
        ),
      );
    setCamera({
      zoom: z,
      x: bounds.x * z - (viewport.clientWidth - bounds.width * z) / 2,
      y: bounds.y * z - 95,
    });
  };
  const detach = (id: string) =>
    setScene((s) => ({ ...s, groups: detachMember(s.groups, id) }));
  const closeTool = (id: string) =>
    setScene((s) => ({
      ...s,
      tools: s.tools.filter((t) => t.id !== id),
      groups: detachMember(s.groups, id),
    }));
  const closeView = (id: string) =>
    setScene((s) => ({
      ...s,
      closed: [...new Set([...(s.closed || []), id])],
      groups: detachMember(s.groups, id),
    }));
  const openTool = (
    editor: CanvasTool["editor"],
    object: string,
    artifact?: string,
    context?: string,
    at?: Point,
  ) => {
    const same = scene.tools.find(
      (t) =>
        t.editor === editor &&
        t.object === object &&
        t.artifact === artifact &&
        t.context === context,
    );
    if (same) {
      if (editor === "python")
        setScene((s) => ({
          ...s,
          tools: s.tools.map((t) =>
            t.id === same.id ? { ...t, collapsed: false } : t,
          ),
        }));
      o.canvas.current
        ?.querySelector(`[data-tool-id="${same.id}"]`)
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
      return;
    }
    if (scene.tools.length >= 24) {
      setError("This prototype supports up to 24 canvas tool views.");
      return;
    }
    const source = frames.find((f) => f.id === (artifact || object)),
      position = at || {
        x: source?.x || 120,
        y: (source?.y || 100) + (source?.height || 70) + 36,
      };
    const tool: CanvasTool = {
      id: `tool-${crypto.randomUUID()}`,
      editor,
      collapsed: false,
      object,
      artifact,
      context,
      at: position,
      width: editor === "dependencies" ? 450 : 520,
      height: editor === "dependencies" ? 270 : editor === "python" ? 300 : 410,
    };
    setScene((s) => ({ ...s, tools: [...s.tools, tool] }));
  };
  const point = (e: { clientX: number; clientY: number }): Point => {
    const node = o.canvas.current!,
      rect = node.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left + canvasScroll(node).x) / o.zoom,
      y: (e.clientY - rect.top + canvasScroll(node).y) / o.zoom,
    };
  };
  const start = (
    id: string,
    e: PointerEvent,
    group = false,
    selection: string[] = [],
  ) => {
    const multiple = !group && selection.includes(id) && selection.length > 1;
    const members = multiple
        ? selection
        : group
          ? groupMembers(scene.groups, id)
          : [id],
      origins = Object.fromEntries(
        frames
          .filter((f) => members.includes(f.id))
          .map((f) => [f.id, { x: f.x, y: f.y }]),
      );
    gesture.current = {
      id,
      start: point(e),
      client: { x: e.clientX, y: e.clientY },
      members: origins,
      moved: false,
      group: group || multiple,
      multiple,
    };
  };
  const captureStart = (e: PointerEvent, selection: string[] = []) => {
    if (e.button !== 0) return;
    const el = e.target as Element,
      handle = el.closest('button[aria-label^="Move "]');
    if (!handle) return;
    const obj = handle.closest<HTMLElement>(
      "[data-region-id],[data-plot-id],[data-view-id],[data-tool-id],[data-data-relation-id],[data-model-id]",
    );
    const id =
      obj?.dataset.regionId ||
      obj?.dataset.plotId ||
      obj?.dataset.modelId ||
      obj?.dataset.viewId ||
      obj?.dataset.toolId ||
      obj?.dataset.dataRelationId;
    if (id) {
      start(id, e, false, selection);
      if (gesture.current?.multiple) {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        return true;
      }
    }
    return false;
  };
  const move = (e: PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const p = point(e);
    let dx = p.x - g.start.x,
      dy = p.y - g.start.y;
    if (
      !g.moved &&
      Math.hypot(e.clientX - g.client.x, e.clientY - g.client.y) < 5
    )
      return;
    g.moved = true;
    const visibleIds = new Set(o.readFrames().map((f) => f.id));
    const moving = frameBounds(
      frames
        .filter((f) => g.members[f.id])
        .map((f) => ({ ...f, ...g.members[f.id] })),
    );
    if (moving) {
      const aligned = e.altKey
        ? { dx: 0, dy: 0, guides: [] }
        : alignSelection(
            { ...moving, x: moving.x + dx, y: moving.y + dy },
            frames.filter(
              (f) =>
                !g.members[f.id] &&
                !hidden.has(f.id) &&
                !closed.has(f.id) &&
                visibleIds.has(f.id),
            ),
            (g.group ? 6 : 0.75) / o.zoom,
          );
      if (g.group) {
        dx += aligned.dx;
        dy += aligned.dy;
      }
      setGuides(aligned.guides);
    }
    if (g.group)
      setPreview(
        Object.fromEntries(
          Object.entries(g.members).map(([id, at]) => [
            id,
            { x: at.x + dx, y: at.y + dy },
          ]),
        ),
      );
    setDock(
      e.altKey || g.multiple
        ? undefined
        : dockTarget(
            g.id,
            p,
            frames.filter(
              (f) =>
                !hidden.has(f.id) && !closed.has(f.id) && visibleIds.has(f.id),
            ),
            scene.groups,
          ),
    );
  };
  const end = () => {
    const g = gesture.current;
    gesture.current = undefined;
    setGuides([]);
    if (!g?.moved) {
      setDock(undefined);
      return;
    }
    let groups = scene.groups;
    if (g.multiple) {
      for (const id of Object.keys(g.members)) {
        const containing = groups.find((v) => v.members.includes(id));
        if (
          containing &&
          !containing.members.every((member) => !!g.members[member])
        )
          groups = detachMember(groups, id);
      }
    }
    if (dock)
      groups = dockObjects(
        g.group ? scene.groups : detachMember(scene.groups, g.id),
        g.id,
        dock.id,
        dock.layout,
      );
    else if (!g.group) groups = detachMember(scene.groups, g.id);
    const measured = o.readFrames(),
      actual = frames.map((f) => ({
        ...f,
        ...(measured.find((v) => v.id === f.id) || {}),
        ...(g.group ? preview[f.id] : {}),
      }));
    const group =
      dock &&
      groups.find((v) =>
        v.members.includes(groupMembers(scene.groups, g.id)[0]),
      );
    if (group) patchPositions(groupPlacements(group, actual), true, groups);
    else if (g.group) patchPositions(preview, true, groups);
    else setScene((s) => ({ ...s, groups }));
    setPreview({});
    setDock(undefined);
  };
  const cancel = () => {
    setCancelVersion((v) => v + 1);
    const g = gesture.current;
    gesture.current = undefined;
    setPreview({});
    setDock(undefined);
    setGuides([]);
    if (g?.moved && !g.group) patchPositions(g.members, false);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && gesture.current) {
        e.preventDefault();
        e.stopPropagation();
        cancel();
      }
    };
    const blur = () => {
      if (gesture.current) cancel();
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", blur);
    };
  });
  const saveViewpoint = (name: string) => {
    if (!name.trim()) return;
    const view: Viewpoint = {
      id: `viewpoint-${crypto.randomUUID()}`,
      name: name.trim().slice(0, 80),
      camera: camera(),
      positions: Object.fromEntries(
        frames.map((f) => [f.id, { x: f.x, y: f.y }]),
      ),
      groups: structuredClone(scene.groups),
      tools: structuredClone(scene.tools),
      pins: { ...scene.pins },
      closed: [...(scene.closed || [])],
    };
    setScene((s) => ({
      ...s,
      viewpoints: [
        ...s.viewpoints.filter((v) => v.name !== view.name),
        view,
      ].slice(-12),
    }));
  };
  const restoreViewpoint = (view: Viewpoint) => {
    patchPositions(view.positions);
    const known = new Set(Object.keys(view.positions));
    setScene((s) => ({
      ...s,
      groups: [
        ...s.groups.filter((g) => g.members.every((id) => !known.has(id))),
        ...structuredClone(view.groups),
      ],
      tools: [
        ...s.tools.filter((t) => !view.tools.some((v) => v.id === t.id)),
        ...structuredClone(view.tools),
      ],
      pins: { ...s.pins, ...view.pins },
      closed: [
        ...(s.closed || []).filter((id) => !known.has(id)),
        ...(view.closed || []),
      ],
    }));
    setFocus(undefined);
    setCamera(view.camera);
    setViewMenu(false);
  };
  return {
    cancelVersion,
    guides,
    movingSelection: () => !!gesture.current?.multiple,
    moving: () => !!gesture.current?.moved,
    scene,
    setScene,
    error,
    preview: displayed,
    dock,
    frames,
    hidden,
    closed,
    focus,
    focusObject,
    restoreFocus,
    compact,
    arrangeGroup,
    dockTogether,
    detach,
    closeTool,
    closeView,
    openTool,
    patchPositions,
    captureStart,
    move,
    end,
    cancel,
    start,
    viewMenu,
    setViewMenu,
    saveViewpoint,
    restoreViewpoint,
    pin: (id: string, context?: string) =>
      setScene((s) => {
        const pins = { ...s.pins };
        if (context) pins[id] = context;
        else delete pins[id];
        return { ...s, pins };
      }),
  };
}
