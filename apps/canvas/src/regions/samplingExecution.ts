/** Installed sampler adapter. The core owns captures, jobs, evidence and output resources. */
import * as f from "@manifold/foundation";
import {
  acceptCapturedData,
  samplingKey,
  type Artifact,
  type Job,
  type Data,
} from "./artifacts.ts";
import { validArtifactReceipt } from "./artifactRecords.ts";
import type { ArtifactExecutor, ArtifactJob } from "./artifactComputations.ts";
export const sourceHash = async (code: string) =>
  (await f.webHash(code)).slice(7);
const byteLength = f.byteLength;
const MAX_TRANSPORT_BYTES = 64 * 1024;
/** The transport receives only code/scalar inputs, never the workspace or source files. */
export const samplerExecutor: ArtifactExecutor = async (job, signal) => {
  const body = JSON.stringify({
    code: job.code,
    inputs: job.inputs,
    ...(job.definitions.some((r) => r.mathVersion === 2)
      ? { mathVersion: 2 }
      : {}),
  });
  if (byteLength(body) > MAX_TRANSPORT_BYTES)
    throw Error("Sampler input budget exceeded");
  const response = await fetch("/api/artifact-sample", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal,
  });
  const reader = response.body?.getReader();
  let text: string;
  if (reader) {
    const bytes = new Uint8Array(MAX_TRANSPORT_BYTES);
    let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > MAX_TRANSPORT_BYTES)
          throw Error("Sampler output budget exceeded");
        bytes.set(part.value, size - part.value.byteLength);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
    text = new TextDecoder().decode(bytes.subarray(0, size));
  } else {
    text = await response.text();
    if (byteLength(text) > MAX_TRANSPORT_BYTES)
      throw Error("Sampler output budget exceeded");
  }
  const data = JSON.parse(text);
  if (!response.ok)
    throw Error(
      String(data.error || "Python execution failed.").slice(0, 2000),
    );
  return data;
};

export type SamplingInput = Readonly<{
  artifact: string;
  request: Pick<Artifact, "input" | "output" | "low" | "high">;
  capture: Omit<Job, "key" | "legacy">;
}>;
export type SamplingOutput = Readonly<{
  points: Data["points"];
  runtime: Data["runtime"];
  source: f.Asset;
}>;
export const samplingMethodRef = Object.freeze({
  id: "manifold.worksheet-sampler",
  version: "1",
  runtime: "bounded-python-sampler/1",
});
export const scientificSamplingMethodRef = Object.freeze({
  id: samplingMethodRef.id,
  version: "2",
  runtime: "manifold-scientific-sampler@2",
});
const isSamplingMethod = (method: Parameters<typeof f.methodKey>[0]) =>
  [samplingMethodRef, scientificSamplingMethodRef].some(
    (ref) => f.methodKey(method) === f.methodKey(ref),
  );
const json = (value: unknown) => value as f.Json;
const jobs = new WeakMap<object, ArtifactJob>(),
  receipts = new WeakMap<object, NonNullable<Artifact["receipt"]>>();
