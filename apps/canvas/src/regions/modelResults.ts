/** General model outputs lower to the existing typed request/receipt protocol. */
import * as f from "@manifold/foundation";
export const MODEL_OUTPUT_REQUEST = "canvas-model-outputs-request@1";
export const modelOutputsMethodRef = {
  id: "manifold.model-outputs",
  version: "1",
  runtime: "manifold-native-models@1",
};
export type ModelOutputsRequest = Readonly<{
  instance: f.Reference;
  outputs: readonly string[];
}>;
export function modelOutputsRequest(
  body: unknown,
): asserts body is ModelOutputsRequest {
  f.assert(f.object(body), "Invalid model output request");
  f.fields(body, ["instance", "outputs"]);
  f.validateReference(body.instance);
  f.assert(
    body.instance.selection.kind === "follow" &&
      f.canonical(body.instance.selector) === f.canonical(f.wholeSelector),
    "Model outputs need a whole followed instance",
  );
  f.assert(
    Array.isArray(body.outputs) &&
      body.outputs.length > 0 &&
      body.outputs.length <= 32 &&
      new Set(body.outputs).size === body.outputs.length,
    "Invalid model output interface",
  );
  for (const output of body.outputs) {
    f.assert(typeof output === "string", "Invalid output ID");
    f.modelPort(output);
  }
}
function values(body: unknown) {
  f.assert(
    f.object(body) &&
      Object.keys(body).length > 0 &&
      Object.keys(body).length <= 32,
    "Invalid model output values",
  );
  for (const [port, value] of Object.entries(body)) {
    f.modelPort(port);
    f.scalar(value);
  }
}
const outputRef = (body: ModelOutputsRequest, port: string) => ({
  ...body.instance,
  selector: f.modelPort(port),
});
export const modelOutputsSchema: f.Schema = {
  id: MODEL_OUTPUT_REQUEST,
  validate: modelOutputsRequest,
  references(body) {
    modelOutputsRequest(body);
    return [
      body.instance,
      ...body.outputs.map((port) => outputRef(body, port)),
    ];
  },
  assets: () => [],
  project(body, selector, _resources, _revision, reader) {
    modelOutputsRequest(body);
    if (f.canonical(selector) !== f.canonical(f.wholeSelector))
      return {
        status: "unsupported",
        reason: "Inspect the whole model output request",
      };
    const result: Record<string, f.Json> = Object.create(null);
    for (const port of body.outputs) {
      const got = reader.read(outputRef(body, port));
      if (got.status !== "resolved") return got;
      f.assert(got.projection.type === "scalar", "Model output must be scalar");
      f.scalar(got.projection.value);
      result[port] = got.projection.value;
    }
    return {
      type: "typed-request@1",
      value: {
        method: modelOutputsMethodRef,
        input: { schema: "canvas-model-values@1", body: result },
        output: "canvas-model-values@1",
      },
    };
  },
};
export const modelOutputsMethod: f.TypedMethod = {
  requirements: modelOutputsMethodRef,
  input: "canvas-model-values@1",
  output: "canvas-model-values@1",
  limits: { inputBytes: 32 * 1024, outputBytes: 32 * 1024 },
  validateInput: values,
  validateOutput(input, output) {
    values(output);
    f.assert(
      f.canonical(input) === f.canonical(output as f.Json),
      "Checked model outputs differ from captured values",
    );
    return output as f.Json;
  },
};
export const modelOutputsExecutor: f.TypedExecutor = async (
  snapshot,
  signal,
) => {
  f.assert(
    !signal.aborted &&
      f.methodKey(snapshot.method) === f.methodKey(modelOutputsMethodRef),
    "Model executor unavailable or cancelled",
  );
  return snapshot.input.body;
};
