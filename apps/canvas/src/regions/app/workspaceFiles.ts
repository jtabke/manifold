import { titleFromFilename } from "../documentTitle.ts";
import { checkWorkspaceFileSize } from "./workspaceCodec.ts";
import { archiveLoaded } from "./workspaceCodec.ts";
import { canvasSchemas } from "./canvasDocument.ts";
import { archive, decodeWorkspace, inspectWorkspace } from "../artifacts.ts";
import { RegionSession } from "../document.ts";
import { markCanvasPrimary } from "./canvasBootstrap.ts";
import {
  openCanvasStore,
  discardStagedCanvas,
  type CanvasLocalStore,
} from "./canvasLocalStore.ts";
import { workspaceStorage } from "../workspaceStorage.ts";

/** React owns unaccepted buffers. The application checks them across asynchronous work. */
export type WorkspaceEdits = {
  read: () => { editing?: string; draft: string };
  finish: () => boolean;
  settle: () => Promise<void>;
};
/** Renderer buffers stay transient, but file transitions observe and finish all of them. */
export function createEditBuffers() {
  const ports = new Map<
    string,
    { read: () => string | undefined; finish: () => boolean }
  >();
  return Object.freeze({
    register(
      id: string,
      port: { read: () => string | undefined; finish: () => boolean },
    ) {
      if (ports.has(id)) throw Error("Duplicate edit buffer");
      ports.set(id, port);
      return () => {
        if (ports.get(id) === port) ports.delete(id);
      };
    },
    compose(primary: WorkspaceEdits): WorkspaceEdits {
      return {
        read() {
          const base = primary.read(),
            extensions = [...ports.entries()].flatMap(([id, port]) => {
              const value = port.read();
              return value === undefined ? [] : [[id, value]];
            });
          return {
            editing:
              base.editing ||
              (extensions.length ? "extension-buffer" : undefined),
            draft: JSON.stringify([base.draft, extensions]),
          };
        },
        finish() {
          if (!primary.finish()) return false;
          for (const port of ports.values())
            if (port.read() !== undefined && !port.finish()) return false;
          return true;
        },
        settle: primary.settle,
      };
    },
  });
}
export type EditBuffers = ReturnType<typeof createEditBuffers>;

