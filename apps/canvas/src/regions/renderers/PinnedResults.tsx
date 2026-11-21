import { Pin, X } from "lucide-react";
import type { Projection } from "../document";
import { isPreviewReading, worksheetReadout } from "../worksheetReadout";
import "../styles/worksheetReadouts.css";

export function PinnedResults({
  ids,
  projection: p,
  previewInput,
  add,
  remove,
  trace,
}: {
  ids: readonly string[];
  projection: Projection;
  previewInput?: string;
  add: (id: string) => void;
  remove: (id: string) => void;
  trace: (id: string) => void;
}) {
  return (
    <section
      className="er-pinned-results"
      aria-label="Pinned worksheet results"
    >
      <header>
        <Pin size={14} />
        <h3>Pinned results</h3>
      </header>
      {ids.length > 0 && (
        <ul>
          {ids.map((id) => {
            const read = worksheetReadout(p, id),
              label = read?.label ?? "Unavailable result",
              value = read?.text ?? "Unavailable",
              preview = isPreviewReading(p, id, previewInput);
            return (
              <li key={id} data-pinned-result={id}>
                <button
                  className="er-pinned-reading"
                  aria-label={`Trace ${label}: ${value}${preview ? ", preview" : ""}`}
                  disabled={!read}
                  onClick={() => trace(id)}
                  title={read?.detail}
                >
                  <span>{label}</span>
                  <b data-pass={read?.pass}>{value}</b>
                  {preview && (
                    <small className="er-readout-preview">Preview</small>
                  )}
                </button>
                <button
                  aria-label={`Unpin ${label}`}
                  title="Unpin from Results"
                  onClick={() => remove(id)}
                >
                  <X size={13} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <select
        aria-label="Pin a worksheet result"
        value=""
        onChange={(e) => {
          if (e.target.value) add(e.target.value);
        }}
      >
        <option value="">Pin a value or requirement…</option>
        {Array.from(
          p.statements,
          ([id, s]) =>
            !ids.includes(id) && (
              <option key={id} value={id}>
                {s.relation !== "="
                  ? `Requirement: ${p.texts[id]}`
                  : s.anonymous
                    ? p.texts[id]
                    : s.name}
              </option>
            ),
        )}
      </select>
    </section>
  );
}
