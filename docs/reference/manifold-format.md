# `.manifold` file format

A `.manifold` file is UTF-8 JSON, not a ZIP archive or executable program. The
extension denotes portable authored work and retained computation evidence;
browser autosave uses a separate incremental storage protocol. This reference
describes the current canvas writer and foundation reader. The format remains
repository-local and experimental.

## Canvas envelope

The current canvas writer emits compact JSON with exactly these top-level fields:

```json
{
  "format": "manifold-region-artifacts",
  "version": 9,
  "foundation": {
    "format": "manifold-foundation",
    "version": 2,
    "document": {},
    "contexts": {},
    "snapshots": {},
    "receipts": [],
    "assets": {}
  }
}
```

The empty objects above illustrate the envelope, not a valid complete document.
The outer canvas version and inner foundation version are independent. Do not
infer an inner version from the outer version. V9 identifies v3 scientific scalar
math support (V8 introduced v2); the inner writer selects V2, V3 or V4 according to retained evidence.

Canvas Open reads outer V1–V9. V1–V5 use the legacy migration path; V6 additionally
carries legacy artifact `results`; V7–V9 contain only the foundation envelope.
V3 worksheet records use required `canvas-record@2`; source versions are preserved on
import and ordinary edits. Worksheet receipts and sampler methods carry their own
v1/v2/v3 identities. Unknown outer versions are rejected, not guessed or automatically downgraded.
Legacy import migrates data before establishing a live owner. Loaded code and
execution requests never grant permission to run themselves.

## Foundation envelope

All seven fields are required; unknown top-level fields are rejected.

| Field | Meaning |
| --- | --- |
| `format` | Exactly `manifold-foundation`. |
| `version` | Reader accepts 1, 2, 3 and 4. Current writer emits 2–4. |
| `document` | Authored records, selected heads, views, alternatives and durable identity metadata. |
| `contexts` | Package-local IDs mapped to frozen selection contexts used by receipts. |
| `snapshots` | Package-local IDs mapped to captured execution inputs and method versions. |
| `receipts` | Ordered checked execution records referencing context/snapshot table IDs. |
| `assets` | Asset digest keys mapped to included source text. |

Foundation V1 has no identity ledgers or evidence high-water mark; the reader
reconstructs these during migration. V2 requires `document.identities` and
`document.evidenceSequence`. V3 adds projection-dependency provenance to scalar
snapshots. V4 permits typed snapshots. Lower versions cannot carry those newer
evidence structures. Schema IDs and method/runtime versions inside the document
remain independently validated.

`document` contains `document` (durable document identity), `id` (current state
identity), `sequence`, `evidenceSequence`, `identities`, and the keyed `items`,
`revisions`, `views` and `alternatives` tables. Identity ledgers have exactly five
arrays: `items`, `revisions`, `views`, `alternatives` and `receipts`. They retain
retired IDs to prevent identity reuse. Revision bodies are owned and validated by
their declared content schemas, not by arbitrary application JSON conventions.

Receipt IDs and order values must be unique. Referenced contexts/snapshots must
exist, and unused context/snapshot table entries are rejected. Receipts are
validated against document source, method contracts and included assets; a
retained result is not automatically current or physically valid.

## Assets and closure

Asset declarations contain a digest, UTF-8 byte size, media type and disposition
(`included` or `linked`). Included bytes are JSON strings under keys matching
`sha256:` followed by 64 lowercase hexadecimal digits. SHA-256 is computed over
the UTF-8 encoding of the decoded string, not over JSON escape sequences. There
is no implicit base64 or binary encoding. Size declarations count those same
UTF-8 bytes.

The reader verifies hashes and declared sizes and rejects missing/corrupt included
assets. Linked assets need not be available. Fully understood writable packages
reject supplied asset entries not declared by a retained revision or receipt;
they do not silently discard extra payloads on the next save. A digest may be
shared by multiple declarations, but their sizes must agree.

Canvas export compacts revision history to current authored work and retained
source/evidence closure. It preserves durable identities and pinned dependencies.
Session Undo is not portable file history. Contexts, snapshots and assets are
shared within the package rather than repeated for every receipt.

## Limits and trust boundary

The canvas transport limit is **128 MiB** of UTF-8 JSON. Browser Open checks file
size before reading and rechecks decoded text. The CLI checks the opened file's
size and bounds actual reads even if the file grows. CLI edit-batch files have the
same input transport bound. These limits do not raise the canvas's separate
64 MiB conservative retained-state admission budget or 4,096-receipt limit.

The foundation string reader defaults to 64 MiB; canvas supplies 128 MiB.
Foundation native validation also enforces:

- At most 100,000 total entries across items, revisions, views, alternatives,
  contexts, snapshots, receipts and assets, combined.
- At most 100,000 receipts, and at most 100,000 IDs per identity ledger.
- At most 1,000,000 JSON value nodes, including primitive values.
- At most 128 nested objects/arrays, with finite numbers and plain JSON values.

`DecodeLimits` allows hosts to configure byte, aggregate-record, receipt and node
limits. Depth is fixed by the shared JSON validator. Depth/node validation occurs
before cloning/freezing native data. These are data/transport bounds, not a
promise about peak JavaScript heap usage. Legacy canvas formats retain their
migration-specific structural validators; the foundation native limits apply to
the modern foundation decode path.

Unknown required content is rejected. Unknown optional foundation content makes
the entire package read-only; the string reader retains original text and the
string writer returns it unchanged. This opaque path does not interpret receipts
or discard unknown asset closure. Canvas admission may reject content it cannot
render or own. Read-only preservation is not permission to execute unknown data.

Asset digests detect corruption of declared bytes; they are not signatures and do
not authenticate the author or make a document tamper-proof.

## Codec APIs and errors

`encodeEnvelope` builds a writable foundation object; `decodeEnvelope` validates
an already parsed object. Hosts using the object reader must enforce transport
byte limits before parsing. The object reader does not retain another serialized
copy for writable documents. For opaque read-only input it retains a serialized
copy; only `decode(text)` promises preservation of the original JSON whitespace
and byte order. `encode` and `decode` remain compatible string adapters.

Canvas Save/Open use the object APIs so the modern transport is serialized once
on export and parsed once on import. Opaque saved-work rescue may still use the
string preservation path. No container version bump is required.

Foundation codec failures are exceptions; their English messages are diagnostic,
not stable machine codes. Headless Open wraps verification/admission failures as
`INVALID_WORKSPACE`. The CLI reports bounded-read failures as `FILE_TOO_LARGE`
(exit 2); an oversized changed input detected during publication is `STALE_FILE`
(exit 6). See [CLI file safety](cli.md#file-safety-and-errors).

## Implementation and compatibility checks

- Foundation codec: `packages/foundation/src/portable.ts`.
- Canvas wrapper and migration: `apps/canvas/src/regions/app/workspaceCodec.ts`
  and `apps/canvas/src/regions/artifacts.ts`.
- Legacy fixtures and round-trip/corruption tests:
  `packages/foundation/test/portable*.fixture.json`, `foundation.test.mjs`,
  `portable-limits.test.mjs`, and canvas storage/portable-scene/native-workspace tests.

Structural JSON Schema alone cannot validate dimensional semantics, source closure,
receipt currency or content-handler contracts. Changes to the format must retain
legacy fixture coverage and semantic rejection tests, not merely parse successfully.
