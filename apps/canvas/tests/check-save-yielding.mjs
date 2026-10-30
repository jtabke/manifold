/** Force synchronous hashing so only deliberate task yields can let the timer edit run. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as f from "@manifold/foundation";
import { canvasLocalStore } from "../src/regions/app/canvasLocalStore.ts";
import { drawings, editDrawings } from "../src/regions/drawing.ts";
import { drawingGeometry } from "../src/regions/drawingGeometry.ts";
import { drawingFixture } from "./drawing-fixture.mjs";
const { session, ids } = drawingFixture(1000),
  backend = f.memoryBackend();
let failNext = false,
  commits = 0;
const store = canvasLocalStore(
  {
    ...backend,
    commit(...args) {
      commits++;
      return backend.commit(...args);
    },
  },
  async (text) => {
    if (failNext) {
      failNext = false;
      throw Error("Injected planning hash failure");
    }
    return "sha256:" + createHash("sha256").update(text).digest("hex");
  },
);
try {
  await store.load();
  await store.save(session);
  const entries = drawings(session.document);
  editDrawings(
    session,
    drawingGeometry(entries).transform(
      new Set(ids),
      { x: 0, y: 0 },
      true,
    )({ x: 12, y: 12 }),
  );
  const capture = session.capture(),
    head = await backend.head(),
    diagnostics = backend.diagnostics(),
    priorCommits = commits;
  let timerRan = false;
  const timer = setTimeout(() => {
    timerRan = true;
    failNext = true;
    const entry = drawings(session.document)[0];
    editDrawings(session, [
      { entry, at: { x: entry.view.x + 1, y: entry.view.y } },
    ]);
  }, 0);
  try {
    await assert.rejects(
      store.save(session, capture),
      /Injected planning hash failure/,
    );
  } finally {
    clearTimeout(timer);
  }
  assert(
    timerRan,
    "a macrotask must run while large save planning is incomplete",
  );
  assert.equal(
    commits,
    priorCommits,
    "failed planning must not enter the atomic backend commit",
  );
  assert.deepEqual(await backend.head(), head);
  assert.deepEqual(backend.diagnostics(), diagnostics);
  assert.equal(session.isSaved, false);
  // A failed planner may still have settling child hashes; none may establish acknowledged reuse.
  const retry = await store.save(session, capture);
  assert.equal(
    retry.current,
    false,
    "saving an older immutable capture must not ACK the timer edit",
  );
  assert.equal(session.isSaved, false);
  const recovered = await store.load();
  assert.deepEqual(drawings(recovered.document), drawings(capture.document));
  assert.equal((await store.save(session)).current, true);
  assert.equal(session.isSaved, true);
  assert.deepEqual(
    drawings((await store.load()).document),
    drawings(session.document),
  );
} finally {
  store.close();
  session.dispose();
}
console.log(
  "Save yielding: macrotask progress with synchronous hashes, pre-commit planning failure, no durable mutation/reuse poisoning, immutable older capture, exact ACK and successful retry/reopen pass.",
);
