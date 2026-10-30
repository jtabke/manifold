# Interaction design

**Manifold — A bicycle for the engineering mind.** Create freely, connect effortlessly,
and explore consequences without interrupting the engineering thought.

**The workspace should adapt to the engineer's thinking.** This is the interaction
contract for the [product vision](vision.md). It describes intended behavior; the
[roadmap's evidence ledger](ecosystem-and-roadmap.md#current-evidence) identifies
which parts have bounded implementations and which remain proposals.

## Four forms of fluidity

| Form | Intended experience |
| --- | --- |
| Spatial | Arrange, group, focus and navigate work freely. |
| Representational | Move between mathematics, plots, code, data, geometry and diagrams. |
| Semantic | Establish and inspect meaningful engineering connections. |
| Hierarchical | Move between calculations, models, subsystems and systems. |

These work together within one workspace rather than becoming separate application modes.

## An open canvas with structure on demand

Begin with an empty canvas. Typing starts work directly; clicking places it spatially.
Writing an equation or note requires no object-type choice. Importing measurements
is available directly and through file drop. Creation menus contain working actions,
not architectural concepts or proposed capabilities. Research studies are available
through a secondary Research menu, separate from everyday authoring.

The primary loop is Create → Connect → Explore. Validate that loop with a few
independently authored equations and measurements before introducing hierarchy.

Equations, notes and data are visible when useful. Sources, code, assumptions,
history and dependencies appear in context; they do not each require another
permanent canvas object. Semantic zoom and nested models disclose complexity only
when the problem needs it.

Equations, notes, assumptions, requirements and
questions can be authored directly; computational artifacts appear near the work
that produced them. Incomplete work stays editable and visibly unresolved, without
fabricated results.

Freeform placement is the default. Optional stacking, grids, tabs, docking and tiling
can organize related work. Any representation should be focusable and restorable
without losing spatial context. A workspace can preserve useful arrangements and
viewpoints. Window-manager ideas are tools within the canvas, not a prerequisite
for continuing work.

Arrangement never establishes a computational relationship. A plot remains linked
to its source after it moves; docking two objects does not connect their quantities.
A visual group and a model boundary are distinct operations.

## Engineering objects before widgets

| Concept | Meaning |
| --- | --- |
| Entity | A represented component, system or other thing. |
| Quantity | A physical, numerical or measurable property. |
| Relation | An equation, dependency, model or other typed relationship. |
| Condition | A requirement, constraint, limit or objective. |
| Context | A configuration, assumption set, operating condition or model choice. |
| Evidence | Measurements, simulations, calculations or source artifacts. |

This vocabulary guides behavior; it does not mandate six tables or a universal class hierarchy.

Keep five responsibilities distinct:

- **Meaning:** which definitions and relationships exist.
- **Context:** which design, assumptions and implementations are considered.
- **Execution:** what ran, with which inputs, tools and versions.
- **Representation:** how information appears as mathematics, plots, tables or other artifacts.
- **Arrangement:** where those representations appear.

Changing an axis usually changes representation. Changing an input changes context;
editing a governing equation changes meaning. Moving a view changes arrangement.
The interface should make these distinctions understandable without exposing framework machinery.

## One interaction language

| Operation | Intended behavior |
| --- | --- |
| Select / Inspect | Identify an object; reveal definitions, assumptions, sources and uses. |
| Edit | Change a value, definition, assumption or permitted parameter. |
| Connect | Establish a reviewed, typed engineering relationship. |
| Explore | Vary inputs and inspect consequences. |
| Transform | Create another representation of existing information. |
| Branch / Compare | Preserve an alternative and examine meaningful differences. |
| Trace | Follow upstream and downstream relationships. |
| Group / Focus | Organize space or concentrate on relevant work; model creation is explicit. |

Keyboard, pointer, AI and API entry points must invoke the same underlying semantic
operations. `/` offers content actions in authoring contexts; division within an
equation remains division. `@` references an existing object. Cmd/Ctrl K searches
objects and available commands. Direct manipulation should support mathematical
terms, values, plot points and connection handles with clear feedback and ordinary Undo.

The compact contextual toolbar is the discoverable starting point. Right-click,
Actions and Shift+F10 expose a conventional contextual list. Command search provides
the same operations by name, including less frequent choices.

These are presentations of one shared command resolver. A resolved command carries
a stable identity, engineering target, availability and explanation, bound parameters,
consequence preview, execution operation, recovery contract and presentation metadata.
Changing invocation method does not change the selected definition, plot bindings,
review semantics or recovery behavior. New integrations must register supported
capabilities explicitly rather than advertising operations that cannot execute.

Contextual toolbars show up to three likely actions and More. Equations offer
Edit/Plot/Connect; quantities offer Edit value/Vary/Find uses; results and plot
selections offer Inspect source/Explore/Compare; datasets offer Inspect/Connect/
Visualize, with unavailable calculated-data views explained. A selected term is
identified separately from its containing equation and resolves its identity-bound
definition. Alt-click selects a mathematical term for actions; ordinary clicking
continues to edit mathematics directly. Right-click also distinguishes terms,
results and plot views. No selection gesture silently creates another definition.

Search shows the selected object, current model and scenario. It offers supported
input-specific response plots, existing response views and commands used during
the current session, alongside quantities, datasets and models. Unresolved inputs
produce unavailable commands with explanations. Input choices are bound to source
identities, not inferred physical equivalence. Code and recovery details remain
inspectable; view removal is distinguished from document Undo.

An optional experimental marking menu accelerates four primary operations for the
current object. The cardinal intents stay fixed: Edit above, Explore right, Connect
below and Inspect left. The resolved operation varies by capability: Explore plots
an equation response or focuses a quantity's direct variation control. Unsupported
categories stay unavailable rather than rotating the other directions. Blank space,
models and selections offer only their supported operations. Secondary choices such
as comparison remain in the contextual list and search.

Hold Shift+Space, flick toward an action and release Space. Execution does not wait
for the menu, which appears after 180 ms as guidance. Tapping the shortcut reveals
it for explicit selection. The smaller ring has an open center, and contextual
toolbars are hidden while either menu is open. Escape or an outside click cancels.
Arrow keys and Enter remain available. Text editing retains Shift+Space input and
the native context menu; Space-drag still pans.

This is an interaction experiment, not a new engineering primitive or a demonstrated
usability improvement. Compare it with the toolbar and command search before
promoting it; see the [study protocol](ecosystem-and-roadmap.md#command-interface-experiment).

## Linking is a first-class experience

Support references, explicit connection handles and contextual requests. Preview
uncertain mappings and let the engineer review their meaning, source, units and
scope before acceptance. Routine reversible edits should not require repeated dialogs.

Distinguish a dependency, an evidence association, a geometry association and a
second representation. Never silently merge similar names, equate same-unit values,
pair unrelated measurement records, treat predictions as measurements, turn a CAD
face into a boundary condition, or assume an unsupported inverse operation.

Reveal relationships contextually rather than drawing every wire permanently.
Selection highlights relevant definitions and uses; Trace can expand a navigable trail:

**Dataset record → Model input → Equation → Result → Requirement**

Navigation must work in both directions and preserve a return path.

## Grouping has distinct meanings

| Object | Meaning | Computational consequences |
| --- | --- | --- |
| Visual group | Arrange related content together. | None; no ports are required. |
| Model | Encapsulate relationships behind an explicit interface. | Defines inputs, outputs and definitions, with computation where supported. |
| Investigation | Preserve a question, alternatives, selected results and context. | References models and evaluations; does not redefine them. |

Group, collapse, enter and detach can share interaction conventions while retaining
these distinctions. Promotion from visual group to model is explicit and reviewed.
An investigation does not become a member of the model it examines merely because
it appears beside or inside a view. Notes and charts need no computational hierarchy.

The canvas contains first-class engineering objects and views: models, quantities,
datasets, sketches, plots, notes, requirements and external references. It is not
required to depict a single universal computational graph. A plot can Trace sources;
a model can Show equations; a dataset can create an empirical relation; geometry
can propose a reviewed engineering association. Shared operations reveal different
presentations according to the selected object.

## Nested, explorable models

**A model can be an entire workspace internally and one connectable object externally.**
Its interior remains a freeform canvas containing mathematics, data, notes, plots,
code, geometry and nested models. Its exterior exposes identity, purpose, inputs,
outputs, assumptions, applicability, evaluation state and available operations.

### Adaptable model exteriors

Standardize the interaction contract where interoperability needs it: identity,
selection, inspection, connections, entry, collapse and source tracing. Do not
standardize every model into a subsystem card, scalar result or pass/fail badge.
A model's compact exterior is a chosen view of its useful information.

Begin with a small reusable set of exterior types:

- Label/interface view for identity, unresolved inputs and exposed quantities.
- Equation preview for selected governing expressions.
- Response preview for a selected plot or characteristic behavior.
- User-selected artifact view referencing an existing plot, sketch, geometry or other artifact.

These are implementation targets, not claims that all four are shipped. Existing
icon and outline choices are cosmetic and do not establish this representation contract.
Switching exterior preserves definitions, ports, source identity and evaluation context;
missing or unsupported preview sources remain explicit. Avoid a renderer per discipline.

At distant zoom show a legible identity and the chosen summary rather than shrinking
all interior content. Selection or focus reveals detail in place; entering changes
scope. A zoomed-out model need not display every port label, assumption or requirement.
Connections appear contextually, with persistent diagrams available by explicit choice.
Automatic arrangement is a requested operation over views, never a compulsory canvas
layout. A permanent investigation sidebar is not the default inspection mechanism.

The intended Make model sequence is:

1. Select existing work and request a model boundary.
2. Identify relationships crossing that boundary and propose inputs and outputs.
3. Review the interface while retaining the internal definitions' identities.
4. Show a compact model in the parent workspace and connect it through explicit ports.
5. Enter to edit the original internal work, then return and inspect affected consumers.

**Zoom changes visual detail. Entering changes working scope.** Semantic zoom may
simplify a detailed view into an interface or compact result. Manual expansion and
collapse remain available. Breadcrumbs, search across scopes, direct link following
and navigation history keep hierarchy from becoming a maze. Multiple simultaneous
views of different levels are a target, not a requirement of the present prototype.

Grouping must preserve numerical meaning and existing links. A model hierarchy does
not by itself define numerical namespaces, reusable instances or execution boundaries.
The current evaluator uses globally unique symbols; independent reusable model
instances remain future work.

## Transformations preserve meaning and access to sources

A simpler representation must not discard the richer engineering information behind
it. Make the kind of transformation and its consequences inspectable:

| Transformation | Example | Preservation contract |
| --- | --- | --- |
| View | Plot an existing dataset, change axes, render an equation differently | Keep the underlying information and identity unchanged; retain bindings and evaluated context. |
| Computational | Apply an equation, solver, interpolation or optimization | Create a derived result linked to resolved inputs, method, parameters and execution context. |
| Lossy | Mesh CAD, reduce a field to a scalar, downsample data, export a screenshot | Record what was reduced or omitted, the method and context; retain the richer source or a revision-specific reference to it. |

These categories can overlap: a computational transformation can also be lossy.
Treat a maximum temperature extracted from an FEA field as a derived quantity with
an extraction method, evaluated context and reference to the full field. A scalar
value alone does not preserve the simulation's engineering meaning.

Inspection should answer the following without displaying all metadata permanently:

| Question | Information to expose when available |
| --- | --- |
| What is this? | Quantity identity, physical meaning and units. |
| Where did it come from? | Source artifact, measurement record, model or calculation. |
| How was it produced? | Relation, numerical implementation, parameters and any reduction method. |
| Under what conditions? | Design configuration, assumptions and environment. |
| What supports trust? | Applicability, coverage, uncertainty and validation status. |
| What depends on it? | Downstream models, results and requirements. |
| Can it be reproduced? | Source revisions, resolved inputs, execution metadata and source availability. |

Selecting a derived plot point should let an engineer follow its original measurement
record, equation, units, assumptions and requirement margin, navigate related
calculations, and preserve an alternative without changing the original. This extends
the existing bounded CSV/equation/plot interactions into a lifecycle requirement;
it does not establish general support for every artifact today.

For future CAD integration, selection should expose native properties and reviewed
quantity associations, linked simulation results and a return to the original feature
where the source API supports it. A mesh preview must disclose which native structure
and references it retains or omits.

When an upstream source changes, keep the earlier result attached to its original
revision and show which views or results need reevaluation. An unavailable source,
unknown calibration or missing derivation must remain visibly unavailable or unknown.
A stored link or hash alone does not guarantee source access or reproducibility.

## Connected computational artifacts

An equation or result can produce a plot, table, report, field or interactive tool.
Retain bindings to source quantities, context and evaluated results. A plot point
can reveal its engineering state; a supported manipulation can propose a parameter
edit through an explicit binding. A generated view receives no automatic authority
to edit the model or external files.

Code should be inspectable and editable when supported, without being mandatory for
ordinary interaction. Prefer deterministic native operations for filtering, changing
axes and switching representations. AI-generated computation needs inspectable code,
appropriate isolation and controlled capabilities; AI remains optional.

Large datasets and simulation fields should move by reference when appropriate,
with coordinated representations rather than one canvas object per data element.

## Alternatives, assumptions and evidence

Distinguish design, assumption, model and requirement changes in history and comparison.
Use normal Undo for local edits and independent contexts for larger alternatives.
Results retain the context in which they were evaluated, including after later edits.

Assigned quantities support an explicit Vary session. Its value, exploration range
and step use the displayed units, including affine temperature conversion. Previewing
updates dependent equations, following response artifacts and authored requirement
status and margins while accepted definitions remain unchanged. Range bounds are
interaction limits, not requirements or claims about model validity. The contextual
controls distinguish Accept value, Keep as alternative and Cancel. Keeping an
alternative should preserve the baseline and apply the proposed value together with
its comparison presentation; one Undo should restore both. The current prototype
coordinates Page and artifact updates through separate owners and an Undo callback.
It freezes assigned values, but equations can remain shared across alternatives.
Full semantic snapshots and a single publication boundary are proposed contracts,
not shipped guarantees; see the [operation lifecycle](design/operation-lifecycle.md)
and [frozen-context proposal](design/decisions/0002-context-snapshots-and-result-currency.md).
The same session is available from a response plot's operating point. It varies one
assigned input at a time; changing the input starts a new proposal against the accepted
state. Undefined affected calculations block acceptance and alternative creation.
Ordinary direct scrubbing retains acceptance on release and ordinary Undo. Preview
controls remain temporary; reloading or changing the model or scenario discards them.

Show execution status, convergence, applicability, data coverage, requirement
satisfaction, empirical validation and uncertainty as distinct information. A sampled
allowed interval is not a certified feasible region. Stale or pending results must
remain distinguishable from results for the current context.

### Computation, validity and requirements are independent

| Dimension | Examples | Presentation rule |
| --- | --- | --- |
| Execution | Defined but unevaluated, incomplete, calculating, current, stale, unable to converge | Describe what computation did or still needs; do not imply physical validity. |
| Model validity | Unknown applicability, inside or outside a stated domain, empirical support | Retain assumptions and evidence; numerical completion is not validation. |
| Requirement satisfaction | Unassessed, passing or failing an explicit authored condition | Show only for an actual requirement in the relevant context. |

A successfully evaluated model without a requirement has no pass/fail assessment.
An unfinished equation is valid working material. A failed requirement can coexist
with successful computation, and a converged calculation can be outside its valid
domain. Compact views expose what matters to the selected work; they do not default
to a global failure headline or a success badge for every object. Do not fabricate
execution lifecycle states that the current evaluator cannot establish.

## Native documents travel with the work

Saving an editable canvas and opening it on another computer is foundational. The
native document retains authored drafts, references, saved representations, required
source revisions and available assets. Preserved result evidence is distinct from
being able to recompute it; missing tools or sources remain explicit. Save retains
active authored text as a draft without requiring successful computation. Numerical
previews still require explicit acceptance. See the [portability contract](design/portability.md).

This file handoff is useful before collaboration or presentation services. A native
save preserves structured work; static images and reports are derived exports with
their own preservation limits.

## Communication is a later use of connected work

Dedicated presentation functionality is deferred. A future design review could be a
curated arrangement of existing model, calculation, plot and table views with their
source relationships intact. First make the underlying engineering work expressive,
connected and information-preserving.

Static exports are useful, explicit lossy transformations. Keep their source revision,
derivation and export context in the project, attach references or metadata where
the format supports them, and disclose when the exported artifact cannot retain
interactive inspection or recomputation.

## Visual language

Combine the precision of an engineering instrument with the fluidity of creative
software: readable mathematics, calm spacing, contextual controls, clear selection,
accessible themes and enough density for serious work. Avoid making permanent
inspectors, tiled cards or glowing wires the default workspace.

Keep the purple-and-orange M logo at the upper left. Purple may emphasize selection
and active context; orange may distinguish exploration and alternatives. Errors,
unknowns, feasibility and validation need distinct treatments beyond color alone.

Learn from simulation games through observable consequences, manipulable rules,
contextual overlays, progressive mastery and spatial memory. The purpose is to make
complex systems understandable and responsive.
