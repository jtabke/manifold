import { useEffect, useId, useState, type ReactNode } from "react";
import {
  ASSISTANT_DIAGRAM_CSP,
  ASSISTANT_DIAGRAM_LIMITS,
  checkAssistantDiagram,
} from "../assistantDiagrams";
import "../styles/assistant-diagram.css";

type Diagram = { document: string; height: number };
let libraries:
  | Promise<{
      mermaid: (typeof import("mermaid"))["default"];
      purify: (typeof import("dompurify"))["default"];
    }>
  | undefined;
let tail: Promise<unknown> = Promise.resolve();
const SAFE_SVG_STYLE = `
body { margin: 0; background: #fff; color: #1e293b; font: 14px sans-serif; }
svg { display: block; width: 100%; height: auto; max-width: 100%; }
svg text, svg tspan { fill: #1e293b; font: 14px sans-serif; }
svg .node rect, svg .node circle, svg .node ellipse, svg .node polygon,
svg .node path, svg .actor, svg .labelBox { fill: #eef2f8; stroke: #64748b; }
svg path, svg line, svg polyline { stroke: #64748b; }
svg .flowchart-link, svg .messageLine0, svg .messageLine1 { fill: none; }
svg marker path { fill: #64748b; stroke: none; }
svg .edgeLabel rect, svg .label-container { fill: #fff; }
svg * { pointer-events: none; }
`;

function loadLibraries() {
  return (libraries ??= Promise.all([import("mermaid"), import("dompurify")])
    .then(([{ default: mermaid }, { default: purify }]) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "sandbox",
        suppressErrorRendering: true,
        maxTextSize: ASSISTANT_DIAGRAM_LIMITS.characters,
        maxEdges: ASSISTANT_DIAGRAM_LIMITS.edges,
        htmlLabels: false,
        flowchart: { htmlLabels: false },
        theme: "neutral",
        fontFamily: "sans-serif",
        secure: Object.keys(mermaid.mermaidAPI.defaultConfig),
      });
      return { mermaid, purify };
    })
    .catch((failure) => {
      libraries = undefined;
      throw failure;
    }));
}

/** Serialize Mermaid's global configuration and keep all temporary content behind CSP. */
function renderDiagram(source: string, id: string, current: () => boolean) {
  const task = tail.then(async () => {
    if (!current()) return;
    checkAssistantDiagram(source);
    const { mermaid, purify } = await loadLibraries();
    if (!current()) return;
    const host = document.createElement("div");
    host.className = "assistant-diagram-measure";
    host.setAttribute("aria-hidden", "true");
    document.body.append(host);
    try {
      // In pinned Mermaid 12.3.0 this immediate API creates the sandbox and then
      // awaits parsing. Install CSP synchronously before that first continuation.
      const pending = mermaid.mermaidAPI.render(id, source, host);
      const frame = host.querySelector("iframe"),
        frameDocument = frame?.contentDocument;
      if (!frame || !frame.hasAttribute("sandbox") || !frameDocument?.head) {
        void pending.catch(() => {});
        throw Error("Diagram isolation is unavailable.");
      }
      const policy = frameDocument.createElement("meta");
      policy.httpEquiv = "Content-Security-Policy";
      policy.content = ASSISTANT_DIAGRAM_CSP;
      frameDocument.head.prepend(policy);
      const rendered = await pending;
      if (!current()) return;
      // Sandbox mode returns an iframe wrapper. Never attach that wrapper to chat.
      const encoded =
        /src="data:text\/html;charset=UTF-8;base64,([A-Za-z0-9+/=]+)"/.exec(
          rendered.svg,
        )?.[1];
      if (!encoded) throw Error("Unsupported isolated diagram output.");
      const body = new TextDecoder().decode(
        Uint8Array.from(atob(encoded), (value) => value.charCodeAt(0)),
      );
      const svgStart = body.indexOf("<svg"),
        svgEnd = body.lastIndexOf("</svg>");
      if (svgStart < 0 || svgEnd < svgStart)
        throw Error("Missing diagram SVG.");
      const clean = purify.sanitize(body.slice(svgStart, svgEnd + 6), {
        USE_PROFILES: { svg: true },
        FORBID_TAGS: [
          "style",
          "foreignObject",
          "image",
          "feImage",
          "a",
          "script",
          "iframe",
          "object",
          "embed",
          "use",
          "animate",
          "set",
          "animateMotion",
          "animateTransform",
        ],
        FORBID_ATTR: ["href", "xlink:href", "src", "srcset", "style"],
        ALLOW_DATA_ATTR: false,
      });
      const parsed = new DOMParser().parseFromString(clean, "image/svg+xml"),
        svg = parsed.documentElement;
      if (svg.localName !== "svg" || parsed.querySelector("parsererror"))
        throw Error("Invalid diagram SVG.");
      for (const element of [svg, ...svg.querySelectorAll("*")])
        for (const attribute of [...element.attributes]) {
          // Preserve local marker/clip references only; CSS escapes cannot hide a URL.
          if (
            /^on/i.test(attribute.name) ||
            /[\\@]/.test(attribute.value) ||
            (/url\s*\(/i.test(attribute.value) &&
              !/^url\(\s*['"]?#[\w:.-]+['"]?\s*\)$/.test(attribute.value))
          )
            element.removeAttribute(attribute.name);
        }
      const dimensions = (svg.getAttribute("viewBox") || "")
          .split(/[ ,]+/)
          .map(Number),
        height = Number.isFinite(dimensions[3])
          ? Math.min(520, Math.max(160, dimensions[3]))
          : 240;
      return {
        height,
        document: `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${ASSISTANT_DIAGRAM_CSP}"><style>${SAFE_SVG_STYLE}</style></head><body>${new XMLSerializer().serializeToString(svg)}</body></html>`,
      } satisfies Diagram;
    } finally {
      host.remove();
    }
  });
  tail = task.catch(() => {});
  return task;
}

export function AssistantDiagram({
  source,
  copy,
}: {
  source: string;
  copy: ReactNode;
}) {
  const identity = useId().replace(/[^a-zA-Z0-9]/g, ""),
    [state, setState] = useState<{
      source: string;
      diagram?: Diagram;
      error?: string;
    }>({ source });
  useEffect(() => {
    let active = true;
    setState({ source });
    const timer = setTimeout(() => {
      void renderDiagram(source, `assistantDiagram${identity}`, () => active)
        .then((diagram) => {
          if (active && diagram) setState({ source, diagram });
        })
        .catch((failure: unknown) => {
          if (!active) return;
          let error =
            "This diagram is incomplete or could not be rendered. View or copy its source.";
          try {
            checkAssistantDiagram(source);
          } catch (reason) {
            error = (reason as Error).message;
          }
          if (
            failure instanceof Error &&
            failure.message === "Diagram isolation is unavailable."
          )
            error = "Diagram preview is unavailable. View or copy its source.";
          setState({ source, error });
        });
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [source, identity]);
  const current = state.source === source ? state : undefined;
  return (
    <figure className="assistant-diagram" aria-label="Mermaid diagram">
      <figcaption>Mermaid diagram</figcaption>
      {current?.diagram ? (
        <iframe
          title="Mermaid diagram preview"
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={current.diagram.document}
          style={{ height: current.diagram.height }}
        />
      ) : (
        <p role="status">{current?.error || "Rendering diagram…"}</p>
      )}
      <details open={current?.error ? true : undefined}>
        <summary>Diagram source</summary>
        {copy}
        <pre>
          <code className="language-mermaid">{source}</code>
        </pre>
      </details>
    </figure>
  );
}
