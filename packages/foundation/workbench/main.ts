import {
  assert,
  object,
  createWorkspace,
  current,
  project,
  reference,
  asset,
  MemoryResources,
  webHash,
  encode,
  decode,
  incrementalStorage,
  acknowledgementApplies,
  type Resources,
  type Asset,
  type Scalar,
  type Stamp,
  type Command,
  type Fault,
  type Scope,
  type Loaded,
  isScalarReceipt,
  type Receipt,
  type RetentionPolicy,
} from "../src/index.ts";
import { indexedBackend } from "../src/indexed-db.ts";
import {
  demo,
  schemas,
  methods,
  calculate,
  ref,
  meta,
  revision,
} from "./demo.ts";
const $ = <T extends HTMLElement>(id: string) => {
  const node = document.getElementById(id);
  assert(node, "Missing control: " + id);
  return node as T;
};
const input = (id: string) => $<HTMLInputElement>(id),
  select = (id: string) => $<HTMLSelectElement>(id),
  draft = $<HTMLTextAreaElement>("draft");
let sourceUnavailable = false,
  held: (() => void)[] = [],
  releaseSave: (() => void) | undefined;
const initial = await demo(webHash);
let memory = initial.resources;
const port = (r: Resources): Resources =>
  Object.freeze({
    read: (a: Asset) =>
      sourceUnavailable
        ? {
            status: "unavailable" as const,
            reason: "Source access is temporarily unavailable",
          }
        : r.read(a),
  });
const w = createWorkspace(
  { ...initial, resources: port(memory) },
  {
    schemas,
    methods,
    namespace: crypto.randomUUID(),
    executor: async (s, signal) => {
      const mode = select("execution").value;
      if (mode === "hold")
        await new Promise<void>((resolve, reject) => {
          held.push(resolve);
          signal.addEventListener(
            "abort",
            () => reject(Error("Previous work closed")),
            { once: true },
          );
        });
      if (mode === "fail")
        throw Error("The executor failed. Your authored work is intact.");
      return calculate(s);
    },
  },
);
const storeName =
  new URLSearchParams(location.search).get("store") ??
  "manifold-foundation-workbench";
const backend = await indexedBackend(storeName),
  io = incrementalStorage(backend, schemas, methods, webHash);
const initialHead = await backend.head();
let generation = initialHead?.generation ?? 0,
  saved: Stamp | undefined,
  acceptedDraft = "",
  acceptedForce = NaN,
  calculationRenders = 0,
  recent: Receipt[] = [];
let lastSave: Awaited<ReturnType<typeof io.save>> | undefined;
let cleanup: ReturnType<typeof w.reader.reviewCompaction> | undefined;
let storageReview: Awaited<ReturnType<typeof io.reviewReclamation>> | undefined,
  lastReclamation: Awaited<ReturnType<typeof io.reclaim>> | undefined;
