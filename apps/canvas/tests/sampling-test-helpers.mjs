/** Test transport injection happens at host construction; only the real core compute path admits results. */
import * as f from "@manifold/foundation";
import { RegionSession, project } from "../src/regions/document.ts";
import { calculate } from "../src/notebook/math.ts";
import {
  samplingJob,
  samplingReference,
} from "../src/regions/samplingPlans.ts";
import { sourceHash } from "../src/regions/samplingExecution.ts";
import { validArtifactReceipt } from "../src/regions/artifactRecords.ts";
const ports = new WeakMap();
export async function sampleOutput(job) {
  const key = JSON.parse(job.key),
    input = key[5],
    output = key[6],
    low = key[7],
    high = key[8],
    page = {
      regions: job.definitions,
      contexts: [{ id: job.context, label: "Test", base: {}, overrides: {} }],
      active: job.context,
      links: job.dependencies,
      plots: [],
      layout: {},
      origin: { x: 0, y: 0 },
    },
    p = project(page),
    x = p.statements.get(input).name,
    y = p.statements.get(output).name,
    q = p.solved.values.get(x),
    points = [low, high].map((value) => {
      const result = calculate(
        job.definitions.map((r) => ({ ...r, x: 0, y: 0 })),
        { [x]: { ...q, value } },
      ).values.get(y);
      return [value, result.absolute ? result.value - 273.15 : result.value];
    });
  return {
    points,
    code_sha256: await sourceHash(job.code),
    runtime: {
      adapter: job.definitions.some((r) => r.mathVersion === 2)
        ? "bounded-python-sampler/2"
        : "bounded-python-sampler/1",
      python: "test",
    },
  };
}
export function testSession(...args) {
  let next;
  const supplied = args[6] ?? {};
  args[6] = {
    ...supplied,
    artifactExecutor:
      supplied.artifactExecutor === undefined
        ? async (job) => {
            if (next !== undefined) {
              const data = next;
              next = undefined;
              return data;
            }
            return sampleOutput(job);
          }
        : supplied.artifactExecutor,
  };
  const session = new RegionSession(...args);
  ports.set(session, (value) => {
    next = value;
  });
  return session;
}
export async function deliver(session, artifact, receipt) {
  if (
    !validArtifactReceipt(receipt) ||
    !session.artifacts.some((a) => a.id === artifact) ||
    !session.state.contexts.some((c) => c.id === receipt.context)
  )
    return false;
  let job;
  try {
    job = samplingJob(session.document, artifact, receipt.context);
  } catch {
    return false;
  }
  if (receipt.snapshot !== 2 || receipt.key !== job.key) return false;
  const set = ports.get(session);
  if (!set)
    throw Error("Construct the test session with its transport adapter");
  set({
    points: receipt.points,
    code_sha256: receipt.code_sha256,
    runtime: receipt.runtime,
  });
  const task = session.compute(
      samplingReference(session.document, artifact, receipt.context),
    ),
    result = await task.completion;
  return (
    session.state.contexts.some((c) => c.id === receipt.context) &&
    result.status === "retained" &&
    result.receipt.outcome.status === "success" &&
    session.foundation.result(
      samplingReference(session.document, artifact, receipt.context),
    ).status === "current"
  );
}
export const evidence = (session) => session.capture().foundation.receipts;
export const recovery = (session) => ({
  foundation: {
    document: session.document,
    receipts: [...session.foundation.evidence().entries()].map(
      ([, receipt]) => receipt,
    ),
    resources: session.foundation.resources(),
  },
});
