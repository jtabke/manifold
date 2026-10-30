import { useState } from "react";
import type { ExternalReference } from "../externalReference";
import { validateExternalReference } from "../externalReference";
export function ExternalReferenceView({
  name,
  reference,
  edit,
}: {
  name: string;
  reference: ExternalReference;
  edit: () => void;
}) {
  return (
    <div className="er-external-reference">
      <small>EXTERNAL REFERENCE</small>
      <a href={reference.url} target="_blank" rel="noreferrer">
        {name} ↗
      </a>
      <span>{reference.url}</span>
      <span>Revision · {reference.revision || "unspecified"}</span>
      <small>Referenced source · no model or values imported</small>
      <button
        onClick={(e) => {
          e.stopPropagation();
          edit();
        }}
      >
        Edit reference
      </button>
    </div>
  );
}
export function ExternalReferenceEditor({
  initial,
  save,
  close,
}: {
  initial?: { id: string; name: string; reference: ExternalReference };
  save: (name: string, reference: ExternalReference) => void;
  close: () => void;
}) {
  const [name, setName] = useState(initial?.name || ""),
    [url, setUrl] = useState(initial?.reference.url || ""),
    [revision, setRevision] = useState(initial?.reference.revision || ""),
    [error, setError] = useState("");
  return (
    <div
      className="er-modal-shade"
      onClick={close}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") close();
      }}
    >
      <form
        className="nm-review"
        role="dialog"
        aria-label="External reference"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          try {
            const reference = {
              url: url.trim(),
              revision: revision.trim() || undefined,
            };
            validateExternalReference(reference);
            if (!name.trim() || name.length > 160)
              throw Error("Name the source in 160 characters or fewer.");
            save(name.trim(), reference);
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <h2>External reference</h2>
        <p>
          Keep a source beside your work. This adds a reference; it does not
          import definitions or establish an engineering association.
        </p>
        <label>
          Name
          <input
            autoFocus
            aria-label="Reference name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <label>
          Address
          <input
            aria-label="Reference address"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
          />
        </label>
        <label>
          Revision or source date
          <input
            aria-label="Reference revision"
            value={revision}
            onChange={(e) => setRevision(e.target.value)}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <footer>
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button type="submit">Save reference</button>
        </footer>
      </form>
    </div>
  );
}
