import { readFileSync } from "node:fs";
import { decode, createWorkspace } from "../src/index.ts";
import { schemas, methods, hash, ref } from "./helpers.mjs";
const loaded = await decode(
  readFileSync(process.argv[2], "utf8"),
  schemas,
  methods,
  hash,
);
let executions = 0;
const w = createWorkspace(loaded, {
  schemas,
  methods,
  namespace: "fresh",
  executor: async () => {
    executions++;
    throw Error("Open executed");
  },
});
const [alt] = [...w.reader.read().alternatives.entries()];
console.log(
  JSON.stringify({
    alternatives: w.reader.read().alternatives.size,
    jobs: w.diagnostics().activeJobs,
    executions,
    baseline: w.reader.result(ref("pressure")).receipt.outcome.output.value,
    alternative: w.reader.result(ref("pressure"), { alternative: alt[0] })
      .receipt.outcome.output.value,
  }),
);
