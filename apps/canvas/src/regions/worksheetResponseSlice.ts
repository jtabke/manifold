import type {
  DesignMapPoint,
  DesignResponseMap,
} from "./worksheetOptimization.ts";

/** Project a row or column of the existing grid, retaining canonical sample IDs. */
export function responseSlice(
  map: DesignResponseMap,
  probe: Pick<DesignMapPoint, "x" | "y">,
  fixedId: string,
) {
  const fixedX = fixedId === map.xAxis.id;
  const fixed = fixedX ? map.xAxis : map.yAxis;
  const varied = fixedX ? map.yAxis : map.xAxis;
  const last = map.size - 1;
  const fraction = (value: number, axis: typeof fixed) =>
    (value - axis.bounds[0]) / (axis.bounds[1] - axis.bounds[0]);
  const x = fraction(probe.x, map.xAxis),
    y = fraction(probe.y, map.yAxis);
  if (![x, y].every((n) => n >= -1e-12 && n <= 1 + 1e-12)) return;
  const [i, j] = [x, y].map((v) =>
    Math.max(0, Math.min(last, Math.round(v * last))),
  );
  const active = fixedX ? j : i;
  const samples = Array.from({ length: map.size }, (_, k) => {
    const index = fixedX ? k * map.size + i : j * map.size + k;
    const point = map.points[index];
    return { index, point, input: fixedX ? point.y : point.x };
  });
  const point = samples[active].point;
  const fixedValue = fixedX ? point.x : point.y;
  return {
    fixed,
    varied,
    fixedValue,
    active,
    samples,
    fixedSnapped: Math.abs((fixedX ? x : y) * last - (fixedX ? i : j)) > 1e-9,
    snapped: Math.abs(x * last - i) > 1e-9 || Math.abs(y * last - j) > 1e-9,
    crossings: map.requirements.flatMap((requirement, q) => {
      const brackets = samples.slice(1).flatMap((right, k) => {
        const left = samples[k];
        const a = left.point.checks[q],
          b = right.point.checks[q];
        return a !== null && b !== null && a !== b
          ? [{ low: left.input, high: right.input, enters: b }]
          : [];
      });
      return brackets.length ? [{ requirement, brackets }] : [];
    }),
  };
}
