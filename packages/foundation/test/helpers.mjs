import { createHash } from "node:crypto";
import {
  demo,
  schemas,
  methods,
  calculate,
  ref,
  meta,
  revision,
} from "../workbench/demo.ts";
import { createWorkspace, current, encode } from "../src/index.ts";
export { schemas, methods, calculate, ref, meta, revision, current };
export const hash = async (text) =>
  "sha256:" + createHash("sha256").update(text).digest("hex");
export const initial = () => demo(hash);
export async function workspace(
  executor = async (s) => calculate(s),
  loaded = awaitable,
  options = {},
) {
  const data = loaded === awaitable ? await initial() : loaded;
  return createWorkspace(data, {
    schemas,
    methods,
    executor,
    namespace: "test",
    ...options,
  });
}
const awaitable = Symbol("initial");
let serial = 0;
export const id = (p) => p + ":" + ++serial;
export function apply(w, commands, resources) {
  const r = w.owner.apply(w.reader.stamp(), id("root"), commands, resources);
  if (!r.ok) throw Error(r.error);
  return r.value;
}
export function force(w, value) {
  return apply(w, [
    {
      kind: "revise",
      item: "force",
      revision: revision(id("force"), "force", "scalar@1", {
        value,
        unit: "N",
        ...meta,
      }),
    },
  ]);
}
export function preview(w, value) {
  const r = w.owner.preview(w.reader.stamp(), ref("pressure"), [
    {
      item: "force",
      revision: revision(id("preview-force"), "force", "scalar@1", {
        value,
        unit: "N",
        ...meta,
      }),
    },
  ]);
  if (!r.ok) throw Error(r.error);
  return r.value;
}
export function keep(w, label = "Alternative") {
  const alt = id("alternative"),
    view = id("comparison");
  const r = w.owner.keep(w.reader.stamp(), id("kept-root"), alt, label, {
    id: view,
    reference: ref("pressure"),
    renderer: "result@1",
    x: 500,
    y: 200,
    alternative: alt,
  });
  if (!r.ok) throw Error(r.error);
  return { alternative: alt, view, value: r.value };
}
export function undo(w) {
  const r = w.owner.undo(w.reader.stamp(), id("undo"));
  if (!r.ok) throw Error(r.error);
  return r.value;
}
export async function compute(w, target = ref("pressure"), scope = "baseline") {
  const r = w.owner.compute(w.reader.stamp(), target, scope);
  if (!r.ok) throw Error(r.error);
  return r.value.completion;
}
export const serialized = (w) =>
  encode(
    w.reader.read(),
    [...w.reader.evidence().entries()].map(([, r]) => r),
    w.reader.resources(),
    schemas,
    w.reader.original(),
  );
export function controlled() {
  const calls = [];
  const execute = (snapshot, signal) =>
    new Promise((resolve, reject) =>
      calls.push({ snapshot, signal, resolve, reject }),
    );
  return { calls, execute };
}
