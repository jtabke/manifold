import type {
  DesignMapPoint,
  DesignMargin,
  DesignResponseMap,
} from "../worksheetOptimization";

export function requirementStatus(point: DesignMapPoint, k: number) {
  return point.checks[k] === false
    ? "Fails"
    : point.checks[k] === null
      ? "Undefined"
      : point.margins[k]?.atLimit
        ? "At limit"
        : "Passes";
}

export const num = (v: number, precision = 4) =>
  String(Number(v.toPrecision(precision)));
export const unitValue = (v: number, unit: string) =>
  `${num(v)} ${unit}`.trim();
const signed = (value: number, unit: string) =>
  `${value > 0 ? "+" : value < 0 ? "−" : ""}${unitValue(Math.abs(value), unit)}`;
export const marginText = (margin: DesignMargin, unit: string) =>
  margin.roundoff && margin.value > 0
    ? `≈${unitValue(0, unit)}`
    : signed(margin.value, unit);

export type MapPin = { label: "A" | "B"; index: number };

export function WorksheetMapComparison({
  id,
  map,
  candidate,
  pins,
  inspected,
  inspect,
  remove,
}: {
  id: string;
  map: DesignResponseMap;
  candidate?: DesignMapPoint;
  pins: readonly MapPin[];
  inspected?: MapPin;
  inspect: (pin: MapPin) => void;
  remove: (pin: MapPin) => void;
}) {
  const columns: { title: string; point: DesignMapPoint; pin?: MapPin }[] = [
    { title: "Current", point: map.current },
    ...(candidate ? [{ title: "Checked candidate", point: candidate }] : []),
    ...pins.map((pin) => ({
      title: `Sample ${pin.label}`,
      point: map.points[pin.index],
      pin,
    })),
  ];
  const [goal, ...otherOutputs] = map.outputs.map((output, k) => ({
    ...output,
    read: (p: DesignMapPoint) => p.values[k],
  }));
  const axes = [
    { ...map.xAxis, read: (p: DesignMapPoint) => p.x },
    { ...map.yAxis, read: (p: DesignMapPoint) => p.y },
  ];
  function quantityRow(
    {
      id,
      name,
      unit,
      read,
    }: Pick<typeof goal, "id" | "name" | "unit" | "read">,
    key: string,
  ) {
    const baseline = read(map.current);
    return (
      <tr key={key + id}>
        <th scope="row">{name}</th>
        {columns.map(({ title, point, pin }, i) => {
          const value = read(point);
          const delta =
            value === null || baseline === null ? NaN : value - baseline;
          return (
            <td key={title} data-inspected={pin === inspected && !!pin}>
              {value === null ? "Undefined" : unitValue(value, unit)}
              {i > 0 && Number.isFinite(delta) && delta !== 0 && (
                <small className="design-map-delta">
                  Δ {signed(delta, "")}
                </small>
              )}
            </td>
          );
        })}
      </tr>
    );
  }
  return (
    <section
      className="design-map-comparison"
      id={id}
      aria-label="Compare designs"
    >
      <p className="design-comparison-guide">
        Δ shows change from Current in the same units.
      </p>
      <table aria-label="Pinned design comparison">
        <thead>
          <tr>
            <th scope="col">Quantity</th>
            {columns.map(({ title, pin }) => (
              <th key={title} scope="col" aria-label={title}>
                {pin ? (
                  <button
                    type="button"
                    className="design-compare-inspect"
                    aria-label={`Inspect sample ${pin.label}`}
                    aria-pressed={inspected === pin}
                    onClick={() => inspect(pin)}
                  >
                    {title}
                  </button>
                ) : (
                  title
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {quantityRow(goal, "output:")}
          {map.requirements.map(({ id, label, unit }, k) => (
            <tr key={id} className="design-margin-row">
              <th scope="row">
                {label}
                <small>Margin</small>
              </th>
              {columns.map(({ title, point, pin }) => {
                const margin = point.margins[k];
                return (
                  <td key={title} data-inspected={pin === inspected && !!pin}>
                    <span data-pass={point.checks[k] ?? "unknown"}>
                      {requirementStatus(point, k)}
                    </span>
                    {margin && <small>{marginText(margin, unit)}</small>}
                  </td>
                );
              })}
            </tr>
          ))}
          {axes.map((quantity) => quantityRow(quantity, "axis:"))}
          {otherOutputs.map((quantity) => quantityRow(quantity, "output:"))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Pinned samples</th>
            {columns.map(({ title, pin }) => (
              <td key={title}>
                {pin && (
                  <button
                    type="button"
                    className="design-compare-remove"
                    aria-label={`Remove sample ${pin.label}`}
                    onClick={() => remove(pin)}
                  >
                    Remove
                  </button>
                )}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </section>
  );
}
