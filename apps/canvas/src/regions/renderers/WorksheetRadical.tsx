import { createElement, useLayoutEffect, useRef, type ReactNode } from "react";

/** Measure in either canvas or screen coordinates. The relative geometry is
 * invariant under canvas zoom, including inside scripts and nested roots. */
export function radicalShape(root: DOMRect, argument: DOMRect) {
  const { width, height } = root;
  const lead = argument.left - root.left;
  const gap = argument.top - root.top;
  if (lead <= 0 || gap <= 0 || width <= lead || height <= gap) return;
  const stroke = Math.min(lead * 0.063, gap * 0.3);
  const top = gap * 0.35;
  return {
    stroke,
    bar: {
      x: root.left + lead * 0.96,
      y: root.top + top,
      width: width - lead * 0.96,
      height: stroke,
    },
    path: `M${stroke * 0.7},${height * 0.51 + stroke} L${lead * 0.15},${height * 0.51} L${lead * 0.43},${height - stroke} L${lead * 0.96},${top + stroke / 2} H${width - stroke / 2}`,
  };
}

/** Keep native MathML layout, semantics and input targets. Chromium paints the
 * stretched surd and its overbar separately, producing a step at their join.
 * Paint both as one stroke using the layout the browser already computed. */
export function WorksheetRadical({
  children,
  source,
}: {
  children: ReactNode;
  source: Record<string, unknown>;
}) {
  const root = useRef<MathMLElement>(null);
  const argument = useRef<MathMLElement>(null);
  useLayoutEffect(() => {
    const node = root.current!,
      arg = argument.current!;
    const paint = () => {
      const box = node.getBoundingClientRect();
      const shape = radicalShape(box, arg.getBoundingClientRect());
      if (!shape) return;
      const ink = getComputedStyle(node.parentElement!).color;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box.width} ${box.height}" preserveAspectRatio="none"><path fill="none" stroke="${ink}" stroke-width="${shape.stroke}" stroke-linecap="round" stroke-linejoin="round" d="${shape.path}"/></svg>`;
      const image = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
      if (node.style.getPropertyValue("--er-radical-image") !== image) {
        node.style.setProperty("--er-radical-image", image);
        node.style.setProperty("--er-radical-ink", ink);
      }
      if (!node.hasAttribute("data-radical-painted"))
        node.setAttribute("data-radical-painted", "");
    };
    const resize = new ResizeObserver(paint);
    resize.observe(node);
    resize.observe(arg);
    paint();
    return () => resize.disconnect();
  }, []);
  return createElement(
    "msqrt",
    { ...source, ref: root },
    createElement("mrow", { ref: argument, "data-radicand": "" }, children),
  );
}
