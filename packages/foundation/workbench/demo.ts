/** Example engineering methods live outside the document/storage core. */
import {
  createSchemas,
  createMethods,
  reference,
  wholeSelector,
  asset,
  MemoryResources,
  empty,
  prepare,
  freeze,
  type Hash,
  type MethodRef,
  type Snapshot,
  type Scalar,
  type Revision,
  type Command,
} from "../src/index.ts";
export const schemas = createSchemas();
export const pressureMethod: MethodRef = freeze({
  id: "average-pressure",
  version: "1",
  runtime: "scalar-js@1",
});
export const forceMethod: MethodRef = freeze({
  id: "required-force",
  version: "1",
  runtime: "scalar-js@1",
});
export const methods = createMethods([
  {
    requirements: pressureMethod,
    inputs: { force: "N", area: "mm2" },
    output: "MPa",
    validateDomain(inputs) {
      if (inputs.area!.value <= 0) throw Error("Area must be positive");
    },
  },
  {
    requirements: forceMethod,
    inputs: { pressure: "MPa", area: "mm2" },
    output: "N",
    validateDomain(inputs) {
      if (inputs.area!.value <= 0) throw Error("Area must be positive");
    },
  },
]);
export const meta = freeze({
  subject: "specimen-A",
  frame: "axial",
  condition: "load-case-A",
});
export const ref = (item: string) => reference("foundation-demo", item);
export const revision = (
  id: string,
  item: string,
  schema: string,
  body: Revision["body"],
): Revision => ({ id, item, schema, required: true, body });
export function calculate(s: Snapshot): Scalar {
  const x = (slot: string) => s.inputs[slot]!.scalar.value;
  return {
    value:
      s.method.id === pressureMethod.id
        ? x("force") / x("area")
        : x("pressure") * x("area"),
    unit: s.output,
    subject: s.subject,
    frame: s.frame,
    condition: s.condition,
  };
}
export function areaRef(id = "area-r1") {
  return {
    ...ref("area"),
    selector: { kind: "cell", version: 1, revision: id, row: 0, column: 0 },
  };
}
export async function demo(hash: Hash) {
  const bytes = JSON.stringify([[2500]]),
    a = await asset(bytes, hash),
    resources = await MemoryResources.verify([[a.digest, bytes]], hash);
  const commands: Command[] = [
    {
      kind: "create",
      item: "draft",
      label: "Unfinished thought",
      revision: revision("draft-r1", "draft", "note@1", {
        text: "F =",
        mode: "draft",
      }),
    },
    {
      kind: "create",
      item: "force",
      label: "Applied force",
      revision: revision("force-r1", "force", "scalar@1", {
        value: 100,
        unit: "N",
        ...meta,
      }),
    },
    {
      kind: "create",
      item: "observation",
      label: "Measured force",
      revision: revision("observation-r1", "observation", "scalar@1", {
        value: 130,
        unit: "N",
        ...meta,
      }),
    },
    {
      kind: "create",
      item: "target-pressure",
      label: "Target pressure",
      revision: revision("target-pressure-r1", "target-pressure", "scalar@1", {
        value: 0.08,
        unit: "MPa",
        ...meta,
      }),
    },
    {
      kind: "create",
      item: "area",
      label: "Imported area source",
      revision: revision("area-r1", "area", "source@1", {
        asset: a,
        rows: 1,
        columns: 1,
        interpretation: [{ unit: "mm2", ...meta }],
      }),
    },
    {
      kind: "create",
      item: "pressure",
      label: "Average pressure",
      revision: revision("pressure-r1", "pressure", "request@1", {
        method: pressureMethod,
        inputs: { force: ref("force"), area: areaRef() },
        output: "MPa",
        ...meta,
      }),
    },
    {
      kind: "create",
      item: "required-force",
      label: "Required force",
      revision: revision("required-force-r1", "required-force", "request@1", {
        method: forceMethod,
        inputs: { pressure: ref("target-pressure"), area: areaRef() },
        output: "N",
        ...meta,
      }),
    },
    {
      kind: "view",
      view: {
        id: "draft-view",
        reference: ref("draft"),
        renderer: "note@1",
        x: 40,
        y: 40,
        alternative: null,
      },
    },
    {
      kind: "view",
      view: {
        id: "pressure-view",
        reference: ref("pressure"),
        renderer: "result@1",
        x: 400,
        y: 40,
        alternative: null,
      },
    },
  ];
  return {
    document: prepare(empty("foundation-demo"), "demo-root", commands, schemas)
      .document,
    receipts: [],
    resources,
  };
}
export { wholeSelector };
