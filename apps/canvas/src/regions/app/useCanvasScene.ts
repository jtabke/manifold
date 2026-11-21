import { isDialogEvent } from "../interaction/modalInput";
import {
  canvasScroll,
  canvasZoom,
  scrollCanvasTo,
} from "../interaction/canvasViewport";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
  type PointerEvent,
} from "react";
import type { Artifact } from "../artifacts";
import { drawingGeometry, placeDrawings } from "../drawingGeometry";
import {
  measureCanvasObjects,
  observeCanvasObjects,
} from "./canvasMeasurements";
import { type Page, type Point, type RegionSession } from "../document";
import { alignSelection } from "../alignment";
import { createScenePreview } from "../interaction/scenePreview";
import { frameBounds, type CanvasFrame } from "../selection";
import {
  groupMembers,
  detachMember,
  dockObjects,
  planDock,
  planDetach,
  type GroupLayoutPlan,
  groupPlacements,
  dockTarget,
  type CanvasScene,
  type CanvasGroup,
  type CanvasTool,
  type Camera,
  type Viewpoint,
} from "../canvasScene";
import type { SpatialDrag } from "../renderers/CanvasObjects";
import { sameJson } from "../immutableJson.ts";
import { positionDrawings } from "../selectionOperations.ts";
import { useFrameTask } from "../interaction/frameTask";
const STALE_GESTURE =
  "This workspace changed during the gesture. Try the move again.";
