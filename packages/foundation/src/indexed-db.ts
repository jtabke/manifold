import { assert } from "./value.ts";
import type { Head } from "./storage.ts";
import { commitRecords, type RecordBackend } from "./record-backend.ts";
import {
  captureRecords,
  advanceClock,
  state,
  reclamationState,
  type Inspection,
  type ReclaimPlan,
  type SnapshotLimits,
} from "./local-store.ts";
/** Promoted F2 staging/CAS adapter. The transaction covers head and referenced record existence. */
export async function indexedBackend(
  name: string,
): Promise<
  RecordBackend & { close(): void; loseAsset(key: string): Promise<void> }
> {
  assert(
    /^manifold-foundation-[a-zA-Z0-9-]+$/.test(name),
    "Use a foundation database namespace",
  );
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 2);
    let blocked = false;
    request.onblocked = () => {
      blocked = true;
      reject(Error("Close older foundation tabs to upgrade storage"));
    };
    request.onupgradeneeded = () => {
      for (const store of ["assets", "packages", "head"])
        if (!request.result.objectStoreNames.contains(store))
          request.result.createObjectStore(store);
    };
    request.onsuccess = () => {
      if (blocked) request.result.close();
      else resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  });
  database.onversionchange = () => database.close();
  const inspections = new WeakMap<Inspection, ReclaimPlan>();
  function request<T>(value: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      value.onsuccess = () => resolve(value.result);
      value.onerror = () => reject(value.error);
    });
  }
  function complete(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? Error("Aborted head transaction"));
      tx.onerror = () => reject(tx.error ?? Error("Aborted head transaction"));
    });
  }
  async function dbState(tx: IDBTransaction) {
    const head = tx.objectStore("head"),
      [current, epoch, revision] = await Promise.all([
        request(head.get("current")),
        request(head.get("epoch")),
        request(head.get("revision")),
      ]);
    return state(current ?? null, epoch ?? 0, revision ?? 0);
  }
  async function run<T>(
    mode: IDBTransactionMode,
    fn: (tx: IDBTransaction) => Promise<T>,
  ): Promise<T> {
    const tx = database.transaction(["assets", "packages", "head"], mode),
      done = complete(tx);
    try {
      const result = await fn(tx);
      await done;
      return result;
    } catch (error) {
      try {
        tx.abort();
      } catch {}
      await done.catch(() => {});
      throw error;
    }
  }
  function scan(tx: IDBTransaction) {
    return {
      state: () => dbState(tx),
      get: async (store: "assets" | "packages", key: string) =>
        (await request(tx.objectStore(store).get(key))) as string | undefined,
      inventory: (
        store: "assets" | "packages",
        visit: (key: string, text: string) => void,
      ) =>
        new Promise<void>((resolve, reject) => {
          const cursor = tx.objectStore(store).openCursor();
          cursor.onerror = () => reject(cursor.error);
          cursor.onsuccess = () => {
            try {
              const at = cursor.result;
              if (!at) {
                resolve();
                return;
              }
              assert(
                typeof at.key === "string" && typeof at.value === "string",
                "Invalid stored inventory",
              );
              visit(at.key, at.value);
              at.continue();
            } catch (error) {
              reject(error);
            }
          };
        }),
    };
  }
  async function read<T>(store: string, key: string): Promise<T | undefined> {
    const tx = database.transaction(store, "readonly"),
      done = complete(tx);
    const value = await request(tx.objectStore(store).get(key));
    await done;
    return value as T | undefined;
  }
  async function write(
    store: string,
    key: string,
    data: string,
  ): Promise<void> {
    const tx = database.transaction([store, "head"], "readwrite"),
      done = complete(tx);
    try {
      const target = tx.objectStore(store),
        prior = await request(target.get(key));
      assert(
        prior === undefined || prior === data,
        "Immutable staged record conflict",
      );
      if (prior === undefined) {
        const previous = await dbState(tx);
        target.put(data, key);
        tx.objectStore("head").put(advanceClock(previous.revision), "revision");
      }
      await done;
    } catch (error) {
      try {
        tx.abort();
      } catch {}
      await done.catch(() => {});
      throw error;
    }
  }
  return Object.freeze({
    putAsset: (key: string, data: string) => write("assets", key, data),
    putPackage: (key: string, data: string) => write("packages", key, data),
    asset: (key: string) => read<string>("assets", key),
    package: (key: string) => read<string>("packages", key),
    head: async () => (await read<Head>("head", "current")) ?? null,
    state: () => run("readonly", dbState),
    snapshot: (limits?: SnapshotLimits) =>
      run(
        "readonly",
        async (tx) => (await captureRecords(scan(tx), limits)).snapshot,
      ),
    inspect: async (limits?: SnapshotLimits) => {
      const { plan } = await run("readonly", (tx) =>
        captureRecords(scan(tx), limits, true),
      );
      inspections.set(plan!.inspection, plan!);
      return plan!.inspection;
    },
    reclaim: async (inspection: Inspection, abort = false) => {
      const plan = inspections.get(inspection);
      assert(plan, "Unrecognized storage cleanup review");
      const result = await run("readwrite", async (tx) => {
        const current = await dbState(tx),
          next = reclamationState(plan, current);
        for (const key of plan.packages) tx.objectStore("packages").delete(key);
        for (const key of plan.assets) tx.objectStore("assets").delete(key);
        if (next.epoch !== current.epoch) {
          tx.objectStore("head").put(next.epoch, "epoch");
          tx.objectStore("head").put(next.revision, "revision");
        }
        assert(!abort, "Aborted storage cleanup");
        return Object.freeze({
          epoch: next.epoch,
          removedPackages: plan.packages.length,
          removedAssets: plan.assets.length,
          reclaimedBytes: inspection.before.bytes - inspection.after.bytes,
        });
      });
      inspections.delete(inspection);
      return result;
    },
    async publish(
      expected: number,
      next: Omit<Head, "generation">,
      required: readonly string[],
      abort: boolean,
    ): Promise<Head> {
      const tx = database.transaction(
          ["assets", "packages", "head"],
          "readwrite",
        ),
        done = complete(tx);
      try {
        const [head, pack, ...bytes] = await Promise.all([
          request(tx.objectStore("head").get("current")),
          request(tx.objectStore("packages").get(next.package)),
          ...required.map((key) => request(tx.objectStore("assets").get(key))),
        ]);
        assert(
          ((head as Head | undefined)?.generation ?? 0) === expected,
          "Save conflict: durable generation changed",
        );
        assert(
          pack !== undefined &&
            bytes.every((value) => typeof value === "string"),
          "Missing staged records",
        );
        const accepted = Object.freeze({
          ...next,
          generation: advanceClock(expected),
        });
        const previous = await dbState(tx);
        tx.objectStore("head").put(accepted, "current");
        tx.objectStore("head").put(advanceClock(previous.revision), "revision");
        if (abort) tx.abort();
        await done;
        return accepted;
      } catch (error) {
        try {
          tx.abort();
        } catch {}
        await done.catch(() => {});
        throw error;
      }
    },
    async commit(...args: Parameters<RecordBackend["commit"]>) {
      const [expected, next, chunks, assets, fault, expectedEpoch] = args;
      const tx = database.transaction(
          ["assets", "packages", "head"],
          "readwrite",
        ),
        done = complete(tx);
      try {
        const result = await commitRecords(
          expected,
          next,
          chunks,
          assets,
          fault,
          {
            state: () => dbState(tx),
            get: async (store, key) =>
              (await request(tx.objectStore(store).get(key))) as
                | string
                | undefined,
            put: (store, key, text) => {
              tx.objectStore(store).put(text, key);
            },
            publish: (head) => {
              tx.objectStore("head").put(head, "current");
            },
          },
          expectedEpoch,
        );
        const previous = await dbState(tx);
        tx.objectStore("head").put(advanceClock(previous.revision), "revision");
        await done;
        return result;
      } catch (error) {
        try {
          tx.abort();
        } catch {}
        await done.catch(() => {});
        throw error;
      }
    },
    async loseAsset(key: string) {
      const tx = database.transaction(["assets", "head"], "readwrite"),
        done = complete(tx);
      const previous = await dbState(tx);
      tx.objectStore("assets").delete(key);
      tx.objectStore("head").put(advanceClock(previous.epoch), "epoch");
      tx.objectStore("head").put(advanceClock(previous.revision), "revision");
      await done;
    },
    close: () => database.close(),
  });
}
