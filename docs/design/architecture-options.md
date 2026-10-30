# Architecture options against the vision

**Status:** Exploratory assessment, 2026-10-23. No architecture option is accepted.
The foundation brief (internal design note) translates this assessment
into the active implementation sequence and a bounded first task as of 2026-10-24.
The earlier [record-model proposal](data-model.md) is one candidate, not the premise
of this comparison. Start with the [vision](../vision.md) and
[interaction contract](../interaction-design.md).

## What we need to decide first

We moved from a domain vocabulary to detailed revision records before demonstrating
that the proposed primitives support the full product. The spring-equation fixture
shows useful arithmetic/versioning behavior. It cannot establish the right foundation
for sketches, native geometry, measured-versus-predicted values, or equations with
several legitimate solution directions. The storage sizing exercise says nothing
about which of those things should have independent engineering identities.

Separate four axes of architecture:

| Axis | Question | Candidate choices |
| --- | --- | --- |
| Semantic authority | What is the enduring authored information, and who defines its meaning? | Document content, computational operators, engineering objects, or typed local/native resources with shared interfaces. |
| Execution | How does a request acquire an answer? | Cell evaluation, reactive dataflow, equation/constraint solving, external jobs, or a bounded composition of these. |
| Change and history | What changes together; what follows live edits; what stays frozen? | Shared operations with preview/Undo, context selection, immutable versions, optional operation history and later collaborative merge. |
| Physical storage/deployment | How are records/bytes indexed, persisted and distributed? | Local archive, transactional records/blobs, persistent maps, indexes, caches and optional remote execution. |

A graph database, relational tables, component storage, an event log or CRDT does
not by itself answer what a quantity or a connection means. A semantic graph can
be stored in normalized tables. A document can evaluate a derived dependency graph.
A local application can delegate a solver job without adopting microservices.
Evaluate these choices independently before combining them.

## Vision obligations

These are obligations from our existing direction, not feature requests or invented
performance scores. An architecture must explain the mechanism, not just claim fit.

| Vision commitment | Required architectural behavior | Evidence that would contradict fit |
| --- | --- | --- |
| Express freely; structure emerges | Retain notes, drafts and imported information without completing a schema or constructing a model first. | A note, sketch or unfinished equation requires ports, a quantity declaration or an executable graph. |
| Meaning survives representation | Separate retained information from visual placement and presentation. Allow multiple views and explicit independent copies. | Moving/grouping/duplicating a view changes definitions or recomputes numerical work. |
| Connect effortlessly and correctly | Address whole resources and meaningful parts; distinguish reference, dependency, association, derivation and physical-equivalence claims. | Matching symbols/units or proximity silently merges information; ambiguous subelements retarget. |
| Explore continuously | Preview cheaply where possible, communicate expensive work, compare earlier contexts and recover. | Every gesture persists a full branch or launches every downstream external job. |
| Preserve rich information | Retain native authority, available structure and transformation provenance; disclose inaccessible information. | A mesh or scalar blob becomes the only surviving representation of a richer source. |
| Compose specialized tools | Give adapters explicit types, capabilities, effects, versions and unavailable states. | Each new discipline adds special cases to every core operation or needs a universal physics engine. |
| Complexity on demand | Keep authored content, semantic scope, visual grouping and execution boundaries distinct. | A freeform layout becomes a mandatory subsystem tree or universal wiring diagram. |
| Optional AI; shared operations | Make the manual path useful, with inspectable operations and the same semantics for pointer, keyboard, AI and API. | An agent must interpret every connection or bypasses binding/Undo rules. |

## Scenarios that discriminate between architectures

Use the same scenarios for every option. These are design probes, not a new delivery
milestone. Supported arithmetic and mocked native/solver adapters are sufficient for
initial experiments; do not build CAD or a general solver merely to compare designs.

1. **Unfinished thought.** Write a note, `F =`, and a sketch on a blank canvas. Move
   them and later give an expression meaning. Preserve identity through partial edits
   without pretending the sketch or note is a numerical variable.
2. **Several representations, one definition.** Inspect a quantity through an equation,
   plot and table. Distinguish another view from an independent engineering copy.
   Editing a plot range may change a sampling request; panning it must not.
