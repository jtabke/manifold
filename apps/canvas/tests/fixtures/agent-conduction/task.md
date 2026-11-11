# Author and revise a thermal-conduction worksheet

Load the repository's [Manifold skill](../../../../../.agents/skills/manifold/SKILL.md).
Start from [baseline.manifold](baseline.manifold). Preserve its reference note and mass.
Use only the CLI and public documentation; do not read implementation, test or verifier
source. The caller provides a private output directory; write only there, not in the checkout.

## Engineering problem

Estimate steady one-dimensional heat loss through an insulation panel using
`Q = k*A*deltaT/L`. Ignore radiation, convection and contact resistance. This is a simplified
mathematical model, not a claim that the panel is physically safe or validated.

Author a worksheet from these inputs, using the names below so it can be reviewed consistently:

- Conductivity `k`: **0.04 W/(m\*K)**.
- Area `A`: **2 m^2**.
- Temperature difference `deltaT`: **20 K**, not an absolute Celsius temperature.
- Initial thickness `L`: **50 mm**.
- Heat loss `Q`: derive it from the four inputs, not a hard-coded result.
- Requirement: **Q < 50 W**.

Add one plain-language note documenting the assumptions. Create these related regions in
one atomic batch, then save an **initial** candidate. Inspect its results and validation.
Next, revise **only thickness L to 25 mm** using the accepted region ID and a newly inspected
document ID. Save a separate **final** candidate. Keep the initial file unchanged. Inspect,
compare and validate both stages. Decide whether an explicit computation job is actually
needed; do not invent a model, request or checked receipt for worksheet-derived values.
Prefer compact discovery; request focused full details when needed to understand units,
source, dimensional diagnostics or evidence.

Do not weaken the requirement to obtain clean validation. Preserve every region's identity
between the initial and final stages, all notes, other inputs, and unrelated baseline content.
Do not overwrite files, modify code/fixtures, or install/start additional tools/services.

## Handoff

Write `report.json` with these fields:

| Field                                                  | Required content                                                                                                                 |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `initial`                                              | Absolute path to the initial authored workspace.                                                                                 |
| `candidate`                                            | Absolute path to the final revised workspace.                                                                                    |
| `initialThicknessMm`, `finalThicknessMm`               | Numeric thicknesses in mm.                                                                                                       |
| `initialHeatLossW`, `finalHeatLossW`                   | Numeric derived heat losses in W.                                                                                                |
| `initialConstraintPass`, `finalConstraintPass`         | Boolean outcomes of the unchanged requirement.                                                                                   |
| `initialValidationExitCode`, `finalValidationExitCode` | Observed strict validation exit codes.                                                                                           |
| `execution`                                            | Describe the result path: use `worksheet-derived-no-job` if no execution request was needed.                                     |
| `physicalValidity`                                     | State whether physical validity was assessed.                                                                                    |
| `summary`                                              | Nonempty explanation of assumptions, source/revision changes, unit conversions, results, requirement transition and limitations. |

Provide the two workspace paths and report path in your final reply. The supervisor will
run the independent verifier afterward:

```sh
node apps/canvas/tools/verify-agent-conduction.mjs /absolute/initial.manifold /absolute/final.manifold /absolute/report.json
```

The verifier is not an agent-solving tool. It checks both native files, the protected baseline,
independent expected arithmetic, dimensional values, formula dependencies, isolated
counterfactual inputs and the report. A passing exercise does not establish general agent
reliability or engineering validity. Normal checks use a deterministic solution and negative
cases; they do not launch paid agent runs.
