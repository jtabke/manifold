import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export const evidenceEnabled = process.env.MANIFOLD_TEST_EVIDENCE === "1";

/** Optional success captures; failure screenshots stay unconditional at their call sites. */
export async function captureEvidence(page, options) {
  if (!evidenceEnabled) return;
  await mkdir(dirname(options.path), { recursive: true });
  return page.screenshot(options);
}