3. **Measurement versus prediction.** Observe 12 N while a calculation predicts 10 N
   for the same physical property and operating condition. Retain both values,
   sources, methods and uncertainty/validity limits. Do not resolve disagreement
   by making the last writer the quantity's sole truth.
4. **Direction is a choice.** Author `F = k*x`. With known `k` and `x`, request `F`;
   with known `F` and `k`, request `x`. Retain one relation if its semantics permit
   both requests. Unsupported inverse computation stays unsupported; a drawing
   of a dependency arrow cannot prove solvability.
5. **Rich external source and reference failure.** Associate a load with an identified
   CAD face, derive a mesh, then a simulation field, then a maximum. Change the CAD
   revision so the face splits. Keep old conclusions reproducible where possible;
   show ambiguity rather than guess a new face. Work can open when the source tool
   is absent, with the limitation visible.
6. **Compose without namespace accidents.** Use two instances of a model containing
   `k`, including a nested instance. Keep their identities distinct, expose intended
   interfaces, and preserve unaffected external references through grouping, rename
   and explicit model promotion.
7. **Alternative with limited scope.** Preview an assumption change, keep a comparison,
   then correct a typo in a shared note, revise an equation and reimport measurements.
   Decide separately what follows live edits and what is pinned. Compare the changed
   assumption without forcing a choice among silently drifting or entirely isolated
   copies of everything.
8. **Honest mixed execution.** Edit a parameter used by a fast equation and a slow
   external job; edit it again, Undo, lose the source connection and reopen. Distinguish
   current, pending, unavailable and historical results. A successful old job must
   not take authority over newer work.

The existing fixture exercises only portions of scenarios 2, 7 and 8 in a scalar
setting. None of these options has passed the complete set.

Portability is also a cross-option requirement: a candidate must represent its
accepted content and dependency closure independently of runtime/browser state.
See the [native-document assessment](portability.md), including Excalidraw/draw.io
precedents and the F1 clean-environment round-trip gate. Physical storage choice
does not defer this obligation.

## Option A: Document or worksheet as the semantic center

**Primary:** authored regions/cells containing text, formulas, data and embedded
artifacts. Stable region IDs and a separate spatial view can improve the current
prototype without changing its basic authoring model.

**Strongest case:** freeform expression is natural and inexpensive. Drafts, notes and
mixed prose/mathematics are native. Bindings, units and retained execution inputs can
be added; a worksheet need not use hidden execution state or screen order as meaning.
This is the most credible low-complexity alternative for the immediate working loop.

**Tension with the vision:** a region is not always the engineering thing. One region
can describe several quantities; one property can appear across several documents or
native sources. Repeated names and a second representation need identity below or
outside the cell. An external face and a field sample should not have to masquerade
as spreadsheet cells.

**What it must add:** structured references independent of textual names, typed
embedded resources, separate representations and explicit execution contexts.
If these remain small and coherent, A may be enough. If every new tool needs a
separate cross-cell identity layer, the document has become the authoring surface
of another semantic architecture.

**Scale:** small state and straightforward editing are advantages. Coarse cell
invalidation and whole-document saves can limit locality. Neither limitation is
inherent; fine-grained references and indexes can be added, with increasing cost.

**Choose this if:** the user value is primarily better engineering worksheets and
richer sources are supporting attachments. That is narrower than our current vision,
but would be a legitimate product choice rather than an architectural failure.

## Option B: Reactive dataflow as the semantic center

**Primary:** operations with typed inputs/outputs and explicit bindings. The canvas
can hide the wiring; dataflow does not require a visible node editor.

**Strongest case:** change propagation, incremental computation and reusable operators
have a clear contract. Direct manipulation naturally changes inputs. Native/code
adapters can publish rich typed outputs. A coherent execution graph is easier to
inspect than unrelated cell side effects.

**Tension with the vision:** authored relations are not always directional operations.
A constraint system, an incomplete equation and an evidence association are not the
same kind of edge. Treating everything as a successful operator output makes notes,
claims and unavailable native information awkward. Competing predictions may be
separate operators, while their connection to one physical property still needs
another semantic layer.

**What it must add:** nonexecuting resources and relationships, explicit solve blocks,
draft authoring, revision-aware references, and separation of operator identity from
physical identity. Keep these additions honest instead of treating every arbitrary
cycle as a solvable loop.

