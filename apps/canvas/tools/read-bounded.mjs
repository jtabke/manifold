import { open } from "node:fs/promises";

/** Check the opened file, then cap actual bytes read even if it grows after stat. */
export async function readBoundedText(path, maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
    throw new Error("Invalid input byte limit");
  const handle = await open(path, "r");
  const tooLarge = () => {
    const error = new Error(
      `Input exceeds the ${maxBytes}-byte limit: ${path}`,
    );
    error.code = "FILE_TOO_LARGE";
    throw error;
  };
  try {
    const stat = await handle.stat();
    if (stat.size > maxBytes) tooLarge();
    const chunks = [];
    let bytes = 0;
    for (;;) {
      const buffer = Buffer.allocUnsafe(
        Math.min(64 * 1024, maxBytes - bytes + 1),
      );
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      bytes += bytesRead;
      if (bytes > maxBytes) tooLarge();
      chunks.push(buffer.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, bytes).toString("utf8");
  } finally {
    await handle.close();
  }
}