function invalidateStorageReview() {
  if (storageReview)
    $("storage-review").textContent = "Saved storage changed. Review again.";
  storageReview = undefined;
  $<HTMLButtonElement>("reclaim-storage").disabled = true;
}
const uid = (prefix: string) => prefix + ":" + crypto.randomUUID();
const message = (text: string) => {
  $("message").textContent = text;
};
const text = () => {
  const r = current(w.reader.read(), "draft");
  assert(
    r?.schema === "note@1" && object(r.body) && typeof r.body.text === "string",
    "Unsupported note editor",
  );
  return r.body.text;
};
const rootForce = () => {
  const r = current(w.reader.read(), "force");
  assert(
    r?.schema === "scalar@1" &&
      object(r.body) &&
      typeof r.body.value === "number",
    "Unsupported force editor",
  );
  return r.body.value;
};
function same(a: Stamp | undefined, b: Stamp) {
  return (
    a?.root === b.root && a.evidence === b.evidence && a.binding === b.binding
  );
}
function native() {
  return encode(
    w.reader.read(),
    [...w.reader.evidence().entries()].map(([, r]) => r),
    w.reader.resources(),
    schemas,
    w.reader.original(),
  );
}
function renderAuthoring(reset = false) {
  const t = text(),
    force = rootForce();
  if (reset || t !== acceptedDraft) draft.value = t;
  if (reset || force !== acceptedForce) input("force").value = String(force);
  acceptedDraft = t;
  acceptedForce = force;
  const notes: HTMLElement[] = [];
  let relationCount = 0;
  for (const [item] of w.reader.read().items.entries()) {
    const r = current(w.reader.read(), item);
    if (
      (r?.schema === "note@1" || r?.schema === "conclusion@1") &&
      item !== "draft"
    ) {
      const li = document.createElement("li");
      li.textContent = (r.body as { text: string }).text;
      notes.push(li);
    }
    if (r?.schema === "relation@1") relationCount++;
  }
  $("notes").replaceChildren(...notes);
  $("connections").textContent = relationCount
    ? `${relationCount} explicit comparison · Applied ${force} N and measured 130 N remain separate records.`
    : "No comparison has been asserted.";
  const request = current(w.reader.read(), "pressure")!.body;
  assert(object(request) && object(request.inputs), "Unsupported request");
  const p = project(
    w.reader.read(),
    request.inputs.area as ReturnType<typeof ref>,
    schemas,
    w.reader.resources(),
  );
  $("source-context").textContent =
    p.status === "resolved"
      ? `Area ${(p.projection.value as Scalar).value} mm² · imported area source · specimen A / axial / load case A`
      : `Area source: ${p.status}`;
}
function stateText(scope: Scope = "baseline", target = ref("pressure")) {
  const state = w.reader.result(target, scope);
  if (
    state.status === "current" &&
    isScalarReceipt(state.receipt) &&
    state.receipt.outcome.status === "success"
  )
    return `${state.receipt.outcome.output.value} ${state.receipt.outcome.output.unit} · current`;
  if (state.status === "failed" && state.receipt.outcome.status === "failed")
    return `Failed · ${state.receipt.outcome.reason}`;
  if (state.status === "blocked") return `Unresolved · ${state.reason}`;
  return state.status === "pending"
    ? "Computing captured inputs…"
    : "Ready to compute";
}
function renderResults() {
  calculationRenders++;
  $("baseline-result").textContent = stateText();
  $("inverse-result").textContent =
    "Required force at 0.08 MPa · " +
    stateText("baseline", ref("required-force"));
  const preview = w.reader.preview();
  $("preview-panel").hidden = !preview;
  if (preview) $("preview-result").textContent = stateText("preview");
  const nodes: HTMLElement[] = [];
  for (const [id, a] of w.reader.read().alternatives.entries()) {
    const card = document.createElement("article");
    card.className = "alternative";
    card.dataset.alternative = id;
    const title = document.createElement("h3");
    title.textContent = a.label;
    const value = document.createElement("p");
    value.className = "result-value";
    value.dataset.result = id;
    value.textContent = stateText({ alternative: id });
    const description = document.createElement("p");
    description.className = "hint";
    description.textContent = `${a.context.revisions.size} retained revisions · source and input selections stay pinned`;
    const row = document.createElement("div");
    row.className = "row";
    const compute = document.createElement("button");
    compute.textContent = "Compute " + a.label;
    compute.onclick = () => runCompute({ alternative: id });
    const remove = document.createElement("button");
    remove.className = "quiet";
    remove.textContent = "Remove " + a.label;
    remove.onclick = () => {
      const commands: Command[] = [
        ...[...w.reader.read().views.entries()]
          .filter(([, v]) => v.alternative === id)
          .map(([viewId]) => ({ kind: "removeView" as const, id: viewId })),
        { kind: "removeAlternative", id },
      ];
      apply(commands, "Alternative and its comparison removed together.");
    };
    row.append(compute, remove);
    card.append(title, value, description, row);
    nodes.push(card);
  }
  if (!nodes.length) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "Preview a change, then keep it here.";
    nodes.push(p);
  }
  $("alternatives").replaceChildren(...nodes);
  $("alternative-count").textContent = String(
    w.reader.read().alternatives.size,
  );
}
function renderStatus() {
  const d = w.diagnostics();
  $("saved-state").textContent =
    same(saved, w.reader.stamp()) && draft.value === text()
      ? "Saved locally"
      : "Unsaved";
  $("history").textContent = `${d.undoSteps} retained Undo steps`;
  $("diagnostics").textContent =
    `${d.activeJobs} active jobs · ${d.receipts} retained receipts · ${w.reader.read().revisions.size} content revisions`;
  $("evidence").replaceChildren(
    ...recent.map((r) => {
      assert(
        isScalarReceipt(r),
        "This scalar example cannot render a typed receipt",
      );
      const li = document.createElement("li");
      li.dataset.receiptId = r.id;
      li.textContent = `${r.snapshot.method.id}@${r.snapshot.method.version} · ${r.outcome.status} · ${Object.entries(
        r.snapshot.inputs,
      )
        .map(
          ([k, i]) =>
            `${k}=${i.scalar.value} ${i.scalar.unit} @ ${i.origin.revision}`,
        )
        .join("; ")}`;
      const cite = document.createElement("button");
      cite.className = "quiet";
      cite.textContent = "Keep this result";
      cite.onclick = () => {
        const item = uid("conclusion"),
          value =
            r.outcome.status === "success"
              ? `${r.outcome.output.value} ${r.outcome.output.unit}`
              : r.outcome.reason;
        apply(
          [
            {
              kind: "create",
              item,
              label: "Recorded conclusion",
              revision: revision(
                uid("conclusion-revision"),
                item,
                "conclusion@1",
                {
                  text: `Recorded ${value} from ${r.snapshot.method.id}. Physical validity has not been assessed.`,
                  receipts: [r.id],
                },
              ),
            },
            {
              kind: "view",
              view: {
                id: uid("conclusion-view"),
                reference: ref(item),
                renderer: "note@1",
                x: 80,
                y: 240,
                alternative: null,
              },
            },
          ],
          "Conclusion retained with an explicit link to its execution evidence.",
        );
      };
      li.append(document.createElement("br"), cite);
      return li;
    }),
  );
}
function refreshRecent() {
  recent = [...w.reader.evidence().entries()]
    .map(([, r]) => r)
    .sort((a, b) => b.order - a.order)
    .slice(0, 10);
}
function invalidateCleanup() {
  if (cleanup) {
    cleanup = undefined;
    $("cleanup-review").textContent =
      "Work or execution changed. Review cleanup again.";
  }
  $<HTMLButtonElement>("apply-cleanup").disabled = true;
}
w.reader.subscribe((event) => {
  invalidateCleanup();
  if (event.items.length || event.alternatives.length) renderAuthoring();
  if (
    event.affected.length ||
    event.alternatives.length ||
    event.evidence ||
    event.preview
  )
    renderResults();
  if (event.receiptIds.length) {
    for (const id of event.receiptIds) {
      const r = w.reader.evidence().get(id);
      if (r) recent = [r, ...recent].slice(0, 10);
    }
  } else if (event.evidence) refreshRecent();
  renderStatus();
});
function applied(result: { ok: boolean; error?: string }, success: string) {
  message(result.ok ? success : (result.error ?? "Operation rejected"));
  renderStatus();
  return result.ok;
}
function apply(
  commands: readonly Command[],
  success: string,
  resources?: Resources,
) {
  const result = w.owner.apply(
    w.reader.stamp(),
    uid("root"),
    commands,
    resources,
  );
  return applied(result, success);
}
function keepThought() {
  if (draft.value === text()) return true;
  return apply(
    [
      {
        kind: "revise",
        item: "draft",
        revision: revision(uid("draft"), "draft", "note@1", {
          text: draft.value,
          mode: "draft",
        }),
      },
    ],
    "Thought retained, including unfinished mathematics.",
  );
}
function runCompute(scope: Scope = "baseline", target = ref("pressure")) {
  const result = w.owner.compute(w.reader.stamp(), target, scope);
  applied(
    result,
    "Inputs captured. You can keep working while computation runs.",
  );
  renderResults();
  if (result.ok)
    void result.value.completion.then(() => {
      renderResults();
      renderStatus();
    });
}
select("retention").onchange = invalidateCleanup;
$("review-cleanup").onclick = () => {
  try {
    cleanup = w.reader.reviewCompaction({
      evidence: select("retention").value as RetentionPolicy["evidence"],
    });
    const { before, after } = cleanup;
    $("cleanup-review").textContent =
      `Before: ${before.revisions} revisions, ${before.receipts} receipts, ${before.includedAssets} included sources (${before.includedBytes} bytes). After: ${after.revisions} revisions, ${after.receipts} receipts, ${after.includedAssets} included sources (${after.includedBytes} bytes). Remove ${cleanup.removedRevisions.length} unused revisions and ${cleanup.removedReceipts.length} unprotected attempts. This maintenance cannot be undone; retained Undo steps remain usable.`;
    $<HTMLButtonElement>("apply-cleanup").disabled = false;
  } catch (error) {
    message(String(error));
  }
};
$("review-storage").onclick = () =>
  void (async () => {
    try {
      invalidateStorageReview();
      storageReview = await io.reviewReclamation();
      const { before, after } = storageReview;
      $("storage-review").textContent =
        `Saved storage: ${before.packages} records and ${before.assets} sources (${before.bytes} bytes). Retain ${after.packages} records and ${after.assets} sources (${after.bytes} bytes). Reclaim ${before.bytes - after.bytes} bytes of obsolete saved data.`;
      $<HTMLButtonElement>("reclaim-storage").disabled =
        before.packages === after.packages && before.assets === after.assets;
    } catch (error) {
      message(String(error));
    }
  })();