**Scale:** dependency-local scheduling is a good fit, but global fanout, giant output
arrays and expensive external work remain real costs. Dependency discovery and
selected-instance expansion must be incremental. A DAG alone does not supply units,
provenance, source access or correct result currency.

**Choose this if:** repeatable computational workflows are the center of the product.
For the broader vision, dataflow is a strong execution subsystem and a weaker
universal authoring ontology.

## Option C: Typed engineering object and relation graph

**Primary:** identified engineering concepts such as entities, properties, relations,
models, observations and requirements. Documents and plots are views of this semantic
network. This is the strongest interpretation of our previous model, not merely an
untyped graph with arbitrary edges.

**Strongest case:** persistent engineering meaning, reusable models, scope, semantic
search, traceability and comparisons have direct representations. A property can
have many observations and many predictive methods without losing its identity.
Relations may be declarative; execution planners choose supported methods rather
than storing a universal producer arrow on the property.

**Tension with the vision:** schema completeness can become the admission price for
expression. Domain taxonomies can expand without convergence. Native CAD intent,
simulation topology or incomplete mathematics can be forced into a simplified
internal language. A centrally owned union of every engineering type couples new
features to core releases.

**What it must add:** permissive drafts, typed extensibility, explicit foreign authority,
addressable projections into rich objects, and a way to retain unsupported content
without inventing meaning. Typed graph structure is valuable; it does not require
one graph database, one universal physical ontology or an object per sample.

**Scale:** indexes and typed subgraphs can be efficient; large fanout, semantic joins,
revision selection and fine-grained identity add costs. Coarse native resources and
lazy projections prevent graph explosion. Those are design choices, not automatic
effects of using a graph.

**Choose this if:** Manifold owns a stable engineering modeling language and enough
cross-domain semantics to justify maintaining it. This option remains viable, but
our current scalar quantity/computation schema is insufficient evidence for it.

## Option D: Composable semantic document with typed resource interfaces

**Primary:** retained authored/native resources, references to whole resources or
addressable parts, reviewed typed relations and independent views. Domain schemas
and shared interfaces supply mathematics, measurements, geometry and model behavior.
Manifold owns its local content and cross-resource operations; specialized tools
retain authority over their own native internals.

This is a proposed boundary between responsibilities, not a new catch-all `Resource`
class or permission to store all meaning as unchecked JSON. A quantity can be a
local identified object or a documented projection of a retained table/model. It
must still expose a usable typed contract, not an opaque attachment.

**Strongest case:** expression remains a document experience while semantic identity
extends across representations and native formats. A note need not declare ports.
A dataset need not materialize every cell as an object. A solver's relations can
stay inside its declared solve boundary while typed outputs join a larger dataflow.
Core interactions query supported interfaces instead of knowing every discipline.

**Tension with the vision:** the shared contract can be too weak. A canvas of foreign
resources may look connected while each tool interprets names, units and edits
differently. Capability dispatch, projection identities and cross-adapter transactions
can be harder to understand than a single typed graph. Different projections can
become conflicting writable copies of the same information.

**What it must add:** an explicit authority/writeback rule per projection, versioned
semantic types, reference resolution with ambiguity states, shared operation effects,
and a minimal set of interoperability rules for connections and execution. At least
two genuinely different resource kinds must use the same connection/trace/Undo
protocol. Otherwise “extensible core” is just feature-specific glue with a new name.

**Scale:** large data can stay coarse and load by reference. Selected projections
and dependency summaries reduce eager expansion. Adapter crossings, metadata indexes,
remote access and retained native revisions can dominate costs. Shared interfaces
must disclose granularity and estimates rather than promise cheap arbitrary access.

**Choose this if:** Manifold's enduring product is an expressive interaction medium
that composes engineering meaning and specialized tools. This currently aligns most
closely with the vision, but has the least demonstrated interoperability evidence.

## Option E: Federated tool workspace as the semantic center

**Primary:** external documents, pinned links, previews and jobs. Local notes and
arrangements help engineers navigate work; authoritative engineering semantics live
in the tools that created it.

**Strongest case:** native information stays rich, tool boundaries are honest and
integration can begin without a universal modeling language. Long-running jobs and
large artifacts naturally remain outside the canvas process.

**Tension with the vision:** Manifold risks becoming a launcher/dashboard. Blank-canvas
mathematics, direct exploration and meaningful connections across tools still require
local semantics, not just links. Offline editing and Undo cannot be promised for an
external tool that exposes no appropriate operation API.

