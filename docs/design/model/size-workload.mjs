/** Synthetic serialization sizing, not an application throughput or memory benchmark. */
const count = 10_000;
const alternatives = 100;
const changes = 50;
const payloadLength = 1_024;
const encoder = new TextEncoder();
const bytes = (value) => encoder.encode(JSON.stringify(value)).byteLength;
const pad = (n) => String(n).padStart(5, "0");
const definition = (n, version) => ({
  id: `revision-${pad(n)}-${pad(version)}`,
  definition: `definition-${pad(n)}`,
  scope: "root",
  body: {
    kind: "note",
    text: String(version % 10).repeat(payloadLength),
    format: "plain",
  },
});
const base = Array.from({ length: count }, (_, n) => definition(n, 0));
const records = Object.fromEntries(base.map((r) => [r.id, r]));
const snapshots = [
  {
    id: "snapshot-00000",
    document: "document",
    definitions: Object.fromEntries(base.map((r) => [r.definition, r.id])),
    sources: {},
    scopes: { root: {} },
  },
];
for (let branch = 1; branch <= alternatives; branch++) {
  const selection = { ...snapshots[0].definitions };
  for (let n = 0; n < changes; n++) {
    const record = definition(n, branch);
    records[record.id] = record;
    selection[record.definition] = record.id;
  }
  snapshots.push({
    ...snapshots[0],
    id: `snapshot-${pad(branch)}`,
    definitions: selection,
  });
}
// Fixed-length generated fields make all independently expanded snapshot arrays equal size.
const expandedBytes = bytes(base) * snapshots.length;
const recordsBytes = bytes(records);
const snapshotsBytes = bytes(snapshots);
console.log(
  JSON.stringify(
    {
      workload: {
        definitions: count,
        alternatives,
        changedDefinitionsPerAlternative: changes,
        textBytesPerDefinition: payloadLength,
      },
      retainedDefinitionRevisions: Object.keys(records).length,
      expandedDefinitionArraysBytes: expandedBytes,
      normalizedRevisionTableBytes: recordsBytes,
      completeSnapshotMapsBytes: snapshotsBytes,
      normalizedTotalBytes: recordsBytes + snapshotsBytes,
      notes:
        "UTF-8 JSON sizing only. Excludes blobs, receipts, indexes, history roots, allocator overhead and archive validation. Dense maps still copy O(N) entries per alternative.",
    },
    null,
    2,
  ),
);