$("reclaim-storage").onclick = () =>
  void (async () => {
    try {
      assert(storageReview, "Review saved storage first");
      lastReclamation = await io.reclaim(storageReview);
      invalidateStorageReview();
      $("storage-review").textContent =
        `Reclaimed ${lastReclamation.reclaimedBytes} bytes from obsolete saved data. The latest saved version is intact.`;
      message(
        "Saved storage reclaimed. Current work and the latest saved version are intact.",
      );
    } catch (error) {
      invalidateStorageReview();
      message(String(error));
    }
  })();
$("apply-cleanup").onclick = () => {
  try {
    assert(cleanup, "Review cleanup first");
    const selected = memory.retain(cleanup.assets),
      result = w.owner.compact(
        w.reader.stamp(),
        uid("compacted-root"),
        cleanup,
        port(selected),
      );
    if (result.ok) {
      memory = selected;
      cleanup = undefined;
      $("cleanup-review").textContent =
        `Working history compacted; ${result.value.after.receipts} receipts and ${result.value.after.revisions} revisions retained. Save or download to persist this version.`;
    }
    applied(
      result,
      "Reviewed cleanup applied. Current work, protected history and cited evidence remain available.",
    );
  } catch (error) {
    message(String(error));
  }
};
$("keep-draft").onclick = () => {
  keepThought();
};
draft.oninput = renderStatus;
$("create-note").onclick = () => {
  const value = input("new-note").value;
  if (!value.trim()) {
    message("Write a thought to retain.");
    return;
  }
  const item = uid("note");
  if (
    apply(
      [
        {
          kind: "create",
          item,
          label: "Note",
          revision: revision(uid("note-revision"), item, "note@1", {
            text: value,
            mode: "note",
          }),
        },
        {
          kind: "view",
          view: {
            id: uid("note-view"),
            reference: reference(w.reader.read().document, item),
            renderer: "note@1",
            x: 40,
            y: 160,
            alternative: null,
          },
        },
      ],
      "Note and its independent view created together.",
    )
  )
    input("new-note").value = "";
};
$("apply-force").onclick = () => {
  const value = Number(input("force").value);
  if (!input("force").value || !Number.isFinite(value)) {
    message("Enter a finite force.");
    return;
  }
  apply(
    [
      {
        kind: "revise",
        item: "force",
        revision: revision(uid("force"), "force", "scalar@1", {
          value,
          unit: "N",
          ...meta,
        }),
      },
    ],
    "Baseline force updated. Kept alternatives retain their own inputs.",
  );
};
$("preview").onclick = () => {
  const value = Number(input("preview-force").value);
  if (!input("preview-force").value || !Number.isFinite(value)) {
    message("Enter a finite preview force.");
    return;
  }
  applied(
    w.owner.preview(w.reader.stamp(), ref("pressure"), [
      {
        item: "force",
        revision: revision(uid("preview-force"), "force", "scalar@1", {
          value,
          unit: "N",
          ...meta,
        }),
      },
    ]),
    "Preview opened. The baseline has not changed.",
  );
};
$("cancel").onclick = () =>
  applied(
    w.owner.cancelPreview(w.reader.stamp()),
    "Preview cancelled. No alternative was authored.",
  );
