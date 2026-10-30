/** Independent cold reference for the existing bound; deliberately retains canonical encoding. */
import assert from "node:assert/strict";
import * as f from "@manifold/foundation";
import {
  CanvasStorageBudget,
  MAX_CANVAS_LOCAL_BYTES,
} from "../src/regions/app/canvasStorageBudget.ts";
import { canvasSchemas } from "../src/regions/app/canvasDocument.ts";
import { sceneFixture } from "./scene-fixture.mjs";
import { drawingFixture } from "./drawing-fixture.mjs";
import { editDrawings, drawings } from "../src/regions/drawing.ts";
import { drawingGeometry } from "../src/regions/drawingGeometry.ts";
const bytes = (value) => f.byteLength(f.canonical(value));
function reference(document, foundation, schemas) {
  const assets = (values) =>
    values.reduce(
      (n, a) => n + (a.disposition === "included" ? a.size * 6 + 896 : 0),
      0,
    );
  const map = (values, project = (v) => v, extra = () => 0) =>
    [...values.entries()].reduce(
      (n, [key, value]) =>
        n + bytes(key) + bytes(project(value)) + extra(value) + 896,
      0,
    );
  return (
    4096 +
    map(document.items) +
    map(document.revisions) +
    map(document.views) +
    map(document.known) +
    map(
      document.alternatives,
      (a) => ({ ...a, context: f.contextToPlain(a.context) }),
      (a) => 896 * (a.context.heads.size + a.context.revisions.size),
    ) +
    Object.values(document.allocated).reduce(
      (n, values) => n + map(values),
      0,
    ) +
    (foundation
      ? map(
          foundation.receipts,
          f.receiptData,
          (r) =>
            896 * (r.context.heads.size + r.context.revisions.size) +
            assets(f.receiptAssets(r)),
        )
      : 0) +
    [...document.revisions.entries()].reduce(
      (n, [, r]) => n + assets(schemas.get(r.schema)?.assets(r.body) ?? []),
      0,
    )
  );
}
function compare(
  document,
  foundation,
  schemas,
  hot = new CanvasStorageBudget(),
) {
  const expected = reference(document, foundation, schemas);
  assert.equal(
    hot.estimate(document, foundation, schemas),
    expected,
    "warm/shared-node bound differs from canonical reference",
  );
  assert.equal(
    new CanvasStorageBudget().estimate(document, foundation, schemas),
    expected,
    "cold bound differs from canonical reference",
  );
  return expected;
}
function registry(assets = []) {
  return f.createSchemas([
    {
      id: "budget-probe@1",
      validate: f.json,
      references: () => [],
      assets: () => assets,
      project: (body) => ({ type: "budget", value: body }),
    },
  ]);
}
const schemas = registry();
function documentFor(bodies, installed = schemas) {
  return f.prepare(
    f.empty("budget-document"),
    "budget-root",
    bodies.map((body, i) => ({
      kind: "create",
      item: "item-" + i,
      label: "Value",
      revision: {
        item: "item-" + i,
        id: "revision-" + i,
        schema: "budget-probe@1",
        required: true,
        body,
      },
    })),
    installed,
  ).document;
}
// Seeded JSON exercises key order, numeric keys, shared nodes, null prototypes and UTF-8 escaping.
let seed = 0x13579a;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed >>> 8;
};
const scalar = [
  null,
  true,
  false,
  -0,
  1e-9,
  1e21,
  Number.MAX_VALUE,
  Number.MIN_VALUE,
  "",
  "😀汉字",
  "\ud800",
  "\udfff",
  '"\\\b\t\n\f\r\u0000\u2028\u2029',
];
const keys = [
  "z",
  "a",
  "10",
  "2",
  "",
  "__proto__",
  "constructor",
  "toJSON",
  '"\\\n',
  "😀",
  "\ud800",
];
function value(depth = 0) {
  if (depth === 4 || random() % 3 === 0)
    return scalar[random() % scalar.length];
  if (random() % 2)
    return Array.from({ length: random() % 5 }, () => value(depth + 1));
  const out = random() % 2 ? {} : Object.create(null);
  for (let i = 0, count = random() % 6; i < count; i++)
    Object.defineProperty(out, keys[random() % keys.length], {
      value: value(depth + 1),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  return out;
}
const shared = { text: 'quote" and emoji 😀' },
  bodies = [
    ...scalar,
    { second: shared, first: shared },
    { toJSON: "ordinary data", 10: "ten", 2: "two" },
    ...Array.from({ length: 1000 }, () => value()),
  ];
const document = documentFor(bodies),
  hot = new CanvasStorageBudget();
const referenceSize = compare(document, undefined, schemas, hot);
// Clone boundaries normalize null prototypes; also check a valid raw JSON projection directly.
const nil = Object.create(null);
Object.defineProperty(nil, "__proto__", {
  value: ["😀", "\ud800", -0],
  enumerable: true,
});
nil["2"] = true;
nil.a = { toJSON: "not executable" };
const nilRevision = document.revisions.get("revision-0");
compare(
  {
    ...document,
    revisions: document.revisions.set(
      nilRevision.id,
      f.freeze({ ...nilRevision, body: nil }),
    ),
  },
  undefined,
  schemas,
);
// Warm estimates must still reuse the unchanged maps, not reserialize the full graph.
const stringify = JSON.stringify;
let serializations = 0;
JSON.stringify = function (...args) {
  serializations++;
  return stringify.apply(this, args);
};
try {
  hot.estimate(document, undefined, schemas);
  assert.equal(serializations, 0);
} finally {
  JSON.stringify = stringify;
}

// Cold accounting must stringify the original revision values, with no sorted/rebuilt JSON tree.
const roots = new Set([...document.revisions.entries()].map(([, r]) => r)),
  observed = new Set();
const sort = Array.prototype.sort;
JSON.stringify = function (value, ...args) {
  if (roots.has(value)) observed.add(value);
  return stringify.call(this, value, ...args);
};
Array.prototype.sort = function () {
  throw Error("byte accounting sorted keys");
};
try {
  assert.equal(
    new CanvasStorageBudget().estimate(document, undefined, schemas),
    referenceSize,
  );
} finally {
  JSON.stringify = stringify;
  Array.prototype.sort = sort;
}
assert.equal(
  observed.size,
  roots.size,
  "accounting must not rebuild revision values before serialization",
);

// Check real authored views, retained revisions, transformations, Undo and checked receipts.
const drawing = drawingFixture(100),
  drawingBudget = new CanvasStorageBudget();
const checkDrawing = () => {
  const c = drawing.session.capture();
  compare(c.document, c.foundation, canvasSchemas, drawingBudget);
};
checkDrawing();
const entries = drawings(drawing.session.document);
editDrawings(
  drawing.session,
  drawingGeometry(entries).transform(
    new Set(drawing.ids),
    { x: 0, y: 0 },
    true,
  )({ x: 12, y: 8 }),
);
checkDrawing();
drawing.session.undo();
checkDrawing();
drawing.session.redo();
checkDrawing();
drawing.session.dispose();
const checked = await sceneFixture(3, true),
  capture = checked.session.capture();
assert(capture.foundation.receipts.size > 0);
compare(capture.document, capture.foundation, canvasSchemas);
checked.session.dispose();

// Kept selections exercise the alternative/context projection without application-specific renderers.
const w = f.createWorkspace(
  {
    document: documentFor([{ baseline: 1 }]),
    receipts: [],
    resources: { read: () => ({ status: "unavailable", reason: "No assets" }) },
  },
  { schemas, namespace: "budget-owner" },
);
const target = f.reference(w.reader.read().document, "item-0");
const preview = w.owner.preview(w.reader.stamp(), target, [
  {
    item: "item-0",
    revision: {
      item: "item-0",
      id: "preview-revision",
      schema: "budget-probe@1",
      required: true,
      body: { alternative: "😀" },
    },
  },
]);
assert(preview.ok, preview.error);
const keep = w.owner.keep(w.reader.stamp(), "kept-root", "kept", "Kept", {
  id: "kept-view",
  reference: target,
  renderer: "budget-view",
  x: 10,
  y: 20,
  alternative: "kept",
});
assert(keep.ok, keep.error);
compare(w.reader.read(), w.reader.capture(), schemas);
w.owner.dispose();

// Asset expansion, linked exclusions and exact admission boundary; no large source allocation or live adoption.
const asset = (size, disposition = "included") => ({
  digest: "sha256:" + (disposition === "included" ? "a" : "b").repeat(64),
  size,
  disposition,
  mediaType: "text/plain",
});
let boundary;
for (let padding = 0; padding < 6; padding++) {
  const doc = documentFor([{ pad: "x".repeat(padding) }]);
  const base = reference(doc, undefined, registry([asset(0)]));
  if ((MAX_CANVAS_LOCAL_BYTES - base) % 6 === 0) {
    boundary = { doc, size: (MAX_CANVAS_LOCAL_BYTES - base) / 6 };
    break;
  }
}
assert(boundary);
for (const offset of [-1, 0, 1]) {
  const installed = registry([
    asset(boundary.size + offset),
    asset(123, "linked"),
  ]);
  const budget = new CanvasStorageBudget(),
    state = { document: boundary.doc, receipts: f.SharedMap.empty() };
  const expected = compare(state.document, state, installed, budget);
  assert.equal(expected, MAX_CANVAS_LOCAL_BYTES + offset * 6);
  if (offset > 0)
    assert.throws(() => budget.check(state, installed), /recovery budget/);
  else assert.equal(budget.check(state, installed), expected);
}

// Strict JSON failures must occur before stringify can silently drop/convert invalid values.
let invoked = false;
const cycle = {};
cycle.self = cycle;
const decorated = [1];
decorated.extra = 2;
const hidden = {};
Object.defineProperty(hidden, "hidden", { value: 1 });
const malformed = [
  undefined,
  NaN,
  Infinity,
  1n,
  () => 1,
  new Date(),
  Object.create({ inherited: 1 }),
  { [Symbol("x")]: 1 },
  Array(2),
  decorated,
  hidden,
  cycle,
  {
    toJSON() {
      invoked = true;
      return "serialized hook";
    },
  },
  {
    get x() {
      invoked = true;
      return 1;
    },
  },
];
let deep = 1;
for (let i = 0; i < 129; i++) deep = { next: deep };
malformed.push(deep);
const base = documentFor([{}]),
  original = base.revisions.get("revision-0");
for (const body of malformed) {
  const bad = {
    ...base,
    revisions: base.revisions.set(original.id, { ...original, body }),
  };
  assert.throws(() => reference(bad, undefined, schemas));
  assert.throws(() =>
    new CanvasStorageBudget().estimate(bad, undefined, schemas),
  );
}
assert.equal(invoked, false);
console.log(
  "Storage budget: canonical-reference equality for seeded JSON, real revisions/views/receipts/kept contexts, warm reuse, assets, exact limits and strict malformed-data rejection pass.",
);