/** One I/O lifecycle over the existing owner and store; no additional accepted state. */
export function canvasWorkspace(config: {
  session: RegionSession;
  key: string;
  store?: CanvasLocalStore;
  blocked?: boolean;
  error?: string;
  legacyRescue?: string;
  legacyScene?: string;
  reportError: (message: string) => void;
  openStore?: typeof openCanvasStore;
  discard?: typeof discardStagedCanvas;
  markPrimary?: typeof markCanvasPrimary;
  newSearch?: () => string;
}) {
  const { session } = config,
    openStore = config.openStore || openCanvasStore,
    markPrimary = config.markPrimary || markCanvasPrimary,
    discard = config.discard || discardStagedCanvas,
    newSearch = config.newSearch || (() => `?canvas=${crypto.randomUUID()}`);
  let store = config.store,
    error = config.error || "",
    saving: Promise<boolean> | undefined,
    saveAgain = false,
    transitioning = false;
  const report = (message: string) => {
    error = message;
    config.reportError(message);
  };
  const capture = (edits: WorkspaceEdits) => ({
    document: session.document,
    evidence: session.evidenceSequence,
    ...edits.read(),
  });
  const unchanged = (
    before: ReturnType<typeof capture>,
    edits: WorkspaceEdits,
    message = "Work changed while opening the file. Your current work is preserved; try again when ready.",
  ) => {
    const now = capture(edits);
    if (
      now.document !== before.document ||
      now.evidence !== before.evidence ||
      now.editing !== before.editing ||
      now.draft !== before.draft
    )
      throw Error(message);
  };
  async function finish(edits: WorkspaceEdits) {
    if (!edits.finish()) return false;
    await edits.settle();
    if (edits.read().editing)
      throw Error("Finish the current edit before continuing.");
    return true;
  }
  async function transition<T>(run: () => Promise<T>): Promise<T> {
    if (transitioning)
      throw Error("A workspace transition is already in progress.");
    transitioning = true;
    try {
      return await run();
    } finally {
      transitioning = false;
    }
  }
  function save(): Promise<boolean> {
    if (config.blocked) return Promise.resolve(false);
    saveAgain = true;
    if (saving) return saving;
    const run = async () => {
      try {
        if (!store) {
          const opened = await openStore(config.key);
          try {
            if (await opened.load())
              throw Error(
                "A saved workspace is available. Export new work before reloading it.",
              );
            store = opened;
          } catch (failure) {
            opened.close();
            throw failure;
          }
        }
        let passes = 0;
        while (saveAgain) {
          if (++passes > 8)
            throw Error("Work keeps changing during Save. Retry when ready.");
          saveAgain = false;
          if (!session.isSaved) {
            const result = await store.save(session);
            markPrimary(config.key);
            if (!result.current) saveAgain = true;
          }
        }
        report("");
        return session.isSaved;
      } catch (failure) {
        saveAgain = false;
        const reason = (failure as Error).message;
        report(
          reason.includes("Save conflict")
            ? "Another tab saved a newer version. Your work is still open here; export it before reloading."
            : reason.includes("recovery budget")
              ? "Local save needs history cleanup or a fresh exported copy. Current work remains open."
              : "Local save failed. Your work is still open here; retry or export a copy.",
        );
        return false;
      }
    };
    const promise = run();
    saving = promise;
    void promise.finally(() => {
      if (saving === promise) saving = undefined;
      if (saveAgain && !session.isSaved) void save();
    });
    return promise;
  }
  async function readyToLeave(edits: WorkspaceEdits) {
    if (config.blocked || error)
      throw Error("Export current work first; local save is unavailable.");
    if (!(await finish(edits))) return;
    const before = capture(edits);
    if (!(await save()))
      throw Error(
        "Current work could not be saved. Export it before opening another workspace.",
      );
    unchanged(before, edits);
    return before;
  }
  return Object.freeze({
    save,
    store: () => store,
    rescueSaved: () =>
      transition(async () => {
        if (config.legacyRescue !== undefined) {
          const inspected = await inspectWorkspace(
            config.legacyRescue,
            config.legacyScene,
          );
          if (config.legacyScene !== undefined)
            return archiveLoaded(inspected.recovery.foundation, canvasSchemas);
          return config.legacyRescue;
        }
        if (!store) throw Error("Saved workspace storage is unavailable.");
        return store.exportSaved(config.legacyScene);
      }),
    export: (edits: WorkspaceEdits) =>
      transition(async () => {
        if (!(await finish(edits))) return;
        const saved = session.capture();
        return archive(session.native(saved));
      }),
    newCanvas: (edits: WorkspaceEdits) =>
      transition(async () => {
        if (!(await readyToLeave(edits))) return;
        return newSearch();
      }),
    open: (
      file: Pick<File, "size" | "text"> & { name?: string },
      edits: WorkspaceEdits,
    ) =>
      transition(async () => {
        if (config.blocked || error)
          throw Error("Export current work first; local save is unavailable.");
        checkWorkspaceFileSize(file.size);
        const before = capture(edits),
          incoming = await stageWorkspaceFile(await file.text());
        if (incoming.state.title === undefined && file.name)
          incoming.renameDocument(titleFromFilename(file.name));
        unchanged(
          before,
          edits,
          "Work changed while reading the file. Open it again when your edit is ready.",
        );
        const saved = await readyToLeave(edits);
        if (!saved) return;
        const search = newSearch(),
          key = workspaceStorage("manifold.artifact-experiment.v1", search),
          target = await openStore(key);
        let staged = false;
        try {
          try {
            if (await target.load())
              throw Error("The destination canvas already exists.");
            staged = true;
            await target.save(incoming);
          } finally {
            target.close();
          }
          unchanged(saved, edits);
          markPrimary(key);
          staged = false;
          return search;
        } finally {
          if (staged) await discard(key).catch(() => {});
        }
      }),
  });
}

/** Validate once into an isolated owner before any storage or navigation side effect. */
export async function stageWorkspaceFile(text: string): Promise<RegionSession> {
  const data = await decodeWorkspace(text);
  return new RegionSession(
    data.page,
    () => [],
    data.document,
    data.artifacts,
    false,
    data.recovery,
  );
}
