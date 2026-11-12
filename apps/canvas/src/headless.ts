/** Programmatic canvas host. No DOM, browser persistence, or implicit network transport. */
import * as f from "@manifold/foundation";
import { RegionSession } from "./regions/document.ts";
import { archive, decodeWorkspace } from "./regions/artifacts.ts";
import { canvasSchemas } from "./regions/app/canvasDocument.ts";
import { modelReference } from "./regions/modelCommands.ts";
import type { ModelFamily } from "./regions/foundationModels.ts";
import {
  createHeadlessEdits,
  modelInfo,
  worksheetSnapshot,
  type HeadlessEdits,
  type WorksheetPosition,
} from "./headlessAuthoring.ts";
export type {
  HeadlessEdits,
  WorksheetPosition,
  WorksheetSnapshot,
} from "./headlessAuthoring.ts";
import type { ArtifactExecutor } from "./regions/artifactComputations.ts";
import { MODEL_OUTPUT_REQUEST } from "./regions/modelResults.ts";
import { HeadlessError, headlessOperation } from "./headlessErrors.ts";
export { HeadlessError, type HeadlessErrorCode } from "./headlessErrors.ts";

export type {
  Command,
  Document,
  Json,
  Reference,
  Scope,
} from "@manifold/foundation";
export type { ModelFamily } from "./regions/foundationModels.ts";
export type HeadlessOptions = Readonly<{
  /** Explicit opt-in for sampling. Omission disables the browser's HTTP transport. */
  artifactExecutor?: ArtifactExecutor;
}>;

function describeModel(session: RegionSession, item: string) {
  const document = session.document;
  const info = modelInfo(session, item);
  const project = (reference: f.Reference) =>
    f.project(
      document,
      reference,
      canvasSchemas,
      session.foundation.resources(),
    );
  const outputs = Object.entries(info.definition.outputs).map(
    ([id, output]) => {
      const reference = modelReference(document, item, f.modelPort(id));
      const projection = project(reference);
      let unit: string | null = null;
      if (
        projection.status === "resolved" &&
        projection.projection.type === "scalar"
      ) {
        f.scalar(projection.projection.value);
        unit = projection.projection.value.unit;
      }
      return { id, label: output.label, reference, unit, projection };
    },
  );
  const requests = [...document.items.entries()].flatMap(([, candidate]) => {
    const revision = f.current(document, candidate.id);
    if (
      !revision ||
      !["request@1", MODEL_OUTPUT_REQUEST].includes(revision.schema)
    )
      return [];
    const references = canvasSchemas
      .get(revision.schema)!
      .references(revision.body)
      .filter(
        (ref) =>
          ref.document === document.document &&
          ref.item === item &&
          ref.selection.kind === "follow",
      );
    if (!references.length) return [];
    const reference = modelReference(document, candidate.id);
    return [
      {
        id: candidate.id,
        label: candidate.label,
        reference,
        outputs: outputs
          .filter((output) =>
            references.some(
              (ref) =>
                f.canonical(ref.selector) ===
                f.canonical(output.reference.selector),
            ),
          )
          .map((output) => output.id),
        result: session.foundation.result(reference),
      },
    ];
  });
  return f.freeze({
    id: item,
    label: document.items.get(item)!.label,
    documentId: document.id,
    document: document.document,
    revisionId: info.revision.id,
    definitionRevisionId: info.definitionRevision.id,
    inputs: Object.entries(info.definition.inputs).map(([id, input]) => {
      const node = info.definition.nodes[input.node];
      f.assert(
        node.kind === "input",
        "Model public input is not an input node",
      );
      return {
        id,
        label: input.label,
        unit: node.unit,
        defaultValue: node.default ?? null,
        binding: info.body.inputs[id] ?? null,
        numericEdit: { minimum: -1e12, maximum: 1e12, finite: true },
        projection: project(
          modelReference(document, item, f.modelNode([], input.node)),
        ),
      };
    }),
    outputs,
    requests,
  });
}

export type ModelDescription = ReturnType<typeof describeModel>;

