# Portable work and native documents

**Current status, 2026-10-28:** application native V7 writes one foundation envelope with
supported authored content, source/evidence closure and authored groups/tools/named layouts.
Fresh-environment Open and local recovery pass the application acceptance audit (internal design note).
V1–V6 remain read adapters and loaded code stays paused. Active camera, focus and navigation
are personal unless explicitly captured in a named viewpoint. Richer tool semantics,
partial-source containers and collaboration retain separate feature gates. The precedents
and broader requirements below explain the design direction.

## The product promise

An engineer can save a canvas, move the file to another computer or send it to someone,
and open it in a compatible Manifold reader without the original browser storage,
canvas URL or machine. Supported authored content remains editable. Preserved sources,
relationships and saved conclusions retain their identity and context. Dependencies
that were not included or cannot run are explicit.

Portability has three distinct outcomes: inspect retained work, edit supported content,
and recompute results. A file may support the first two while a particular calculation
needs an unavailable solver. Do not reduce this to one opaque “portable” flag. File
transfer is useful before a sharing service, accounts or live collaboration exists.

## Relevant precedents

These are verified design precedents, not claims that their formats satisfy Manifold's
engineering semantics. The recommendations below are our architectural inferences.

### Excalidraw: a versioned scene document

The documented `.excalidraw` format is plaintext JSON with a format type/version,
scene elements, application settings and image-file data. This makes editable scene
information a first-class document rather than just a rendered image.
[Excalidraw JSON schema](https://docs.excalidraw.com/docs/codebase/json-schema/)

Its export implementation distinguishes local-file and database serialization,
cleans application state for export and includes files referenced by nondeleted image
elements for local export. The state configuration distinguishes browser, export and
server fields, with file handles and transient collaboration state excluded from export.
[JSON export implementation](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/data/json.ts),
[application-state policy](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/appState.ts)

**Borrow:** a small versioned envelope, explicit asset inclusion and a deliberate
saved-state policy. Do not serialize the live React/application object graph.

### draw.io: native editing information survives the handoff

The official documentation recommends `.drawio`, describes its XML-based native
format and also supports PNG/SVG files containing diagram data that can be reopened.
[Native save formats](https://www.drawio.com/docs/manual/editor/save-file-formats/)

The editable-PNG documentation explains embedding XML and reopening the diagram. It
also notes that some image-sharing services strip metadata when resampling images.
[Embedded diagram data in PNG](https://www.drawio.com/docs/manual/export/xml-in-png/)

**Borrow:** make the editable native file the reliable handoff. An optional preview
can accompany or later carry native data; an ordinary screenshot is not the complete
engineering document. Metadata-bearing images are a convenience, not our only copy.

### Jupyter: source and saved output are different information

The notebook specification separates format versions, metadata, cell source and
execution outputs, including rich MIME representations. A saved result can therefore
travel with authored computation.
[Jupyter notebook specification](https://nbformat.readthedocs.io/en/latest/format_description.html)

**Borrow:** preserve inspectable source and readable outputs together. For Manifold,
also retain resolved source/input revisions and method requirements; a visible output
or execution counter alone is insufficient evidence that it can be reproduced.

### FreeCAD: a compound engineering document

FreeCAD's published FCStd format documentation describes a ZIP container with semantic
Document.xml, separate GUI representation, optional thumbnails and stored geometry.
This is a relevant engineering precedent for keeping structured metadata and richer
assets together while separating meaning from presentation.
[FreeCAD file-format documentation](https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/File_Format_FCStd.md)

**Borrow:** a logical manifest plus separately addressable assets, including usable
saved representations when the original computation is expensive. This is a format
pattern, not a decision to adopt FCStd or translate every native source into our schema.

## Recommended document boundary

Design a native Manifold document as a versioned logical package. It contains one
selected accepted workspace state and its required reachable information. The on-disk
container and extension are implementation choices; a custom suffix alone supplies
neither portability nor a coherent architecture.

The package must describe:

- **Identity and version:** format/schema version, document lineage, saved root/version
  and qualified references. The reader capability requirements are explicit.
- **Authored work:** notes, unfinished mathematics, definitions and typed relationships.
  Explicit Save first retains active authored text as a draft through an operation;
  a failed parse cannot discard it. Unaccepted numerical previews remain temporary.
- **Presentation:** views, arrangement, saved groups/viewpoints and comparison
  selections needed to understand the work. User/device preferences are separate;
  a useful opening view must not require the original screen dimensions.
- **Required revisions:** selected source/content versions and historical versions
  reachable from retained comparisons and receipts. Export need not include all
  abandoned edits or session Undo history.
- **Assets:** imported measurements, available native files and required derived data,
  with package-relative logical references, media type, byte size and integrity data.
  Shared assets are included once. Neither a browser object URL nor an absolute local
  filesystem path is a portable identity.
- **Evidence and requirements:** retained result data/previews, evaluated input/source
  identities, method/code versions and nonsecret runtime/adapter requirements. These
  describe what happened and what is needed, without claiming a dependency is installed.

A workspace can eventually contain multiple canvases; the first implementation needs
only one root canvas and its dependency closure. Named root records allow this to grow
without making every canvas a silo or duplicating every shared source.

## Assets and external dependencies

The default native save includes app-owned content and available imported source bytes.
For each remaining external dependency, distinguish included, intentionally linked,
unavailable or omitted. Keep an explicit manifest/report of what is needed, whether
it can be inspected locally and whether it blocks recomputation. Never report a
link-only package as self-contained. Preserve richer source access as far as its owner
actually exposes; do not substitute a mesh or screenshot without recording the loss.

An external locator identifies where to look, not proof that the recipient has access
or that the same revision still exists. Missing credentials remain local configuration;
credentials, machine file handles and temporary execution sessions do not belong in
a shared document. Opening a file reads data; it does not automatically run embedded
code, fetch private sources or silently update linked versions. Execution remains an
explicit supported operation with the normal capability/effect boundary.

A reader negotiates declared root/content-schema, selector/resolver, renderer and
method/runtime versions. It reports inspection, editing and recomputation separately,
scoped to the affected resource/request rather than one global compatible flag. The
codec checks structure/encoding; domain functions validate understood semantic rules;
adapter results have their own validation. A generic reader can show supported notes,
metadata and saved representations while marking unsupported content/tools. Unknown versioned payloads must be preserved for
round-trip or left intact in a read-only package; they must not be stripped on save.
Unknown root versions fail without overwriting the original bytes or current work.
A stored result may be shown as saved evidence with its context; source/tool absence
cannot turn it into a newly verified result or a reproducibility claim.

## Opening, copying and identity

Normal Open preserves document and object lineage and establishes a new local storage
binding. Renaming or moving a file does not rename engineering identities. “Make an
independent copy” is a separate action that allocates independent lineage and remaps
internal references coherently, retaining source provenance and reusable byte identities.

Two edited files with the same lineage may have diverged. Detect differing heads;
open separately or require an explicit future reconcile operation. Do not overwrite
an existing canvas solely because a file carries the same document ID. Workspace
sequence numbers are local ordering, not globally unique revisions or a merge policy.
Sharing files does not imply live synchronization or semantic merging.

Save captures one coherent root and pins its reachable revisions while serializing.
Later edits cannot mix newer sources with older definitions in the exported file.
Load parses and validates in staging before publishing accepted state. Invalid internal
references, missing supposedly included bytes or incompatible required schemas cannot
silently replace existing work. Intentional external absence is a dependency state,
not the same thing as package corruption. Validate package entry presence/size before
adoption; eager F1 fixtures also check payload digests. A future lazy reader may defer
full-byte verification, but must expose unverified integrity and reject a digest
mismatch before using data. It cannot label an opened package fully verified merely
because the metadata parsed. See the [ownership contracts](architecture.md#resource-access-and-large-information).

## F2 extension and browser proof

The F2 experiment (local-only experiment) extends the private fixture package
with property/claim/relation and mocked native-source revisions. Fresh-process and
fresh-Chrome-context handoffs preserve claims, selected source revisions, split-face
ambiguity, draft editability and included asset counts. It also tests exact-root storage
acknowledgements, aborted transactions and missing-asset recovery. These results apply
to the isolated harness, not the current application or a production file format.

## F3 request and evidence handoff

The F3 experiment (local-only experiment) retains authored requests, exact
method/runtime requirements, actual input/source revision snapshots and ordered success/
failure receipts. Fresh-process and fresh-browser handoff start no jobs. Active jobs and
derived current associations are excluded. Unavailable linked-source receipts remain
historical evidence while current inputs stay blocked; missing included bytes reject.

Receipt arrival changes the retained portable state independently of authored Undo.
Save acknowledgement therefore covers authored root, evidence version and destination
binding. A delayed Open also checks for newly arrived receipts and newly typed draft
text. The closed F3 fixture rejects unknown contracts before adoption; it does not select
a public compatibility policy, container, retention rule or production executor.

## Reusable v0 native work

The [foundation package](../../packages/foundation/README.md) now implements a separate v0
native envelope carrying complete reachable alternatives, views, sources and receipts.
Source bytes and repeated receipt contexts/input snapshots are shared in transport. A
fresh reader restores the work without active jobs or original runtime state. Unknown
optional content preserves the whole original package read-only, including unknown frozen
closure and uninterpreted receipts; no missing interpretation is fabricated.

This is a usable package/workbench contract with linked evidence (local-only report),
not a migration of existing canvas archives or a final production container decision.
The writer now emits native v2 with durable item/revision/view/alternative/receipt identity
ledgers and an evidence high-water clock; cleanup cannot recycle IDs or rewind Save versions.
The v1 reader migrates identities present in older packages, without reconstructing absent
history. Reviewed retention (internal design note) protects selected work, Undo,
alternatives, active captures and cited attempts. Byte deduplication preserves per-source
identity/media interpretation. Reader budgets, retained identity-marker growth and full-load
validation still constrain capacity. This does not reclaim older local database generations.

Incremental local snapshots (internal design note) now encode hot saves as private
content-addressed branches/records with an atomic durable-head CAS. Native files contain no
physical tree nodes, cache tokens or local database keys. The workbench reads older local
envelopes and preserves opaque packages exactly. Local recovery restores physical shape only
after full owner validation; no physical layout is added to native files. Full Open/native
export and [reviewed old-generation reclamation](decisions/0013-coordinated-storage-reclamation.md)
remain distinct costs and contracts. Coherent full reads own their captured bytes; storage
epochs force one bounded Save rebuild after deletion. The latest durable root remains intact.

## Storage and file-format options

A readable JSON document is a good initial fixture encoding: easy to inspect and
compare, with no packaging framework needed for notes and a small table. JSON with
inline asset encodings becomes expensive for large native/binary content. A directory
of metadata and assets is inspectable and can support changed-file workflows, but is
less convenient to hand off as one attachment. An archive containing a readable manifest
and distinct assets is a strong candidate for the user-facing native file when those
assets grow. Measure export size, peak memory, load time, partial access and compatibility
before choosing the production container. These are physical encodings of one logical
package, not three competing domain models.

Browser autosave may use indexed records, blobs and caches; the native document remains
a documented transport contract independent of that implementation. A future storage
change must not require recipients to reconstruct local database keys or runtime objects.
Capture/exchange a complete package when sharing; incremental local saves need not
rewrite a complete archive after every keystroke. Use chunking/streaming and shared
assets as needed rather than requiring every file to fit in one JSON string in memory.

## Acceptance from the first slice

F1 must encode its authored note/draft, table bytes, references and views as plain data,
then load them in a separate process/fresh core instance without original state, storage
keys, paths or object identities. This is a fixture format, not the final public schema.

Verify stable identities/revisions, a pinned selected cell, two views of one source,
editable unfinished work, shared-asset counts and useful opening context. Inject an
absent linked dependency, missing included bytes, unsupported required schema and
unknown optional payload; distinguish their outcomes and preserve current work on
failed load. Check that file data is inert and no runtime handle/session is required.

Repeat this clean-environment handoff gate for every later slice: relations in F2,
request/evidence metadata in F3, pinned alternatives in F4, transactional persistence
and version migration in F5, instance/port references in F6. F5 chooses the mature
container and durable implementation; it is not the first time portability is tested.

The isolated F1 experiment (local-only experiment) now demonstrates a
clean-process handoff for its text/draft/table fixture, preserving editability, pins
and shared assets. F1b (local-only experiment) repeats the handoff after
changing the private in-memory map/Undo representation; those runtime nodes and
compatibility metadata do not enter the native data. It does not integrate with the application or establish a public
native format. The canvas adoption (internal design note) and
Keep/Undo successor (internal design note) now provide native V5 file Open/export,
V1–V4 reads, durable identities and checked-result handoff in a fresh browser, without executing
loaded code. Incremental local storage (internal design note) remains a private
physical graph independent of those native files. Explicitly kept calculations (internal design note) travel with their evaluated
mathematics and source pins; temporary recency and authored Undo do not. Authored scene groups/tools/closed/pins and named model/camera viewpoints now travel as ordinary
records, with exact layout component pins through cleanup. Active camera, selection, focus, navigation
and title remain browser preferences. See [ADR 0032](decisions/0032-portable-authored-canvas-scene.md)
for old-scene read migration, authoritative empty markers and recipient attention isolation. Richer
sources and broader renderer capacity remain separate feature gates.
See [archive/restore](../../apps/canvas/src/regions/artifacts.ts),
[export action](../../apps/canvas/src/regions/app/Regions.tsx),
[authored scene records](../../apps/canvas/src/regions/sceneRecords.ts) and
[storage binding](../../apps/canvas/src/regions/workspaceStorage.ts).
