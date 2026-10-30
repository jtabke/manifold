# Ecosystem and roadmap

The [vision](vision.md) and [interaction design](interaction-design.md) describe a
fluid computational engineering canvas. Specialized solvers, CAD tools and external
sources retain their own responsibilities. Add integrations when concrete work
reveals a missing connection, rather than building a universal engineering engine.

## Current evidence

The application supports blank-canvas equations and notes, bounded arithmetic with
units, CSV measurements, reviewed references and data relationships, plots,
alternatives and nested models. A restricted Python adapter samples scalar
expressions for connected computational artifacts.

Automated checks cover mathematical behavior and interaction mechanics. They do
not establish a usability or productivity advantage, physical validity, or fitness
for a particular engineering decision. No live AI provider is connected.

The worksheet evaluator uses globally unique symbols. Bounded independent scalar instances are
implemented through foundation adapters; general external-model execution and native CAD integration
remain future work.
Data and navigation save locally in the browser; collaboration is not implemented.
The canvas native handoff (internal design note) and
unified owner (internal design note) now preserve authored Page/model/CSV/artifact data,
durable identities and checked results through current V7 export/Open in a fresh compatible browser; V1–V6 remain read boundaries.
Loaded code stays paused. Incremental local storage (internal design note) now
saves authored/result roots atomically, validates recovery, reuses unchanged sources and detects
conflicting tabs. Protected app retention and reviewed saved-storage cleanup (internal design note) now
preserve Undo and historical artifact results while removing unused payloads.
Compact computation snapshots (internal design note) now share pinned historical CSV
revisions instead of copying full Pages into new results.
Recent/kept calculations (internal design note) now bound session recency and preserve
chosen mathematical context as portable content. Independent scalar composition (internal design note)
now passes in the foundation and bounded real canvas instance/port/CSV workflows. Authorable scalar models (internal design note)
add bounded equation definitions with stable public ports, independent instances, general-unit
outputs and explicit reviewed revision updates. Source and compiled meaning travel together. Model-backed analyses (internal design note)
connect these instances to bounded single-input sweeps, one checked table/curve result and frozen
portable analyses. Shared typed sampling
also uses the core receipt/clock/storage path ([ADR 0029](design/decisions/0029-canvas-sampler-on-shared-evidence.md)). General solver/partial-source
access and broader product capacity remain open. Portable authored groups, tools and named
layouts now pass through the shared owner; active camera, focus and navigation stay personal.
Incremental worksheet derivation (internal design note) shares prepared expressions,
reuses unaffected mathematics and caches unchanged curves/mathematical subtrees within explicit
derivation bounds. The existing 256-region limit remains; changed inputs still require indexing.
The completed foundation acceptance audit (internal design note) links current
contracts, browser checks and measured bounds.

## Development priorities and gates

1. Make blank-canvas authoring exceptional: fast entry, incomplete mathematics,
   precise editing and predictable navigation.
2. Make connections between equations and measurements effortless while keeping
   scope, units, source identity and review explicit.
3. Make plots, tables and computational artifacts useful views of the same work,
   with inspectable assumptions and evaluated context.
4. Introduce hierarchy when observed complexity demands it, preserving identity,
   interfaces and numerical meaning.

Evaluate unfamiliar engineers doing real work from an empty canvas. Compare against
capable existing tools with comparable AI assistance. Prioritize demonstrated
interaction needs over adding examples, templates or numerical frameworks.

## Next milestone: a complete working loop

An unfamiliar engineer should be able to start from blank, express a calculation,
connect measurements, explore a change and preserve an alternative without a
product walkthrough. Existing mechanics are the starting point; adding another
engineering example is not the milestone.

### First usability study

Recruit three to five engineers unfamiliar with Manifold. Ask each to bring a small,
non-sensitive calculation they understand and a short CSV of related measurements.
Include work without requirements or model boundaries. Allow about 40 minutes per
session and use a fresh canvas for each participant.

Give outcome-based prompts, without naming controls or demonstrating gestures:

1. Express the calculation and a note about an assumption. Revise part of an
   equation, leave something unfinished, and return to finish it.
2. Bring in the measurements and use a selected record in the calculation. Explain
   which source record and units the resulting quantity represents.
3. Explore how an input affects an output. Compare a changed assumption with the
   original and recover the original work.
4. Starting from a plotted result, find the equation, inputs and measurement record
   behind it. Return to the previous view, save a native document and open the file
   in a fresh browser/profile without the original storage, using the implemented
   Export/Open workspace actions. Record any failed file handoff as a blocker.

Ask participants to think aloud. Let them try before helping; record every hint and
the point at which it was needed. If a task cannot proceed, capture the blocker,
provide the minimum help, and continue so later interactions can still be observed.

