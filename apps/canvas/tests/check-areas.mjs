import assert from "node:assert/strict";
import {
  initialLayouts,
  arrangeAreas,
  duplicateWorkspace,
  restoreLayouts,
} from "../src/regions/areaLayout.ts";
const saved = initialLayouts(),
  original = JSON.stringify(saved);
let think = saved.workspaces[0];
think = arrangeAreas(think, {
  type: "split",
  id: think.columns[0].areas[0].id,
  direction: "right",
});
assert.equal(think.columns.length, 2);
const second = think.columns[1].areas[0].id;
think = arrangeAreas(think, { type: "editor", id: second, editor: "response" });
think = arrangeAreas(think, { type: "split", id: second, direction: "down" });
assert.equal(think.columns[1].areas.length, 2);
think = arrangeAreas(think, { type: "editor", id: second, editor: "canvas" });
assert.equal(
  think.columns.flatMap((c) => c.areas).filter((a) => a.editor === "canvas")
    .length,
  1,
);
const copy = duplicateWorkspace(think, "My model");
assert.notEqual(copy.columns[0].areas[0].id, think.columns[0].areas[0].id);
assert.equal(JSON.stringify(saved), original);
const portable = restoreLayouts(
  JSON.stringify({ ...saved, workspaces: [think, copy] }),
);
assert.equal(portable.workspaces.length, 2);
assert.throws(() =>
  restoreLayouts(JSON.stringify({ ...saved, active: "missing" })),
);
assert.throws(() =>
  restoreLayouts(
    JSON.stringify({
      ...saved,
      workspaces: [{ ...think, columns: [{ ...think.columns[0], width: 0 }] }],
    }),
  ),
);
assert.equal(
  Object.hasOwn(
    restoreLayouts(
      JSON.stringify({ ...saved, page: { regions: ["injected"] } }),
    ),
    "page",
  ),
  false,
);
console.log(
  "Independent layouts, split/swap/duplicate, portable arrangement recovery and validation passed.",
);
