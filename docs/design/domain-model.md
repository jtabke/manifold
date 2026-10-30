# Domain model and invariants

This is a conceptual model derived from the [vision](../vision.md) and
[interaction contract](../interaction-design.md). It is not a proposed database
schema or a claim that the prototype implements every distinction.

The [concrete data-model proposal](data-model.md) now defines TypeScript records,
a worked lifecycle and adoption gates. Its [scale assessment](scalability-and-flexibility.md)
covers storage growth, dependency locality and extension boundaries. Both remain
proposed; current implementation anchors below identify the prototype.

The [architecture review](architecture-options.md) treats the vocabulary below as
useful domain language, not a settled list of storage primitives. Whether quantities
are independent objects or typed projections, how relations acquire execution direction,
and how competing observations relate to a property remain open foundational choices.

## Shared language

| Concept | Meaning and relationship | Current implementation anchor |
| --- | --- | --- |
| Definition | Authored engineering meaning: a quantity, relation, note or condition; may be incomplete. | `Region` and authored text in [document.ts](../../apps/canvas/src/regions/document.ts). |
| Quantity | A property with identity, meaning and units; its symbol is a representation of that identity. | Parsed statements identify symbols; `Quantity` in [math.ts](../../apps/canvas/src/notebook/math.ts) is a numeric value with units, not a persistent property identity. |
| Relationship | A typed dependency or association between identified information. | `Page.links`, data relations and reviewed connection edits. |
| Context | The assumptions and choices under which definitions are interpreted and evaluated. | `Context` base/overrides in `document.ts`; broader revision semantics remain open. |
| Evaluation | A result of resolving definitions and inputs in a particular context, using a method. | `Projection`, bounded recent calculations, typed explicitly kept worksheet snapshots and checked sampler results; see history (internal design note). These are not one general execution/audit ontology. |
| Source | A measurement record, external artifact or authored definition supporting derived information. | Immutable source revision pins preserve bounded sampler/kept-calculation evidence through cleanup and handoff; broader source/tool policy remains open. |
| View | A representation of existing information, with its own presentation and arrangement. | Independent region/artifact views and authored scene/group/tool/named-layout records use the accepted owner. Active camera, selection and navigation remain personal attention; see [ADR 0032](decisions/0032-portable-authored-canvas-scene.md). |
| Model | An explicit boundary with an interface over internal definitions and relationships. | `NestedModel` in [models.ts](../../apps/canvas/src/regions/models.ts); no independent reusable instances. |
| Workspace | The working environment containing authored information, contexts and views. | One accepted foundation Page/artifact/kept-calculation owner, separate checked-result state and ephemeral browser attention; [architecture](architecture.md). |

An entity is the thing being described; a quantity is one of its properties. A
requirement is an explicitly authored condition. An investigation organizes a
question and evidence; a visual group organizes presentation. Neither implicitly
creates a model boundary. These concepts need not each become a stored object.

Conceptually, definitions connect through typed relationships; evaluations resolve
them in a context; views expose definitions or evaluations; models bound selected
definitions through explicit interfaces. Sources support authored and derived work.

## Invariants

| ID | Contract | Consequence for design |
| --- | --- | --- |
| D1 | Meaning and identity survive changes in arrangement and representation. | Moving, collapsing or duplicating a view must not silently redefine a quantity or change its result. |
| D2 | Connections preserve explicit targets, units, source identity and meaning. | Matching names or compatible units alone cannot establish physical equivalence. |
| D3 | A result belongs to the definitions, resolved inputs and context used to produce it. | An earlier result cannot silently become the result of changed work. |
| D4 | Unfinished, unresolved and unavailable information remains explicit. | Never substitute an old value or invent a result to make the interface look complete. |
| D5 | Exploration is reversible; accepting a proposal has a defined boundary. | Preview, commit, alternative creation, cancellation and Undo must have consistent effects across state owners. |
| D6 | Execution, physical validity and requirement satisfaction are distinct. | Numeric success cannot imply validated physics or an unauthored pass/fail assessment. |
| D7 | Derived representations retain access to richer sources where available. | Record source revisions and transformation limits; a hash alone does not guarantee reproducibility. |

These are required behaviors from the existing product direction, not statements
that all current code satisfies them. [Quality scenarios](quality-and-risks.md)
make selected contracts observable.

## Proposed domain decisions

- Identity and revision: when does an edit create a revision, a new definition or
  only a new view? What must a saved evaluation reference?
- Scope and instancing: how do local symbols resolve, and how are independent
  instances identified without changing existing references?
- Context composition: how do design changes, assumption changes and model changes
  interact? What is inherited, frozen or recomputed?
- Source lifecycle: how are imported records and upstream revisions identified,
  retained and marked unavailable?

The [concrete model](data-model.md) separates quantity identity from computation
outputs and numeric values. Context revisions select complete snapshots; patches
are edit input, not a second authority. These refinements are recorded in
[ADR 0004](decisions/0004-normalized-engineering-records.md).

Concrete choices are now proposed in [identity and scope](decisions/0001-semantic-identity-and-scope.md)
and [frozen contexts](decisions/0002-context-snapshots-and-result-currency.md).
They preserve definition identity across edits, separate revisions from views,
pin complete alternative semantics, and require explicit source/model updates.
[Operation ownership](decisions/0003-workspace-operation-ownership.md) defines the
corresponding acceptance and recovery boundary.

These questions remain pending acceptance and implementation evidence. In
particular, source retention/deletion and a richer executor's reproduction policy
still need workflow-specific decisions. Existing TypeScript types are evidence,
not automatic answers or a universal schema.