$("keep").onclick = () => {
  const alt = uid("alternative"),
    label = input("alternative-label").value.trim();
  if (!label) {
    message("Name the alternative.");
    return;
  }
  applied(
    w.owner.keep(w.reader.stamp(), uid("kept-root"), alt, label, {
      id: uid("comparison"),
      reference: ref("pressure"),
      renderer: "result@1",
      x: 500,
      y: 240,
      alternative: alt,
    }),
    "Alternative and comparison kept together. Baseline inputs remain independent.",
  );
};
$("undo").onclick = () =>
  applied(
    w.owner.undo(w.reader.stamp(), uid("undo")),
    "Authored operation undone. Retained execution evidence stays available.",
  );
$("compute").onclick = () => runCompute();
$("compute-preview").onclick = () => runCompute("preview");
$("compute-inverse").onclick = () =>
  runCompute("baseline", ref("required-force"));
$("connect").onclick = () => {
  const item = uid("comparison-link");
  apply(
    [
      {
        kind: "create",
        item,
        label: "Prediction / measurement comparison",
        revision: revision(
          uid("comparison-link-revision"),
          item,
          "relation@1",
          { role: "compares", from: ref("force"), to: ref("observation") },
        ),
      },
    ],
    "Explicit comparison retained. The two values have not been merged.",
  );
};
$("move-view").onclick = () => {
  const view = w.reader.read().views.get("draft-view")!;
  apply(
    [{ kind: "view", view: { ...view, x: view.x + 20, y: view.y } }],
    "Note view moved. Computation inputs are unchanged.",
  );
};
$("toggle-source").onclick = () => {
  sourceUnavailable = !sourceUnavailable;
  $("toggle-source").textContent = sourceUnavailable
    ? "Restore source access"
    : "Make source unavailable";
  renderAuthoring();
  renderResults();
};
$("release").onclick = () => {
  const list = held;
  held = [];
  for (const release of list) release();
  message(
    "Held jobs released. Each result still concerns its captured inputs.",
  );
};
input("source-file").onchange = () =>
  void (async () => {
    const file = input("source-file").files?.[0];
    if (!file) return;
    const expected = w.reader.stamp(),
      capturedMemory = memory;
    try {
      assert(
        file.size <= 1024 * 1024,
        "This source importer supports files up to 1 MiB",
      );
      const bytes = await file.text(),
        data: unknown = JSON.parse(bytes);
      assert(
        Array.isArray(data) &&
          data.length === 1 &&
          Array.isArray(data[0]) &&
          data[0].length === 1 &&
          typeof data[0][0] === "number" &&
          Number.isFinite(data[0][0]),
        "Expected a one-cell numeric JSON table",
      );
      const a = await asset(bytes, webHash),
        resources = await capturedMemory.add(a, bytes, webHash),
        rid = uid("area-source");
      const commands: Command[] = [
        {
          kind: "revise",
          item: "area",
          revision: revision(rid, "area", "source@1", {
            asset: a,
            rows: 1,
            columns: 1,
            interpretation: [{ unit: "mm2", ...meta }],
          }),
        },
      ];
      for (const item of ["pressure", "required-force"]) {
        const prior = current(w.reader.read(), item)!.body;
        assert(
          object(prior) && object(prior.inputs) && object(prior.inputs.area),
          "Unsupported request",
        );
        commands.push({
          kind: "revise",
          item,
          revision: revision(uid(item), item, "request@1", {
            ...prior,
            inputs: {
              ...prior.inputs,
              area: {
                ...prior.inputs.area,
                selector: {
                  kind: "cell",
                  version: 1,
                  revision: rid,
                  row: 0,
                  column: 0,
                },
              },
            },
          }),
        });
      }
      const result = w.owner.apply(
        expected,
        uid("source-import"),
        commands,
        port(resources),
      );
      if (result.ok) memory = resources;
      applied(
        result,
        "Area source reimported and baseline selectors explicitly rebound. Kept alternatives are unchanged.",
      );
    } catch (e) {
      message(String(e));
    }
    input("source-file").value = "";
  })();
