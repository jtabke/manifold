# Manifold — A bicycle for the engineering mind

An open-source environment where engineers can think freely, express ideas naturally,
connect information effortlessly, and use powerful computation without interrupting
their flow.

Engineering models, equations, data, simulations, and results retain their meaning
and relationships regardless of how they are arranged or represented.

Complexity emerges only when the problem requires it. Existing tools provide
specialized capabilities. AI makes those capabilities easier to access.

**The engineer focuses on understanding and creating. Manifold handles the software.**

This is the product direction, not a list of shipped capabilities. The immediate
priority is a focused UX reset: an empty canvas, an engineering idea, a natural way
to express it, an effortless way to connect it, and an immediate way to explore it.
See [interaction design](interaction-design.md) and the
[roadmap](ecosystem-and-roadmap.md#development-priorities-and-gates).

## Product guardrails

- **No engineering example may define the application's fundamental layout, navigation,
  object representation, or interaction semantics. Examples validate the primitives.
  They do not become the primitives.**
- **The freeform canvas is the default environment. Structured diagrams, model
  hierarchies, dashboards, and investigations are optional representations created
  within it.**
- **Engineering objects retain their meaning independently of position, appearance,
  and presentation.**

The interaction medium is the product. A failed-constraint investigation is one useful
workflow; it must not define the environment. Models without requirements and work
without model boundaries are equally valid.

## Create, connect, explore

These three capabilities define the everyday experience, without modes or a required
sequence. Create equations, notes, quantities and data without setup. Connect
independently authored information while retaining units, scope and source identity.
Explore the consequences through direct manipulation and linked plots and tables.

Hierarchy, execution tools, evidence and workspace arrangements support that work;
they do not define its starting point. Not every useful piece of information needs
a canvas object. Sources, implementations, assumptions, history and dependencies
should be available in context, without demanding permanent screen space. Show what
matters at the current level of reasoning and preserve everything else.

## Six foundational principles

### Freedom of expression

Work naturally with equations, text, sketches, tables, datasets, plots, diagrams,
code and geometry. An unfinished equation, assumption or question is valid working
material. Users should not need to choose a workflow or hierarchy before expressing
an idea. **Structure emerges as understanding develops.**

### Persistent engineering meaning

A quantity can appear as an equation symbol, Python variable, plot axis, table column
or CAD parameter. These can be representations of the same engineering definition.
Moving a view must not change a calculation; creating a view must not silently
create another definition. **One engineering meaning, many representations.**

### Effortless connection

Referencing, linking, tracing and composing engineering information are foundational
interactions. A connection must say what it means: spatial grouping is distinct from
mathematical dependency, and compatible units do not establish physical equivalence.
**Easy to connect. Difficult to connect incorrectly.**

### Continuous exploration

Manipulate inputs, vary assumptions, inspect consequences, compare alternatives and
follow dependencies without repeatedly leaving the working context. Exploration is
reversible and earlier conclusions retain their evaluated context.
**Thinking and computing should feel like one continuous activity.**

### Openness and composability

Build on established tools through open interfaces. Favor local-first work, portable
project information, inspectable computation and replaceable integrations. Saved work
should remain useful when moved to another computer or shared as a native document;
its meaning cannot depend on the original browser or machine. Specialized
tools retain responsibility for specialized work.
**Manifold connects capabilities; it does not need to own them.**

### Preservation of rich information

**Engineering information should remain in its richest useful representation
throughout its lifecycle. Every visualization, calculation, report and interaction
should be a view or traceable transformation of that information.**

This is as fundamental as the canvas. A CAD model reduced to a mesh, a simulation
field reduced to a spreadsheet value, or a plot reduced to a screenshot can lose
design intent, context and inspectable relationships. Manifold should preserve
access to richer sources as work evolves, rather than requiring engineers to
reconstruct those connections after every export or upstream change.

Four rules follow:

- Never discard richer information merely to display a simpler view.
- Preserve identity and context across derived representations.
- Make transformations traceable, including assumptions, limitations and information loss.
- Reference authoritative external tools and artifacts instead of duplicating entire systems.

The enduring assets are engineering meaning, models and their relationships. CAD,
simulation and measurement tools can retain their own authoritative information;
Manifold need not copy every artifact into one universal format. Preserve as much
as the underlying tools and sources actually expose, and make missing or unavailable
information explicit. Perfect losslessness across external formats is not promised.

**Derived information complements its source; it must not silently replace it.**

## The product promise

**Express → Connect → Compute → Explore → Understand → Refine**

Everyday work includes four equally important activities:

| Activity | Working material and purpose |
| --- | --- |
| Derive | Develop equations, assumptions, sketches and notes, including unfinished ideas. |
| Connect | Relate data, equations, Python models and external artifacts; keep proposed links explicit. |
| Explore | Manipulate parameters, visualize responses and compare assumptions or designs. |
| Refine | Improve approximations, incorporate measurements and revise conclusions. |

These are capabilities available together on one canvas, not applications, tabs or
mandatory workflow stages. Refining a model differs from changing a design. Neither
exploration nor successful evaluation requires a requirement or optimization objective.
A few equations and a plot should require little setup. A multidisciplinary system
should support hierarchy, explicit interfaces, specialized solvers and traceable
conclusions using the same recognizable interaction language.

Optimization and design-space exploration remain important capabilities within this
broader environment. CAD, simulation, evidence management and AI also contribute
without defining the whole product. Manifold does not need a proprietary universal
physics engine or a replacement for every engineering application.

AI should reduce friction through the same inspectable operations available to an
engineer. Basic authoring and computation must remain useful without an AI provider,
Tracer, or any particular agent runtime.

## The design test

A student writing equations, an engineer connecting loads and geometry, a systems
engineer navigating nested models, and a researcher comparing data and hypotheses
should recognize the same underlying interactions. Complexity should appear when
needed rather than being required at the start.

A completed calculation establishes neither physical validity nor a certified
conclusion. Assumptions, applicability, evidence and uncertainty remain part of
understanding a result.

**Manifold should make it easier to think about engineering than to operate
engineering software.**
