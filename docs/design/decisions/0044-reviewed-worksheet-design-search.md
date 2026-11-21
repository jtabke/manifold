# Reviewed worksheet design search

Status: Accepted for bounded scalar worksheet designs.

An engineer can ask for the smallest mass that meets a deflection limit without publishing a reusable
model. Input bounds, required inequalities and observations to report have different meanings. A UI
over the existing one-input model optimizer could not enforce those inequalities.

Use a separate versioned numeric request on the existing optional optimizer host. The session schedules
an explicit Run; no authored formula strings, user code or workspace archive go to SciPy. The worksheet
owns unit interpretation and independently evaluates the exact proposed literals before offering them
for adoption. The review is disposable, like a worksheet what-if, not an authored request or a durable
model receipt. Opening a sheet or configuring a run does not start a solver job. Apply and Keep use the
existing session transaction, input writers and scenario branching: no second history or persistence owner.

A two-input response study is a variant of the existing worksheet plot record. It retains stable
source IDs, unit-bearing bounds, selected requirements and reports, and ordinary canvas placement.
It follows the active worksheet scenario. It does not retain a sample grid, solver job or candidate.
The bounded grid derives locally through the same worksheet capture as the one-input scan; the
maps share the probe and feasibility across outputs but scale their colors independently.
Approximate contours and sample inspection do not create an adoptable candidate. Only explicit
Run uses the optional numerical host and its separately checked candidate can be reviewed alongside
the plots without a modal. Layout and plot settings use the existing document history.

This trades durable run provenance for a direct, non-mutating review. Use the published-model workflow
when an authored optimization request and captured receipt are needed. Search is local, limited to two
bounded continuous inputs and the supported scalar graph; neither convergence nor a passing worksheet
certifies a physical design. The [numeric contract](../../../apps/canvas/artifact_optimizer_contract.md)
owns the execution limits. The [rail acceptance case](../../../apps/canvas/tests/check-worksheet-optimization.mjs)
checks the analytical sag boundary, tightening it, varying width too and refusing infeasible designs.
