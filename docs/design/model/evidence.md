# Concrete model design evidence

Date: 2026-10-20. Tested the uncommitted design files identified below in the main
checkout, whose base commit is `5d4cf4a`. Existing application changes were already
present; no application runtime migration was performed by this design exercise.
Environment: Node v26.5.0, TypeScript 5.9.3 and Prettier 3.6.2 from the application
installation. This identifies design evidence, not a supported production runtime matrix.

## Checks

From the repository root:

```sh
node_modules/.bin/tsc -p docs/design/model/tsconfig.json
node docs/design/model/check-lifecycle.mjs
node docs/design/model/size-workload.mjs
node_modules/.bin/prettier --check docs/design/model
```

- Strict typechecking passes, including unchecked-index and exact-optional checks.
- The lifecycle assertions pass for authoring, connecting a measurement, temporary
  preview/cancel, Keep, baseline equation edits, source reimport, compatible explicit
  alternative update with retained prior-context and baseline lineage, immediate Undo and archive serialization/reopen.
- Assertions check shared unchanged revisions/bytes, pinned comparison targets,
  dependency-key stability across unrelated note/view edits, late-result key
  comparisons, missing data, incomplete/unresolved expressions and revision collisions.
  Included fixture source bytes match their digest and byte length.
- Synthetic serialization output is saved in [size-results.json](size-results.json).
  It reports 15,000 retained definition revisions and 60,039,698 encoded bytes for
  shared records plus dense selection maps, versus a calculated 1,162,510,101 bytes
  for expanded arrays under that generated workload. See the
  [assessment](../scalability-and-flexibility.md#synthetic-sizing-where-sharing-helps-and-where-it-does-not)
  for assumptions and exclusions.
- Proposal TypeScript, JavaScript and JSON formatting passes.

## What this evidence does not establish

The interpreter knows only the fixture's two linear scalar formulae and a tiny CSV
read. The dependency-key helper knows that fixture's closure. The fixture stages
immutable values in memory; its Keep/Undo roots are constructed by the example,
not published by the production operation owner. Serialization round-trip is not
atomic storage or complete archive validation. These checks do not demonstrate
production occurrence mapping, a general dependency graph, unit algebra, conflicting
alternative merge, model-port validation, unknown-codec execution, storage recovery,
UI usability, or application latency/capacity. The required next gates remain in
[ADR 0004](../decisions/0004-normalized-engineering-records.md#validation-and-review).

## File identities

SHA-256 of the tested artifacts:

- `contracts.ts`: `6b46ddb45c09ac473ad6e76c221f622ce7ee50a9b92bc967b12f0a2697028856`
- `lifecycle.ts`: `b8734e05b12c4e7e147a279a7943f332f6a67dbb510a229817d2494e35c24250`
- `check-lifecycle.mjs`: `d197fa59daf4529ab5337d09a5efb04d5246d202968c4267f286aa94863f0df8`
- `size-workload.mjs`: `30fa18ac3fd6b544d82844c92ab216bc0a91a189cf5194e34c55a81ef3ff3169`
- `size-results.json`: `454b1a8097897813d1a4d68faf23ea70760373712d0d296a363a47f0f8ce925e`
- `tsconfig.json`: `66cb7ef11392dc129eddbec6ef3e2ca422ef2d3428ae2a08eff0f24f89d9d7ad`