$("save").onclick = () =>
  void (async () => {
    try {
      if (!keepThought()) return;
      const ticket = {
          request: uid("save"),
          stamp: w.reader.stamp(),
          document: w.reader.read().document,
          expectedGeneration: generation,
          capture: w.reader.capture(),
        },
        hold = input("hold-save").checked;
      input("hold-save").checked = false;
      const result = await io.save(
        ticket,
        select("fault").value as Fault,
        hold
          ? () =>
              new Promise<void>((resolve) => {
                releaseSave = resolve;
                message("Save staged and held before publication.");
              })
          : undefined,
      );
      const head = result.head;
      lastSave = result;
      invalidateStorageReview();
      generation = head.generation;
      const current = acknowledgementApplies(head, ticket, w.reader.stamp());
      if (current) saved = ticket.stamp;
      message(
        current
          ? "Work saved locally."
          : "Captured work saved. Newer changes remain unsaved.",
      );
    } catch (e) {
      message(String(e));
    }
    renderStatus();
  })();
$("release-save").onclick = () => {
  releaseSave?.();
  releaseSave = undefined;
};
function validateWorkbench(loaded: Loaded) {
  const doc = loaded.document;
  assert(
    doc.document === "foundation-demo" &&
      !doc.readOnly &&
      current(doc, "draft")?.schema === "note@1" &&
      current(doc, "force")?.schema === "scalar@1" &&
      current(doc, "pressure")?.schema === "request@1" &&
      current(doc, "required-force")?.schema === "request@1" &&
      doc.views.get("draft-view"),
    "This workbench cannot render that document; current work was preserved",
  );
  const force = current(doc, "force")!.body;
  assert(object(force) && force.unit === "N", "Unsupported force editor unit");
}
function adopt(expected: Stamp, buffer: string, loaded: Loaded) {
  validateWorkbench(loaded);
  assert(draft.value === buffer, "Draft changed while opening");
  const result = w.owner.open(expected, loaded, port(loaded.resources));
  assert(result.ok, result.ok ? "" : result.error);
  assert(
    loaded.resources instanceof MemoryResources,
    "Expected verified portable resources",
  );
  memory = loaded.resources;
  saved = undefined;
  renderAuthoring(true);
  refreshRecent();
  renderResults();
  renderStatus();
}
input("open").onchange = () =>
  void (async () => {
    const file = input("open").files?.[0];
    if (!file) return;
    const expected = w.reader.stamp(),
      buffer = draft.value;
    try {
      assert(
        file.size <= 64 * 1024 * 1024,
        "Native file exceeds the 64 MiB reader budget",
      );
      const loaded = await decode(await file.text(), schemas, methods, webHash);
      adopt(expected, buffer, loaded);
      message("Portable work opened. No jobs were started.");
    } catch (e) {
      message(String(e));
    }
    input("open").value = "";
  })();
