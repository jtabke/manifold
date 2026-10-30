import assert from "node:assert/strict";
import { parse } from "../src/notebook/math.ts";
import { mathSource, caretInSpan } from "../src/regions/editing.ts";
import {
  organizeFrames,
  selectionRect,
  touches,
} from "../src/regions/selection.ts";
import {
  RegionSession,
  project,
  semanticKey,
  curve,
  positions,
} from "../src/regions/document.ts";
import {
  REGION_STEP,
  regionAdvance,
  freeRegionPosition,
} from "../src/regions/pageLayout.ts";
const namedPage = {
  origin: { x: 0, y: 0 },
  layout: Object.create(null),
  plots: [],
  regions: ["constructor", "toString", "tail"].map((id) => ({
    id,
    text: "A line",
  })),
};
assert.equal(
  positions(namedPage).tail.y,
  2 * REGION_STEP,
  "inherited names are not measured heights",
);
const inheritedHeight = Object.create(null);
Object.defineProperty(inheritedHeight, "constructor", {
  get() {
    throw Error("Inherited height read");
  },
});
assert.equal(
  positions(namedPage, Object.create(inheritedHeight)).tail.y,
  2 * REGION_STEP,
);
assert.equal(regionAdvance("A line"), 72);
assert(regionAdvance("One\nTwo\nThree") > REGION_STEP);
assert.equal(regionAdvance("Wrapped", 180), 196);
const fixed = [
  { x: 100, y: 150, width: 500, height: 80 },
  { x: 100, y: 260, width: 500, height: 60 },
];
const fixedBefore = structuredClone(fixed);
assert.deepEqual(freeRegionPosition({ x: 100, y: 140 }, REGION_STEP, fixed), {
  x: 100,
  y: 336,
});
assert.deepEqual(fixed, fixedBefore);
const s = new RegionSession();
const arrangedSession = new RegionSession();
const layoutIds = ["a := 2", "b = a*3", "A note"].map((text) => {
  const id = arrangedSession.create();
  arrangedSession.write(id, text);
  return id;
});
const layoutBefore = arrangedSession.state,
  receiptCount = arrangedSession.receipts.length;
const unaffected = positions(layoutBefore)[layoutIds[1]];
arrangedSession.arrange({
  [layoutIds[0]]: { x: 300, y: 500 },
  [layoutIds[2]]: { x: 300, y: 600 },
});
assert.deepEqual(positions(arrangedSession.state)[layoutIds[1]], unaffected);
assert.equal(semanticKey(arrangedSession.state), semanticKey(layoutBefore));
assert.equal(arrangedSession.receipts.length, receiptCount);
arrangedSession.undo();
assert.equal(arrangedSession.state, layoutBefore);
const layoutRecovery = [];
arrangedSession.arrange({}, true, () => layoutRecovery.push(1));
arrangedSession.arrange({}, true, () => layoutRecovery.push(2));
const unusedAfterArrange = arrangedSession.create();
arrangedSession.write(unusedAfterArrange, "");
arrangedSession.undo();
arrangedSession.undo();
assert.deepEqual(layoutRecovery, [2, 1]);
const frames = [
  { id: "a", kind: "region", x: 90, y: 100, width: 250, height: 70 },
  { id: "b", kind: "region", x: 170, y: 250, width: 180, height: 60 },
  { id: "plot", kind: "plot", x: 500, y: 150, width: 600, height: 450 },
];
assert.deepEqual(selectionRect({ x: 400, y: 300 }, { x: 50, y: 80 }), {
  x: 50,
  y: 80,
  width: 350,
  height: 220,
});
assert.ok(
  touches(selectionRect({ x: 400, y: 300 }, { x: 50, y: 80 }), frames[0]),
);
assert.ok(!touches({ x: 0, y: 0, width: 10, height: 10 }, frames[0]));
const wide = organizeFrames(frames, 1300),
  narrow = organizeFrames(frames, 700);