/** Internal live-session adapter. Closing it never closes the canvas owner. */
export function bindLiveWorkspace(session: RegionSession) {
  return host(session, false);
}

function host(session: RegionSession, ownsSession = true) {
  let closed = false;
  let currentTransaction: { failure?: unknown } | undefined;
  function check() {
    if (closed)
      throw new HeadlessError(
        "WORKSPACE_CLOSED",
        "Headless workspace is closed",
      );
    if (currentTransaction) {
      const error = new HeadlessError(
        "OPERATION_REJECTED",
        "Use only the scoped editor inside a transaction",
        { operation: "transaction" },
      );
      currentTransaction.failure = error;
      throw error;
    }
  }
  function guard(expectedDocumentId: string) {
    check();
    if (
      typeof expectedDocumentId !== "string" ||
      expectedDocumentId !== session.document.id
    )
      throw new HeadlessError(
        "STALE_DOCUMENT",
        "Workspace changed; inspect it again before editing",
        {
          expectedDocumentId: expectedDocumentId ?? null,
          currentDocumentId: session.document.id,
        },
      );
  }
  function transaction<T>(
    expectedDocumentId: string,
    operation: (edits: HeadlessEdits) => T,
  ): T {
    guard(expectedDocumentId);
    const state: { failure?: unknown } = {};
    currentTransaction = state;
    try {
      return headlessOperation("transaction", () =>
        session.atomic((staged) => {
          let active = true;
          const edits = createHeadlessEdits(
            staged,
            () => {
              if (!active)
                throw new HeadlessError(
                  "OPERATION_REJECTED",
                  "Transaction editor is closed",
                  { operation: "transaction" },
                );
              if (state.failure) throw state.failure;
            },
            (error) => {
              state.failure = error;
            },
          );
          try {
            const value = operation(edits);
            if (
              value &&
              typeof (value as { then?: unknown }).then === "function"
            ) {
              // Observe rejection from an async callback; its leaked editor is closed below.
              void Promise.resolve(value).catch(() => {});
              throw new HeadlessError(
                "INVALID_INPUT",
                "Transaction callbacks must be synchronous",
                { operation: "transaction" },
              );
            }
            if (state.failure) throw state.failure;
            return value;
          } finally {
            active = false;
          }
        }),
      );
    } finally {
      currentTransaction = undefined;
    }
  }
  const edits = createHeadlessEdits(session, check);
  return Object.freeze({
    /** Immutable accepted document, including qualified references and retained revisions. */
    read() {
      check();
      return session.document;
    },
    /** Current heads only; retained historical revisions remain available through read(). */
    items() {
      check();
      return Object.freeze(
        [...session.document.items.entries()].map(([, item]) =>
          Object.freeze({
            ...item,
            revision: f.current(session.document, item.id),
          }),
        ),
      );
    },
    inspectModel(item: string) {
      check();
      return modelInfo(session, item);
    },
    /** Discover models without knowledge of internal schemas or request-ID conventions. */
    models() {
      check();
      return headlessOperation("models", () =>
        Object.freeze(
          [...session.document.items.entries()]
            .filter(
              ([, item]) =>
                f.current(session.document, item.id)?.schema ===
                "scalar-model-instance@1",
            )
            .map(([, item]) => describeModel(session, item.id)),
        ),
      );
    },
    describeModel(item: string) {
      check();
      return headlessOperation("describeModel", () =>
        describeModel(session, item),
      );
    },
    reference(item: string, selector: f.Json = f.wholeSelector) {
      check();
      return modelReference(session.document, item, selector);
    },
    project(target: f.Reference, context?: f.Context) {
      check();
      return headlessOperation("project", () =>
        f.project(
          session.document,
          target,
          canvasSchemas,
          session.foundation.resources(),
          context,
        ),
      );
    },
    /** Read checked retained evidence; this never starts an execution. */
    result(target: f.Reference, scope: f.Scope = "baseline") {
      check();
      return headlessOperation("result", () =>
        session.foundation.result(target, scope),
      );
    },
    /** One validated atomic publication. The document ID guards an operation reviewed by the caller. */
    apply(commands: readonly f.Command[], expectedDocumentId: string) {
      guard(expectedDocumentId);
      return headlessOperation("apply", () => session.applyCommands(commands));
    },
    worksheet() {
      check();
      return headlessOperation("worksheet", () => worksheetSnapshot(session));
    },
    transaction,
    createEquation(
      text: string,
      expectedDocumentId: string,
      at?: WorksheetPosition,
    ) {
      return transaction(expectedDocumentId, (edits) =>
        edits.createEquation(text, at),
      );
    },
    updateEquation(item: string, text: string, expectedDocumentId: string) {
      return transaction(expectedDocumentId, (edits) =>
        edits.updateEquation(item, text),
      );
    },
    enableScientificMath(item: string, expectedDocumentId: string) {
      return transaction(expectedDocumentId, (edits) =>
        edits.enableScientificMath(item),
      );
    },
    createNote(
      text: string,
      expectedDocumentId: string,
      at?: WorksheetPosition,
    ) {
      return transaction(expectedDocumentId, (edits) =>
        edits.createNote(text, at),
      );
    },
    updateNote(item: string, text: string, expectedDocumentId: string) {
      return transaction(expectedDocumentId, (edits) =>
        edits.updateNote(item, text),
      );
    },
    createModel(family: ModelFamily, expectedDocumentId: string) {
      guard(expectedDocumentId);
      return edits.createModel(family);
    },
    setModelInput(
      item: string,
      port: string,
      value: number,
      expectedDocumentId: string,
    ) {
      guard(expectedDocumentId);
      edits.setModelInput(item, port, value);
    },
    /** Explicit execution; returns the owner's cancellable job and completion promise. */
    compute(target: f.Reference, scope: f.Scope = "baseline") {
      check();
      return headlessOperation("compute", () => session.compute(target, scope));
    },
    undo(expectedDocumentId: string) {
      guard(expectedDocumentId);
      headlessOperation("undo", () => session.undo());
    },
    redo(expectedDocumentId: string) {
      guard(expectedDocumentId);
      headlessOperation("redo", () => session.redo());
    },
    /** Native canvas archive. No filesystem or browser-storage side effects. */
    export() {
      check();
      return headlessOperation("export", () =>
        archive(session.native(session.capture())),
      );
    },
    /** Cancels owned work. Idempotent; all other operations reject after closing. */
    dispose() {
      if (closed) return;
      check();
      closed = true;
      if (ownsSession) headlessOperation("dispose", () => session.dispose());
    },
  });
}

