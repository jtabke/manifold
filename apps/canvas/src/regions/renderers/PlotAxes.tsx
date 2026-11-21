import { ArrowLeftRight } from "lucide-react";

export function SwapAxesButton({
  swapped,
  disabled,
  onSwap,
}: {
  swapped?: boolean;
  disabled?: boolean;
  onSwap: () => void;
}) {
  return (
    <button
      className="er-swap-axes"
      type="button"
      aria-label="Swap axes"
      aria-pressed={!!swapped}
      title="Swap axes without changing the calculation"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onSwap();
      }}
    >
      <ArrowLeftRight size={15} aria-hidden="true" />
      <span>Swap axes</span>
    </button>
  );
}

/** Samples and selection always use (swept input, response), regardless of display orientation. */
export function responsePlotAxes(
  rect: { left: number; right: number; top: number; bottom: number },
  input: readonly [number, number],
  output: readonly [number, number],
  swapped: boolean,
) {
  const { left, right, top, bottom } = rect;
  const width = right - left,
    height = bottom - top;
  const toFraction = (n: number, domain: typeof input) =>
    (n - domain[0]) / (domain[1] - domain[0] || 1);
  const inputSpan = input[1] - input[0];
  const inputLength = swapped ? height : width;
  const horizontal = swapped ? output : input;
  const vertical = swapped ? input : output;
  const x = (n: number) => left + toFraction(n, horizontal) * width;
  const y = (n: number) => bottom - toFraction(n, vertical) * height;
  const point = (sweep: number, response: number) =>
    swapped
      ? ([x(response), y(sweep)] as const)
      : ([x(sweep), y(response)] as const);
  const guide = (sweep: number, response?: number) =>
    swapped
      ? `M${left},${y(sweep)}H${response === undefined ? right : x(response)}`
      : `M${x(sweep)},${bottom}V${response === undefined ? top : y(response)}`;
  const limit = (response: number) =>
    swapped
      ? `M${x(response)},${top}V${bottom}`
      : `M${left},${y(response)}H${right}`;
  const band = (low: number, high: number) =>
    swapped
      ? { x: left, y: y(high), width, height: Math.max(1, y(low) - y(high)) }
      : { x: x(low), y: top, width: Math.max(1, x(high) - x(low)), height };
  const inputPixel = (
    svg: SVGSVGElement | null,
    clientX: number,
    clientY: number,
  ) => {
    const matrix = svg?.getScreenCTM();
    if (!matrix) return 0;
    const pt = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return swapped ? bottom - pt.y : pt.x - left;
  };
  const inputAt = (pixel: number) =>
    input[0] + Math.max(0, Math.min(1, pixel / inputLength)) * inputSpan;
  return {
    x,
    y,
    point,
    guide,
    limit,
    band,
    inputPixel,
    inputAt,
    inputLength,
    horizontal,
    vertical,
  };
}
