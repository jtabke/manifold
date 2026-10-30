import { createWorkspace, encode } from "../src/index.ts";
import {
  initial,
  schemas,
  methods,
  hash,
  calculate,
  ref,
  meta,
  revision,
} from "./helpers.mjs";
export async function portableFixture() {
  const w = createWorkspace(await initial(), {
    schemas,
    methods,
    namespace: "fixture",
    executor: async (s) => calculate(s),
  });
  const preview = w.owner.preview(w.reader.stamp(), ref("pressure"), [
    {
      item: "force",
      revision: revision("preview-force-r1", "force", "scalar@1", {
        value: 200,
        unit: "N",
        ...meta,
      }),
    },
  ]);
  if (!preview.ok) throw Error(preview.error);
  const keep = w.owner.keep(
    w.reader.stamp(),
    "kept-root",
    "higher-load",
    "Higher load",
    {
      id: "comparison-view",
      reference: ref("pressure"),
      renderer: "result@1",
      x: 500,
      y: 240,
      alternative: "higher-load",
    },
  );
  if (!keep.ok) throw Error(keep.error);
  await w.owner.compute(w.reader.stamp(), ref("pressure"), {
    alternative: "higher-load",
  }).value.completion;
  const change = w.owner.apply(w.reader.stamp(), "baseline-r2", [
    {
      kind: "revise",
      item: "force",
      revision: revision("force-r2", "force", "scalar@1", {
        value: 300,
        unit: "N",
        ...meta,
      }),
    },
  ]);
  if (!change.ok) throw Error(change.error);
  await w.owner.compute(w.reader.stamp(), ref("pressure")).value.completion;
  return encode(
    w.reader.read(),
    [...w.reader.evidence().entries()].map(([, r]) => r),
    w.reader.resources(),
    schemas,
  );
}
