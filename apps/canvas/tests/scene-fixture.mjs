/** Real source-backed checked work, shared by scene browser and storage workloads. */
import { testSession, sampleOutput } from "./sampling-test-helpers.mjs";
import { makeArtifact } from "../src/regions/artifacts.ts";
import { samplingReference } from "../src/regions/samplingPlans.ts";
export async function sceneFixture(count = 8, nested = false) {
  const session = testSession(
    undefined,
    () => [],
    undefined,
    [],
    false,
    undefined,
    {
      artifactExecutor: async (job) => {
        const data = await sampleOutput(job),
          [a, b] = data.points;
        return {
          ...data,
          points: Array.from({ length: 201 }, (_, index) => {
            const t = index / 200;
            return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
          }),
        };
      },
    },
  );
  const add = (text) => {
    const id = session.create();
    if (!session.write(id, text).ok) throw Error("Fixture edit failed");
    return id;
  };
  const input = add("x := 1 mm"),
    output = add("F := gain*x"),
    csv = "gain,noise\n10," + "u".repeat(900000);
  const dataset = session.importData("measurements.csv", csv, {
    x: 80,
    y: 600,
  });
  const gain = session.quantityFromCell(dataset, 0, 0, "gain", "N/mm", {
    x: 100,
    y: 300,
  });
  const artifact = makeArtifact(
    session.state,
    output,
    "Plot F versus x from 0.5 to 3 mm",
  );
  artifact.at = { x: 1320, y: 110 };
  session.setArtifacts([artifact]);
  const job = session.compute(
    samplingReference(session.document, artifact.id, "original"),
  );
  const checked = await job.completion;
  if (checked.status !== "retained") throw Error(checked.reason);
  if (nested)
    session.makeModel(
      {
        id: "model-scene",
        name: "Scene model",
        members: [input, output, gain, dataset, artifact.id],
        inputs: [input],
        outputs: [output],
      },
      { x: 80, y: 100 },
      [artifact.id],
    );
  const tools = Array.from({ length: count }, (_, index) => ({
    id: "tool-scene-" + index,
    editor: "dependencies",
    object: output,
    context: "original",
    at: { x: 720 + (index % 4) * 520, y: 140 + Math.floor(index / 4) * 320 },
    width: 450,
    height: 270,
  }));
  const groups =
    count >= 3
      ? [
          {
            id: "group-scene",
            name: "Review",
            members: tools.slice(-2).map((tool) => tool.id),
            layout: "row",
            auto: false,
          },
        ]
      : [];
  session.setScene({ ...session.scene, tools, groups });
  const view = {
    id: "viewpoint-scene",
    name: "Working layout",
    ...(nested ? { scope: "model-scene" } : {}),
    camera: { x: 0, y: 0, zoom: 1 },
    positions: Object.fromEntries(tools.map((tool) => [tool.id, tool.at])),
    tools: session.scene.tools,
    groups: session.scene.groups,
  };
  session.setScene({ ...session.scene, viewpoints: [view] });
  return { session, input, output, artifact, dataset, csv };
}
