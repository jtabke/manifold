import * as f from "../src/index.ts";
import { indexedBackend } from "../src/indexed-db.ts";
import * as d from "./composition-demo.ts";
const $ = <T extends HTMLElement>(id: string) => {
  const node = document.getElementById(id);
  f.assert(node, "Missing control: " + id);
  return node as T;
};
const input = (id: string) => $<HTMLInputElement>(id),
  id = () => crypto.randomUUID();
const w = f.createWorkspace(await d.initial(), {
  schemas: d.schemas,
  methods: d.methods,
  executor: async (snapshot, signal) => {
    executions++;
    return d.execute(snapshot, signal);
  },
  namespace: id(),
  historyLimit: 32,
});
let executions = 0,
  editVersion = 0,
  generation = 0,
  saved: f.Stamp | undefined,
  saving = false;
const backend = await indexedBackend(
    new URLSearchParams(location.search).get("store") ??
      "manifold-foundation-composition",
  ),
  io = f.incrementalStorage(backend, d.schemas, d.methods, f.webHash);
let review: { stamp: f.Stamp; command: f.Command } | undefined,
  cleanup: ReturnType<typeof w.reader.reviewCompaction> | undefined;
const accepted = new Map<string, string>();
function message(text: string) {
  $("message").textContent = text;
}
function checked<T>(
  r: { ok: true; value: T } | { ok: false; error: string },
): T {
  if (!r.ok) throw Error(r.error);
  return r.value;
}
function command(item: string, body: unknown): f.Command {
  const previous = f.current(w.reader.read(), item);
  f.assert(previous, "Item unavailable");
  return {
    kind: "revise",
    item,
    revision: { ...previous, id: id(), body: d.body(body) },
  };
}
function apply(commands: readonly f.Command[], resources?: f.Resources) {
  return checked(w.owner.apply(w.reader.stamp(), id(), commands, resources));
}
function number(id: string) {
  const value = Number(input(id).value);
  f.assert(
    input(id).value.trim() !== "" && Number.isFinite(value),
    "Enter a finite number",
  );
  return value;
}
function model(item: string): f.ModelInstance {
  const body = f.current(w.reader.read(), item)?.body;
  f.modelInstance(body);
  return body;
}
function changedInput(item: string, value: number): f.ModelInstance {
  const body = model(item);
  return {
    ...body,
    inputs: {
      ...body.inputs,
      displacement: { kind: "value", value, unit: "mm" },
    },
  };
}
function port(
  item: string,
  selector: f.Json = f.modelPort("force"),
  document = w.reader.read(),
): string {
  const r = f.project(
    document,
    d.ref(item, selector),
    d.schemas,
    w.reader.resources(),
  );
  if (r.status !== "resolved") return r.status + " · " + r.reason;
  f.scalar(r.projection.value);
  return r.projection.value.value + " " + r.projection.value.unit;
}
function result(scope: f.Scope = "baseline", request = "pressure-A") {
  const r = w.reader.result(d.ref(request), scope);
  if (r.status === "current" && f.isScalarReceipt(r.receipt)) {
    const outcome = r.receipt.outcome;
    return outcome.status === "success"
      ? `${outcome.output.value} ${outcome.output.unit} · current`
      : "Execution failed";
  }
  return r.status === "ready" ? "Ready to compute" : r.status;
}
function sync(name: string, value: string) {
  const node = input(name),
    previous = accepted.get(name);
  if (previous === undefined || node.value === previous) node.value = value;
  accepted.set(name, value);
}
function render() {
  const doc = w.reader.read();
  for (const item of ["A", "B", "C"]) {
    $("force-" + item).textContent = port(item);
    $("result-" + item).textContent = result("baseline", "pressure-" + item);
    if (item !== "C") {
      const body = model(item);
      $("revision-" + item).textContent =
        "Definition · " +
        (body.model.selection.kind === "pin"
          ? body.model.selection.revision
          : "unselected");
      const projection = f.project(
        doc,
        body.model,
        d.schemas,
        w.reader.resources(),
      );
      const binding = body.inputs.displacement;
      const value =
        binding?.kind === "value"
          ? binding.value
          : projection.status === "resolved"
            ? (projection.projection.value as unknown as f.ModelDefinition)
                .nodes.x
            : undefined;
      sync(
        "x-" + item,
        typeof value === "number"
          ? String(value)
          : value && "default" in value
            ? String(value.default)
            : "1",
      );
    }
  }
  $("force-pair").textContent = port("pair-instance");
  $("nested").textContent =
    "left / k = " +
    port("pair-instance", f.modelNode(["left"], "k")) +
    " · right / k = " +
    port("pair-instance", f.modelNode(["right"], "k"));
  $("template-head").textContent =
    "Latest spring revision · " + f.current(doc, "spring")!.id;
  sync(
    "stiffness",
    String((f.current(doc, "stiffness")!.body as unknown as f.Scalar).value),
  );
  $("preview-result").textContent = w.reader.preview()
    ? result("preview")
    : "No preview";
  $("alternatives").replaceChildren(
    ...[...doc.alternatives.entries()].map(([id, alt]) => {
      const p = document.createElement("p");
      p.textContent = alt.label + " · " + result({ alternative: id });
      return p;
    }),
  );
  $("counters").textContent =
    `${doc.items.size} authored items · ${doc.revisions.size} revisions · ${w.reader.evidence().size} receipts · ${executions} external executions`;
  $("saved").textContent =
    saved &&
    f.canonical(saved as unknown as f.Json) ===
      f.canonical(w.reader.stamp() as unknown as f.Json)
      ? "Saved locally"
      : "Unsaved";
  $<HTMLButtonElement>("undo").disabled = w.diagnostics().undoSteps === 0;
}
function on(name: string, action: () => unknown | Promise<unknown>) {
  $(name).addEventListener("click", () => {
    Promise.resolve()
      .then(action)
      .catch((e) => message(String(e)));
  });
}
function showReview(title: string, detail: string, command: f.Command) {
  review = { stamp: w.reader.stamp(), command };
  $("review-title").textContent = title;
  $("review-detail").textContent = detail;
  $("review").hidden = false;
}
for (const item of ["A", "B"])
  on("apply-" + item, () => {
    apply([command(item, changedInput(item, number("x-" + item)))]);
    message(item + " input accepted independently.");
  });
