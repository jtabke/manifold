import { current, type Document } from "@manifold/foundation";
import type { RegionSession, SessionPublication } from "../document.ts";
import { drawings, DRAWING_RENDERER } from "../drawing.ts";
import { drawingGeometry } from "../drawingGeometry.ts";
import { modelViews, MODEL_RENDERER } from "../modelCommands.ts";
import { analysisViews } from "../modelAnalysisCommands.ts";
import { ANALYSIS_RENDERER } from "../modelAnalysis.ts";
import {
  optimizationResponses,
  optimizationViews,
} from "../modelOptimizationCommands.ts";
import { OPTIMIZATION_RENDERER } from "../modelOptimization.ts";

function selectAll(doc: Document) {
  const optimizations = optimizationViews(doc);
  return {
    drawing: drawingGeometry(drawings(doc)),
    models: modelViews(doc),
    analyses: analysisViews(doc),
    optimizations,
    responses: optimizations.length ? optimizationResponses(doc) : [],
  };
}
/** Disposable presentation cache. Admission/commands never trust its hints. Only
 * use a delta across its exact observed root pair (not IDs or sequence numbers).
 * Cold mount, Open, missed/reentrant notifications all have a complete read. */
export function canvasViewSelection(session: RegionSession) {
  let previous = session.document,
    value = selectAll(previous);
  function read(publication?: SessionPublication) {
    const doc = session.document;
    if (doc === previous) return value;
    if (
      doc.document === previous.document &&
      doc.views === previous.views &&
      doc.items === previous.items &&
      doc.revisions === previous.revisions
    ) {
      previous = doc;
      return value;
    }
    if (publication?.previous !== previous || publication.document !== doc) {
      value = selectAll(doc);
    } else {
      const { event } = publication,
        changed = new Set<string>();
      for (const id of event.views) {
        const before = previous.views.get(id),
          after = doc.views.get(id);
        if (before === after) continue;
        if (before) changed.add(before.renderer);
        if (after) changed.add(after.renderer);
      }
      // A revision can change a mark (and attached geometry) without writing a
      // view. A view move can change both endpoints without writing any items.
      const markChanged = event.items.some((id) => {
        const entry = value.drawing.byId.get(id);
        return entry && current(doc, id)?.body !== entry.mark;
      });
      if (markChanged || changed.has(DRAWING_RENDERER))
        value = { ...value, drawing: drawingGeometry(drawings(doc)) };
      if (changed.has(MODEL_RENDERER))
        value = { ...value, models: modelViews(doc) };
      if (changed.has(ANALYSIS_RENDERER))
        value = { ...value, analyses: analysisViews(doc) };
      const wasOptimizing = value.optimizations.length;
      if (changed.has(OPTIMIZATION_RENDERER))
        value = { ...value, optimizations: optimizationViews(doc) };
      if (value.optimizations.length) {
        const responses = optimizationResponses(
          doc,
          wasOptimizing ? event.items : undefined,
          value.responses,
        );
        if (responses !== value.responses) value = { ...value, responses };
      } else if (value.responses.length) value = { ...value, responses: [] };
    }
    previous = doc;
    return value;
  }
  return {
    read: () => read(),
    currentDrawing: () => read().drawing,
    subscribe: (refresh: () => void) =>
      session.subscribe((publication) => {
        read(publication);
        refresh();
      }),
  };
}