type Options = {
  page: Page;
  session: RegionSession;
  artifacts: Artifact[];
  canvas: RefObject<HTMLDivElement | null>;
  zoom: number;
  setZoom: Dispatch<SetStateAction<number>>;
  places: Record<string, Point>;
  readFrames: (ids?: ReadonlySet<string>) => CanvasFrame[];
  extraFrames: CanvasFrame[];
  drawing: ReturnType<typeof drawingGeometry>;
  setRegionHeights: Dispatch<SetStateAction<Record<string, number>>>;
  sceneError?: string;
};
type SceneGesture = SpatialDrag & {
  document: RegionSession["document"];
  pointer: number;
  last?: { clientX: number; clientY: number };
  released?: boolean;
  frames: CanvasFrame[];
  visibleIds: Set<string>;
  departure: ReturnType<typeof planDetach>;
  bounds: ReturnType<typeof frameBounds>;
  automatic: Record<string, Point>;
  ownsPositions: boolean;
  presentation: ReturnType<typeof createScenePreview>;
};
type DockTarget = NonNullable<ReturnType<typeof dockTarget>>;
type PendingDock = {
  gesture: SceneGesture;
  target: DockTarget;
  at: { x: number; y: number };
  timer?: number;
  plan?: GroupLayoutPlan;
  displayed?: boolean;
};
export function useCanvasScene(o: Options) {
  const scene = o.session.scene;
  const setScene = (
    update: CanvasScene | ((scene: CanvasScene) => CanvasScene),
  ) => {
    try {
      o.session.setScene(update);
      setError("");
    } catch (failure) {
      setError((failure as Error).message);
    }
  };
  const [error, setError] = useState(o.sceneError || ""),
    [, setMoving] = useState(false),
    [dock, setDock] = useState<
      (DockTarget & { plan?: GroupLayoutPlan }) | undefined
    >(),
    [focus, setFocus] = useState<{ id: string; camera: Camera } | undefined>(),
    [viewMenu, setViewMenu] = useState(false),
    [cancelVersion, setCancelVersion] = useState(0);
  const previewValue = useRef<Record<string, Point>>({});
  const guideLayer = useRef<HTMLDivElement>(null);
  const gesture = useRef<SceneGesture | undefined>(undefined),
    pendingDock = useRef<PendingDock | undefined>(undefined),
    cache = useRef(new Map<string, CanvasFrame>());
  const latest = useRef(o);
  latest.current = o;
  const [measureVersion, measured] = useState(0);
  const clearDock = (render = true) => {
    if (pendingDock.current?.timer !== undefined)
      window.clearTimeout(pendingDock.current.timer);
    pendingDock.current = undefined;
    if (render) setDock(undefined);
  };
  useEffect(
    () => () => {
      clearDock(false);
      gesture.current?.presentation.clear();
    },
    [],
  );
  useLayoutEffect(() => gesture.current?.presentation.refresh());
  useLayoutEffect(() => {
    const pending = pendingDock.current;
    if (dock?.plan && pending?.plan === dock.plan && !pending.gesture.released)
      pending.displayed = true;
  }, [dock]);
  const observed = useRef<
    | { canvas: HTMLElement; objects: ReturnType<typeof observeCanvasObjects> }
    | undefined
  >(undefined);
  useLayoutEffect(() => {
    const canvas = o.canvas.current;
    if (observed.current?.canvas === canvas) return;
    observed.current?.objects.disconnect();
    observed.current = undefined;
    if (!canvas) return;
    const objects = observeCanvasObjects(canvas, (targets) => {
      if (gesture.current?.moved) return;
      const heights = new Map<string, number>();
      const frames = measureCanvasObjects(
        canvas,
        latest.current.zoom,
        targets,
        (id, h) => heights.set(id, h),
      );
      let changed = false;
      for (const f of frames) {
        const before = cache.current.get(f.id);
        if (
          !before ||
          Math.abs(before.width - f.width) > 0.5 ||
          Math.abs(before.height - f.height) > 0.5
        ) {
          cache.current.set(f.id, f);
          changed = true;
        }
      }
      if (changed) measured((v) => v + 1);
      if (heights.size)
        latest.current.setRegionHeights((previous) => {
          let next = previous;
          for (const [id, h] of heights)
            if (Math.abs((previous[id] ?? 0) - h) > 0.5) {
              if (next === previous)
                next = Object.assign(Object.create(null), previous);
              next[id] = h;
            }
          return next;
        });
    });
    observed.current = { canvas, objects };
    objects.refresh();
  });
  useLayoutEffect(
    () => () => {
      observed.current?.objects.disconnect();
      observed.current = undefined;
    },
    [],
  );
  useLayoutEffect(() => {
    if (!gesture.current?.moved) observed.current?.objects.refresh();
  }, [o.zoom, cancelVersion, !!gesture.current?.moved]);
  const raw = useMemo<CanvasFrame[]>(
    () => [
      ...o.extraFrames.map((f) => ({
        ...f,
        height: cache.current.get(f.id)?.height || f.height,
      })),
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
        width: (p.study && cache.current.get(p.id)?.width) || p.width,
        height: (p.study && cache.current.get(p.id)?.height) || p.height,
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
      ...scene.tools.map((t) => {
        return {
          id: t.id,
          kind: "plot" as const,
          ...t.at,
          width: t.width,
          height:
            t.editor === "python" && t.collapsed !== false ? 40 : t.height,
        };
      }),
    ],
    [o.extraFrames, o.page, o.places, o.artifacts, scene.tools, measureVersion],
  );
  const objectIndex = useMemo(() => new Map(raw.map((f) => [f.id, f])), [raw]);
  const drawingFrame = (scene: typeof o.drawing, id: string) => {
    const entry = scene.byId.get(id);
    return entry && scene.frame(entry);
  };
  useLayoutEffect(() => {
    for (const id of cache.current.keys())
      if (!objectIndex.has(id)) cache.current.delete(id);
  }, [objectIndex]);
  const baseFrame = (id: string) =>
    objectIndex.get(id) ?? drawingFrame(o.drawing, id);
  const automatic = useMemo(() => {
    if (gesture.current) return gesture.current.automatic;
    const positions: Record<string, Point> = Object.create(null);
    for (const g of scene.groups) {
      if (!g.auto) continue;
      Object.assign(
        positions,
        groupPlacements(
          g,
          g.members.flatMap((id) => baseFrame(id) ?? []),
        ),
      );
    }
    return positions;
  }, [scene.groups, objectIndex, o.drawing, gesture.current?.id]);
  const displayed = automatic;
  const lastPlacements = useRef<Record<string, Point>>({});
  const drawingPlacements = useMemo(() => {
    const next = Object.fromEntries(
      Object.entries(displayed).filter(([id]) => o.drawing.byId.has(id)),
    );
    if (!sameJson(lastPlacements.current, next)) lastPlacements.current = next;
    return lastPlacements.current;
  }, [o.drawing, displayed]);
  const drawing = useMemo(
    () => placeDrawings(o.drawing, drawingPlacements),
    [o.drawing, drawingPlacements],
  );
  const frame = (id: string) => {
    const f = objectIndex.get(id);
    return f
      ? displayed[id]
        ? { ...f, ...displayed[id] }
        : f
      : drawingFrame(drawing, id);
  };
  // Materialize a mixed scene only for an interaction that asks for one.
  // Worksheet layout/measurements must not walk or re-create every drawing.
  const allFrames = () => [
    ...drawing.frames,
    ...raw.map((f) => (displayed[f.id] ? { ...f, ...displayed[f.id] } : f)),
  ];
  const compact = (g: CanvasGroup) =>
    (!!g.collapsed || o.zoom < 0.65) && focus?.id !== g.id;
  const hidden = useMemo(
    () => new Set(scene.groups.filter(compact).flatMap((g) => g.members)),
    [scene.groups, o.zoom < 0.65, focus?.id],
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
    groups?: readonly CanvasGroup[],
    update?: (scene: CanvasScene) => CanvasScene,
    edit?: (staged: RegionSession) => void,
  ) => {
    const place = <T extends { id: string; at: Point }>(a: T): T =>
      placements[a.id] ? { ...a, at: placements[a.id] } : a;
    try {
      o.session.atomic((staged) => {
        const value: unknown = edit?.(staged);
        if (value && typeof (value as { then?: unknown }).then === "function") {
          void Promise.resolve(value).catch(() => undefined);
          throw Error("Layout edits must be synchronous.");
        }
        positionDrawings(staged, placements);
        staged.arrange(placements, checkpoint);
        staged.setArtifacts((items) =>
          items.map((a) => ({
            ...place(a),
            ...(a.views ? { views: a.views.map(place) } : {}),
          })),
        );
        staged.setScene((s) => {
          const next = {
            ...s,
            ...(groups ? { groups } : {}),
            tools: s.tools.map(place),
          };
          return update ? update(next) : next;
        });
      });
      setError("");
      return true;
    } catch (failure) {
      setError((failure as Error).message);
      return false;
    }
  };

  const arrangeGroup = (id: string, layout: CanvasGroup["layout"]) => {
    const group = scene.groups.find((g) => g.id === id);
    if (!group) return;
    const next = { ...group, layout, auto: true };
    patchPositions(
      groupPlacements(next, allFrames()),
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
    if (group)
      patchPositions(groupPlacements(group, allFrames()), true, groups);
  };
  const restoreFocus = () => {
    if (focus) setCamera(focus.camera);
    setFocus(undefined);
  };
  const focusObject = (id: string) => {
    const members = groupMembers(scene.groups, id),
      bounds = frameBounds(members.flatMap((id) => frame(id) ?? []));
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
    const source = frame(artifact || object),
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
      rect = node.getBoundingClientRect(),
      scale = canvasZoom(node, o.zoom);
    return {
      x: (e.clientX - rect.left + canvasScroll(node).x) / scale,
      y: (e.clientY - rect.top + canvasScroll(node).y) / scale,
    };
  };
  const start = (
    id: string,
    e: PointerEvent,
    group = false,
    selection: string[] = [],
    direct = false,
  ) => {
    if (
      e.button !== 0 ||
      (gesture.current && gesture.current.pointer !== e.pointerId)
    )
      return;
    clearDock();
    moveFrame.cancel();
    gesture.current?.presentation.clear();
    previewValue.current = {};
    setMoving(false);
    const measured = o.readFrames(),
      allFrames = measuredFrames(measured);
    for (const f of measured)
      if (f.kind !== "drawing") cache.current.set(f.id, f);
    const multiple = !group && selection.includes(id) && selection.length > 1;
    const members = multiple
        ? selection
        : group
          ? groupMembers(scene.groups, id)
          : [id],
      origins = Object.fromEntries(
        allFrames
          .filter((f) => members.includes(f.id))
          .map((f) => [f.id, { x: f.x, y: f.y }]),
      );
    gesture.current = {
      document: o.session.document,
      pointer: e.pointerId,
      id,
      start: point(e),
      client: { x: e.clientX, y: e.clientY },
      members: origins,
      moved: false,
      group: group || multiple || direct,
      ownsPositions: group || multiple || direct,
      multiple,
      frames: allFrames,
      visibleIds: new Set(measured.map((f) => f.id)),
      departure: planDetach(scene.groups, members, allFrames),
      bounds: frameBounds(allFrames.filter((f) => members.includes(f.id))),
      automatic,
      presentation: createScenePreview(
        o.canvas.current!,
        allFrames,
        scene.groups,
        compact,
        guideLayer,
        o.zoom,
      ),
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
      if (
        gesture.current &&
        (obj?.dataset.regionId || obj?.dataset.dataRelationId)
      )
        gesture.current.ownsPositions = true;
      if (
        gesture.current?.multiple &&
        gesture.current.pointer === e.pointerId
      ) {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        return true;
      }
    }
    return false;
  };
  const measuredFrames = (measured = o.readFrames()) => {
    const byId = new Map(measured.map((f) => [f.id, f]));
    return allFrames().map((f) => byId.get(f.id) ?? f);
  };
  const currentDockPlan = (g: SceneGesture, target: DockTarget) => {
    if (
      !o.canvas.current ||
      g.document.document !== o.session.document.document ||
      g.document.id !== o.session.document.id
    )
      return;
    const measured = o.readFrames();
    if (
      !measured.some((f) => f.id === target.id) ||
      hidden.has(target.id) ||
      closed.has(target.id)
    )
      return;
    return planDock(
      scene.groups,
      g.id,
      target.id,
      target.layout,
      measuredFrames(measured),
      g.group,
    );
  };
  const latestDockPlan = useRef(currentDockPlan);
  latestDockPlan.current = currentDockPlan;
  const hoverDock = (
    g: SceneGesture,
    target: DockTarget | undefined,
    e: { clientX: number; clientY: number },
  ) => {
    const pending = pendingDock.current;
    if (
      target &&
      pending?.gesture === g &&
      pending.target.id === target.id &&
      pending.target.layout === target.layout &&
      Math.hypot(e.clientX - pending.at.x, e.clientY - pending.at.y) <= 8
    )
      return;
    clearDock();
    if (!target) return;
    const next: PendingDock = {
      gesture: g,
      target,
      at: { x: e.clientX, y: e.clientY },
    };
    pendingDock.current = next;
    setDock(target);
    next.timer = window.setTimeout(() => {
      if (pendingDock.current !== next || gesture.current !== g || g.released)
        return;
      next.timer = undefined;
      const plan = latestDockPlan.current(g, target);
      if (!plan) {
        clearDock();
        return;
      }
      next.plan = plan;
      setDock({ ...target, plan });
    }, 450);
  };
  type Move = Pick<
    PointerEvent,
    "pointerId" | "clientX" | "clientY" | "altKey"
  >;
  const renderMove = (e: Move) => {
    const g = gesture.current;
    if (!g || g.released || g.pointer !== e.pointerId) return;
    g.last = { clientX: e.clientX, clientY: e.clientY };
    const p = point(e);
    let dx = p.x - g.start.x,
      dy = p.y - g.start.y;
    if (
      !g.moved &&
      Math.hypot(e.clientX - g.client.x, e.clientY - g.client.y) < 5
    )
      return;
    const visibleIds = g.visibleIds,
      departure = g.departure;
    if (!departure) {
      cancel();
      return;
    }
    const moving = g.bounds;
    const aligned =
      moving && !e.altKey
        ? alignSelection(
            { ...moving, x: moving.x + dx, y: moving.y + dy },
            g.frames.filter(
              (f) =>
                !g.members[f.id] &&
                !hidden.has(f.id) &&
                !closed.has(f.id) &&
                visibleIds.has(f.id),
            ),
            (g.group ? 4 : 1) / o.zoom,
            120 / o.zoom,
          )
        : { dx: 0, dy: 0, guides: [] };
    if (moving && g.group) {
      dx += aligned.dx;
      dy += aligned.dy;
    }
    // Closing a gap in the source group must be visible before release too.
    if (g.ownsPositions || departure.destinations.length) {
      const next = {
        ...departure.placements,
        ...(g.ownsPositions
          ? Object.fromEntries(
              Object.entries(g.members).map(([id, at]) => [
                id,
                { x: at.x + dx, y: at.y + dy },
              ]),
            )
          : {}),
      };
      previewValue.current = next;
      g.presentation.show(next, aligned.guides);
    } else g.presentation.show({}, aligned.guides);
  };
  const moveFrame = useFrameTask(renderMove);
  const move = (e: Move) => {
    const g = gesture.current;
    if (!g || g.released || g.pointer !== e.pointerId) return;
    if (
      !g.moved &&
      Math.hypot(e.clientX - g.client.x, e.clientY - g.client.y) < 5
    )
      return;
    if (!g.moved) setMoving(true);
    g.moved = true;
    g.last = { clientX: e.clientX, clientY: e.clientY };
    // Dwell ownership changes immediately, even if the next display frame is delayed.
    hoverDock(
      g,
      e.altKey || g.multiple
        ? undefined
        : dockTarget(
            g.id,
            point(e),
            g.frames.filter(
              (f) =>
                !hidden.has(f.id) &&
                !closed.has(f.id) &&
                g.visibleIds.has(f.id),
            ),
            scene.groups,
          ),
      e,
    );
    moveFrame.schedule({
      pointerId: e.pointerId,
      clientX: e.clientX,
      clientY: e.clientY,
      altKey: e.altKey,
    });
  };
  const clearGesture = () => {
    moveFrame.cancel();
    gesture.current?.presentation.clear();
    gesture.current = undefined;
    previewValue.current = {};
    clearDock();
    setMoving(false);
  };
  const end = (
    tool?: CanvasTool,
    before?: CanvasTool,
    completion?: {
      placements: Record<string, Point>;
      edit?: (staged: RegionSession) => void;
      expected?: RegionSession["document"];
    },
  ) => {
    const candidate = tool && before ? { tool, before } : undefined;
    const placements = completion?.placements ?? {};
    const edit = completion
      ? (staged: RegionSession) => {
          if (
            completion.expected &&
            (completion.expected.document !== staged.document.document ||
              completion.expected.id !== staged.document.id)
          )
            throw Error(STALE_GESTURE);
          return completion.edit?.(staged);
        }
      : undefined;
    moveFrame.flush();
    const proposed = previewValue.current;
    const g = gesture.current,
      pending = pendingDock.current,
      docking =
        pending?.gesture === g && pending?.displayed ? pending.plan : undefined;
    clearGesture();
    if (
      (g &&
        (g.document.document !== o.session.document.document ||
          g.document.id !== o.session.document.id)) ||
      (candidate &&
        !sameJson(
          o.session.scene.tools.find((t) => t.id === candidate.tool.id),
          candidate.before,
        ))
    ) {
      setError(STALE_GESTURE);
      return;
    }
    const update = candidate
      ? (s: CanvasScene): CanvasScene => ({
          ...s,
          tools: s.tools.map((t) =>
            t.id === candidate.tool.id ? { ...candidate.tool, at: t.at } : t,
          ),
        })
      : undefined;
    if (!g?.moved) {
      if (update || completion)
        patchPositions(placements, true, undefined, update, edit);
      return;
    }
    const fresh = docking
      ? latestDockPlan.current(g, pending!.target)
      : planDetach(scene.groups, Object.keys(g.members), measuredFrames());
    // Allow subpixel DOM rounding at fractional zoom, not unpreviewed rearrangement.
    // Acceptance still uses the exact coordinates shown, never the refreshed ones.
    const tolerance = 0.5 / o.zoom;
    const matches =
      fresh &&
      (docking
        ? fresh.destinations.length === docking.destinations.length &&
          fresh.destinations.every((f, index) => {
            const shown = docking.destinations[index];
            return (
              f.id === shown.id &&
              (["x", "y", "width", "height"] as const).every(
                (key) => Math.abs(f[key] - shown[key]) <= tolerance,
              )
            );
          })
        : fresh.destinations.every(
            (f) =>
              Object.hasOwn(proposed, f.id) &&
              Math.abs(f.x - proposed[f.id].x) <= tolerance &&
              Math.abs(f.y - proposed[f.id].y) <= tolerance,
          ));
    if (!fresh || !matches) {
      setError("The layout changed during the preview. Try the move again.");
      return;
    }
    const groups = docking?.groups || fresh.groups;
    const positions = docking
      ? { ...placements, ...docking.placements }
      : g.ownsPositions
        ? { ...placements, ...proposed }
        : candidate
          ? {
              ...proposed,
              ...placements,
              [candidate.tool.id]: candidate.tool.at,
            }
          : { ...proposed, ...placements };
    patchPositions(positions, true, groups, update, edit);
  };
  const cancel = (event?: { pointerId: number }) => {
    if (event && event.pointerId !== gesture.current?.pointer) return;
    setCancelVersion((v) => v + 1);
    clearGesture();
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (isDialogEvent(e)) return;
      const g = gesture.current;
      if (e.key === "Alt" && g?.last)
        move({ ...g.last, pointerId: g.pointer, altKey: e.type === "keydown" });
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
    window.addEventListener("keyup", key, true);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("keyup", key, true);
      window.removeEventListener("blur", blur);
    };
  });
  const saveViewpoint = (name: string, scope?: string) => {
    if (!name.trim()) return;
    const view: Viewpoint = {
      id: `viewpoint-${crypto.randomUUID()}`,
      name: name.trim().slice(0, 80),
      camera: camera(),
      ...(scope ? { scope } : {}),
      positions: Object.fromEntries(
        allFrames().map((f) => [f.id, { x: f.x, y: f.y }]),
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
  const restoreViewpoint = (
    view: Viewpoint,
    navigate?: (scope: string | undefined, camera: Camera) => void,
  ) => {
    if (
      view.scope &&
      !o.page.models?.some((model) => model.id === view.scope)
    ) {
      setError("This named view's model is unavailable.");
      return;
    }
    const known = new Set(Object.keys(view.positions));
    const restored = patchPositions(view.positions, true, undefined, (s) => ({
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
    if (!restored) return;
    setFocus(undefined);
    if (navigate) navigate(view.scope, view.camera);
    else setCamera(view.camera);
    setViewMenu(false);
  };
  // Renderers capture their baseline at pointer-down; completion must use current docking intent.
  const latestEnd = useRef(end);
  latestEnd.current = end;
  return {
    cancelVersion,
    guideLayer,
    movingSelection: () => !!gesture.current?.multiple,
    moving: () => !!gesture.current?.moved,
    scene,
    finishTool: (tool: CanvasTool, before: CanvasTool) =>
      latestEnd.current(tool, before),
    finishPositions: (
      placements: Record<string, Point>,
      edit?: (staged: RegionSession) => void,
      expected?: RegionSession["document"],
    ) =>
      latestEnd.current(undefined, undefined, { placements, edit, expected }),
    setScene,
    error,
    preview: displayed,
    dock,
    get frames() {
      return allFrames();
    },
    frame,
    objectFrames: raw,
    drawing,
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
    end: (event?: { pointerId: number }) => {
      if (!event || event.pointerId === gesture.current?.pointer)
        latestEnd.current();
    },
    finishPointer: (event: Move) => {
      const current = gesture.current;
      if (!current || current.pointer !== event.pointerId) return;
      if (
        Math.hypot(
          event.clientX - current.client.x,
          event.clientY - current.client.y,
        ) >= 5
      ) {
        current.moved = true;
        moveFrame.schedule(event);
      }
      moveFrame.flush();
      if (!current.moved) {
        clearGesture();
        return;
      }
      current.released = true;
      const pending = pendingDock.current;
      if (pending?.timer !== undefined) {
        window.clearTimeout(pending.timer);
        pending.timer = undefined;
      }
      if (!pending?.displayed) clearDock();
      // Scene-owned moves have no renderer-local resize/edit to compose.
      if (current.ownsPositions) {
        latestEnd.current();
        return;
      }
      requestAnimationFrame(() => {
        if (gesture.current === current) latestEnd.current();
      });
    },
    lostCapture: (event: { pointerId: number }) => {
      const current = gesture.current;
      if (current && !current.released) cancel(event);
    },
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
