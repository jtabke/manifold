import type { Point, RegionSession } from "./document.ts";
import {
  drawings,
  duplicateDrawings,
  deleteDrawings,
  editDrawings,
} from "./drawing.ts";
import { drawingGeometry } from "./drawingGeometry.ts";
import { detachMember } from "./canvasScene.ts";

export function selectionEditReason(
  session: RegionSession,
  ids: readonly string[],
) {
  const supported = new Set([
    ...session.state.regions.map((r) => r.id),
    ...drawings(session.document).map((e) => e.id),
  ]);
  return ids.some((id) => !supported.has(id))
    ? "Duplicate/Delete supports worksheet regions and drawings. Use the object's own actions for other views."
    : undefined;
}

export function duplicateSelection(
  session: RegionSession,
  ids: readonly string[],
  placements: Record<string, Point>,
) {
  const reason = selectionEditReason(session, ids);
  if (reason) throw Error(reason);
  return session.atomic((staged) => [
    ...staged.duplicateRegions(ids, placements),
    ...duplicateDrawings(staged, [...ids]),
  ]);
}

export function deleteSelection(
  session: RegionSession,
  ids: readonly string[],
) {
  const reason = selectionEditReason(session, ids);
  if (reason) throw Error(reason);
  session.atomic((staged) => {
    staged.deleteRegions(ids);
    deleteDrawings(staged, [...ids]);
    staged.setScene((scene) => ({
      ...scene,
      groups: ids.reduce(
        (groups, id) => detachMember(groups, id),
        scene.groups,
      ),
    }));
  });
}

/** Scene placements use visible bounds, while native drawings store a local-path translation. */
export function positionDrawings(
  session: RegionSession,
  placements: Record<string, Point>,
) {
  const entries = drawings(session.document),
    geometry = drawingGeometry(entries);
  const ids = new Set(entries.filter((e) => placements[e.id]).map((e) => e.id));
  editDrawings(
    session,
    entries
      .filter((e) => ids.has(e.id))
      .map((entry) => {
        const bounds = geometry.bounds(entry),
          at = placements[entry.id];
        const detach =
          entry.mark.kind === "connector" &&
          (entry.mark.start || entry.mark.end) &&
          ![entry.mark.start, entry.mark.end].some(
            (anchor) => anchor && ids.has(anchor.target.item),
          );
        return {
          entry,
          at: {
            x: entry.view.x + at.x - bounds.x,
            y: entry.view.y + at.y - bounds.y,
          },
          ...(detach ? { mark: geometry.detachedMark(entry) } : {}),
        };
      }),
  );
}