For each task record completion without help, time, wrong turns, recovery attempts,
unexpected behavior and the participant's explanation of what is connected. Check
the numerical result against their known calculation. A fast task with an incorrect
understanding of source identity is not a successful connection.

Compare a matched calculation in each participant's familiar tool, allowing
comparable AI assistance in both environments. Alternate which tool comes first;
record differences in task difficulty and prior familiarity. Treat this small study
as directional evidence, not a productivity claim.

### Decision gate

The working-loop exit criteria (internal design note) define when
this milestone can close, including blocking failures and required retest evidence.
The priorities below guide the response to study findings.

Prioritize blockers and incorrect interpretations first, then repeated hesitation
in authoring, connecting and exploration. Turn each selected issue into a concrete
reproduction and an observable acceptance condition. Retest affected tasks after
the fixes. Expand integrations or hierarchy when the observed work calls for them.

The first internal walkthrough found that unmatched reference searches blocked
Enter/Tab continuation and reference suggestions intercepted Shift+Enter. Regression
checks now cover recovery, multiline writing, reference insertion and composition
keys. These are implementation checks; participant sessions and the tool comparison
remain outstanding.

The continuous-exploration loop now includes an explicit Vary session with displayed
units, editable step/range, live dependent results and authored requirement margins.
It can start from a quantity or a plotted operating point. Accepted definitions are
untouched until Accept value or Keep as alternative; cancellation discards the
proposal. Alternative creation and its comparison presentation recover with one
Undo. Automated checks exercise source-bound plot previews, acceptance, cancellation,
alternative recovery, invalid downstream calculations and affine units. The current
session varies one assigned quantity at a time and does not survive reload. These
mechanical checks do not replace the unfamiliar-engineer study described above.

The earlier model viewport regression is covered by the passing current browser suite.
See current source-identified evidence (local-only report) for the
verified scope and the archive (local-only report) for historical failures and checkpoints.
The unfamiliar-engineer study remains pending.

### Command interface experiment

Treat the marking menu as an optional expert accelerator. The compact contextual
toolbar remains the discoverable entry point, with command search and the conventional
right-click list available. No participant measurements have been collected yet.

Compare three conditions: contextual toolbar alone, toolbar plus command search,
and toolbar plus marking. Keep ordinary typing, direct manipulation and Undo available
in every condition. These are study instructions, not separate product modes. Record
attempts to use an excluded path as fallback requests rather than silently counting
them as success for the assigned condition.

Use matched tasks across equations, assigned quantities and plots: edit an equation,
create a response plot, connect an independently authored input, trace a result, and
restore an earlier value. Verify that participants can distinguish a term from its
equation and a plotted view from its source definition. Use the same definitions and
reviewed connections in each condition. Restore the initial calculation between
trials; verify the numerical result and binding identities after each task. Do not
count an incorrect connection as completion. Include unsupported requests to check
whether availability explanations are understood.

First observe unaided discovery without teaching gestures or command names. Then
give equal instruction and three practice attempts per condition. Rotate condition order
across participants to reduce learning effects. Use repeated trials after practice
to distinguish initial discoverability from learned operation speed.

| Measure | Record for each task and path |
| --- | --- |
| Discoverability | Found without help; time to first correct invocation; hints needed. |
| Practiced speed | Invocation-to-completion time, including connection review; report median and range. |
| Accidental activation | Wrong commands, unintended document changes, cancellations and recovery steps. |
| Editing interference | Misrouted typing, mathematical symbols, composition confirmation, Space-pan and command-search shortcuts. |
| Spatial interference | Obscured working material, lost selection or navigation context, extra pointer travel. |
| Preference | Preferred condition after all trials and the participant's stated reasons. |

Include mixed activity between command trials: author an incomplete equation,
continue a note on a new line, type spaces with Shift held, pan, edit a quantity,
and use command search. Record observed errors rather than asking only for preference.
Keep a trial log with participant code, path, task, practice/trial number, elapsed
time, outcome, wrong actions, hints and observations. Do not collect sensitive work.

Keep marking optional unless repeated tasks show a useful speed advantage after
practice without worse accidental activation or editing interference. If evidence
does not support it, retain the simpler toolbar and search. Automated checks verify
mechanics and shortcut isolation; they cannot establish this promotion decision.

The current command resolver supplies all three surfaces with the same stable
operation identities, bound targets and availability. Automated checks compare plot
execution across the three paths and verify quantity variation, Undo, term and result
selection, explicit plot axes and missing-binding explanations. These checks establish
consistency of mechanics; the comparative participant study remains outstanding.
