/** Disposable authored load through the real owner; no alternate drawing persistence. */
import assert from "node:assert/strict";
import * as f from "@manifold/foundation";
import { RegionSession } from "../src/regions/document.ts";
import {
  DRAWING,
  DRAWING_RENDERER,
  MAX_DRAWINGS,
} from "../src/regions/drawing.ts";
export function drawingFixture(count, page) {
  assert(Number.isInteger(count) && count >= 10 && count < MAX_DRAWINGS);
  const session = new RegionSession(page),
    document = session.document.document;
  const kinds = [
    "rectangle",
    "ellipse",
    "pen",
    "highlighter",
    "rectangle",
    "ellipse",
    "line",
    "arrow",
    "text",
    "connector",
  ];
  const ids = Array.from({ length: count }, (_, i) => `drawing-load-${i}`);
  let points = 0;
  session.applyCommands(
    ids.flatMap((id, i) => {
      const kind = kinds[i % kinds.length],
        ink = kind === "pen" || kind === "highlighter";
      const length = i === 2 ? 8192 : ink ? 64 : 2;
      const stroke = Array.from({ length }, (_, j) => ({
        x: Math.round((j / (length - 1)) * 8000) / 100,
        y: ink
          ? Math.round(
              (20 + Math.sin((j / (length - 1)) * Math.PI * 4) * 14) * 100,
            ) / 100
          : j * 40,
        pressure: 0.5,
      }));
      points += length;
      const mark = {
        kind,
        color: "#c5d3e8",
        width: kind === "highlighter" ? 12 : 3,
        points: stroke,
        text: kind === "text" ? "Load" : "",
        start: null,
        end: null,
      };
      if (kind === "connector") {
        mark.start = {
          target: f.reference(document, ids[i - 9]),
          u: 1,
          v: 0.5,
        };
        mark.end = { target: f.reference(document, ids[i - 8]), u: 0, v: 0.5 };
      }
      return [
        {
          kind: "create",
          item: id,
          label: kind,
          revision: {
            id: id + ":r1",
            item: id,
            schema: DRAWING,
            required: true,
            body: mark,
          },
        },
        {
          kind: "view",
          view: {
            id: id + ":view",
            reference: f.reference(document, id),
            renderer: DRAWING_RENDERER,
            x: 120 + (i % 40) * 120,
            y: 120 + Math.floor(i / 40) * 80,
            alternative: null,
          },
        },
      ];
    }),
  );
  return { session, ids, points, longestStroke: 8192 };
}
