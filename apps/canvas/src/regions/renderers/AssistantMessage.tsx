import {
  memo,
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Copy } from "lucide-react";
import { AssistantDiagram } from "./AssistantDiagram";
import "katex/dist/katex.min.css";
import {
  ASSISTANT_OBJECT_LINK,
  type AssistantObjectReference,
} from "../assistantReferences";

function CopyButton({ text, label }: { text: string; label: string }) {
  const [status, setStatus] = useState("");
  return (
    <span className="assistant-copy-control">
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setStatus("Copied");
          } catch {
            setStatus("Could not copy. Select and copy the text manually.");
          }
        }}
      >
        <Copy size={13} aria-hidden="true" /> Copy
      </button>
      <span role="status">{status}</span>
    </span>
  );
}
function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (node && typeof node === "object" && "props" in node)
    return textContent((node.props as { children?: ReactNode }).children);
  return "";
}

/** React nodes only: no raw HTML, remote images, trusted TeX commands or executable URLs. */
export const AssistantMessage = memo(function AssistantMessage({
  text,
  references,
  reveal,
}: {
  text: string;
  references: readonly AssistantObjectReference[];
  reveal: (id: string, input?: string) => Promise<boolean>;
}) {
  const [referenceStatus, setReferenceStatus] = useState("");
  const revealCurrent = useRef(reveal);
  useLayoutEffect(() => {
    revealCurrent.current = reveal;
  }, [reveal]);
  const openReference = useCallback(
    async (href: string) => {
      const reference = references.find((reference) => reference.href === href);
      if (!reference) {
        setReferenceStatus(
          "This reference was not verified by a canvas inspection in this request. No navigation or changes were performed.",
        );
        return;
      }
      setReferenceStatus(`Locating ${reference.label}…`);
      try {
        const found = await revealCurrent.current(
          reference.id,
          reference.input,
        );
        setReferenceStatus(
          found
            ? `Highlighted ${reference.label}. No worksheet changes were made.`
            : `${reference.label} is no longer available or visible on this canvas. No worksheet changes were made.`,
        );
      } catch {
        setReferenceStatus(
          `${reference.label} could not be located. No worksheet changes were made.`,
        );
      }
    },
    [references],
  );
  const prefix = `assistant-${useId()}-`;
  const components = useMemo<Components>(
    () => ({
      h1: ({ children }) => <h4>{children}</h4>,
      h2: ({ children, id }) => (
        <h4 id={id === "footnote-label" ? `${prefix}footnote-label` : id}>
          {children}
        </h4>
      ),
      h3: ({ children }) => <h4>{children}</h4>,
      a: ({ node: _node, href, children, ...props }) =>
        href?.startsWith(ASSISTANT_OBJECT_LINK) ? (
          <button
            type="button"
            className="assistant-object-reference"
            title="Locate on canvas without editing"
            onClick={() => void openReference(href)}
          >
            {references.find((reference) => reference.href === href)?.label ||
              children}
          </button>
        ) : href ? (
          <a
            {...props}
            href={href}
            aria-describedby={
              props["aria-describedby"] === "footnote-label"
                ? `${prefix}footnote-label`
                : props["aria-describedby"]
            }
            target={href.startsWith("#") ? undefined : "_blank"}
            rel={href.startsWith("#") ? undefined : "noopener noreferrer"}
            onClick={
              href.startsWith("#")
                ? (event) => {
                    event.preventDefault();
                    const target = event.currentTarget
                      .closest(".assistant-answer")
                      ?.querySelector<HTMLElement>(
                        `[id="${CSS.escape(href.slice(1))}"]`,
                      );
                    if (target) {
                      target.scrollIntoView({ block: "nearest" });
                      target.setAttribute("tabindex", "-1");
                      target.focus({ preventScroll: true });
                    }
                  }
                : undefined
            }
          >
            {children}
          </a>
        ) : (
          <span>{children}</span>
        ),
      img: ({ alt }) => (
        <span className="assistant-privacy">
          [Image omitted{alt ? `: ${alt}` : ""}]
        </span>
      ),
      table: ({ children }) => (
        <div
          className="assistant-table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Response table"
        >
          <table>{children}</table>
        </div>
      ),
      pre: ({ node, children }) => {
        const code = node?.children[0];
        if (
          code?.type === "element" &&
          code.tagName === "code" &&
          String(code.properties.className)
            .split(/[\s,]+/)
            .includes("language-mermaid")
        ) {
          const source = textContent(children).replace(/\n$/, "");
          return (
            <AssistantDiagram
              source={source}
              copy={<CopyButton text={source} label="Copy diagram source" />}
            />
          );
        }
        return (
          <div className="assistant-code-block">
            <CopyButton text={textContent(children)} label="Copy code" />
            <pre>{children}</pre>
          </div>
        );
      },
    }),
    [prefix, references, openReference],
  );
  return (
    <div className="assistant-answer">
      {text.length > 100_000 ? (
        <pre>{text}</pre>
      ) : (
        <Markdown
          skipHtml
          remarkPlugins={[remarkGfm, remarkMath]}
          remarkRehypeOptions={{ clobberPrefix: prefix }}
          rehypePlugins={[
            [
              rehypeKatex,
              { trust: false, maxExpand: 500, maxSize: 10, strict: "ignore" },
            ],
          ]}
          urlTransform={(url) =>
            url.startsWith(ASSISTANT_OBJECT_LINK) ||
            /^(https?:|mailto:)/i.test(url) ||
            /^(#|\/[^/])/.test(url)
              ? url
              : ""
          }
          components={components}
        >
          {text}
        </Markdown>
      )}
      {referenceStatus && (
        <p role="status" className="assistant-reference-status">
          {referenceStatus}
        </p>
      )}
      <CopyButton text={text} label="Copy assistant response" />
    </div>
  );
});