**What it must add:** local authoring/evaluation, typed source access and cross-tool
meaning. If those additions become central, E is a deployment/authority strategy
within C or D rather than the complete product architecture.

**Scale:** coarse references avoid copying large data, but network/tool availability,
revision access and vendor APIs bound what can be inspected and reproduced. A thin
workspace still needs versioned reference caches and honest unavailable states.

**Choose this if:** connected access to existing tool workflows is the primary value.
Our vision also promises useful creation and computation without those tools, so E
alone is an incomplete fit.

## Judgment across the options

These are architectural judgments, not empirical usability scores. Each row describes
the stated option; additions can improve a weakness and may move its boundary toward
another option. Do not count every possible addition as free.

| Option | Most natural fit | Hardest vision obligation | Main architectural cost |
| --- | --- | --- | --- |
| A: Document/worksheet | Unfinished expression and small calculations. | Identity across rich sources and representations. | Retrofitting fine-grained semantic bindings. |
| B: Reactive dataflow | Continuous, inspectable recomputation. | Declarative relations, noncomputing content and physical identity. | Additional semantic layer and explicit solve boundaries. |
| C: Engineering object graph | Persistent meaning, hierarchy and traceability. | Expression before schema; preserving foreign native semantics. | Ontology/type evolution and authoring translation. |
| D: Composable semantic document | Free expression plus native information and shared operations. | Strong, consistent meaning across adapters. | Reference/projection authority and interoperability contracts. |
| E: Federated workspace | Rich native tools and coarse external artifacts. | Useful standalone creation and manipulation. | Local semantics and cross-tool operation limitations. |

A and B are the cheaper challengers. C could be stronger if real engineering tasks
need a shared modeling language. D is my provisional preference for the current
vision, not a winner established by tests. E supplies an important external authority
boundary inside the others. Revisit the product ambition if the necessary semantics
or integration cost is not worthwhile.

## The same disagreement represented five ways

Take scenario 3: predicted force 10 N and measured force 12 N. No implementation
for these alternative traces is claimed.

| Option | Concrete authoritative information | Relationship that cannot be skipped |
| --- | --- | --- |
| A | Equation region `F_prediction` and a selected measurement cell `F_measured`. | A reviewed assertion identifies the property and operating condition they share; textual names alone do not supply it. |
| B | Prediction operator output and measurement-reader output, with a comparison operation. | Output ports must carry distinct evidence roles plus an explicit shared-property relation. A dependency wire is insufficient. |
| C | Identified force property, prediction method/result and measured observation. | Both value records refer to the property and conditions; neither overwrites the other. A request chooses an input source explicitly. |
| D | Retained equation content and table source, with typed output/cell projections. | A reviewed relation connects projections to the same property/conditions. Projection adapters must expose equivalent types and provenance without duplicating authority. |
| E | Pinned references to calculation and measurement documents, optionally cached previews. | Typed extraction and cross-tool meaning are required before Manifold can compare values rather than merely display two files. |

C and D may converge once C admits extensible native-backed objects and D gives its
relations strong engineering types. The useful boundary is who owns authoritative
meaning and which operations are generic, not which vocabulary wins. If that
boundary becomes identical, merge the options instead of maintaining artificial
architectural categories.

The later [primitive basis review](primitive-basis.md) checks these roles against the implemented
foundation with executable erasure witnesses and positive merge controls. Its conclusions distinguish
necessary information/lifecycles from current collections; the roles below remain the original
option-comparison vocabulary.

## Candidate foundational roles

These are roles to test, not seven mandatory tables, UI objects or public APIs.
Keep the minimum that survives the scenarios; rename or combine roles only when
their identity, authority and lifecycle truly coincide.