export type HeadlessWorkspace = ReturnType<typeof host>;

export function createHeadlessWorkspace(
  options: HeadlessOptions = {},
): HeadlessWorkspace {
  return headlessOperation("create", () =>
    host(
      new RegionSession(undefined, () => [], undefined, [], false, undefined, {
        artifactExecutor: options.artifactExecutor ?? null,
      }),
    ),
  );
}

/** Same verification, migration and capacity policy as canvas Open; never executes on Open. */
export async function openHeadlessWorkspace(
  text: string,
  options: HeadlessOptions = {},
): Promise<HeadlessWorkspace> {
  let data: Awaited<ReturnType<typeof decodeWorkspace>>;
  try {
    data = await decodeWorkspace(text);
  } catch (cause) {
    throw new HeadlessError(
      "INVALID_WORKSPACE",
      cause instanceof Error ? cause.message : String(cause),
      { operation: "open" },
      { cause },
    );
  }
  if (data.sceneError)
    throw new HeadlessError("INVALID_WORKSPACE", data.sceneError, {
      operation: "open",
    });
  return headlessOperation(
    "open",
    () =>
      host(
        new RegionSession(
          data.page,
          () => [],
          data.document,
          data.artifacts,
          false,
          data.recovery,
          { artifactExecutor: options.artifactExecutor ?? null },
        ),
      ),
    "INVALID_WORKSPACE",
  );
}
