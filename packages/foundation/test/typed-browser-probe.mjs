/** Runs inside Chrome; uses the same public owner, native codec and IndexedDB adapter. */
export async function typedBrowserProbe({ root, store }) {
  const f = await import("/@fs" + root + "/packages/foundation/src/index.ts"),
    { indexedBackend } = await import(
      "/@fs" + root + "/packages/foundation/src/indexed-db.ts"
    );
  const methodRef = {
      id: "double-points",
      version: "1",
      runtime: "browser-geometry@1",
    },
    descriptor = (value) => {
      f.assert(f.object(value), "Missing geometry descriptor");
      f.fields(value, ["asset", "unit", "frame"]);
      f.validateAsset(value.asset);
      f.assert(
        value.unit === "mm" && value.frame === "part-A",
        "Geometry interpretation differs",
      );
    },
    points = (value, resources) => {
      const read = resources.read(value.asset);
      f.assert(read.status === "ready", "Geometry bytes missing");
      const data = JSON.parse(read.data);
      f.assert(
        Array.isArray(data) &&
          data.length === 2 &&
          data.every(
            (p) =>
              Array.isArray(p) && p.length === 3 && p.every(Number.isFinite),
          ),
        "Geometry shape differs",
      );
      return data;
    },
    method = {
      requirements: methodRef,
      input: "vertices@1",
      output: "vertices@1",
      limits: { inputBytes: 1024, outputBytes: 1024 },
      validateInput: descriptor,
      validateOutput(_input, output) {
        descriptor(output);
        return output;
      },
      assets: (value) => [value.asset],
      validateInputResources: points,
      validateOutputResources(input, output, resources) {
        f.assert(
          JSON.stringify(points(output, resources)) ===
            JSON.stringify(
              points(input, resources).map((p) => p.map((n) => n * 2)),
            ),
          "Wrong geometric output",
        );
      },
    },
    schema = {
      id: "geometry-task@1",
      validate: descriptor,
      references: () => [],
      assets: (body) => [body.asset],
      project(body) {
        return {
          type: "typed-request@1",
          value: {
            method: methodRef,
            input: { schema: method.input, body },
            output: method.output,
          },
        };
      },
    },
    schemas = f.createSchemas([schema]),
    methods = f.createMethods([], [method]),
    input = "[[1,2,3],[4,5,6]]",
    asset = await f.asset(input, f.webHash),
    resources = await f.MemoryResources.verify(
      [[asset.digest, input]],
      f.webHash,
    ),
    document = f.prepare(
      f.empty("typed-browser"),
      "with-geometry",
      [
        {
          kind: "create",
          item: "geometry",
          label: "Geometry",
          revision: {
            id: "geometry-v1",
            item: "geometry",
            schema: schema.id,
            required: true,
            body: { asset, unit: "mm", frame: "part-A" },
          },
        },
      ],
      schemas,
    ).document;
  let calls = 0;
  const workspace = f.createWorkspace(
      { document, receipts: [], resources },
      {
        schemas,
        methods,
        namespace: "typed-browser",
        typedExecutor: async (snapshot, _signal, io) => {
          calls++;
          const data = JSON.stringify(
              points(snapshot.input.body, io).map((p) => p.map((n) => n * 2)),
            ),
            output = await f.asset(data, f.webHash);
          await io.stage(output, data);
          return { ...snapshot.input.body, asset: output };
        },
      },
    ),
    target = f.reference(document.document, "geometry"),
    pending = workspace.owner.compute(workspace.reader.stamp(), target);
  f.assert(pending.ok, pending.error);
  const done = await pending.value.completion;
  f.assert(
    done.status === "retained" && done.receipt.outcome.status === "success",
    "Typed computation failed",
  );
  const native = f.encode(
      workspace.reader.read(),
      [done.receipt],
      workspace.reader.resources(),
      schemas,
    ),
    decoded = await f.decode(native, schemas, methods, f.webHash),
    backend = await indexedBackend(store);
  let restored;
  try {
    const io = f.incrementalStorage(backend, schemas, methods, f.webHash),
      ticket = (w, generation) => ({
        request: crypto.randomUUID(),
        stamp: w.reader.stamp(),
        document: w.reader.read().document,
        expectedGeneration: generation,
        capture: w.reader.capture(),
      }),
      saved = await io.save(ticket(workspace, 0)),
      recovery = await io.reopen();
    restored = f.createWorkspace(recovery.loaded, {
      schemas,
      methods,
      namespace: "typed-recipient",
    });
    const result = restored.reader.result(target);
    f.assert(
      result.status === "current",
      "Retained typed result unavailable without executor",
    );
    const read = restored.reader
        .resources()
        .read(result.receipt.outcome.output.body.asset),
      warm = await io.save(ticket(restored, saved.head.generation));
    f.assert(
      read.status === "ready" && read.data === "[[2,4,6],[8,10,12]]",
      "Recovered output bytes differ",
    );
    f.assert(
      warm.writes.chunks === 0 && warm.writes.assets === 0 && calls === 1,
      "Unexpected writes or execution on recovery",
    );
    return {
      nativeVersion: JSON.parse(native).version,
      nativeReceipts: decoded.receipts.length,
      calls,
      result: result.status,
      recoveredOutput: read.data,
      unchangedWrites: warm.writes,
    };
  } finally {
    workspace.owner.dispose();
    restored?.owner.dispose();
    backend.close();
  }
}