| Role | Must answer | Example that prevents overgeneralization |
| --- | --- | --- |
| Retained resource | What information exists; who owns its authoritative content? | An unfinished equation and a native CAD revision both remain valid without being numeric values. |
| Qualified reference | Which whole object or part, in which document/instance/revision, and how is it resolved? | A selected CAD face can become ambiguous after a split; a generated ID does not establish continuity. |
| Typed relation | What exactly is asserted or connected; what can it change? | A measured value and a prediction can concern the same property without being equal or interchangeable. |
| Representation | Which information is shown, and which edits are supported? | A second plot view shares a definition; an independently copied calculation does not. |
| Revision/context selection | Which authored versions and alternatives are in play? | A saved conclusion pins inputs; a live note view may follow later spelling edits. |
| Operation protocol | How does an intent stage, validate, publish and recover? | Pointer and AI connect the same targets with the same review and Undo effects. |
| Evaluation request/result | Which supported method ran against which resolved information? | A declarative relation becomes directional only inside a supported request/solve plan. |

The first five describe retained meaning and presentation; the final two describe
behavior and evidence. A resource/reference/relation substrate must not erase typed
quantity, expression, observation or model contracts. Conversely, those domain
contracts need not become a fixed exhaustive core enum before the first useful note.

### Authority and identity rules to settle

1. **Authoritative payload versus projection.** A projection has a qualified source
   reference and declared schema. It is a cache/view unless an explicit operation
   writes back through the source owner. Do not edit both a projected quantity and
   its native parameter as competing masters. Derived computations produce new
   results with provenance; they do not overwrite richer sources.
2. **Reference policy.** A working binding may follow a selected context head. A
   historical result pins resolved revisions. Subresource selectors declare their
   resolver/version and may return unresolved or ambiguous. Name, row index and
   geometry index have different validity domains. No universal ID policy alone
   guarantees subelement identity through transformations.
3. **Relations and competing values.** Separate an authored governing relation,
   a calculation method, an observation, and an applicability/equivalence claim.
   A request/context chooses which supported source/method supplies a computation;
   it does not globally delete competing evidence. The previous single-provider
   field can remain an arithmetic execution binding, not the universal meaning of
   an engineering quantity.
4. **Context scope.** Require immutable evaluated conclusions and pinned saved
   comparisons. Do not yet require every note, native project or hypothetical
   scenario to freeze the whole workspace. Test live versus pinned selectors and
   determine the semantic closure an evaluation actually needs. Store that policy
   explicitly; never leave it to whichever object happened to update last.
5. **Shared interfaces.** Typed resources may expose inspection, reference resolution,
   enumeration of needed dependencies, evaluation, representation and supported edit
   operations. An interface must state input/output types, effects, revision behavior,
   cost/availability and failure states. Unsupported actions remain unavailable.
   Capability registration must not be a plug-in-specific bypass around operations.

### A minimal interaction through the proposed boundary

Write `F = k*x`: the authored text/draft is retained; its mathematical interpretation
exposes bound symbols and a relation where understood. A supported request with `k`
and `x` creates an evaluation plan for `F`. A table cell can supply one input through
an explicit source projection and unit interpretation. A plot references the result
and source context, with sampling as a computation rather than an arbitrary renderer
side effect. A second measurement of `F` remains distinct evidence even when it
disagrees. A native adapter can later expose another method under the same request,
trace and result-currency rules. None of this requires a visible universal graph.

This sequence is a design hypothesis. The next experiments must prove the same
operation/reference contracts work outside arithmetic.

## Runtime and storage recommendation, conditional on semantic fit

Prefer a local modular application with one operation boundary, typed domain/adapter
modules, derived indexes and separate immutable source/result bytes. Keep UI state
outside engineering identity. Use fast reactive evaluation where supported, explicit
asynchronous jobs for costly/external work and bounded solver-owned subgraphs for
implicit relations. A solve region may contain coupled equations even when the graph
between executable regions is directional. Do not automatically solve arbitrary cycles.

Event history may help audit/Undo, but durable event sourcing is not selected. A
future collaboration layer must specify conflicts for bindings, text, relation choices
and context heads; CRDT support cannot decide physical equivalence. A graph index
is useful without choosing a graph database. Incremental record storage, shared maps
and blobs are implementation candidates after semantic boundaries are exercised.

The existing sizing results still identify duplicate-content and dense-map costs.
They compare encodings of generated records; they do not favor D over a well-built
A, B or C, nor establish the right scope of a frozen alternative. Preserve that
limited evidence without using it to justify an ontology.

## Experiments before choosing a foundation

Run the first two probes against a lean A/B challenger and the D candidate. Use the
same inputs and outcomes. Start by tracing C on paper as a serious challenger; add
an executable C slice if its semantics cannot be fairly represented by either trace.
Limit each executable spike to one focused working day; stop at a missing contract
and record it instead of expanding into an integration framework. The timeboxes
bound investigation, not promise feature delivery.

