import { canvasScroll } from "../interaction/canvasViewport";
import { useLayoutEffect, useState, type RefObject } from "react";
import { project, type Page } from "../document";
import { selectionKind, type DataSelection } from "../dataFeedback";
/** Temporary selection paths. They inspect existing relations and never create bindings. */
export function DataRelationshipOverlay({
  page,
  selection,
  canvas,
  zoom,
  trace = false,
  preferred,
}: {
  page: Page;
  selection?: DataSelection;
  canvas: RefObject<HTMLDivElement | null>;
  zoom: number;
  trace?: boolean;
  preferred?: string;
}) {
  const [paths, setPaths] = useState<
    { key: string; d: string; kind: string }[]
  >([]);
  useLayoutEffect(() => {
    const root = canvas.current;
    if (!root || !selection) {
      if (paths.length) setPaths([]);
      return;
    }
    const parent = root.getBoundingClientRect(),
      kind = selectionKind(selection),
      next: typeof paths = [];
    const rect = (el: Element | null) => {
      if (!el || !el.getClientRects().length) return;
      const r = el.getBoundingClientRect();
      return {
        x: (r.left - parent.left + canvasScroll(root).x) / zoom,
        y: (r.top - parent.top + canvasScroll(root).y) / zoom,
        w: r.width / zoom,
        h: r.height / zoom,
      };
    };
    const connect = (
      key: string,
      from: Element | null,
      to: Element | null,
      kind: string,
    ) => {
      const a = rect(from),
        b = rect(to);
      if (!a || !b) return;
      const right = b.x > a.x,
        x1 = right ? a.x + a.w : a.x,
        y1 = a.y + a.h / 2,
        x2 = right ? b.x : b.x + b.w,
        y2 = b.y + b.h / 2,
        bend = Math.max(24, Math.min(110, Math.abs(x2 - x1) / 2));
      next.push({
        key,
        kind,
        d: `M${x1},${y1} C${x1 + (right ? bend : -bend)},${y1} ${x2 - (right ? bend : -bend)},${y2} ${x2},${y2}`,
      });
    };
    const source = root.querySelector(
      `[data-region-id="${selection.dataset}"]`,
    );
    for (const relation of page.dataRelations || []) {
      if (
        relation.dataset !== selection.dataset ||
        (selection.relation && selection.relation !== relation.id)
      )
        continue;
      const model = root.querySelector(`[data-region-id="${relation.output}"]`),
        result = root.querySelector(`[data-data-relation-id="${relation.id}"]`),
        p = project(page);
      for (const b of relation.bindings) {
        if (
          kind !== "record" &&
          selection.columns.length &&
          !selection.columns.includes(b.column)
        )
          continue;
        const name = b.quantity
          ? p.statements.get(b.quantity)?.name || b.symbol
          : b.symbol;
        const cell =
          kind === "series"
            ? source?.querySelector(`[data-source-column="${b.column}"]`)
            : source?.querySelector(
                `[data-source-cell="${selection.rows[0]}-${b.column}"]`,
              );
        connect(
          `${relation.id}-${b.column}`,
          cell || source?.querySelector("header") || null,
          model?.querySelector(`[data-symbol="${name}"]`) || null,
          "evidence",
        );
      }
      if (selection.rows.length) {
        const row = selection.rows[0],
          point =
            result?.querySelector(`[data-measurement-row="${row}"]`) ||
            result?.querySelector(
              `[data-calculated-row="${row}"] [data-derived-value]`,
            );
        connect(
          `${relation.id}-result`,
          model?.querySelector(".er-record-story>strong") ||
            model?.querySelector("math") ||
            null,
          point || null,
          "calculation",
        );
        for (const [id, s] of p.statements)
          if (
            s.relation !== "=" &&
            s.name === p.statements.get(relation.output)?.name
          )
            connect(
              `${relation.id}-${id}`,
              point || null,
              root.querySelector(`[data-region-id="${id}"] math`),
              "requirement",
            );
      } else
        connect(
          `${relation.id}-series`,
          model?.querySelector("math") || null,
          result?.querySelector("header") || null,
          "calculation",
        );
    }
    if (JSON.stringify(next) !== JSON.stringify(paths)) setPaths(next);
  });
  if (!selection || !paths.length) return null;
  const visible = trace
    ? paths
    : paths
        .filter(
          (p) =>
            p.kind ===
            (preferred ||
              (selection.view === selection.dataset
                ? "evidence"
                : "calculation")),
        )
        .slice(0, 1);
  return (
    <svg
      className="er-selection-paths"
      aria-label="Selected engineering relationships"
    >
      <defs>
        <marker
          id="er-data-path-arrow"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="5"
          markerHeight="5"
          orient="auto"
        >
          <path d="M1 1 L7 4 L1 7" fill="none" stroke="currentColor" />
        </marker>
      </defs>
      {visible.map((p) => (
        <path
          key={p.key}
          d={p.d}
          data-relationship-kind={p.kind}
          markerEnd="url(#er-data-path-arrow)"
        >
          <title>
            {p.kind === "evidence"
              ? "Source measurement supplies model input"
              : p.kind === "calculation"
                ? "Model calculates result"
                : "Result evaluated against requirement"}
          </title>
        </path>
      ))}
    </svg>
  );
}
