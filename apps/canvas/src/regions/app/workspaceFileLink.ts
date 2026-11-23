// File access is explicitly granted by the OS picker. A browser-local handle is
// navigation metadata, never part of the portable workspace or its save head.
export type WorkspaceFileHandle = FileSystemFileHandle & {
  requestPermission?: (options: { mode: "read" }) => Promise<PermissionState>;
};
export type FileVersion = Pick<File, "size" | "lastModified">;
export type WorkspaceVersion = {
  document: string;
  root: string;
  evidence: number;
};
export type WorkspaceFileLink = {
  handle: WorkspaceFileHandle;
  version: FileVersion;
  digest: string;
  base: WorkspaceVersion;
};
export const fileVersion = ({
  size,
  lastModified,
}: FileVersion): FileVersion => ({
  size,
  lastModified,
});
export const sameFileVersion = (a: FileVersion, b: FileVersion) =>
  a.size === b.size && a.lastModified === b.lastModified;

type FilePickerOptions = {
  types: { description: string; accept: Record<string, string[]> }[];
};
const pickerHost = () =>
  window as Window & {
    showOpenFilePicker?: (
      options: FilePickerOptions,
    ) => Promise<WorkspaceFileHandle[]>;
    showSaveFilePicker?: (
      options: FilePickerOptions & {
        suggestedName: string;
        excludeAcceptAllOption: boolean;
      },
    ) => Promise<FileSystemFileHandle>;
  };
export function workspaceFilePicker() {
  const host = pickerHost();
  return host.showOpenFilePicker?.bind(host);
}
export function workspaceSavePicker() {
  const host = pickerHost();
  return host.showSaveFilePicker?.bind(host);
}

export async function writeWorkspaceFile(
  file: FileSystemFileHandle,
  blob: Blob,
) {
  const writer = await file.createWritable();
  try {
    await writer.write(blob);
    await writer.close();
  } catch (failure) {
    await writer.abort().catch(() => {});
    throw failure;
  }
}

async function linkStore<T>(
  mode: IDBTransactionMode,
  use: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("manifold-workspace-file-links", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("links");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction("links", mode),
        request = use(tx.objectStore("links"));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export const readWorkspaceFileLink = (key: string) =>
  linkStore<WorkspaceFileLink | undefined>("readonly", (store) =>
    store.get(key),
  );
export const saveWorkspaceFileLink = (key: string, source: WorkspaceFileLink) =>
  linkStore("readwrite", (store) => store.put(source, key));
export const removeWorkspaceFileLink = (key: string) =>
  linkStore("readwrite", (store) => store.delete(key));