assert.equal(wide.a.x, wide.b.x);
assert.ok(wide.plot.x >= wide.a.x + frames[0].width + 64);
assert.ok(narrow.plot.y > narrow.b.y + frames[1].height);
assert.equal(narrow.plot.x, narrow.a.x);
for (const text of [
  "T = T_inf + Q/(h*A)",
  "x := x + x/(x*x)",
  "h := 60 W/(m² K)",
  "T ≤ 1.0e2 °C",
  "x := −.25 m³",
  "x := 2(3 + 4)*5",
]) {
  const statement = parse(text),
    mapped = mathSource(statement, text);
  for (const [expression, location] of mapped.expressions) {
    if (expression.kind === "name")
      assert.equal(
        text
          .slice(location.span.start, location.span.end)
          .replace("°C", "degC"),
        expression.name,
      );
    if (expression.kind === "number")
      assert.equal(
        Number(
          text
            .slice(location.span.start, location.span.end)
            .replace("²", "2")
            .replace("³", "3"),
        ),
        expression.value,
      );
  }
}
assert.deepEqual(caretInSpan({ start: 4, end: 9 }, 0.8), { start: 8, end: 8 });
const unchangedAlternative = new RegionSession();
const shared = unchangedAlternative.create();
unchangedAlternative.write(shared, "y = 2*x");
const input = unchangedAlternative.create();
unchangedAlternative.write(input, "x := 3");
unchangedAlternative.branch();
assert.ok(unchangedAlternative.write(shared, "y = 2*x", true).next);
assert.equal(unchangedAlternative.write(shared, "y = 3*x").ok, false);
assert.equal(s.state.regions.length, 0);
const spatial = new RegionSession();
const firstSpatial = spatial.create({ x: 100, y: 100 });
spatial.write(firstSpatial, "First thought");
const placed = spatial.create({ x: 125, y: 650 });
assert.deepEqual(positions(spatial.state)[placed], { x: 125, y: 650 });
const continued = spatial.write(placed, "Second thought", true).next;
assert.deepEqual(positions(spatial.state)[continued], {
  x: 125,
  y: 650 + REGION_STEP,
});
spatial.write(continued, "");
assert.equal(spatial.state.regions.length, 2);
assert.deepEqual(positions(spatial.state)[firstSpatial], { x: 100, y: 100 });
const cursors = new RegionSession();
const emptyCursor = cursors.create({ x: 400, y: 300 });
assert.ok(cursors.write(emptyCursor, "   ", true).ok);
assert.equal(cursors.state.regions.length, 0);
assert.equal(cursors.canUndo, false);
const note = cursors.create();
cursors.write(note, "Check the cooling assumption");
const unused = cursors.create();
cursors.write(unused, "");
cursors.undo();
assert.equal(cursors.state.regions.length, 0);
const erased = cursors.create();
cursors.write(erased, "Unfinished thought");
cursors.write(erased, "");
assert.equal(cursors.state.regions.length, 0);
cursors.undo();
assert.equal(cursors.state.regions[0].text, "Unfinished thought");
const archived = structuredClone(cursors.state);
archived.regions.push({ id: "region-99", text: "" });
assert.equal(new RegionSession(archived).state.regions.length, 1);
const referenced = new RegionSession(archived, () => ["region-99"]);
referenced.discardEmpty();
assert.equal(referenced.state.regions.length, 2);
archived.contexts.push({
  id: "alternative-100",
  label: "Alternative",
  base: { "region-99": "A := .2 m^2" },
  overrides: {},
});
assert.equal(new RegionSession(archived).state.regions.length, 2);
const enter = (text) => {
  const id = s.create();
  const result = s.write(id, text);
  assert.ok(result.ok);
  return id;
};
const temperature = enter("T = T_inf + Q/(h*A)");
assert.match(project(s.state).errors.get(temperature), /Define/);
enter("T_inf := 25 °C");
enter("Q := 800 W");
const convection = enter("h := 60 W/(m^2 K)");
const area = enter("A := .2 m^2");
const requirement = enter("T <= 100 °C");
let p = project(s.state);
assert.ok(
  Math.abs(p.solved.values.get("T").value - 273.15 - 91.6666666667) < 1e-9,
);
assert.equal(p.solved.constraints.get(requirement).pass, true);
assert.equal(p.bindings[temperature].A, area);
assert.equal(p.bindings[requirement].T, temperature);
// Transient numerical consequences never write accepted definitions or receipts.
const { proposeValue, previewPage, responseFor } = await import(
  "../src/regions/exploration.ts"
);
const acceptedState = s.state,
  acceptedKey = semanticKey(s.state),
  acceptedCount = s.receipts.length;
