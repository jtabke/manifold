/** Logical retained payload and authoring costs; no heap or supported-capacity claim. */
import { writeFileSync } from "node:fs";
import { cpus, platform, release, arch } from "node:os";
import * as f from "@manifold/foundation";
import { RegionSession, effective } from "../src/regions/document.ts";
import { archive, decodeWorkspace } from "../src/regions/artifacts.ts";
import { canvasSourceDigest } from "./canvas-source-digest.mjs";
const dist = (xs) => {
    xs.sort((a, b) => a - b);
    return {
      min: xs[0],
      median: xs[Math.floor(xs.length / 2)],
      p95: xs[Math.ceil(xs.length * 0.95) - 1],
      max: xs.at(-1),
    };
  },
  rows = [];
for (const definitions of [10, 100]) {
  const s = new RegionSession(),
    csv =
      "gain,noise\n" +
      Array.from({ length: 10000 }, () => "10," + "z".repeat(90)).join("\n"),
    dataset = s.importData("measured.csv", csv, { x: 100, y: 700 });
  s.quantityFromCell(dataset, 0, 0, "k", "N/mm", { x: 100, y: 100 });
  const input = s.create();
  s.write(input, "x := 1 mm");
  const output = s.create();
  s.write(output, "F := k*x");
  for (let i = 3; i < definitions; i++) {
    const id = s.create();
    s.write(id, `Note ${i}`);
  }
  const legacyDefinitionsBytes = f.byteLength(
      JSON.stringify(effective(s.state)),
    ),
    edits = [];
  for (let i = 0; i < 1005; i++) {
    const start = performance.now(),
      r = s.write(input, `x := ${i + 2} mm`);
    if (!r.ok) throw Error(r.error);
    if (i >= 5) edits.push(performance.now() - start);
  }
  const recent = { ...s.recentHistory },
    receipt = s.receipts.at(-1),
    before = s.document,
    keepAt = performance.now();
  const id = s.keepCalculation(receipt.id, "Recorded case");
  const keepMs = performance.now() - keepAt;
  if (s.document === before) throw Error("Keep did not publish");
  const keptValue = s.state.calculations[0],
    afterKeep = [];
  for (let i = 0; i < 35; i++) {
    const start = performance.now();
    s.write(input, `x := ${i + 2000} mm`);
    if (i >= 5) afterKeep.push(performance.now() - start);
    if (s.state.calculations[0] !== keptValue)
      throw Error("Edit copied kept content");
  }
  s.clearRecentCalculations();
  s.compact(s.reviewRetention());
  const text = archive(s.native()),
    loaded = await decodeWorkspace(text);
  if (
    loaded.page.calculations[0].id !== id ||
    loaded.page.calculations[0].snapshot.values.F.value !==
      receipt.values.F.value
  )
    throw Error("Kept meaning changed");
  rows.push({
    regions: s.state.regions.length,
    sourceBytes: f.byteLength(csv),
    mathDefinitions: receipt.definitions.length,
    edits1000Ms: dist(edits),
    recent,
    legacyFullDefinitionsBytesPerEntry: legacyDefinitionsBytes,
    recentSnapshotBytes: f.byteLength(f.canonical(receipt)),
    keepMs,
    editsWithKept30Ms: dist(afterKeep),
    keptRecords: loaded.page.calculations.length,
    nativeBytes: f.byteLength(text),
    sourceOccurrences: text.split(JSON.stringify(csv)).length - 1,
  });
}
const report = {
  date: new Date().toISOString(),
  sourceDigest: canvasSourceDigest(),
  environment: {
    node: process.version,
    cpu: cpus()[0].model,
    platform: platform(),
    release: release(),
    arch: arch(),
  },
  method:
    "10/100 non-data regions (three scalar definitions plus notes) and one 940,010-byte CSV. 5 warmups +1000 measured math edits, then Keep and 5 warmups +30 edits with kept content. Report actual bounded recent-cache accounting (receipt bytes plus unique source revisions), not heap. Former full-definition JSON bytes are a per-entry shape diagnostic, not actual stored data or measured memory. Source counted once across recents and native V5; kept content identity must survive edits. Kept export after clear/compaction reopens with original values. Includes legacy candidate scans/clones and domain validation, excludes React, network and storage I/O. No product capacity/latency acceptance.",
  rows,
};
writeFileSync(
  new URL(
    "../../../evidence/current/canvas/calculation-history-results.json",
    import.meta.url,
  ),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
