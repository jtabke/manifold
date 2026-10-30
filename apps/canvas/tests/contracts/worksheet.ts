/** Derived worksheet values have no mutation capability; caches are never an accepted owner. */
import { project, curve, type Page } from "../../src/regions/document";
declare const page: Page;
const projection = project(page);
// @ts-expect-error Derived value maps cannot publish changes.
projection.solved.values.set("x", { value: 1, dimension: [0, 0, 0, 0] });
// @ts-expect-error Derived errors cannot be removed by a renderer.
projection.errors.delete("x");
// @ts-expect-error Cached quantities cannot be rewritten.
projection.solved.values.get("x")!.value = 10;
// @ts-expect-error Cached dimensions cannot be rewritten.
projection.solved.values.get("x")!.dimension[0] = 10;
// @ts-expect-error Prepared definitions cannot be renamed in place.
projection.statements.get("x")!.name = "other";
// @ts-expect-error Derived source lists cannot be extended.
projection.sources.x.push("other");
const response = curve(
  page,
  {
    id: "plot",
    input: "x",
    output: "y",
    low: 0,
    high: 1,
    width: 100,
    height: 100,
  },
  "original",
);
// @ts-expect-error Curve points are immutable derivations.
response.points.push({ x: 1, y: 2 });