const proposal = proposeValue(s.state, area, 0.15);
const transient = previewPage(s.state, proposal),
  projected = project(transient);
assert.ok(
  Math.abs(
    projected.solved.values.get("T").value - 273.15 - (25 + 800 / (60 * 0.15)),
  ) < 1e-9,
);
assert.equal(projected.solved.constraints.get(requirement).pass, false);
assert.equal(s.state, acceptedState);
assert.equal(semanticKey(s.state), acceptedKey);
assert.equal(s.receipts.length, acceptedCount);
const blocked = project(previewPage(s.state, proposeValue(s.state, area, 0)));
assert.ok(blocked.errors.has(temperature));
assert.ok(!blocked.solved.constraints.has(requirement));
assert.equal(responseFor(s.state, temperature, "A").input, area);
assert.equal(previewPage(s.state, { ...proposal, context: "other" }), s.state);
s.write(convection, "h := 50 W/(m^2 K)");
assert.equal(previewPage(s.state, proposal), s.state);
s.undo();
assert.ok(s.write(area, proposal.text).ok);
assert.equal(s.receipts.at(-1).values.A.value, 0.15);
s.undo();
assert.equal(project(s.state).solved.values.get("A").value, 0.2);
assert.equal(s.receipts.at(-1).values.A.value, 0.15);
const plot = s.addPlot(temperature, area);
const key = semanticKey(s.state),
  count = s.receipts.length;
s.move(plot, { x: 550, y: 160 });
s.resize(plot, 660, 340);
s.move(temperature, { x: 120, y: 80 });
assert.equal(semanticKey(s.state), key);
assert.equal(s.receipts.length, count);
assert.equal(positions(s.state)[temperature].x, 120);
const original = s.state.active;
s.branch();
assert.ok(s.write(convection, "h := 40 W/(m^2 K)").ok);
p = project(s.state);
assert.equal(p.solved.values.get("T").value - 273.15, 125);
assert.equal(p.solved.constraints.get(requirement).pass, false);
assert.equal(project(s.state, original).solved.values.get("h").value, 60);
assert.equal(s.write(convection, "h was a guess").ok, false);
assert.equal(s.write(temperature, "T = T_inf + 2*Q/(h*A)").ok, false);
const plotData = curve(s.state, s.state.plots[0], original);
for (const point of plotData.points.filter((p) => p.y !== undefined))
  assert.ok(Math.abs(point.y - (25 + 800 / (60 * point.x))) < 1e-9);
const retained = s.receipts.at(-1);
s.undo();
assert.equal(project(s.state).solved.values.get("h").value, 60);
assert.equal(retained.values.T.value - 273.15, 125);
assert.ok(Object.isFrozen(retained.values));
assert.equal(s.write(convection, "h := 5 m").ok, false);
s.switchContext(original);
const duplicate = enter("A := .3 m^2");
assert.match(project(s.state).errors.get(area), /twice|already/);
assert.match(project(s.state).errors.get(duplicate), /twice|already/);
assert.equal(curve(s.state, s.state.plots[0], original).points.length, 0);
s.undo();
const unfinishedCondition = enter("T <=");
assert.ok(project(s.state).solved.values.has("T"));
assert.ok(project(s.state).errors.has(unfinishedCondition));
assert.ok(!project(s.state).solved.constraints.has(unfinishedCondition));
s.undo();
const before = semanticKey(s.state);
enter("Need to check the heat-transfer assumption");
assert.equal(semanticKey(s.state), before);
assert.equal(s.write(area, "A := 0.").ok, true);
assert.match(project(s.state).errors.get(area), /complete/);
assert.ok(!project(s.state).solved.values.has("A"));
assert.deepEqual(project(s.state).sources.A, [area]);
console.log(
  "Empty-region authoring, late binding, constraints, identity, layout independence, branch/undo receipts, units, duplicate symbols and analytical curves passed.",
);
