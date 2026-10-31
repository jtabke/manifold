import assert from "node:assert/strict";
import { regularizeStroke } from "../src/regions/drawingRegularization.ts";
import { RegionSession } from "../src/regions/document.ts";
import {
  createDrawing,
  drawings,
  editDrawings,
  validateMark,
} from "../src/regions/drawing.ts";
import { archive } from "../src/regions/artifacts.ts";
import { stageWorkspaceFile } from "../src/regions/app/workspaceFiles.ts";
const p = (x, y, pressure = 0.7) => ({ x, y, pressure });
const pen = (points) => ({
  kind: "pen",
  points,
  color: "#aabbcc",
  width: 3,
  text: "",
  start: null,
  end: null,
});
const circle = (radius = 60, laps = 1, squash = 1) =>
  Array.from({ length: 129 }, (_, i) => {
    const a = (i / 128) * Math.PI * 2 * laps,
      noise = 1.2 * Math.sin(a * 5);
    return p(
      200 + (radius + noise) * Math.cos(a),
      180 + (radius + noise) * Math.sin(a) * squash,
    );
  });
const line = pen(
  Array.from({ length: 80 }, (_, i) => p(100 + i * 2, 200 + Math.sin(i / 7))),
);
const rectangle = pen([
  p(80, 80),
  p(240, 80),
  p(240, 180),
  p(80, 180),
  p(80, 80),
]);
for (const [original, kind] of [
  [line, "line"],
  [pen(circle()), "ellipse"],
  [rectangle, "rectangle"],
]) {
  const before = JSON.stringify(original),
    clean = regularizeStroke(original);
  assert.equal(clean?.kind, kind);
  validateMark(clean);
  assert.equal(clean.color, original.color);
  assert.equal(clean.width, original.width);
  assert.equal(clean.points.length, 2);
  assert.equal(clean.start, null);
  assert.equal(clean.end, null);
  assert.equal(
    JSON.stringify(original),
    before,
    "recognition must not mutate authored ink",
  );
  assert(!original.points.includes(clean.points[0]));
  const frozen = Object.freeze({
    ...original,
    points: Object.freeze(original.points.map(Object.freeze)),
  });
  assert.deepEqual(regularizeStroke(frozen), clean);
  if (kind === "ellipse")
    assert(
      Math.abs(
        clean.points[1].x -
          clean.points[0].x -
          (clean.points[1].y - clean.points[0].y),
      ) < 1e-10,
    );
}
for (const mark of [
  pen([p(1, 1)]),
  pen([p(1, 1), p(1, 1)]),
  pen(circle(5)),
  pen(circle(60, 2)),
  pen(circle(60, 1, 0.5)),
  pen(circle().slice(0, 90)),
  pen([p(0, 0), p(80, 120), p(160, 0), p(0, 0)]),
  pen([p(0, 0), p(200, 0), p(180, 20), p(200, 0), p(180, -20)]),
  pen([p(0, 0), p(200, 0), p(0, 0), p(200, 0)]),
  pen([p(100, 0), p(200, 100), p(100, 200), p(0, 100), p(100, 0)]),
  { ...line, kind: "highlighter" },
  { ...rectangle, kind: "rectangle", points: [p(80, 80), p(240, 180)] },
  pen([p(NaN, 0), p(100, 0)]),
  pen(Array.from({ length: 8193 }, () => p(1, 1))),
])
  assert.equal(
    regularizeStroke(mark),
    undefined,
    JSON.stringify(mark).slice(0, 100),
  );
for (const zoom of [0, -1, NaN, Infinity])
  assert.equal(regularizeStroke(line, zoom), undefined);
assert.equal(regularizeStroke(pen([p(0, 0), p(20, 0)])), undefined);
assert.equal(regularizeStroke(pen([p(0, 0), p(20, 0)]), 2)?.kind, "line");
const roughBox = [];
for (const [a, b] of [
  [
    [80, 80],
    [240, 80],
  ],
  [
    [240, 80],
    [240, 180],
  ],
  [
    [240, 180],
    [80, 180],
  ],
  [
    [80, 180],
    [80, 80],
  ],
])
  for (let i = 0; i < 24; i++) {
    const t = i / 24,
      wobble = 1.8 * Math.sin(i * 1.7);
    roughBox.push(
      p(
        a[0] + (b[0] - a[0]) * t + (a[0] === b[0] ? wobble : 0),
        a[1] + (b[1] - a[1]) * t + (a[1] === b[1] ? wobble : 0),
      ),
    );
  }
roughBox.push(roughBox[0]);
assert.equal(regularizeStroke(pen(roughBox))?.kind, "rectangle");
const nearLimit = pen(
  Array.from({ length: 129 }, (_, i) => {
    const a = (i / 128) * Math.PI * 2;
    return p(999942 + 58 * Math.cos(a), 180 + 60 * Math.sin(a));
  }),
);
assert(nearLimit.points.every((point) => point.x <= 1_000_000));
assert.equal(
  regularizeStroke(nearLimit),
  undefined,
  "a fitted shape may not exceed portable coordinate limits",
);
// Density and pauses must not dominate geometry or confuse a four-segment diamond with a circle.
const dense = pen(
  circle().flatMap((point, i) => Array(i < 30 ? 25 : 1).fill(point)),
);
assert.equal(regularizeStroke(dense)?.kind, "ellipse");
const session = new RegionSession();
const id = createDrawing(session, line),
  raw = drawings(session.document).find((e) => e.id === id);
const acceptedRaw = session.document;
editDrawings(
  session,
  [{ entry: raw, mark: regularizeStroke(raw.mark) }],
  acceptedRaw,
);
assert.equal(drawings(session.document)[0].mark.kind, "line");
const saved = await stageWorkspaceFile(archive(session.native()));
assert.equal(
  drawings(saved.document)[0].mark.kind,
  "line",
  "existing native format retains the fitted shape",
);
session.undo();
assert.deepEqual(
  drawings(session.document)[0].mark,
  line,
  "one Undo restores exact original points and pressure",
);
session.redo();
assert.equal(drawings(session.document)[0].mark.kind, "line");
session.undo();
session.undo();
assert.equal(drawings(session.document).length, 0);
assert.throws(
  () =>
    editDrawings(
      session,
      [{ entry: raw, mark: regularizeStroke(raw.mark) }],
      acceptedRaw,
    ),
  /changed/,
);
console.log(
  "Pen regularization: conservative line/circle/rectangle fits, ambiguity rejection, density/zoom, immutable ink, native format, Undo/Redo and stale edit guards passed.",
);
