import assert from "node:assert/strict";
import * as f from "@manifold/foundation";
import {
  RegionSession,
  project,
  semanticKey,
} from "../src/regions/document.ts";
import {
  archive,
  decodeWorkspace,
  makeArtifact,
} from "../src/regions/artifacts.ts";
import { planConnection } from "../src/regions/linking.ts";
import { observeAuthoring } from "./authoring-probe.mjs";

const s = new RegionSession();
const add = (text) => {
  const id = s.create();
  assert.equal(s.write(id, text).ok, true);
  return id;
};
const k = add("k := 10 N/mm"),
  x = add("x := 1 mm"),
  force = add("F := k*x");
const source = "gain,noise\n10," + "u".repeat(900_000);
const dataset = s.importData("measurements.csv", source, { x: 20, y: 700 });
const csv = s.state.regions.find((r) => r.id === dataset);
const gain = s.quantityFromCell(dataset, 0, 0, "gain", "N/mm", {
  x: 20,
  y: 400,
});
const receipt = s.keepCurrentCalculation("Source-backed worksheet");
const savedCalculation = s.state.calculations.find((c) => c.id === receipt);
const artifact = makeArtifact(s.state, force, "Plot F versus x from 0 to 3");
s.setArtifacts([artifact]);
function observe(operation) {
  const result = observeAuthoring(source, operation);
  assert.equal(result.counters.sourceCloneCalls, 0);
  assert.equal(result.counters.sourceSerializationCalls, 0);
  assert.equal(
    s.state.regions.find((r) => r.id === dataset),
    csv,
  );
  assert.equal(
    s.state.calculations.find((c) => c.id === receipt),
    savedCalculation,
  );
  return result.value;
}

// One literal edit preserves every unrelated immutable record and the selected recipe.
const before = s.document,
  page = s.state;
observe(() => assert.equal(s.write(x, "x := 2 mm").ok, true));
assert.equal(s.document.revisions.size, before.revisions.size + 1);
assert.equal(
  s.state.regions.find((r) => r.id === k),
  page.regions.find((r) => r.id === k),
);
assert.equal(s.state.contexts[0], page.contexts[0]);
assert.equal(page.regions.find((r) => r.id === x).text, "x := 1 mm");
assert.equal(project(s.state).solved.values.get("F").value, 20);
const changed = s.document;
observe(() => s.write(x, "x := 2 mm"));
assert.equal(s.document, changed, "equal edits allocate no revision or Undo");

// Placement, flow arrangement, model scope and its interface do not clone source payloads.
const revisions = s.document.revisions;
observe(() => s.move(x, { x: 30, y: 220 }));
assert.equal(s.document.revisions, revisions);
observe(() => s.arrange({ [k]: { x: 30, y: 100 }, [x]: { x: 30, y: 220 } }));
observe(() =>
  s.makeModel(
    {
      id: "model-spring",
      name: "Spring",
      members: [k, x, force],
      inputs: [k, x],
      outputs: [force],
    },
    { x: 80, y: 80 },
  ),
);
observe(() => s.exposeModel("model-spring", [k, x], [force], "Spring model"));
observe(() => s.styleModel("model-spring", { shape: "frame" }));

// Context and connection changes stay atomic; invalid alternatives preserve the prior owner.
const context = observe(() => s.branch());
const alternative = s.document;
observe(() => assert.equal(s.write(x, "x := 2 s").ok, false));
assert.equal(s.document, alternative);
observe(() => s.write(x, "x := 3 mm"));
observe(() => s.switchContext("original"));
const edit = observe(() => planConnection(s.state, gain, k));
observe(() => assert.equal(s.connect(edit).ok, true));
assert.equal(project(s.state).solved.values.get("F").value, 20);
observe(() => s.undo());

// Identity-bound rename updates consumers and all context snapshots without changing CSV.
observe(() => s.write(k, "stiffness := 10 N/mm"));
assert.match(s.state.regions.find((r) => r.id === force).text, /stiffness/);
assert.equal(project(s.state).solved.values.get("F").value, 20);
observe(() => s.switchContext(context));
assert.equal(project(s.state).solved.values.get("F").value, 30);
observe(() => s.switchContext("original"));
const original = s.state;
observe(() => s.write(x, "x := 4 mm"));
observe(() => s.branchEdit(x, original));
assert.equal(project(s.state).solved.values.get("F").value, 40);
observe(() => s.undo());

// Kept/native provenance still closes over original source revisions after these edits.
const decoded = await decodeWorkspace(archive(s.native()));
assert.equal(
  decoded.page.regions.find((r) => r.id === dataset).data.csv,
  source,
);
assert.equal(
  decoded.page.calculations[0].snapshot.id,
  savedCalculation.snapshot.id,
);
assert.equal(semanticKey(decoded.page), semanticKey(s.state));
assert.equal(f.current(s.document, "region:" + dataset).body.value, csv);
s.dispose();
console.log(
  "Targeted authoring: source/kept-record sharing, literal/no-op edits, placement, model interfaces, contexts, failure, connection/rename, branch review, Undo and native provenance pass.",
);
