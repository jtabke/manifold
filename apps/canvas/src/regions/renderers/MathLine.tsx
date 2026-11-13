import { isDialogEvent } from "../interaction/modalInput";
import "../styles/math.css";
import React, {
  useRef,
  useMemo,
  useState,
  useEffect,
  useLayoutEffect,
  type ReactNode,
  type RefObject,
} from "react";
import {
  display,
  references,
  relationGlyph,
  type Statement,
  type Expression,
} from "../../notebook/math";
import { project } from "../document";
import type { Quantity } from "../../notebook/math";
import {
  numberScrubAttributes,
  useNumberScrub,
  type NumberInput,
  type Scrub,
} from "../interaction/useNumberScrub";
import { mathSource, caretInSpan, type SourceSpan } from "../editing";
import { sourceSpans } from "../editing";

const m = (
  tag: string,
  children: ReactNode,
  props: Record<string, unknown> = {},
) => React.createElement(tag, props, children);
function notation(name: string): ReactNode {
  const parts = name.split("_");
  return parts.length > 1
    ? m("msub", [
        m("mi", parts[0], { key: "a" }),
        m("mi", parts.slice(1).join(""), { key: "b" }),
      ])
    : m("mi", name === "degC" ? "°C" : name);
}
type MathLineProps = Omit<
  Parameters<typeof MathLineContent>[0],
  "cancelInput"
