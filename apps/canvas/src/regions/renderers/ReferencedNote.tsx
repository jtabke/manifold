import { Fragment } from "react";
import { ArrowUpRight } from "lucide-react";
import type { Projection } from "../document";
import { noteReferences } from "../noteReferences";
import { worksheetReadout, isPreviewReading } from "../worksheetReadout";

export function ReferencedNote({
  text,
  links,
  projection: p,
  labelFor,
  previewInput,
  open,
  trace,
}: {
  text: string;
  links: Readonly<Record<string, string>>;
  projection: Projection;
  labelFor: (id: string) => string;
  previewInput?: string;
  open: (id: string) => void;
  trace?: (id: string) => void;
}) {
  if (!Object.keys(links).length) return <>{text}</>;
  const refs = noteReferences(text, links);
  let end = 0,
    preview = false;
  const parts = refs.map((ref) => {
    const preceding = text.slice(end, ref.start);
    end = ref.end;
    const live = ref.mode !== "name",
      read = live ? worksheetReadout(p, ref.id) : undefined;
    const valid = read?.kind === ref.mode,
      statement = !live && p.statements.get(ref.id),
      label =
        statement && (statement.anonymous || statement.relation !== "=")
          ? p.texts[ref.id]
          : labelFor(ref.id);
    const content = !live
      ? label
      : !valid || !read?.available
        ? `Unavailable (${ref.alias})`
        : read.kind === "status"
          ? `${read.label} · ${read.text}`
          : read.text;
    if (!preview && live && isPreviewReading(p, ref.id, previewInput))
      preview = true;
    const action = live ? (trace && valid ? trace : undefined) : open;
    return (
      <Fragment key={ref.start}>
        {preceding}
        {action ? (
          <button
            className={live ? "er-note-live" : "er-note-reference"}
            data-note-live={live ? ref.mode : undefined}
            data-pass={valid ? read?.pass : undefined}
            title={live ? read?.detail : undefined}
            aria-label={
              live
                ? `Trace ${ref.mode} of ${read?.name ?? label}: ${content}`
                : `Open reference ${label}`
            }
            onClick={(e) => {
              e.stopPropagation();
              action(ref.id);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {content}
            {!live && <ArrowUpRight size={11} />}
          </button>
        ) : (
          <span
            className="er-note-live"
            data-note-live={ref.mode}
            data-pass={valid ? read?.pass : undefined}
            title={read?.detail}
          >
            {content}
          </span>
        )}
      </Fragment>
    );
  });
  return (
    <>
      {parts}
      {text.slice(end)}
      {preview && <small className="er-readout-preview">Preview</small>}
    </>
  );
}
