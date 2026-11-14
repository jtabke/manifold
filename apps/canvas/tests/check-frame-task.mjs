import assert from "node:assert/strict";
import { createFrameTask } from "../src/regions/interaction/frameTask.ts";

const frames = new Map();
let next = 0;
const clock = {
  request(callback) {
    frames.set(++next, callback);
    return next;
  },
  cancel(handle) {
    frames.delete(handle);
  },
};
const values = [];
const task = createFrameTask((value) => values.push(value), clock);
for (let i = 0; i < 100; i++) task.schedule(i);
assert.equal(frames.size, 1, "an input burst requests only one display frame");
assert.deepEqual(values, []);
[...frames.values()][0](0);
assert.deepEqual(values, [99], "the display uses the newest input");
assert.equal(frames.size, 0);
task.schedule("final pointer position");
task.flush();
assert.deepEqual(values, [99, "final pointer position"]);
assert.equal(frames.size, 0, "release flushes and removes the queued frame");
task.flush();
assert.equal(values.length, 2, "flushing twice never repeats a completion");
task.schedule("cancelled preview");
task.cancel();
assert.equal(frames.size, 0);
task.flush();
assert.equal(values.length, 2, "cancel/unmount must not resurrect a preview");
task.schedule(undefined);
task.flush();
assert.equal(values.length, 3, "undefined is a valid scheduled value");

const reentrant = createFrameTask((value) => {
  values.push(value);
  if (value === "first") reentrant.schedule("next frame");
}, clock);
reentrant.schedule("first");
reentrant.flush();
assert.equal(frames.size, 1, "an apply may schedule a subsequent frame");
reentrant.flush();
assert.equal(values.at(-1), "next frame");
assert.equal(frames.size, 0);
console.log(
  "Frame tasks: latest-input coalescing, final flush, cancellation and reentrant scheduling pass.",
);
