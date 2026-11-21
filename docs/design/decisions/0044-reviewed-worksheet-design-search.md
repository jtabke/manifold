# Reviewed worksheet design search

Status: Accepted for bounded scalar worksheet designs.

An engineer can ask for the smallest mass that meets a deflection limit without publishing a reusable
model. Input bounds, required inequalities and observations to report have different meanings. A UI
over the existing one-input model optimizer could not enforce those inequalities.

Use a separate versioned numeric request on the existing optional optimizer host. The session schedules
an explicit Run; no authored formula strings, user code or workspace archive go to SciPy. The worksheet
owns unit interpretation and independently evaluates the exact proposed literals before offering them
for adoption. The review is disposable, like a worksheet what-if, not an authored request or a durable
model receipt. Opening a sheet or configuring a run does not probe or execute. Apply and Keep use the
existing session transaction, input writers and scenario branching: no second history or persistence owner.

Two-input response maps use a bounded worksheet grid through the same bound scalar capture as the
one-input scan. The maps share the probe coordinates and sampled feasibility across outputs but
scale their colors independently. Approximate contours and sample inspections do not create an
adoptable candidate; the optional candidate marker comes from the separately checked review.
Neither map sampling nor inspecting a sample calls the optional numerical host.

This trades durable run provenance for a direct, non-mutating review. Use the published-model workflow
when an authored optimization request and captured receipt are needed. Search is local, limited to two
bounded continuous inputs and the supported scalar graph; neither convergence nor a passing worksheet
certifies a physical design. The [numeric contract](../../../apps/canvas/artifact_optimizer_contract.md)
owns the execution limits. The [rail acceptance case](../../../apps/canvas/tests/check-worksheet-optimization.mjs)
checks the analytical sag boundary, tightening it, varying width too and refusing infeasible designs.
