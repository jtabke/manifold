import {
  canvasScroll,
  scrollCanvasTo,
  revealCanvasElement,
} from "./canvasViewport";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { Page, Point } from "./document";
import type { DataSelection } from "./dataFeedback";
import type { DatasetComputation } from "./datasetModel";
import { frameBounds, type CanvasFrame } from "./selection";
import {
  relationshipArrangement,
  relationshipDestination,
  relationshipObjects,
  type RelationshipLocation,
} from "./relationshipNavigation";
type Camera = { x: number; y: number; zoom: number };
type View = {
  relation: string;
  mode: "frame" | "arrange";
  positions: Record<string, Point>;
  ids: string[];
};
type Entry = {
  camera: Camera;
  selection?: DataSelection;
  collapsed: string[];
  location?: RelationshipLocation;
  trace: boolean;
  view?: View;
};
export function useRelationshipNavigation(o: {
  page: Page;
  selection?: DataSelection;
  choose: (s: DataSelection | undefined) => void;
  canvas: RefObject<HTMLDivElement | null>;
  zoom: number;
  setZoom: (z: number) => void;
  frames: () => CanvasFrame[];
  collapsed: string[];
  setCollapsed: (ids: string[]) => void;
  persist: (positions: Record<string, Point>) => void;
}) {
  const [history, setHistory] = useState<Entry[]>([]),
    [location, setLocation] = useState<RelationshipLocation>(),
    [trace, setTrace] = useState(false);
  const [focus, setFocus] = useState<
    View & {
      before: Entry;
      history: Entry[];
      originalFrames: CanvasFrame[];
    }
  >();
  useEffect(() => {
    if (!o.selection) {
      setTrace(false);
      setLocation(undefined);
    }
  }, [o.selection]);
  const timer = useRef(0);
  const camera = (): Camera => ({
    x: canvasScroll(o.canvas.current).x,
    y: canvasScroll(o.canvas.current).y,
    zoom: o.zoom,
  });
  const snapshot = (): Entry => ({
    camera: camera(),
    selection: o.selection ? structuredClone(o.selection) : undefined,
    collapsed: [...o.collapsed],
    location,
    trace,
    view: focus && {
      relation: focus.relation,
      mode: focus.mode,
      positions: focus.positions,
      ids: focus.ids,
    },
  });
  const setCamera = (c: Camera, smooth = false) => {
    o.setZoom(c.zoom);
    const serial = timer.current;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (serial !== timer.current) return;
        scrollCanvasTo(o.canvas.current, {
          left: c.x,
          top: c.y,
          behavior:
            smooth &&
            !window.matchMedia("(prefers-reduced-motion: reduce)").matches
              ? "smooth"
              : "instant",
        });
      }),
    );
  };
  const restoreEntry = (e: Entry) => {
    if (focus) setFocus(e.view ? { ...focus, ...e.view } : undefined);
    o.choose(e.selection);
    o.setCollapsed(e.collapsed);
    setLocation(e.location);
    setTrace(e.trace);
    setCamera(e.camera);
  };
  const follow = (relation: DatasetComputation, to: RelationshipLocation) => {
    if (!o.selection) return;
    setHistory((h) => [...h, snapshot()].slice(-32));
    // Following a different consumer leaves the temporary composition. Back
    // can still recover it without persisting any presentation coordinates.
    if (focus && relation.id !== focus.relation)
      setFocus({
        ...focus,
        relation: relation.id,
        mode: "frame",
        positions: {},
        ids: relationshipObjects(o.page, relation).ids,
      });
    setLocation(to);
    const next = relationshipDestination(o.page, relation, to, o.selection);
    o.choose(next);
    if (to.kind === "source" || to.kind === "input")
      o.setCollapsed(o.collapsed.filter((id) => id !== relation.dataset));
    const serial = ++timer.current;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (serial !== timer.current) return;
        const root = o.canvas.current;
        if (!root) return;
        const column = next.columns[0];
        const selector =
          to.kind === "source"
            ? `[data-region-id="${relation.dataset}"] [data-source-row="${next.rows[0]}"]`
            : to.kind === "input"
              ? `[data-region-id="${relation.dataset}"] button[data-source-column="${column}"]`
              : to.kind === "requirement"
                ? `[data-region-id="${next.view}"] math`
                : to.kind === "result"
                  ? `[data-data-relation-id="${relation.id}"] [data-measurement-row="${next.rows[0]}"]`
                  : to.kind === "assumption"
                    ? `[data-region-id="${to.object}"] math`
                    : `[data-region-id="${relation.output}"] .er-record-feedback`;
        const target =
          root.querySelector<HTMLElement>(selector) ||
          root.querySelector<HTMLElement>(
            `[data-region-id="${next.view}"],[data-data-relation-id="${next.view}"]`,
          );
        if (!target) return;
        revealCanvasElement(target, {
          block: "center",
          inline: "center",
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
            ? "instant"
            : "smooth",
        });
        if (target.matches("button,[tabindex]"))
          target.focus({ preventScroll: true });
      }),
    );
  };
  const back = () => {
    const previous = history.at(-1);
    if (!previous) return;
    ++timer.current;
    setHistory((h) => h.slice(0, -1));
    restoreEntry(previous);
  };
  const focusRelationship = (
    relation: DatasetComputation,
    mode: "frame" | "arrange" = "frame",
  ) => {
    ++timer.current;
    const currentFrames = o.frames(),
      frames =
        focus?.mode === "arrange"
          ? currentFrames.map((f) => {
              const original = focus.originalFrames.find((p) => p.id === f.id);
              return original ? { ...f, x: original.x, y: original.y } : f;
            })
          : currentFrames,
      positions =
        mode === "arrange"
          ? relationshipArrangement(o.page, relation, frames, { x: 80, y: 140 })
          : {},
      ids = relationshipObjects(o.page, relation).ids,
      bounds = frameBounds(
        frames
          .filter((f) => ids.includes(f.id))
          .map((f) => ({ ...f, ...positions[f.id] })),
      );
    if (!bounds) return;
    setFocus({
      relation: relation.id,
      mode,
      positions,
      ids,
      before: focus?.before || snapshot(),
      history: focus?.history || history,
      originalFrames: focus?.originalFrames || currentFrames,
    });
    const viewport = o.canvas.current,
      width = viewport?.clientWidth || 1400,
      height = viewport?.clientHeight || 900,
      zoom = Math.max(
        0.1,
        Math.min(
          1,
          (width - 96) / bounds.width,
          (height - 160) / bounds.height,
        ),
      );
    setCamera(
      {
        x: (bounds.x + bounds.width / 2) * zoom - width / 2,
        y: (bounds.y + bounds.height / 2) * zoom - (height + 64) / 2,
        zoom,
      },
      true,
    );
  };
  const restore = () => {
    if (!focus) return;
    ++timer.current;
    const before = focus.before;
    setHistory(focus.history);
    setFocus(undefined);
    restoreEntry(before);
  };
  const keepArrangement = () => {
    if (focus?.mode !== "arrange") return;
    ++timer.current;
    o.persist(focus.positions);
    setHistory(focus.history);
    setFocus(undefined);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        (e.target as Element)?.closest(
          "input,textarea,select,[contenteditable]",
        )
      )
        return;
      if (e.altKey && e.key === "ArrowLeft" && history.length) {
        e.preventDefault();
        e.stopPropagation();
        back();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  });
  return {
    follow,
    back,
    canBack: !!history.length,
    trace,
    setTrace,
    location,
    focus,
    focusRelationship,
    restore,
    keepArrangement,
  };
}