export function samplingInput(value: unknown): asserts value is SamplingInput {
  f.assert(f.object(value), "Invalid sampling invocation");
  f.fields(value, ["artifact", "request", "capture"]);
  f.identity(value.artifact);
  f.assert(
    f.object(value.request) && f.object(value.capture),
    "Missing sampling request/capture",
  );
  f.fields(value.request, ["input", "output", "low", "high"]);
  f.identity(value.request.input);
  f.identity(value.request.output);
  f.assert(
    typeof value.request.low === "number" &&
      typeof value.request.high === "number" &&
      Number.isFinite(value.request.low + value.request.high) &&
      value.request.low < value.request.high,
    "Invalid captured sampling range",
  );
  f.fields(value.capture, [
    "code",
    "inputs",
    "context",
    "definitions",
    "bindings",
    "snapshot",
    "dependencies",
    "sources",
  ]);
  f.assert(
    validArtifactReceipt({
      ...value.capture,
      key: "validation",
      time: "2000-01-01T00:00:00.000Z",
      points: [
        [0, 0],
        [1, 1],
      ],
      code_sha256: "0".repeat(64),
      runtime: { adapter: samplingMethodRef.runtime, python: "validation" },
    }) && value.capture.snapshot === 2,
    "Invalid closed sampling capture",
  );
}
export function jobFromSamplingInput(value: SamplingInput): ArtifactJob {
  const prior = jobs.get(value);
  if (prior) return prior;
  const job = f.retained(
    json({ ...value.capture, key: samplingKey(value.request, value.capture) }),
  ) as unknown as ArtifactJob;
  if (f.deeplyFrozen(value)) jobs.set(value, job);
  return job;
}
export function samplingInvocation(input: SamplingInput): f.TypedRequest {
  return {
    method: input.capture.definitions.some((r) => r.mathVersion === 2)
      ? scientificSamplingMethodRef
      : samplingMethodRef,
    input: { schema: "canvas-sampling-input@1", body: json(input) },
    output: "canvas-sampled-points@1",
  };
}
export function outputFromSamplingData(
  input: SamplingInput,
  value: unknown,
): SamplingOutput {
  f.assert(f.object(value), "Missing sampler output");
  f.fields(value, ["points", "code_sha256", "runtime"]);
  f.assert(
    typeof value.code_sha256 === "string",
    "Missing sampler source digest",
  );
  return {
    points: value.points as Data["points"],
    runtime: value.runtime as Data["runtime"],
    source: {
      digest: "sha256:" + value.code_sha256,
      size: f.byteLength(input.capture.code),
      mediaType: "text/x-python",
      disposition: "included",
    },
  };
}
const baseSamplingMethod: f.TypedMethod = {
  requirements: samplingMethodRef,
  input: "canvas-sampling-input@1",
  output: "canvas-sampled-points@1",
  limits: { inputBytes: 0, outputBytes: 16 * 1024 },
  validateInput: samplingInput,
  validateOutput(input, raw) {
    samplingInput(input);
    f.assert(f.object(raw), "Invalid sampler output");
    f.fields(raw, ["points", "runtime", "source"]);
    f.validateAsset(raw.source);
    const source = raw.source;
    f.assert(
      source.mediaType === "text/x-python" &&
        source.disposition === "included" &&
        source.size === f.byteLength(input.capture.code),
      "Invalid sampler code descriptor",
    );
    const job = jobFromSamplingInput(input),
      artifact = { ...input.request, id: input.artifact } as Artifact,
      checked = acceptCapturedData(artifact, job as Omit<Job, "legacy">, {
        points: raw.points,
        runtime: raw.runtime,
        code_sha256: source.digest.slice(7),
      }).receipt!;
    f.assert(
      validArtifactReceipt(checked),
      "Unsupported checked sampling output",
    );
    return json({ points: checked.points, runtime: checked.runtime, source });
  },
  assets(value, role) {
    return role === "output"
      ? [(value as unknown as SamplingOutput).source]
      : [];
  },
  validateOutputResources(input, output, resources) {
    samplingInput(input);
    const result = output as unknown as SamplingOutput,
      read = resources.read(result.source);
    f.assert(
      read.status === "ready" && read.data === input.capture.code,
      "Python source identity did not match",
    );
  },
};
function versionedSamplingMethod(scientific: boolean): f.TypedMethod {
  const validate = (input: f.Json) => {
    samplingInput(input);
    f.assert(
      input.capture.definitions.some((r) => r.mathVersion === 2) === scientific,
      "Sampler mathematics version differs from its method",
    );
  };
  return {
    ...baseSamplingMethod,
    requirements: scientific ? scientificSamplingMethodRef : samplingMethodRef,
    validateInput: validate,
    validateOutput(input, raw) {
      validate(input);
      return baseSamplingMethod.validateOutput(input, raw);
    },
  };
}
export const samplingMethod = versionedSamplingMethod(false);
export const scientificSamplingMethod = versionedSamplingMethod(true);
export function samplingExecutor(
  execute: ArtifactExecutor | null = samplerExecutor,
): f.TypedExecutor | undefined {
  if (!execute) return undefined;
  return async (snapshot, signal, io) => {
    f.assert(isSamplingMethod(snapshot.method), "Unsupported sampler method");
    samplingInput(snapshot.input.body);
    const input = snapshot.input.body,
      result = outputFromSamplingData(
        input,
        await execute(jobFromSamplingInput(input), signal),
      );
    await io.stage(result.source, input.capture.code);
    return result;
  };
}
export function samplingReceipt(
  receipt: f.Receipt,
): NonNullable<Artifact["receipt"]> | undefined {
  if (
    receipt.kind !== "typed@1" ||
    !isSamplingMethod(receipt.snapshot.method) ||
    receipt.outcome.status !== "success"
  )
    return undefined;
  const prior = receipts.get(receipt);
  if (prior) return prior;
  const input = receipt.snapshot.input.body as unknown as SamplingInput,
    job = jobFromSamplingInput(input),
    output = receipt.outcome.output.body as unknown as SamplingOutput;
  const value = f.retained(
    json({
      ...job,
      points: output.points,
      runtime: output.runtime,
      code_sha256: output.source.digest.slice(7),
      time: receipt.time,
    }),
  ) as unknown as NonNullable<Artifact["receipt"]>;
  receipts.set(receipt, value);
  return value;
}
export function samplingArtifact(receipt: f.Receipt) {
  return receipt.kind === "typed@1" && isSamplingMethod(receipt.snapshot.method)
    ? (receipt.snapshot.input.body as unknown as SamplingInput).artifact
    : undefined;
}

/** Derived indexes group observations; they never establish result currency. */
export const samplingObservationKey = (artifact: string, context: string) =>
  artifact + "\0" + context;
export function indexSamplingObservation(
  index: Map<string, f.Receipt>,
  receipt: f.Receipt,
) {
  const artifact = samplingArtifact(receipt);
  if (!artifact || receipt.outcome.status !== "success") return;
  const context = (receipt.snapshot as f.TypedSnapshot).input
    .body as unknown as SamplingInput;
  for (const key of [
    artifact,
    samplingObservationKey(artifact, context.capture.context),
  ])
    if (!index.has(key) || index.get(key)!.order < receipt.order)
      index.set(key, receipt);
}
