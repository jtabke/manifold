import { useState } from "react";
import { project, type Page } from "./document";
import { quantityTitle, engineeringValue } from "./systemExploration";
import { ScrubNumber, type Scrub } from "./Interactions";

/** A view of an existing assigned quantity. Editing never creates another input. */
export function SystemInput({
  page,
  id,
  scrub,
  write,
  name,
}: {
  page: Page;
  id: string;
  scrub?: Scrub;
  write: (id: string, value: string) => string | undefined;
  name?: string;
}) {
  const p = project(page),
    statement = p.statements.get(id);
  const [draft, setDraft] = useState<string>();
  const [error, setError] = useState<string>();
  if (!statement) return null;
  const label = quantityTitle(statement.name, page);
  const commit = () => {
    if (draft === undefined) return;
    const problem = write(id, draft);
    setError(problem);
    if (!problem) setDraft(undefined);
  };
  return draft === undefined ? (
    <ScrubNumber
      name={name || `${scrub ? "Vary" : "Inspect"} ${statement.name}`}
      scrub={scrub}
      edit={() => {
        setError(undefined);
        setDraft(p.texts[id].replace(/^.*?(?::=|=)\s*/, ""));
      }}
    >
      {engineeringValue(page, id)}
    </ScrubNumber>
  ) : (
    <form
      className="sx-local-edit"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onSubmit={(e) => {
        e.preventDefault();
        commit();
      }}
    >
      <small className="sx-draft-label">Editing · not applied</small>
      <input
        autoFocus
        aria-label={`Edit exposed ${label}`}
        value={draft}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          setDraft(e.target.value);
          setError(undefined);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") {
            e.preventDefault();
            setDraft(undefined);
            setError(undefined);
          }
        }}
      />
      <button type="submit" aria-label={`Apply ${label}`}>
        ↵
      </button>
      {error && <small role="alert">{error}</small>}
    </form>
  );
}