$("reopen").onclick = () =>
  void (async () => {
    const expected = w.reader.stamp(),
      buffer = draft.value;
    try {
      const savedWork = await io.reopen();
      adopt(expected, buffer, savedWork.loaded);
      generation = savedWork.head.generation;
      saved = w.reader.stamp();
      message("Local save reopened. No jobs were started.");
    } catch (e) {
      message(String(e));
    }
    renderStatus();
  })();
$("download").onclick = () => {
  try {
    if (!keepThought()) return;
    const url = URL.createObjectURL(
        new Blob([native()], { type: "application/json" }),
      ),
      a = document.createElement("a");
    a.href = url;
    a.download = "work.manifold";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    message(
      "Portable work downloaded with source bytes, alternatives and evidence.",
    );
  } catch (e) {
    message(String(e));
  }
};
Object.defineProperty(window, "foundationDiagnostics", {
  value: () => ({
    ...w.diagnostics(),
    lastSave,
    lastReclamation,
    stamp: w.reader.stamp(),
    alternatives: w.reader.read().alternatives.size,
    views: w.reader.read().views.size,
    preview: !!w.reader.preview(),
    calculationRenders,
    baseline: stateText(),
    comparison: [...w.reader.read().alternatives.entries()].map(([id, a]) => ({
      id,
      label: a.label,
      result: stateText({ alternative: id }),
      revisions: a.context.revisions.size,
    })),
  }),
  writable: false,
});
refreshRecent();
renderAuthoring(true);
renderResults();
renderStatus();
let startupMessage =
  "Work is ready. Create a thought, compute a baseline, or preview a possibility.";
if (initialHead) {
  const expected = w.reader.stamp(),
    buffer = draft.value;
  try {
    const savedWork = await io.reopen();
    adopt(expected, buffer, savedWork.loaded);
    generation = savedWork.head.generation;
    saved = w.reader.stamp();
    startupMessage = "Local work restored. No jobs were started.";
  } catch (error) {
    startupMessage =
      "Local save could not be restored; its durable head was preserved. " +
      String(error);
  }
}
renderStatus();
message(startupMessage);