for (const item of ["A", "B", "C"])
  on("compute-" + item, async () => {
    const job = checked(
      w.owner.compute(w.reader.stamp(), d.ref("pressure-" + item), "baseline"),
    );
    render();
    await job.completion;
    render();
    message(item + " computation finished.");
  });
on("review-binding", () => {
  const source = $<HTMLSelectElement>("bind-source").value;
  const reviewed = f.reviewModelBinding(
    w.reader.read(),
    d.ref("C"),
    "load",
    d.ref(source, f.modelPort("force")),
    d.schemas,
    w.reader.resources(),
  );
  showReview(
    "Connect " + source + " force to C load",
    `${source} / force → C / load\n${JSON.stringify(reviewed.source.value)}\nDestination: ${JSON.stringify(reviewed.destination.interpretation)}\nSource selection: follow the selected instance.`,
    command("C", reviewed.body),
  );
});
on("apply-review", () => {
  f.assert(review, "Review the change first");
  checked(w.owner.apply(review.stamp, id(), [review.command]));
  review = undefined;
  $("review").hidden = true;
  message("Reviewed change accepted.");
});
on("cancel-review", () => {
  review = undefined;
  $("review").hidden = true;
  message("Review cancelled.");
});
on("publish-template", () => {
  const previous = f.current(w.reader.read(), "spring")!.body;
  f.modelDefinition(previous);
  const x = previous.nodes.x;
  f.assert(x?.kind === "input", "Displacement input unavailable");
  apply([
    command("spring", {
      ...previous,
      nodes: { ...previous.nodes, x: { ...x, default: number("default-x") } },
    }),
  ]);
  message(
    "New definition published. Existing instances keep their pinned revisions.",
  );
});
on("review-update", () => {
  const reviewed = f.reviewModelUpdate(
      w.reader.read(),
      d.ref("A"),
      d.schemas,
      w.reader.resources(),
    ),
    c = command("A", reviewed.body);
  const candidate = f.prepare(w.reader.read(), id(), [c], d.schemas).document;
  showReview(
    "Update A to the latest spring revision",
    `Revision: ${JSON.stringify(reviewed.before.selection)} → ${JSON.stringify(reviewed.after.selection)}\nA force: ${port("A")} → ${port("A", f.modelPort("force"), candidate)}\nInterface changes: ${JSON.stringify(reviewed.interfaceChanges)}\nExisting input overrides are preserved. B keeps its selected revision.`,
    c,
  );
});
on("revise-source", () => {
  apply([
    command("stiffness", {
      ...d.scope,
      value: number("stiffness"),
      unit: "N/mm",
    }),
  ]);
  message(
    "Source revision accepted. A results need the new dependency identity.",
  );
});
input("source-file").addEventListener("change", async () => {
  try {
    const file = input("source-file").files?.[0];
    if (!file) return;
    f.assert(
      file.size <= 1024 * 1024,
      "Source file exceeds 1 MiB workbench limit",
    );
    const stamp = w.reader.stamp(),
      dirty = editVersion,
      bytes = await file.text(),
      rows: unknown = JSON.parse(bytes);
    f.assert(
      Array.isArray(rows) &&
        rows.length > 0 &&
        rows.length <= 10000 &&
        rows.every(
          (row) =>
            Array.isArray(row) &&
            row.length === 1 &&
            typeof row[0] === "number" &&
            Number.isFinite(row[0]),
        ),
      "Expected one-column finite numeric rows",
    );
    const asset = await f.asset(bytes, f.webHash),
      resources = w.reader.resources();
    f.assert(
      resources instanceof f.MemoryResources,
      "Verified in-memory source provider required",
    );
    const next = await resources.add(asset, bytes, f.webHash);
    f.assert(
      dirty === editVersion,
      "Inputs changed during import; choose the source again",
    );
    checked(
      w.owner.apply(
        stamp,
        id(),
        [
          command("source", {
            asset,
            rows: rows.length,
            columns: 1,
            interpretation: [d.expected("N/mm")],
          }),
        ],
        next,
      ),
    );
    message("Source imported. B needs an explicit selector rebind.");
  } catch (e) {
    message(String(e));
  } finally {
    input("source-file").value = "";
  }
});
on("review-rebind", () => {
  const revision = f.current(w.reader.read(), "source")!.id;
  const source = d.ref("source", {
    kind: "cell",
    version: 1,
    revision,
    row: 0,
    column: 0,
  });
  const reviewed = f.reviewModelBinding(
    w.reader.read(),
    d.ref("B"),
    "stiffness",
    source,
    d.schemas,
    w.reader.resources(),
  );
  showReview(
    "Rebind B stiffness to the new table",
    `Table revision: ${revision}\nRow 0 / column 0\n${JSON.stringify(reviewed.source.value)}\nThe kept alternative retains its original selection.`,
    command("B", reviewed.body),
  );
});
on("preview", () => {
  const c = command("A", changedInput("A", number("preview-x")));
  f.assert(c.kind === "revise", "Invalid preview");
  checked(
    w.owner.preview(w.reader.stamp(), d.ref("pressure-A"), [
      { item: "A", revision: c.revision },
    ]),
  );
  render();
  message("A preview prepared; baseline unchanged.");
});
on("compute-preview", async () => {
  const job = checked(
    w.owner.compute(w.reader.stamp(), d.ref("pressure-A"), "preview"),
  );
  render();
  await job.completion;
  render();
});
on("keep", () => {
  const alt = id();
  checked(
    w.owner.keep(w.reader.stamp(), id(), alt, "A alternative", {
      id: id(),
      reference: d.ref("pressure-A"),
      renderer: "result@1",
      x: 0,
      y: 0,
      alternative: alt,
    }),
  );
  message("Alternative retained with its complete dependency selection.");
});
on("cancel-preview", () => {
  checked(w.owner.cancelPreview(w.reader.stamp()));
  render();
  message("Preview cancelled.");
});
on("undo", () => {
  checked(w.owner.undo(w.reader.stamp(), id()));
  message("Previous authored selection restored.");
});
on("review-cleanup", () => {
  cleanup = w.reader.reviewCompaction({ evidence: "reachable" });
  $("cleanup-detail").textContent =
    `Remove ${cleanup.removedRevisions.length} revision payloads and ${cleanup.removedReceipts.length} receipts; current work, kept alternatives and Undo stay reachable.`;
  $<HTMLButtonElement>("apply-cleanup").disabled = false;
});
on("apply-cleanup", () => {
  f.assert(cleanup, "Review cleanup first");
  checked(w.owner.compact(w.reader.stamp(), id(), cleanup));
  cleanup = undefined;
  $<HTMLButtonElement>("apply-cleanup").disabled = true;
  message("Reviewed history cleanup applied. Save to persist it.");
});
on("save", async () => {
  f.assert(!saving, "A save is already running");
  saving = true;
  $<HTMLButtonElement>("save").disabled = true;
  try {
    const capture = w.reader.capture(),
      ticket = {
        request: id(),
        stamp: capture.stamp,
        document: capture.document.document,
        expectedGeneration: generation,
        capture,
      };
    const ack = await io.save(ticket);
    generation = ack.head.generation;
    if (f.acknowledgementApplies(ack.head, ticket, w.reader.stamp()))
      saved = capture.stamp;
    message("Local save completed.");
  } finally {
    saving = false;
    $<HTMLButtonElement>("save").disabled = false;
    render();
  }
});
on("download", () => {
  const text = f.encode(
    w.reader.read(),
    [...w.reader.evidence().entries()].map(([, r]) => r),
    w.reader.resources(),
    d.schemas,
    w.reader.original(),
  );
  const url = URL.createObjectURL(
      new Blob([text], { type: "application/json" }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = "models.manifold";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  message("Portable work downloaded.");
});
input("open").addEventListener("change", async () => {
  try {
    const file = input("open").files?.[0];
    if (!file) return;
    f.assert(
      file.size <= 8 * 1024 * 1024,
      "Native file exceeds 8 MiB workbench limit",
    );
    const stamp = w.reader.stamp(),
      dirty = editVersion,
      loaded = await f.decode(
        await file.text(),
        d.schemas,
        d.methods,
        f.webHash,
      );
    // This focused workbench only renders its own example family; the generic foundation accepts other work.
    validateExample(loaded);
    f.assert(
      dirty === editVersion,
      "Inputs changed during Open; choose the file again",
    );
    checked(w.owner.open(stamp, loaded));
    saved = undefined;
    accepted.clear();
    review = undefined;
    $("review").hidden = true;
    render();
    message("Portable work opened. No external computation started.");
  } catch (e) {
    message(String(e));
  } finally {
    input("open").value = "";
  }
});
function validateExample(loaded: f.Loaded) {
  f.assert(
    loaded.document.document === d.docId,
    "Open this model example in its originating workbench",
  );
  const expected = {
    A: "scalar-model-instance@1",
    B: "scalar-model-instance@1",
    C: "scalar-model-instance@1",
    spring: "scalar-model-definition@1",
    "pair-instance": "scalar-model-instance@1",
    stiffness: "scalar@1",
    source: "source@1",
    "pressure-A": "request@1",
    "pressure-B": "request@1",
    "pressure-C": "request@1",
  };
  for (const [item, schema] of Object.entries(expected))
    f.assert(
      f.current(loaded.document, item)?.schema === schema,
      "This workbench requires its model example records: " + item,
    );
}
async function reopen() {
  const stamp = w.reader.stamp(),
    dirty = editVersion,
    recovered = await io.reopen();
  f.assert(
    dirty === editVersion,
    "Inputs changed during recovery; reopen when ready",
  );
  validateExample(recovered.loaded);
  checked(w.owner.open(stamp, recovered.loaded));
  generation = recovered.head.generation;
  saved = w.reader.stamp();
  accepted.clear();
  render();
  message("Verified local save reopened. No external computation started.");
}
on("reload", reopen);
document.addEventListener("input", () => {
  editVersion++;
});
w.reader.subscribe(render);
render();
try {
  const stamp = w.reader.stamp(),
    dirty = editVersion,
    head = await backend.head();
  if (head) {
    f.assert(
      dirty === editVersion && stamp.root === w.reader.stamp().root,
      "Work changed during startup",
    );
    await reopen();
  } else message("Independent models ready.");
} catch (e) {
  message("Recovery needs attention: " + String(e));
}