| Probe | What to construct | Pass/fail evidence | Decision it informs |
| --- | --- | --- | --- |
| P1: Expression and physical identity | Note/draft → bound equation → prediction plus conflicting measurement. Trace the same steps under A, B, C and D. | No setup required for drafts; identity survives editing; both measured/predicted values and source roles remain inspectable. Record every extra authoring action and special-case path. | Are quantities the primary objects, or typed interpretations of retained content? Does a single-provider core lose needed meaning? |
| P2: Rich reference and shared operations | A local table plus a mocked native shape exposing a parameter and a face. Use one Connect/Trace/Undo protocol; simulate face split and absent source. | Table/native bindings share operation semantics; no name-based retargeting; native payload survives; writeback has one authority; ambiguity is visible. Count core changes and adapter-only changes. | Can a small shared interface deliver real interoperability rather than a dashboard? |
| P3: Relation and execution boundary | Request either `F` or `x` from one relation using a bounded mock method; keep unsupported inverses and a coupled relation explicit. | Authored relation identity does not change with request direction; solver ownership is explicit; no inference that every cycle is solvable. | Is dataflow the semantic center or a generated execution plan? |
| P4: Context and composition | Two same-named nested models, a pinned comparison, live annotation edit, equation/source update and delayed result. | No collisions, silent comparison drift or late-result takeover; live/pinned policies and update conflicts are explicit. | What must a context freeze, and what actually needs an independent instance identity? |

For each candidate record authoritative objects, references, operations, unresolved
states, allowed dependency edges and observable user actions. Review correctness,
authoring burden, number of new core branches and source-information loss; do not
collapse them into arbitrary weighted scores. If D needs special cases in the core
for both mock sources, revise or reject its proposed interface boundary. If A/B
meets the same obligations with less complexity, prefer it. If C avoids adapter
ambiguity without imposing schema setup, keep it in contention.

Passing these probes selects a direction for one vertical slice, not a universal
schema or a production migration. Follow with the existing working-loop study and
real-workload measurements before promoting broader claims. Reconcile ADRs 0001–0004
only after recording which assumptions survived.

## Research anchors and limits

Primary sources inform specific mechanisms below. The architecture recommendation
and option-fit judgments are our inferences, not claims established by these projects.
No dependency on any of these systems is selected.

- **Reactive evaluation:** marimo documents deriving a cell DAG from references and
  definitions, and requires a unique global definition. This demonstrates a clear
  execution model and its naming rules, not that a notebook DAG is a universal
  engineering model. [marimo reactivity](https://docs.marimo.io/guides/reactivity/)
- **Equation semantics:** Modelica describes equations as simultaneous relations and
  specifies matching/initialization rules. This is a counterexample to treating
  every authored equation as a permanently directed assignment. It does not imply
  we should implement Modelica or a universal solver.
  [Modelica 3.6 equations](https://specification.modelica.org/maint/3.6/equations.html)
- **Extensible typed interfaces:** MLIR describes interfaces that let analyses and
  transformations work across dialect-specific operations. We infer a useful
  analogy for shared operations over typed resources; compiler IR machinery is not
  itself the product architecture. [MLIR interfaces](https://mlir.llvm.org/docs/Interfaces/)
- **Composition and reference identity:** OpenUSD preserves composable scene assets
  and describes the tradeoff of path-based identities when referenced namespaces
  change. It supports studying composition while warning against assuming every
  mature system uses our proposed ID policy. It is not a universal engineering
  information model. [OpenUSD introduction](https://openusd.org/release/intro.html)
- **Subelement references:** FreeCAD's documentation gives an example where a face
  index identifies a different face after editing. We infer the need for adapter-owned
  resolution and explicit ambiguity; retaining a file ID alone is insufficient.
  [FreeCAD topological naming](https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/Topological_naming_problem.md)
- **Local authority:** the local-first paper treats offline use, ownership and
  collaboration as product properties and explores CRDTs. We infer that local-first
  is an important ownership/deployment constraint, not a choice of engineering
  ontology or a complete domain merge policy.
  [Kleppmann et al., 2019](https://martin.kleppmann.com/papers/local-first.pdf)