> & {
  inputVersion?: unknown;
};
// Delegates close over current-handler refs and scalar data, never old Page callbacks.
function liveMathHandlers(
  latest: RefObject<MathLineProps>,
  own?: Quantity,
  sources?: ReadonlyMap<string, Quantity>,
) {
  const wrap = (read: () => Scrub | undefined, fallback: Quantity): Scrub => ({
    get quantity() {
      return read()?.quantity || fallback;
    },
    get range() {
      return read()?.range;
    },
    explore: (value, anchor) => read()?.explore(value, anchor),
    finish: () => read()?.finish(),
    revert: () => read()?.revert(),
  });
  return {
    choose: (name: string) => latest.current.choose(name),
    edit: (span?: { start: number; end: number }) => latest.current.edit(span),
    onSymbol: (name: string) => latest.current.onSymbol?.(name),
    scrub: own ? wrap(() => latest.current.scrub, own) : undefined,
    scrubSource: sources
      ? (id: string) => {
          const q = sources.get(id);
          return q
            ? wrap(() => latest.current.scrubSource?.(id), q)
            : undefined;
        }
      : undefined,
  };
}
/** Cache the rendered mathematics, while event delegates use the latest committed application handlers. */
export function MathLine(props: MathLineProps) {
  const latest = useRef(props);
  const cancelInput = useRef<(() => void) | undefined>(undefined);
  // Invalidate input without invalidating the cached mathematical representation.
  useLayoutEffect(() => cancelInput.current?.(), [props.inputVersion]);
  useLayoutEffect(() => {
    latest.current = props;
  });
  const names = useMemo(
    () => [
      ...new Set([
        props.statement.name,
        ...references(props.statement.expression),
      ]),
    ],
    [props.statement],
  );
  const describeScrub = (scrub?: Scrub) =>
    scrub ? [scrub.quantity, scrub.range] : null;
  // Include only values this row displays. A different equation's value is not a rendering dependency.
  const visual = JSON.stringify([
    props.text,
    props.directEdit,
    props.selectOnClick,
    props.inspectSymbols,
    props.highlightExpression,
    describeScrub(props.scrub),
    names.map((name) => {
      const id =
        props.resolved?.sources[name]?.length === 1
          ? props.resolved.sources[name][0]
          : undefined;
      return [
        name,
        props.highlight === name || !!props.highlights?.has(name),
        props.linkSources?.[name],
        props.resolved?.sources[name],
        props.resolved?.solved.values.get(name),
        id && props.resolved?.errors.get(id),
        id && describeScrub(props.scrubSource?.(id)),
      ];
    }),
  ]);
  return useMemo(() => {
    const controls = new Map(
      names.flatMap((name) => {
        const id = props.resolved?.sources[name]?.[0],
          q = id && props.scrubSource?.(id)?.quantity;
        return id && q ? [[id, q] as const] : [];
      }),
    );
    const bound: MathLineProps = {
      ...props,
      ...liveMathHandlers(
        latest,
        props.scrub?.quantity,
        props.scrubSource ? controls : undefined,
      ),
    };
    return <MathLineContent {...bound} cancelInput={cancelInput} />;
  }, [props.statement, visual]);
}
/** Caret location in authored source, even when pointer capture targets the math root. */
function sourceAtPoint(
  root: Element,
  x: number,
  y: number,
): SourceSpan | undefined {
  let target =
    document.elementFromPoint(x, y)?.closest("[data-source-start]") ?? null;
  if (!target || !root.contains(target)) {
    let nearest = Infinity;
    target = null;
    for (const node of root.querySelectorAll("[data-source-start]")) {
      const rect = node.getBoundingClientRect();
      const distance = Math.hypot(
        Math.max(rect.left - x, 0, x - rect.right),
        Math.max(rect.top - y, 0, y - rect.bottom),
      );
      if (distance < nearest) {
        target = node;
        nearest = distance;
      }
    }
  }
  if (!target) return;
  const rect = target.getBoundingClientRect();
  return caretInSpan(
    {
      start: Number(target.getAttribute("data-source-start")),
      end: Number(target.getAttribute("data-source-end")),
    },
    (x - rect.left) / (rect.width || 1),
  );
}
function MathLineContent({
  statement,
  text,
  choose,
  edit,
  scrub,
  resolved,
  scrubSource,
  highlight,
  highlightExpression,
  highlights,
  directEdit = false,
  selectOnClick = false,
  inspectSymbols = false,
  cancelInput,
  linkSources,
  onSymbol,
}: {
  statement: Statement;
  text: string;
  choose: (name: string) => void;
  edit: (span?: { start: number; end: number }) => void;
  scrub?: Scrub;
  resolved?: ReturnType<typeof project>;
  scrubSource?: (id: string) => Scrub | undefined;
  highlight?: string;
  highlights?: Set<string>;
  highlightExpression?: boolean;
  directEdit?: boolean;
  selectOnClick?: boolean;
  inspectSymbols?: boolean;
  cancelInput: RefObject<(() => void) | undefined>;
  linkSources?: Readonly<Record<string, readonly string[]>>;
  onSymbol?: (name: string) => void | boolean;
}) {
  const renders = useRef(0);
  renders.current++;
  const nativeEdit = directEdit && !inspectSymbols;
  const ports = new Map<string, NumberInput>();
  const { events: numbers, cancel } = useNumberScrub({
    read: (target) =>
      ports.get(
        target
          .closest("[data-number-input]")
          ?.getAttribute("data-number-input") || "",
      ),
  });
  useLayoutEffect(() => {
    cancelInput.current = cancel;
    return () => {
      cancelInput.current = undefined;
    };
  });
  const numberControl = (
    id: string,
    name: string,
    children: ReactNode,
    port: NumberInput,
    title?: string,
  ) => {
    ports.set(id, port);
    return m("mn", children, {
      ...numberScrubAttributes(name, port.scrub, title),
      "data-number-input": id,
    });
  };
  const [selection, setSelection] = useState<SourceSpan>();
  const drag = useRef<
    | {
        pointer: number;
        x: number;
        y: number;
        start: number;
        text: string;
        moved: boolean;
      }
    | undefined
  >(undefined);
  const suppressClick = useRef(false);
  const cancelSelection = () => {
    if (!drag.current) return;
    drag.current = undefined;
    suppressClick.current = true;
    setSelection(undefined);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (isDialogEvent(e)) return;
      if (e.key === "Escape" && drag.current) {
        e.preventDefault();
        e.stopPropagation();
        cancelSelection();
      }
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", cancelSelection);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", cancelSelection);
    };
  }, []);
  useLayoutEffect(cancelSelection, [text, nativeEdit]);
  const spans = sourceSpans(text);
  let number = 0;
  const source = mathSource(statement, text);
  const sourceProps = (span?: SourceSpan) =>
    span
      ? {
          "data-source-start": span.start,
          "data-source-end": span.end,
          "data-source-selected":
            !!selection &&
            span.start < selection.end &&
            span.end > selection.start,
        }
      : {};
  const editAt = (span: SourceSpan, element?: Element, x?: number) => {
    if (x !== undefined && element) {
      const rect = element.getBoundingClientRect();
      edit(caretInSpan(span, (x - rect.left) / (rect.width || 1)));
    } else edit({ start: span.start, end: span.start });
  };
  const symbol = (
    name: string,
    substitute = true,
    span?: SourceSpan,
  ): ReactNode => {
    const id =
      resolved?.sources[name]?.length === 1
        ? resolved.sources[name][0]
        : undefined;
    const q = resolved?.solved.values.get(name);
    if (substitute && id && q && !resolved?.errors.has(id))
      return m("munder", [
        m(
          "munder",
          [
            m(
              "mrow",
              numberControl(
                `source:${id}`,
                `Explore ${name}`,
                display(q),
                {
                  scrub: nativeEdit ? undefined : scrubSource?.(id),
                  edit: () => choose(name),
                },
                "Drag to vary · click for definition",
              ),
              { key: "v", "data-source-id": id },
            ),
            m("mo", "⏟", { key: "b", stretchy: "true" }),
          ],
          { key: "q" },
        ),
        m("mtext", name === "T_inf" ? "T∞" : name, {
          key: "n",
          className: "er-term-caption",
        }),
      ]);
    return !references({ kind: "name", name }).length
      ? m("mi", name === "degC" ? "°C" : name, {
          mathvariant: "normal",
          ...sourceProps(span),
        })
      : m("mrow", notation(name), {
          className: `er-term ${highlight === name || highlights?.has(name) ? "is-linked" : ""}`,
          "data-symbol": name,
          title: selectOnClick
            ? "Click to select · Double-click or Enter to edit · Alt-click to inspect this term"
            : "Click to edit · Alt-click to select this term",
          "data-link-source":
            linkSources?.[name]?.length === 1
              ? linkSources[name][0]
              : undefined,
          role: "button",
          tabIndex: 0,
          ...sourceProps(span),
          "aria-label": `${directEdit && !inspectSymbols ? "Edit" : "Inspect"} ${name}`,
          onClick: (e: React.MouseEvent) => {
            if (
              selectOnClick &&
              directEdit &&
              !inspectSymbols &&
              !e.altKey &&
              e.detail < 2
            )
              return;
            e.stopPropagation();
            if (e.altKey) {
              choose(name);
              return;
            }
            if (onSymbol?.(name)) return;
            if (directEdit && span) editAt(span, e.currentTarget, e.clientX);
            else choose(name);
          },
          onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              if (inspectSymbols && onSymbol?.(name)) return;
              if (directEdit && span) editAt(span);
              else choose(name);
            }
          },
        });
  };
  const expression = (e: Expression): ReactNode => {
    const mapped = source.expressions.get(e)!;
    if (e.kind === "number") {
      const span = spans[number++];
      return m(
        "mrow",
        numberControl(`literal:${number}`, `Edit value ${e.value}`, e.value, {
          scrub: nativeEdit ? undefined : number === 1 ? scrub : undefined,
          edit: (element, point) =>
            directEdit ? editAt(mapped.span, element, point?.x) : edit(span),
        }),
        sourceProps(mapped.span),
      );
    }
    if (e.kind === "name") return symbol(e.name, true, mapped.span);
    if (e.kind === "unit" || e.kind === "constant")
      return m(
        "mi",
        e.name === "degC" ? "°C" : e.name === "pi" ? "π" : e.name,
        { mathvariant: "normal", ...sourceProps(mapped.span) },
      );
    if (e.kind === "call") {
      // Keep the transformed operator linked to its authored function name;
      // arguments retain their own precise source spans and interactions.
      const operator = sourceProps(mapped.operator);
      if (e.name === "sqrt") return m("msqrt", expression(e.args[0]), operator);
      if (e.name === "cbrt")
        return m("mroot", [expression(e.args[0]), m("mn", "3")], operator);
      if (e.name === "abs")
        return m("mrow", [
          m("mo", "|", { key: "open", ...operator }),
          m("mrow", expression(e.args[0]), { key: "arg" }),
          m("mo", "|", { key: "close", ...operator }),
        ]);
      if (e.name === "exp")
        return m("msup", [
          m("mi", "e", { key: "fn", mathvariant: "normal", ...operator }),
          m("mrow", expression(e.args[0]), { key: "arg" }),
        ]);
      return m("mrow", [
        e.name === "log10"
          ? m(
              "msub",
              [
                m("mi", "log", {
                  key: "fn",
                  mathvariant: "normal",
                  ...operator,
                }),
                m("mn", "10", { key: "base", ...operator }),
              ],
              { key: "fn" },
            )
          : m(
              "mi",
              (
                { asin: "arcsin", acos: "arccos", atan: "arctan" } as Record<
                  string,
                  string
                >
              )[e.name] ?? e.name,
              {
                key: "fn",
                mathvariant: "normal",
                ...operator,
              },
            ),
        m("mo", "⁡", { key: "apply" }),
        m("mo", "(", { key: "open" }),
        ...e.args.flatMap((arg, i) => [
          ...(i ? [m("mo", ",", { key: `comma-${i}` })] : []),
          m("mrow", expression(arg), { key: `arg-${i}` }),
        ]),
        m("mo", ")", { key: "close" }),
      ]);
    }
    if (e.kind === "unary")
      return m("mrow", [
        m("mo", "−", { key: "o", ...sourceProps(mapped.operator) }),
        m(
          "mrow",
          grouped(
            e.expression,
            e.expression.kind === "unary" ||
              (e.expression.kind === "binary" &&
                ["+", "-"].includes(e.expression.op)),
          ),
          { key: "e" },
        ),
      ]);
    if (e.op === "/" || e.op === "^")
      return m(
        e.op === "/" ? "mfrac" : "msup",
        [
          m(
            "mrow",
            grouped(
              e.left,
              e.op === "^" &&
                (e.left.kind === "binary" ||
                  e.left.kind === "unary" ||
                  (e.left.kind === "call" && e.left.name === "exp") ||
                  (e.left.kind === "number" && e.left.value < 0)),
            ),
            { key: "l" },
          ),
          m("mrow", expression(e.right), { key: "r" }),
        ],
        sourceProps(mapped.operator),
      );
    const child = (value: Expression, right = false) =>
      grouped(
        value,
        (value.kind === "binary" &&
          ["+", "-"].includes(value.op) &&
          (e.op === "*" || (e.op === "-" && right))) ||
          (right && value.kind === "unary"),
      );
    return m("mrow", [
      m("mrow", child(e.left), { key: "l" }),
      m("mo", e.op === "*" ? "·" : e.op === "-" ? "−" : e.op, {
        key: "o",
        ...sourceProps(mapped.operator),
      }),
      m("mrow", child(e.right, true), { key: "r" }),
    ]);
  };
  // Fractions, radicals and exponent slots already delimit their contents.
  // Other contexts need explicit fences to preserve the parsed meaning.
  function grouped(value: Expression, needed: boolean): ReactNode {
    const content = expression(value);
    return needed
      ? m("mrow", [
          m("mo", "(", { key: "open" }),
          m("mrow", content, { key: "value" }),
          m("mo", ")", { key: "close" }),
        ])
      : content;
  }
  return m(
    "math",
    m("mrow", [
      ...(!statement.anonymous
        ? [
            m("mrow", symbol(statement.name, false, source.name), { key: "n" }),
            m("mo", relationGlyph(statement.relation), {
              key: "r",
              ...sourceProps(source.relation),
            }),
          ]
        : []),
      m("mrow", expression(statement.expression), {
        key: "e",
        className: highlightExpression ? "er-linked-expression" : "",
        "data-expression-for": statement.name,
      }),
    ]),
    {
      display: "inline",
      // Full-sized fractions improve worksheet reading; scripts still shrink
      // naturally inside exponents and nested fractions.
      displaystyle: "true",
      "data-math-renders": renders.current,
      tabIndex: -1,
      onKeyDown: numbers.onKeyDown,
      onKeyUp: numbers.onKeyUp,
      onBlur: numbers.onBlur,
      className: `er-typeset-math${nativeEdit ? " er-editable-math" : ""}`,
      onPointerDown: (event: React.PointerEvent<Element>) => {
        if (numbers.onPointerDown(event)) return;
        if (
          !nativeEdit ||
          event.button !== 0 ||
          event.altKey ||
          event.shiftKey ||
          drag.current
        )
          return;
        const point = sourceAtPoint(
          event.currentTarget,
          event.clientX,
          event.clientY,
        );
        if (!point) return;
        event.preventDefault();
        event.stopPropagation();
        suppressClick.current = false;
        drag.current = {
          pointer: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          start: point.start,
          text,
          moved: false,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove: (event: React.PointerEvent<Element>) => {
        if (numbers.onPointerMove(event)) return;
        const g = drag.current;
        if (!g || g.pointer !== event.pointerId || g.text !== text) return;
        if (
          !g.moved &&
          Math.hypot(event.clientX - g.x, event.clientY - g.y) < 4
        )
          return;
        const point = sourceAtPoint(
          event.currentTarget,
          event.clientX,
          event.clientY,
        );
        if (!point) return;
        g.moved = true;
        setSelection({
          start: Math.min(g.start, point.start),
          end: Math.max(g.start, point.start),
        });
      },
      onPointerUp: (event: React.PointerEvent<Element>) => {
        if (numbers.onPointerUp(event)) return;
        const g = drag.current;
        if (!g || g.pointer !== event.pointerId) return;
        drag.current = undefined;
        setSelection(undefined);
        if (!g.moved || g.text !== text) return;
        const point = sourceAtPoint(
          event.currentTarget,
          event.clientX,
          event.clientY,
        );
        if (!point) return;
        event.preventDefault();
        event.stopPropagation();
        suppressClick.current = true;
        edit({
          start: Math.min(g.start, point.start),
          end: Math.max(g.start, point.start),
        });
      },
      onPointerCancel: (event: React.PointerEvent) => {
        numbers.onPointerCancel(event);
        if (drag.current?.pointer === event.pointerId) cancelSelection();
      },
      onLostPointerCapture: (event: React.PointerEvent) => {
        numbers.onLostPointerCapture(event);
        if (drag.current?.pointer === event.pointerId) cancelSelection();
      },
      onDoubleClick: (event: React.MouseEvent) => {
        if (selectOnClick && directEdit) event.stopPropagation();
      },
      onClick: (event: React.MouseEvent) => {
        if (selectOnClick && !event.altKey && event.detail < 2) return;
        if (directEdit) event.stopPropagation();
        if (drag.current) return;
        if (suppressClick.current) {
          suppressClick.current = false;
          return;
        }
        if (numbers.onClick(event)) return;
        if (!directEdit) return;
        event.stopPropagation();
        const point = sourceAtPoint(
          event.currentTarget,
          event.clientX,
          event.clientY,
        );
        edit(point);
      },
    },
  );
}
