/** Fresh-process consumer: no executor is installed or invoked during native Open. */
import { readFile } from "node:fs/promises";
import * as f from "../src/index.ts";
import * as d from "./typed-fixture.mjs";
const loaded = await f.decode(
    await readFile(process.argv[2], "utf8"),
    d.schemas,
    d.methods,
    f.webHash,
  ),
  workspace = d.workspace(loaded, {
    executor: undefined,
    typedExecutor: undefined,
  }),
  state = workspace.reader.result(d.ref("scaled"));
if (state.status !== "current")
  throw Error("Retained geometry was not current: " + state.status);
const read = workspace.reader
  .resources()
  .read(state.receipt.outcome.output.body.asset);
if (read.status !== "ready") throw Error("Retained geometry bytes unavailable");
console.log(
  JSON.stringify({
    status: state.status,
    output: JSON.parse(read.data),
    receipts: workspace.reader.evidence().size,
    jobs: workspace.diagnostics().activeJobs,
  }),
);
workspace.owner.dispose();
